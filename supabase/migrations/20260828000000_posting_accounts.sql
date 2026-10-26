-- Posting Settings: choose which ledger account each automatic posting uses,
-- instead of the fixed account names ("Cash", "Bank", "Sales Income", ...).
--
-- Every auto-posting RPC resolves its accounts through
-- get_or_create_default_account(org, name, type). That function now checks
-- posting_accounts first (keyed by the default name, e.g. 'Undeposited Funds'
-- -> 'undeposited_funds'), and only falls back to the old find-or-create by
-- name when nothing is mapped. So every invoice, receipt, payment, bill,
-- deposit, refund and expense follows the settings with no other change.
--
-- set_posting_account() is the only writer (accounts.manage):
-- * the account must be active, in the org, and of a type that fits the role;
-- * one account can't serve two of the sub-ledger-backed roles (Undeposited
--   Funds, Accounts Receivable, Inventory, Accounts Payable);
-- * for those four, the old account's balance is moved to the new one in the
--   same transaction ('posting_account_change' entry). Their balances must
--   always match their sub-ledger (payments awaiting deposit, open invoices,
--   stock value, open bills), and manual journal entries can't touch them, so
--   the move can't be left to the user;
-- * an Undeposited Funds or Inventory account becomes a control account
--   (blocked from manual entries), like the default ones.
-- Other roles only affect new postings; history stays where it is.

create table public.posting_accounts (
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_key text not null check (account_key in (
    'cash', 'bank', 'undeposited_funds', 'accounts_receivable', 'inventory',
    'accounts_payable', 'sales_income', 'cost_of_goods_sold', 'purchases'
  )),
  account_id uuid not null references public.ledger_accounts(id) on delete cascade,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (org_id, account_key)
);

alter table public.posting_accounts enable row level security;

create policy "org members can select posting accounts"
  on public.posting_accounts for select using (is_org_member(org_id));

-- The default account name a role falls back to, and the account types it
-- accepts. The names are the ones the posting RPCs already pass.
create or replace function public.posting_account_default_name(p_key text)
returns text
language sql
immutable
as $$
  select case p_key
    when 'cash' then 'Cash'
    when 'bank' then 'Bank'
    when 'undeposited_funds' then 'Undeposited Funds'
    when 'accounts_receivable' then 'Accounts Receivable'
    when 'inventory' then 'Inventory'
    when 'accounts_payable' then 'Accounts Payable'
    when 'sales_income' then 'Sales Income'
    when 'cost_of_goods_sold' then 'Cost of Goods Sold'
    when 'purchases' then 'Purchases'
  end;
$$;

create or replace function public.posting_account_types(p_key text)
returns text[]
language sql
immutable
as $$
  select case p_key
    when 'cash' then array['bank']
    when 'bank' then array['bank']
    when 'undeposited_funds' then array['other_current_asset']
    when 'accounts_receivable' then array['accounts_receivable']
    when 'inventory' then array['other_current_asset']
    when 'accounts_payable' then array['accounts_payable']
    when 'sales_income' then array['income', 'other_income']
    when 'cost_of_goods_sold' then array['cost_of_goods_sold']
    when 'purchases' then array['expense', 'cost_of_goods_sold', 'other_expense']
  end;
$$;

-- Roles whose balance is backed by a sub-ledger.
create or replace function public.posting_account_is_controlled(p_key text)
returns boolean
language sql
immutable
as $$
  select p_key in ('undeposited_funds', 'accounts_receivable', 'inventory', 'accounts_payable');
$$;

create or replace function public.get_or_create_default_account(p_org_id uuid, p_name text, p_account_type text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Posting Settings first ('Undeposited Funds' -> 'undeposited_funds').
  select account_id into v_id
  from posting_accounts
  where org_id = p_org_id and account_key = lower(replace(p_name, ' ', '_'));
  if v_id is not null then
    return v_id;
  end if;

  select id into v_id from ledger_accounts where org_id = p_org_id and name = p_name;
  if v_id is null then
    insert into ledger_accounts (org_id, name, account_type, description)
    values (p_org_id, p_name, p_account_type, 'Auto-created default account')
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- The account a role currently resolves to (mapped, or the default by name).
create or replace function public.posting_account_for(p_org_id uuid, p_key text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select account_id from posting_accounts where org_id = p_org_id and account_key = p_key),
    (select id from ledger_accounts where org_id = p_org_id and name = posting_account_default_name(p_key))
  );
$$;
revoke execute on function public.posting_account_for(uuid, text) from public, authenticated, anon;

create or replace function public.set_posting_account(p_org_id uuid, p_key text, p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account ledger_accounts%rowtype;
  v_old_id uuid;
  v_old_name text;
  v_balance numeric;
  v_other text;
begin
  perform assert_permission(p_org_id, 'accounts.manage');

  if posting_account_default_name(p_key) is null then
    raise exception 'unknown posting role: %', p_key;
  end if;

  select * into v_account from ledger_accounts where id = p_account_id;
  if not found or v_account.org_id <> p_org_id then
    raise exception 'account does not belong to this org';
  end if;
  if not v_account.is_active then
    raise exception 'choose an active account';
  end if;
  if not (v_account.account_type = any(posting_account_types(p_key))) then
    raise exception '% needs an account of type %', posting_account_default_name(p_key),
      array_to_string(posting_account_types(p_key), ' or ');
  end if;

  -- A sub-ledger-backed account can serve only one role.
  select k into v_other
  from unnest(array['undeposited_funds', 'accounts_receivable', 'inventory', 'accounts_payable']) k
  where k <> p_key
    and posting_account_for(p_org_id, k) = p_account_id
  limit 1;
  if v_other is not null then
    raise exception '"%" is already the % account. One account can''t do both jobs.',
      v_account.name, posting_account_default_name(v_other);
  end if;

  v_old_id := posting_account_for(p_org_id, p_key);
  if v_old_id = p_account_id then
    return;
  end if;

  -- Sub-ledger-backed roles: move the old account's balance across.
  if posting_account_is_controlled(p_key) and v_old_id is not null then
    select coalesce(sum(debit - credit), 0) into v_balance from journal_lines where account_id = v_old_id;
    select name into v_old_name from ledger_accounts where id = v_old_id;
    if v_balance <> 0 then
      perform post_journal_entry(
        p_org_id, org_today(p_org_id),
        'Posting Settings: moved the ' || posting_account_default_name(p_key) || ' balance from "' || v_old_name ||
          '" to "' || v_account.name || '"',
        case when v_balance > 0 then
          jsonb_build_array(
            jsonb_build_object('account_id', p_account_id, 'debit', v_balance, 'credit', 0),
            jsonb_build_object('account_id', v_old_id, 'debit', 0, 'credit', v_balance))
        else
          jsonb_build_array(
            jsonb_build_object('account_id', v_old_id, 'debit', -v_balance, 'credit', 0),
            jsonb_build_object('account_id', p_account_id, 'debit', 0, 'credit', -v_balance))
        end,
        'posting_account_change', null
      );
    end if;
  end if;

  if p_key in ('undeposited_funds', 'inventory') then
    update ledger_accounts set is_control_account = true where id = p_account_id;
  end if;

  insert into posting_accounts (org_id, account_key, account_id, updated_by, updated_at)
  values (p_org_id, p_key, p_account_id, auth.uid(), now())
  on conflict (org_id, account_key)
  do update set account_id = excluded.account_id, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;


-- Reset Data: the administrative balance moves (Posting Settings now, item
-- account changes next) go with the manual ledger entries, so a Chart of
-- Accounts reset is never blocked by them.
CREATE OR REPLACE FUNCTION public.reset_org_data(p_org_id uuid, p_categories text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_table text;
  v_constraint text;
  v_item_id uuid;
begin
  if org_role(p_org_id) <> 'owner' then
    raise exception 'only the owner can reset organization data';
  end if;

  if p_categories is null or array_length(p_categories, 1) is null then
    raise exception 'select at least one category to reset';
  end if;

  -- One summary row in the audit log instead of one per deleted document.
  perform set_config('app.skip_audit', 'on', true);

  begin
    if 'sales_receipts' = any(p_categories) then
      delete from sales_receipts where org_id = p_org_id;
      delete from stock_movements where org_id = p_org_id and reference_type = 'sales_receipt';
      delete from journal_entries where org_id = p_org_id and reference_type in ('sales_receipt', 'sales_receipt_cogs');
    end if;

    if 'invoices' = any(p_categories) then
      delete from deposits where org_id = p_org_id;
      delete from invoices where org_id = p_org_id;
      delete from stock_movements where org_id = p_org_id and reference_type = 'invoice';
      delete from journal_entries where org_id = p_org_id and reference_type in ('invoice', 'invoice_payment', 'invoice_void', 'invoice_cogs', 'invoice_void_cogs', 'deposit');
    end if;

    if 'supplier_bills' = any(p_categories) then
      delete from supplier_bills where org_id = p_org_id;
      delete from stock_movements where org_id = p_org_id and reference_type = 'supplier_bill';
      delete from journal_entries where org_id = p_org_id and reference_type in ('supplier_bill', 'supplier_bill_payment', 'supplier_bill_void');
    end if;

    if 'purchase_orders' = any(p_categories) then
      delete from purchase_orders where org_id = p_org_id;
      delete from stock_movements where org_id = p_org_id and reference_type = 'purchase_order_line';
    end if;

    if 'quotations' = any(p_categories) then
      delete from quotations where org_id = p_org_id;
    end if;

    if 'sales_orders' = any(p_categories) then
      delete from sales_orders where org_id = p_org_id;
    end if;

    if 'credit_memos' = any(p_categories) then
      delete from credit_memos where org_id = p_org_id;
      delete from stock_movements where org_id = p_org_id and reference_type = 'credit_memo';
      delete from journal_entries where org_id = p_org_id and reference_type in ('credit_memo', 'credit_memo_void', 'credit_memo_cogs', 'credit_memo_void_cogs');
    end if;

    if 'refunds' = any(p_categories) then
      delete from refunds where org_id = p_org_id;
      delete from journal_entries where org_id = p_org_id and reference_type = 'refund';
    end if;

    if 'expenses' = any(p_categories) then
      delete from expenses where org_id = p_org_id;
      delete from journal_entries where org_id = p_org_id and reference_type in ('expense', 'expense_void');
    end if;

    if 'inventory_activity' = any(p_categories) then
      delete from inventory_adjustments where org_id = p_org_id;
      delete from stock_movements where org_id = p_org_id and reason in ('transfer', 'adjustment');
      delete from journal_entries where org_id = p_org_id and reference_type = 'inventory_adjustment';
    end if;

    if 'audit_log' = any(p_categories) then
      delete from audit_log where org_id = p_org_id;
    end if;

    if 'ledger_entries' = any(p_categories) then
      delete from journal_entries where org_id = p_org_id and reference_type in ('manual', 'fund_transfer', 'inventory_cutover', 'posting_account_change', 'item_account_change');
    end if;

    -- Rebuild stock_levels from whatever stock_movements remain -- correct
    -- under any partial selection, not just a full reset.
    delete from stock_levels where org_id = p_org_id;
    insert into stock_levels (org_id, item_id, location_id, quantity)
    select org_id, item_id, location_id, sum(quantity_delta)
    from stock_movements
    where org_id = p_org_id
    group by org_id, item_id, location_id;

    if 'items' = any(p_categories) then
      delete from items where org_id = p_org_id;
    end if;

    if 'customers' = any(p_categories) then
      delete from customers where org_id = p_org_id;
    end if;

    if 'suppliers' = any(p_categories) then
      delete from suppliers where org_id = p_org_id;
    end if;

    if 'locations' = any(p_categories) then
      delete from locations where org_id = p_org_id;
    end if;

    if 'reference_data' = any(p_categories) then
      delete from categories where org_id = p_org_id;
      delete from brands where org_id = p_org_id;
      delete from units_of_measure where org_id = p_org_id;
      delete from areas where org_id = p_org_id;
      delete from sales_reps where org_id = p_org_id;
    end if;

    if 'chart_of_accounts' = any(p_categories) then
      delete from ledger_accounts where org_id = p_org_id;
    end if;
  exception
    when foreign_key_violation then
      get stacked diagnostics v_table = table_name, v_constraint = constraint_name;
      raise exception 'Cannot complete this reset -- some selected data is still referenced by "%" (constraint %). Include the related category in your selection too.',
        coalesce(v_table, 'another table'), coalesce(v_constraint, 'unknown');
  end;

  -- Rebuild avg_cost for every surviving item, same "replay whatever
  -- history remains" idiom as the stock_levels rebuild above.
  for v_item_id in select id from items where org_id = p_org_id
  loop
    perform recompute_item_avg_cost(v_item_id);
  end loop;

  -- Reset document-number counters for any doc_type whose table is now
  -- completely empty for this org -- safe under partial selection, won't
  -- collide with a surviving document's number.
  if not exists (select 1 from sales_receipts where org_id = p_org_id) then
    delete from doc_number_counters where org_id = p_org_id and doc_type = 'sales_receipt';
  end if;
  if not exists (select 1 from invoices where org_id = p_org_id) then
    delete from doc_number_counters where org_id = p_org_id and doc_type = 'invoice';
  end if;
  if not exists (select 1 from supplier_bills where org_id = p_org_id) then
    delete from doc_number_counters where org_id = p_org_id and doc_type = 'supplier_bill';
  end if;
  if not exists (select 1 from quotations where org_id = p_org_id) then
    delete from doc_number_counters where org_id = p_org_id and doc_type = 'quotation';
  end if;
  if not exists (select 1 from sales_orders where org_id = p_org_id) then
    delete from doc_number_counters where org_id = p_org_id and doc_type = 'sales_order';
  end if;
  if not exists (select 1 from credit_memos where org_id = p_org_id) then
    delete from doc_number_counters where org_id = p_org_id and doc_type = 'credit_memo';
  end if;
  if not exists (select 1 from refunds where org_id = p_org_id) then
    delete from doc_number_counters where org_id = p_org_id and doc_type = 'refund';
  end if;
  if not exists (select 1 from expenses where org_id = p_org_id) then
    delete from doc_number_counters where org_id = p_org_id and doc_type = 'expense';
  end if;
  if not exists (select 1 from deposits where org_id = p_org_id) then
    delete from doc_number_counters where org_id = p_org_id and doc_type = 'deposit';
  end if;
  if not exists (select 1 from inventory_adjustments where org_id = p_org_id) then
    delete from doc_number_counters where org_id = p_org_id and doc_type = 'inventory_adjustment';
  end if;
  if not exists (select 1 from journal_entries where org_id = p_org_id) then
    delete from doc_number_counters where org_id = p_org_id and doc_type = 'journal_entry';
  end if;

  perform set_config('app.skip_audit', 'off', true);
  insert into audit_log (org_id, table_name, doc_type, action, changed_fields, changed_by, note)
  values (p_org_id, 'reset_org_data', 'reset_data', 'delete', p_categories, auth.uid(), 'Reset Data');
end;
$function$;
