-- Per-item accounts: an item can have its own Income, Cost of Goods Sold and
-- Inventory account. Items without one use Posting Settings, exactly as
-- before. Postings are grouped per account (one journal line per account,
-- not per item), with a document discount spread over the income lines in
-- proportion to their amounts.
--
-- Voids rebuild their reversal from the document's own lines using the
-- accounts that apply now. Copying the original journal lines would be wrong
-- for Inventory and Accounts Receivable: if either was moved in between
-- (Posting Settings, or an item's Inventory account change), its balance has
-- already been moved to the new account.

alter table public.items
  add column income_account_id uuid references public.ledger_accounts(id) on delete set null,
  add column cogs_account_id uuid references public.ledger_accounts(id) on delete set null,
  add column inventory_account_id uuid references public.ledger_accounts(id) on delete set null;

-- Journal lines from [{account_id, amount}] groups, all on one side (a
-- negative amount goes on the other side). With p_total, the amounts are
-- scaled to add up to exactly p_total, rounded to cents, and any rounding
-- remainder goes to the largest line.
create or replace function public.journal_lines_for(p_groups jsonb, p_side text, p_total numeric default null)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_sum numeric;
  v_ids uuid[] := '{}';
  v_amounts numeric[] := '{}';
  v_allocated numeric := 0;
  v_amount numeric;
  v_largest integer;
  v_lines jsonb := '[]'::jsonb;
  v_rec record;
  v_debit_side boolean;
begin
  if p_side not in ('debit', 'credit') then
    raise exception 'side must be debit or credit';
  end if;

  select coalesce(sum((g ->> 'amount')::numeric), 0) into v_sum
  from jsonb_array_elements(coalesce(p_groups, '[]'::jsonb)) g;

  for v_rec in
    select (g ->> 'account_id')::uuid as account_id, (g ->> 'amount')::numeric as amount
    from jsonb_array_elements(coalesce(p_groups, '[]'::jsonb)) g
    where (g ->> 'amount')::numeric <> 0
  loop
    if p_total is null then
      v_amount := v_rec.amount;
    else
      if v_sum = 0 then
        raise exception 'cannot spread % over lines that add up to zero', p_total;
      end if;
      v_amount := round(v_rec.amount * p_total / v_sum, 2);
    end if;
    v_ids := v_ids || v_rec.account_id;
    v_amounts := v_amounts || v_amount;
    v_allocated := v_allocated + v_amount;
  end loop;

  if p_total is not null and p_total <> 0 then
    if coalesce(array_length(v_amounts, 1), 0) = 0 then
      raise exception 'no lines to post % against', p_total;
    end if;
    select i into v_largest from generate_subscripts(v_amounts, 1) i order by abs(v_amounts[i]) desc, i limit 1;
    v_amounts[v_largest] := v_amounts[v_largest] + (p_total - v_allocated);
  end if;

  for i in 1 .. coalesce(array_length(v_amounts, 1), 0) loop
    continue when v_amounts[i] = 0;
    v_debit_side := (v_amounts[i] > 0) = (p_side = 'debit');
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_ids[i],
      'debit', case when v_debit_side then abs(v_amounts[i]) else 0 end,
      'credit', case when v_debit_side then 0 else abs(v_amounts[i]) end));
  end loop;

  return v_lines;
end;
$$;

-- A document's amounts grouped by the account each item posts to:
--   income:    line totals by income account (Sales Income by default)
--   cogs:      quantity x snapshot cost by COGS account
--   inventory: quantity x snapshot cost (a supplier bill: line total) by
--              Inventory account
create or replace function public.document_account_groups(p_org_id uuid, p_doc_type text, p_doc_id uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_default uuid;
  v_result jsonb;
begin
  v_default := case p_kind
    when 'income' then get_or_create_default_account(p_org_id, 'Sales Income', 'income')
    when 'cogs' then get_or_create_default_account(p_org_id, 'Cost of Goods Sold', 'cost_of_goods_sold')
    when 'inventory' then get_or_create_default_account(p_org_id, 'Inventory', 'other_current_asset')
  end;
  if v_default is null then
    raise exception 'unknown account kind: %', p_kind;
  end if;

  with lines as (
    select item_id, quantity, line_total, unit_cost from invoice_items
      where p_doc_type = 'invoice' and invoice_id = p_doc_id
    union all
    select item_id, quantity, line_total, unit_cost from sales_receipt_items
      where p_doc_type = 'sales_receipt' and sales_receipt_id = p_doc_id
    union all
    select item_id, quantity, line_total, unit_cost from credit_memo_items
      where p_doc_type = 'credit_memo' and credit_memo_id = p_doc_id
    union all
    select item_id, quantity, line_total, unit_cost from supplier_bill_items
      where p_doc_type = 'supplier_bill' and bill_id = p_doc_id
  ),
  grouped as (
    select
      coalesce(case p_kind
        when 'income' then it.income_account_id
        when 'cogs' then it.cogs_account_id
        else it.inventory_account_id
      end, v_default) as account_id,
      sum(case
        when p_kind = 'income' or p_doc_type = 'supplier_bill' then l.line_total
        else l.quantity * coalesce(l.unit_cost, 0)
      end) as amount
    from lines l
    join items it on it.id = l.item_id and it.org_id = p_org_id
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('account_id', account_id, 'amount', amount) order by account_id), '[]'::jsonb)
  into v_result
  from grouped
  where amount <> 0;

  return v_result;
end;
$$;

revoke execute on function public.document_account_groups(uuid, text, uuid, text) from public, authenticated, anon;

-- Item account checks: the right type, active, this org's, and (Inventory)
-- never the Undeposited Funds account. Choosing the default Inventory account
-- is stored as "use the default" so Posting Settings keeps governing it.
create or replace function public.items_check_accounts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed boolean;
  v_account ledger_accounts%rowtype;
  v_check record;
begin
  if tg_op = 'INSERT' then
    v_changed := new.income_account_id is not null or new.cogs_account_id is not null or new.inventory_account_id is not null;
  else
    v_changed := new.income_account_id is distinct from old.income_account_id
      or new.cogs_account_id is distinct from old.cogs_account_id
      or new.inventory_account_id is distinct from old.inventory_account_id;
  end if;
  if not v_changed then
    return new;
  end if;

  if auth.uid() is not null then
    perform assert_permission(new.org_id, 'accounts.manage');
  end if;

  if new.inventory_account_id is not null
     and new.inventory_account_id = posting_account_for(new.org_id, 'inventory') then
    new.inventory_account_id := null;
  end if;

  for v_check in
    select * from (values
      (new.income_account_id, array['income', 'other_income'], 'income account', 'Income or Other Income'),
      (new.cogs_account_id, array['cost_of_goods_sold'], 'cost of goods sold account', 'Cost of Goods Sold'),
      (new.inventory_account_id, array['other_current_asset'], 'inventory account', 'Other Current Asset')
    ) v(account_id, types, label, type_label)
    where v.account_id is not null
  loop
    select * into v_account from ledger_accounts where id = v_check.account_id;
    if not found or v_account.org_id <> new.org_id then
      raise exception 'The % does not belong to this business', v_check.label;
    end if;
    if not v_account.is_active then
      raise exception 'The % "%" is inactive', v_check.label, v_account.name;
    end if;
    if not (v_account.account_type = any(v_check.types)) then
      raise exception 'The % must be an % account; "%" isn''t', v_check.label, v_check.type_label, v_account.name;
    end if;
  end loop;

  if new.inventory_account_id is not null then
    if new.inventory_account_id = posting_account_for(new.org_id, 'undeposited_funds') then
      raise exception 'The Undeposited Funds account can''t hold inventory';
    end if;
    -- Its balance must match the stock behind it, so it can't take manual entries.
    update ledger_accounts set is_control_account = true
    where id = new.inventory_account_id and not is_control_account;
  end if;

  return new;
end;
$$;

create trigger items_check_accounts
  before insert or update of income_account_id, cogs_account_id, inventory_account_id on public.items
  for each row execute function public.items_check_accounts();

-- Changing an item's Inventory account moves its stock value (quantity on
-- hand x average cost) from the old account to the new one.
create or replace function public.items_move_inventory_value()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_default uuid;
  v_from uuid;
  v_to uuid;
  v_qty numeric;
  v_value numeric;
begin
  v_default := get_or_create_default_account(new.org_id, 'Inventory', 'other_current_asset');
  v_from := coalesce(old.inventory_account_id, v_default);
  v_to := coalesce(new.inventory_account_id, v_default);
  if v_from = v_to then
    return null;
  end if;

  select coalesce(sum(quantity), 0) into v_qty
  from stock_levels where org_id = new.org_id and item_id = new.id;
  v_value := round(v_qty * coalesce(new.avg_cost, 0), 2);
  if v_value = 0 then
    return null;
  end if;

  perform post_journal_entry(
    new.org_id, org_today(new.org_id),
    'Inventory account changed for ' || new.name,
    jsonb_build_array(
      jsonb_build_object('account_id', v_to, 'debit', greatest(v_value, 0), 'credit', greatest(-v_value, 0)),
      jsonb_build_object('account_id', v_from, 'debit', greatest(-v_value, 0), 'credit', greatest(v_value, 0))),
    'item_account_change', new.id
  );
  return null;
end;
$$;

create trigger items_move_inventory_value
  after update of inventory_account_id on public.items
  for each row
  when (old.inventory_account_id is distinct from new.inventory_account_id)
  execute function public.items_move_inventory_value();

revoke execute on function public.items_check_accounts() from public, authenticated, anon;
revoke execute on function public.items_move_inventory_value() from public, authenticated, anon;

-- The posting RPCs, with only their journal postings changed.

CREATE OR REPLACE FUNCTION public.create_invoice(p_org_id uuid, p_customer_id uuid, p_due_date date, p_lines jsonb, p_notes text DEFAULT NULL::text, p_sales_rep_id uuid DEFAULT NULL::uuid, p_discount numeric DEFAULT 0, p_sales_order_id uuid DEFAULT NULL::uuid)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoice invoices%rowtype;
  v_invoice_number text;
  v_subtotal numeric;
  v_discount numeric := coalesce(p_discount, 0);
  v_order sales_orders%rowtype;
  v_line jsonb;
  v_item_id uuid;
  v_location_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_line_discount numeric;
  v_item_org uuid;
  v_item_cost numeric;
  v_commission_rate numeric;
  v_total_cogs numeric := 0;
begin
  perform assert_permission(p_org_id, 'invoices.create');

  if p_customer_id is null then
    raise exception 'an invoice requires a customer';
  end if;
  if (select org_id from customers where id = p_customer_id) is distinct from p_org_id then
    raise exception 'customer does not belong to this org';
  end if;
  if p_due_date is null then
    raise exception 'an invoice requires a due date';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'an invoice must have at least one line item';
  end if;
  perform assert_sales_rep_in_org(p_org_id, p_sales_rep_id);

  -- Check every line's discount first, so an oversized one is reported as
  -- such rather than as a document discount above a negative subtotal.
  perform assert_valid_line_discount((line ->> 'quantity')::numeric, (line ->> 'unit_price')::numeric,
                                     coalesce((line ->> 'discount')::numeric, 0))
  from jsonb_array_elements(p_lines) as line;

  select coalesce(sum((line ->> 'quantity')::numeric * (line ->> 'unit_price')::numeric
                      - coalesce((line ->> 'discount')::numeric, 0)), 0)
  into v_subtotal
  from jsonb_array_elements(p_lines) as line;

  if v_discount < 0 or v_discount > v_subtotal then
    raise exception 'the invoice discount must be between 0 and the subtotal';
  end if;

  if p_sales_order_id is not null then
    select * into v_order from sales_orders where id = p_sales_order_id for update;
    if not found or v_order.org_id <> p_org_id then
      raise exception 'sales order not found';
    end if;
    if v_order.status <> 'open' then
      raise exception 'sales order % is already %', v_order.order_number, v_order.status;
    end if;
    if v_order.customer_id <> p_customer_id then
      raise exception 'the invoice must be for the sales order''s customer';
    end if;
  end if;

  v_invoice_number := next_document_number(p_org_id, 'invoice', 'INV');

  insert into invoices (org_id, invoice_number, customer_id, sales_rep_id, due_date, subtotal, discount, total, notes, created_by)
  values (p_org_id, v_invoice_number, p_customer_id, p_sales_rep_id, p_due_date, v_subtotal, v_discount,
          v_subtotal - v_discount, p_notes, auth.uid())
  returning * into v_invoice;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := (v_line ->> 'item_id')::uuid;
    v_location_id := (v_line ->> 'location_id')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_price := (v_line ->> 'unit_price')::numeric;
    v_line_discount := coalesce((v_line ->> 'discount')::numeric, 0);

    if v_quantity <= 0 then
      raise exception 'quantity must be positive';
    end if;
    if v_unit_price < 0 then
      raise exception 'unit price cannot be negative';
    end if;
    perform assert_valid_line_discount(v_quantity, v_unit_price, v_line_discount);

    select org_id, avg_cost, commission_rate into v_item_org, v_item_cost, v_commission_rate
    from items where id = v_item_id;
    if v_item_org is distinct from p_org_id then
      raise exception 'item does not belong to this org';
    end if;
    if (select org_id from locations where id = v_location_id) is distinct from p_org_id then
      raise exception 'location does not belong to this org';
    end if;

    insert into invoice_items (invoice_id, item_id, location_id, quantity, unit_price, discount, unit_cost, commission_rate, line_total)
    values (v_invoice.id, v_item_id, v_location_id, v_quantity, v_unit_price, v_line_discount, v_item_cost,
            v_commission_rate, v_quantity * v_unit_price - v_line_discount);

    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (p_org_id, v_item_id, v_location_id, -v_quantity, 'sale', 'invoice', v_invoice.id, auth.uid());

    v_total_cogs := v_total_cogs + (v_quantity * coalesce(v_item_cost, 0));
  end loop;

  -- Revenue per item income account (the invoice discount spread in
  -- proportion), cost per item COGS / Inventory account. Items without their
  -- own accounts use Posting Settings.
  if v_invoice.total > 0 then
    perform post_journal_entry(
      p_org_id, v_invoice.issue_date, 'Invoice ' || v_invoice_number,
      jsonb_build_array(jsonb_build_object(
        'account_id', get_or_create_default_account(p_org_id, 'Accounts Receivable', 'accounts_receivable'),
        'debit', v_invoice.total, 'credit', 0))
      || journal_lines_for(document_account_groups(p_org_id, 'invoice', v_invoice.id, 'income'), 'credit', v_invoice.total),
      'invoice', v_invoice.id
    );
  end if;

  if v_total_cogs > 0 then
    perform post_journal_entry(
      p_org_id, v_invoice.issue_date, 'COGS for invoice ' || v_invoice_number,
      journal_lines_for(document_account_groups(p_org_id, 'invoice', v_invoice.id, 'cogs'), 'debit', v_total_cogs)
      || journal_lines_for(document_account_groups(p_org_id, 'invoice', v_invoice.id, 'inventory'), 'credit', v_total_cogs),
      'invoice_cogs', v_invoice.id
    );
  end if;

  if p_sales_order_id is not null then
    update sales_orders set status = 'invoiced', invoice_id = v_invoice.id, updated_at = now()
    where id = p_sales_order_id;
  end if;

  return v_invoice;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_sales_receipt(p_org_id uuid, p_customer_id uuid, p_payment_method text, p_lines jsonb, p_sales_rep_id uuid DEFAULT NULL::uuid, p_discount numeric DEFAULT 0)
 RETURNS sales_receipts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_receipt sales_receipts%rowtype;
  v_receipt_number text;
  v_subtotal numeric;
  v_discount numeric := coalesce(p_discount, 0);
  v_line jsonb;
  v_item_id uuid;
  v_location_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_line_discount numeric;
  v_item_org uuid;
  v_item_cost numeric;
  v_commission_rate numeric;
  v_total_cogs numeric := 0;
begin
  perform assert_permission(p_org_id, 'sales.create');

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a sale must have at least one line item';
  end if;
  if p_customer_id is not null
     and (select org_id from customers where id = p_customer_id) is distinct from p_org_id then
    raise exception 'customer does not belong to this org';
  end if;
  perform assert_sales_rep_in_org(p_org_id, p_sales_rep_id);

  -- Check every line's discount first, so an oversized one is reported as
  -- such rather than as a document discount above a negative subtotal.
  perform assert_valid_line_discount((line ->> 'quantity')::numeric, (line ->> 'unit_price')::numeric,
                                     coalesce((line ->> 'discount')::numeric, 0))
  from jsonb_array_elements(p_lines) as line;

  select coalesce(sum((line ->> 'quantity')::numeric * (line ->> 'unit_price')::numeric
                      - coalesce((line ->> 'discount')::numeric, 0)), 0)
  into v_subtotal
  from jsonb_array_elements(p_lines) as line;

  if v_discount < 0 or v_discount > v_subtotal then
    raise exception 'the sale discount must be between 0 and the subtotal';
  end if;

  v_receipt_number := next_document_number(p_org_id, 'sales_receipt', 'SR');

  insert into sales_receipts (org_id, receipt_number, customer_id, sales_rep_id, payment_method, subtotal, discount, total, created_by)
  values (p_org_id, v_receipt_number, p_customer_id, p_sales_rep_id, p_payment_method, v_subtotal, v_discount,
          v_subtotal - v_discount, auth.uid())
  returning * into v_receipt;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := (v_line ->> 'item_id')::uuid;
    v_location_id := (v_line ->> 'location_id')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_price := (v_line ->> 'unit_price')::numeric;
    v_line_discount := coalesce((v_line ->> 'discount')::numeric, 0);

    if v_quantity <= 0 then
      raise exception 'quantity must be positive';
    end if;
    if v_unit_price < 0 then
      raise exception 'unit price cannot be negative';
    end if;
    perform assert_valid_line_discount(v_quantity, v_unit_price, v_line_discount);

    select org_id, avg_cost, commission_rate into v_item_org, v_item_cost, v_commission_rate
    from items where id = v_item_id;
    if v_item_org is distinct from p_org_id then
      raise exception 'item does not belong to this org';
    end if;
    if (select org_id from locations where id = v_location_id) is distinct from p_org_id then
      raise exception 'location does not belong to this org';
    end if;

    insert into sales_receipt_items (sales_receipt_id, item_id, location_id, quantity, unit_price, discount, unit_cost, commission_rate, line_total)
    values (v_receipt.id, v_item_id, v_location_id, v_quantity, v_unit_price, v_line_discount, v_item_cost,
            v_commission_rate, v_quantity * v_unit_price - v_line_discount);

    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (p_org_id, v_item_id, v_location_id, -v_quantity, 'sale', 'sales_receipt', v_receipt.id, auth.uid());

    v_total_cogs := v_total_cogs + (v_quantity * coalesce(v_item_cost, 0));
  end loop;

  -- Revenue per item income account (the sale discount spread in
  -- proportion), cost per item COGS / Inventory account.
  if v_receipt.total > 0 then
    perform post_journal_entry(
      p_org_id, current_date, 'Sales receipt ' || v_receipt_number,
      jsonb_build_array(jsonb_build_object(
        'account_id', get_or_create_default_account(
          p_org_id, case when p_payment_method = 'cash' then 'Cash' else 'Bank' end, 'bank'),
        'debit', v_receipt.total, 'credit', 0))
      || journal_lines_for(document_account_groups(p_org_id, 'sales_receipt', v_receipt.id, 'income'), 'credit', v_receipt.total),
      'sales_receipt', v_receipt.id
    );
  end if;

  if v_total_cogs > 0 then
    perform post_journal_entry(
      p_org_id, current_date, 'COGS for sales receipt ' || v_receipt_number,
      journal_lines_for(document_account_groups(p_org_id, 'sales_receipt', v_receipt.id, 'cogs'), 'debit', v_total_cogs)
      || journal_lines_for(document_account_groups(p_org_id, 'sales_receipt', v_receipt.id, 'inventory'), 'credit', v_total_cogs),
      'sales_receipt_cogs', v_receipt.id
    );
  end if;

  return v_receipt;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_credit_memo(p_org_id uuid, p_customer_id uuid, p_lines jsonb, p_notes text DEFAULT NULL::text, p_sales_rep_id uuid DEFAULT NULL::uuid)
 RETURNS credit_memos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_credit_memo credit_memos%rowtype;
  v_credit_memo_number text;
  v_subtotal numeric;
  v_line jsonb;
  v_item_id uuid;
  v_location_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_item_org uuid;
  v_item_cost numeric;
  v_total_cost numeric := 0;
begin
  perform assert_permission(p_org_id, 'credit_memos.create');

  if p_customer_id is null then
    raise exception 'a credit memo requires a customer';
  end if;
  if (select org_id from customers where id = p_customer_id) is distinct from p_org_id then
    raise exception 'customer does not belong to this org';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a credit memo must have at least one line item';
  end if;
  perform assert_sales_rep_in_org(p_org_id, p_sales_rep_id);

  select coalesce(sum((line ->> 'quantity')::numeric * (line ->> 'unit_price')::numeric), 0)
  into v_subtotal
  from jsonb_array_elements(p_lines) as line;

  v_credit_memo_number := next_document_number(p_org_id, 'credit_memo', 'CM');

  insert into credit_memos (org_id, credit_memo_number, customer_id, sales_rep_id, subtotal, total, notes, created_by)
  values (p_org_id, v_credit_memo_number, p_customer_id, p_sales_rep_id, v_subtotal, v_subtotal, p_notes, auth.uid())
  returning * into v_credit_memo;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := (v_line ->> 'item_id')::uuid;
    v_location_id := (v_line ->> 'location_id')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_price := (v_line ->> 'unit_price')::numeric;

    if v_quantity <= 0 then
      raise exception 'quantity must be positive';
    end if;
    if v_unit_price < 0 then
      raise exception 'unit price cannot be negative';
    end if;

    select org_id, avg_cost into v_item_org, v_item_cost from items where id = v_item_id;
    if v_item_org is distinct from p_org_id then
      raise exception 'item does not belong to this org';
    end if;
    if (select org_id from locations where id = v_location_id) is distinct from p_org_id then
      raise exception 'location does not belong to this org';
    end if;

    insert into credit_memo_items (credit_memo_id, item_id, location_id, quantity, unit_price, unit_cost, line_total)
    values (v_credit_memo.id, v_item_id, v_location_id, v_quantity, v_unit_price, v_item_cost, v_quantity * v_unit_price);

    -- Positive: goods physically coming back.
    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (p_org_id, v_item_id, v_location_id, v_quantity, 'return', 'credit_memo', v_credit_memo.id, auth.uid());

    v_total_cost := v_total_cost + (v_quantity * coalesce(v_item_cost, 0));
  end loop;

  -- Revenue reversed per item income account; returned goods' cost moved
  -- back per item Inventory / COGS account.
  if v_subtotal > 0 then
    perform post_journal_entry(
      p_org_id, v_credit_memo.issue_date, 'Credit memo ' || v_credit_memo_number,
      journal_lines_for(document_account_groups(p_org_id, 'credit_memo', v_credit_memo.id, 'income'), 'debit', v_subtotal)
      || jsonb_build_array(jsonb_build_object(
        'account_id', get_or_create_default_account(p_org_id, 'Accounts Receivable', 'accounts_receivable'),
        'debit', 0, 'credit', v_subtotal)),
      'credit_memo', v_credit_memo.id
    );
  end if;

  if v_total_cost > 0 then
    perform post_journal_entry(
      p_org_id, v_credit_memo.issue_date, 'Cost of returns for credit memo ' || v_credit_memo_number,
      journal_lines_for(document_account_groups(p_org_id, 'credit_memo', v_credit_memo.id, 'inventory'), 'debit', v_total_cost)
      || journal_lines_for(document_account_groups(p_org_id, 'credit_memo', v_credit_memo.id, 'cogs'), 'credit', v_total_cost),
      'credit_memo_cogs', v_credit_memo.id
    );
  end if;

  return v_credit_memo;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_supplier_bill(p_org_id uuid, p_supplier_id uuid, p_due_date date, p_lines jsonb, p_notes text DEFAULT NULL::text)
 RETURNS supplier_bills
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_bill supplier_bills%rowtype;
  v_bill_number text;
  v_subtotal numeric;
  v_supplier_org uuid;
  v_line jsonb;
  v_item_id uuid;
  v_location_id uuid;
  v_quantity numeric;
  v_unit_cost numeric;
  v_item_org uuid;
  v_location_org uuid;
begin
  perform assert_permission(p_org_id, 'supplier_bills.create');

  if p_supplier_id is null then
    raise exception 'a bill requires a supplier';
  end if;

  select org_id into v_supplier_org from suppliers where id = p_supplier_id;
  if v_supplier_org is distinct from p_org_id then
    raise exception 'supplier does not belong to this org';
  end if;

  if p_due_date is null then
    raise exception 'a bill requires a due date';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a bill must have at least one line item';
  end if;

  select coalesce(sum((line ->> 'quantity')::numeric * (line ->> 'unit_cost')::numeric), 0)
  into v_subtotal
  from jsonb_array_elements(p_lines) as line;

  v_bill_number := next_document_number(p_org_id, 'supplier_bill', 'BILL');

  insert into supplier_bills (org_id, bill_number, supplier_id, due_date, subtotal, total, notes, created_by)
  values (p_org_id, v_bill_number, p_supplier_id, p_due_date, v_subtotal, v_subtotal, p_notes, auth.uid())
  returning * into v_bill;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := (v_line ->> 'item_id')::uuid;
    v_location_id := (v_line ->> 'location_id')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_cost := (v_line ->> 'unit_cost')::numeric;

    if v_quantity <= 0 then
      raise exception 'quantity must be positive';
    end if;
    if v_unit_cost < 0 then
      raise exception 'unit cost cannot be negative';
    end if;

    select org_id into v_item_org from items where id = v_item_id;
    if v_item_org is distinct from p_org_id then
      raise exception 'item does not belong to this org';
    end if;

    select org_id into v_location_org from locations where id = v_location_id;
    if v_location_org is distinct from p_org_id then
      raise exception 'location does not belong to this org';
    end if;

    insert into supplier_bill_items (bill_id, item_id, location_id, quantity, unit_cost, line_total)
    values (v_bill.id, v_item_id, v_location_id, v_quantity, v_unit_cost, v_quantity * v_unit_cost);

    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (p_org_id, v_item_id, v_location_id, v_quantity, 'receive', 'supplier_bill', v_bill.id, auth.uid());

    perform recompute_item_avg_cost(v_item_id);
  end loop;

  -- Stock capitalised per item Inventory account.
  if v_subtotal > 0 then
    perform post_journal_entry(
      p_org_id, v_bill.issue_date, 'Supplier bill ' || v_bill_number,
      journal_lines_for(document_account_groups(p_org_id, 'supplier_bill', v_bill.id, 'inventory'), 'debit', v_subtotal)
      || jsonb_build_array(jsonb_build_object(
        'account_id', get_or_create_default_account(p_org_id, 'Accounts Payable', 'accounts_payable'),
        'debit', 0, 'credit', v_subtotal)),
      'supplier_bill', v_bill.id
    );
  end if;

  return v_bill;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_inventory_adjustment(p_org_id uuid, p_location_id uuid, p_adjustment_type text, p_adjustment_account_id uuid, p_adjustment_date date, p_reference_number text, p_description text, p_lines jsonb, p_reason text DEFAULT 'other'::text)
 RETURNS inventory_adjustments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_adjustment inventory_adjustments%rowtype;
  v_adjustment_number text;
  v_location_org uuid;
  v_account_org uuid;
  v_line jsonb;
  v_item_id uuid;
  v_item_org uuid;
  v_qty_on_hand_before numeric;
  v_current_avg_cost numeric;
  v_current_value_before numeric;
  v_new_qty numeric;
  v_new_value numeric;
  v_resulting_avg_cost numeric;
  v_value_diff numeric;
  v_qty_other_locations numeric;
  v_value_other_locations numeric;
  v_new_total_qty numeric;
  v_new_total_value numeric;
  v_total_value_diff numeric := 0;
begin
  perform assert_permission(p_org_id, 'inventory.adjust');

  if p_adjustment_type not in ('quantity', 'value', 'quantity_and_value') then
    raise exception 'invalid adjustment type: %', p_adjustment_type;
  end if;

  if coalesce(p_reason, 'other') not in ('stock_count', 'damaged', 'expired', 'lost', 'revaluation', 'other') then
    raise exception 'invalid adjustment reason: %', p_reason;
  end if;

  select org_id into v_location_org from locations where id = p_location_id;
  if v_location_org is distinct from p_org_id then
    raise exception 'location does not belong to this org';
  end if;

  select org_id into v_account_org from ledger_accounts where id = p_adjustment_account_id;
  if v_account_org is distinct from p_org_id then
    raise exception 'adjustment account does not belong to this org';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'an inventory adjustment must have at least one line item';
  end if;

  v_adjustment_number := next_document_number(p_org_id, 'inventory_adjustment', 'ADJ');

  insert into inventory_adjustments (
    org_id, adjustment_number, adjustment_type, location_id, adjustment_account_id,
    adjustment_date, reference_number, description, reason, created_by
  )
  values (
    p_org_id, v_adjustment_number, p_adjustment_type, p_location_id, p_adjustment_account_id,
    coalesce(p_adjustment_date, current_date), p_reference_number, p_description, coalesce(p_reason, 'other'), auth.uid()
  )
  returning * into v_adjustment;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := (v_line ->> 'item_id')::uuid;

    select org_id into v_item_org from items where id = v_item_id;
    if v_item_org is distinct from p_org_id then
      raise exception 'item does not belong to this org';
    end if;

    -- Serialize against a concurrent adjustment or supplier bill for the
    -- same item before reading anything cost-related.
    perform id from items where id = v_item_id for update;

    select coalesce(quantity, 0) into v_qty_on_hand_before
    from stock_levels where item_id = v_item_id and location_id = p_location_id;
    v_qty_on_hand_before := coalesce(v_qty_on_hand_before, 0);

    select avg_cost into v_current_avg_cost from items where id = v_item_id;
    v_current_value_before := v_qty_on_hand_before * v_current_avg_cost;

    if p_adjustment_type = 'quantity' then
      if v_line ->> 'new_qty' is null then
        raise exception 'quantity adjustment requires a new quantity for every line';
      end if;
      v_new_qty := (v_line ->> 'new_qty')::numeric;
      v_new_value := v_new_qty * v_current_avg_cost;
      v_resulting_avg_cost := v_current_avg_cost;
    else
      if v_line ->> 'new_value' is null then
        raise exception '% adjustment requires a new value for every line', p_adjustment_type;
      end if;
      v_new_value := (v_line ->> 'new_value')::numeric;

      if p_adjustment_type = 'quantity_and_value' then
        if v_line ->> 'new_qty' is null then
          raise exception 'quantity and value adjustment requires a new quantity for every line';
        end if;
        v_new_qty := (v_line ->> 'new_qty')::numeric;
      else
        v_new_qty := v_qty_on_hand_before;
      end if;

      select coalesce(sum(quantity), 0) into v_qty_other_locations
      from stock_levels where item_id = v_item_id;
      v_qty_other_locations := v_qty_other_locations - v_qty_on_hand_before;
      v_value_other_locations := v_qty_other_locations * v_current_avg_cost;

      v_new_total_qty := v_qty_other_locations + v_new_qty;
      v_new_total_value := v_value_other_locations + v_new_value;
      v_resulting_avg_cost := case when v_new_total_qty > 0 then v_new_total_value / v_new_total_qty else 0 end;
    end if;

    if v_new_qty < 0 then
      raise exception 'new quantity cannot be negative';
    end if;

    v_value_diff := v_new_value - v_current_value_before;

    insert into inventory_adjustment_items (
      adjustment_id, item_id, qty_on_hand_before, current_value_before,
      new_qty, new_value, resulting_avg_cost, value_diff
    )
    values (
      v_adjustment.id, v_item_id, v_qty_on_hand_before, v_current_value_before,
      v_new_qty, v_new_value, v_resulting_avg_cost, v_value_diff
    );

    -- Always insert a stock_movements row, even at a zero delta (a pure
    -- Value adjustment doesn't change quantity) -- the MAC replay only
    -- ever looks at stock_movements to find events, so a Value-only
    -- adjustment needs this as its anchor or the replay would have no
    -- way to find and re-apply its cost correction later.
    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (p_org_id, v_item_id, p_location_id, v_new_qty - v_qty_on_hand_before, 'adjustment', 'inventory_adjustment', v_adjustment.id, auth.uid());

    update items set avg_cost = v_resulting_avg_cost, updated_at = now() where id = v_item_id;

    v_total_value_diff := v_total_value_diff + v_value_diff;
  end loop;

  update inventory_adjustments set total_value_diff = v_total_value_diff where id = v_adjustment.id
  returning * into v_adjustment;

  -- Value change per item Inventory account (a line that lowers value
  -- credits it), balanced against the chosen adjustment account.
  declare
    v_inv_default uuid := get_or_create_default_account(p_org_id, 'Inventory', 'other_current_asset');
    v_groups jsonb;
    v_net numeric;
    v_lines jsonb;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('account_id', acct, 'amount', amt)), '[]'::jsonb),
           coalesce(sum(amt), 0)
    into v_groups, v_net
    from (
      select coalesce(it.inventory_account_id, v_inv_default) as acct, round(sum(coalesce(ai.value_diff, 0)), 2) as amt
      from inventory_adjustment_items ai
      join items it on it.id = ai.item_id
      where ai.adjustment_id = v_adjustment.id
      group by 1
    ) g;

    v_lines := journal_lines_for(v_groups, 'debit')
      || journal_lines_for(jsonb_build_array(jsonb_build_object('account_id', p_adjustment_account_id, 'amount', v_net)), 'credit');

    if jsonb_array_length(v_lines) >= 2 then
      perform post_journal_entry(
        p_org_id, v_adjustment.adjustment_date, 'Inventory adjustment ' || v_adjustment_number,
        v_lines, 'inventory_adjustment', v_adjustment.id
      );
    end if;
  end;

  return v_adjustment;
end;
$function$;

CREATE OR REPLACE FUNCTION public.void_invoice(p_invoice_id uuid)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoice invoices%rowtype;
  v_line record;
  v_total_cogs numeric := 0;
begin
  select * into v_invoice from invoices where id = p_invoice_id;
  if not found then
    raise exception 'invoice % not found', p_invoice_id;
  end if;

  perform assert_permission(v_invoice.org_id, 'invoices.void');

  if v_invoice.status = 'void' then
    raise exception 'invoice is already void';
  end if;

  if v_invoice.amount_paid > 0 then
    raise exception 'cannot void an invoice with recorded payments';
  end if;

  for v_line in select * from invoice_items where invoice_id = p_invoice_id
  loop
    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (v_invoice.org_id, v_line.item_id, v_line.location_id, v_line.quantity, 'void', 'invoice', v_invoice.id, auth.uid());

    v_total_cogs := v_total_cogs + (v_line.quantity * coalesce(v_line.unit_cost, 0));
  end loop;

  update invoices
  set status = 'void', updated_at = now()
  where id = p_invoice_id
  returning * into v_invoice;

  update sales_orders set status = 'open', invoice_id = null, updated_at = now()
  where invoice_id = p_invoice_id and status = 'invoiced';

  -- Reversal built from the invoice's lines with the accounts that apply now.
  if v_invoice.total > 0 then
    perform post_journal_entry(
      v_invoice.org_id, current_date, 'Void invoice ' || v_invoice.invoice_number,
      journal_lines_for(document_account_groups(v_invoice.org_id, 'invoice', v_invoice.id, 'income'), 'debit', v_invoice.total)
      || jsonb_build_array(jsonb_build_object(
        'account_id', get_or_create_default_account(v_invoice.org_id, 'Accounts Receivable', 'accounts_receivable'),
        'debit', 0, 'credit', v_invoice.total)),
      'invoice_void', v_invoice.id
    );
  end if;

  if v_total_cogs > 0 then
    perform post_journal_entry(
      v_invoice.org_id, current_date, 'Reverse COGS for voided invoice ' || v_invoice.invoice_number,
      journal_lines_for(document_account_groups(v_invoice.org_id, 'invoice', v_invoice.id, 'inventory'), 'debit', v_total_cogs)
      || journal_lines_for(document_account_groups(v_invoice.org_id, 'invoice', v_invoice.id, 'cogs'), 'credit', v_total_cogs),
      'invoice_void_cogs', v_invoice.id
    );
  end if;

  return v_invoice;
end;
$function$;

CREATE OR REPLACE FUNCTION public.void_credit_memo(p_credit_memo_id uuid)
 RETURNS credit_memos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_credit_memo credit_memos%rowtype;
  v_line record;
  v_total_cost numeric := 0;
begin
  select * into v_credit_memo from credit_memos where id = p_credit_memo_id;
  if not found then
    raise exception 'credit memo % not found', p_credit_memo_id;
  end if;

  perform assert_permission(v_credit_memo.org_id, 'credit_memos.void');

  if v_credit_memo.status = 'void' then
    raise exception 'credit memo is already void';
  end if;

  for v_line in select * from credit_memo_items where credit_memo_id = p_credit_memo_id
  loop
    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (v_credit_memo.org_id, v_line.item_id, v_line.location_id, -v_line.quantity, 'void', 'credit_memo', v_credit_memo.id, auth.uid());

    v_total_cost := v_total_cost + (v_line.quantity * coalesce(v_line.unit_cost, 0));
  end loop;

  update credit_memos
  set status = 'void', updated_at = now()
  where id = p_credit_memo_id
  returning * into v_credit_memo;

  -- Reversal built from the credit memo's lines with the accounts that apply now.
  if v_credit_memo.total > 0 then
    perform post_journal_entry(
      v_credit_memo.org_id, current_date, 'Void credit memo ' || v_credit_memo.credit_memo_number,
      jsonb_build_array(jsonb_build_object(
        'account_id', get_or_create_default_account(v_credit_memo.org_id, 'Accounts Receivable', 'accounts_receivable'),
        'debit', v_credit_memo.total, 'credit', 0))
      || journal_lines_for(document_account_groups(v_credit_memo.org_id, 'credit_memo', v_credit_memo.id, 'income'), 'credit', v_credit_memo.total),
      'credit_memo_void', v_credit_memo.id
    );
  end if;

  if v_total_cost > 0 then
    perform post_journal_entry(
      v_credit_memo.org_id, current_date, 'Reverse cost of returns for voided credit memo ' || v_credit_memo.credit_memo_number,
      journal_lines_for(document_account_groups(v_credit_memo.org_id, 'credit_memo', v_credit_memo.id, 'cogs'), 'debit', v_total_cost)
      || journal_lines_for(document_account_groups(v_credit_memo.org_id, 'credit_memo', v_credit_memo.id, 'inventory'), 'credit', v_total_cost),
      'credit_memo_void_cogs', v_credit_memo.id
    );
  end if;

  return v_credit_memo;
end;
$function$;

CREATE OR REPLACE FUNCTION public.void_supplier_bill(p_bill_id uuid)
 RETURNS supplier_bills
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_bill supplier_bills%rowtype;
  v_line record;
  v_received_at timestamptz;
  v_item_name text;
begin
  select * into v_bill from supplier_bills where id = p_bill_id;
  if not found then
    raise exception 'supplier bill % not found', p_bill_id;
  end if;

  perform assert_permission(v_bill.org_id, 'supplier_bills.void');

  if v_bill.status = 'void' then
    raise exception 'bill is already void';
  end if;

  if v_bill.amount_paid > 0 then
    raise exception 'cannot void a bill with recorded payments';
  end if;

  select min(created_at) into v_received_at
  from stock_movements
  where reference_type = 'supplier_bill' and reference_id = p_bill_id and reason = 'receive';

  for v_line in select distinct item_id from supplier_bill_items where bill_id = p_bill_id
  loop
    if exists (
      select 1 from stock_movements
      where item_id = v_line.item_id and created_at > v_received_at
    ) then
      select name into v_item_name from items where id = v_line.item_id;
      raise exception 'cannot void this bill -- stock for "%" has moved since it was received, which would desync inventory valuation. Void immediately after a mistaken bill, before anything else touches that item.',
        coalesce(v_item_name, 'an item on this bill');
    end if;
  end loop;

  for v_line in select * from supplier_bill_items where bill_id = p_bill_id
  loop
    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (v_bill.org_id, v_line.item_id, v_line.location_id, -v_line.quantity, 'void', 'supplier_bill', v_bill.id, auth.uid());
  end loop;

  update supplier_bills
  set status = 'void', updated_at = now()
  where id = p_bill_id
  returning * into v_bill;

  -- Reversal built from the bill's lines with the accounts that apply now.
  if v_bill.total > 0 then
    perform post_journal_entry(
      v_bill.org_id, current_date, 'Void supplier bill ' || v_bill.bill_number,
      jsonb_build_array(jsonb_build_object(
        'account_id', get_or_create_default_account(v_bill.org_id, 'Accounts Payable', 'accounts_payable'),
        'debit', v_bill.total, 'credit', 0))
      || journal_lines_for(document_account_groups(v_bill.org_id, 'supplier_bill', v_bill.id, 'inventory'), 'credit', v_bill.total),
      'supplier_bill_void', v_bill.id
    );
  end if;

  return v_bill;
end;
$function$;
