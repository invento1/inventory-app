-- Audit log: who changed or deleted which document, and when. Unlocks the old
-- HashirHub's "Deleted Transactions" and "Updated Transactions" reports (the
-- old app's Updated report was only a proxy; this one is real).
--
-- * audit_log rows are written only by the audit_document_change() trigger on
--   the document tables; there is no client write policy. Reading needs the
--   new reports.audit permission.
-- * Updates: one row per update that changed something other than updated_at,
--   with the changed field names and the before/after rows. Payment-driven
--   updates to invoices/bills (amount_paid, and status moving between unpaid /
--   partially_paid / paid) are skipped: payments are their own records.
-- * Deletes: one row with the deleted row. HashirHub voids rather than
--   deletes, so "Deleted Transactions" lists voids/cancellations (a status
--   update) as well as real deletes.
-- * Reset Data turns the trigger off for its bulk deletes (app.skip_audit)
--   and writes one summary row instead; it can also clear the audit log.
-- * Backfill: documents already void get one row each, dated at their last
--   update, with no user (that wasn't recorded before today).

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  table_name text not null,
  record_id uuid,
  doc_type text not null,
  doc_number text,
  action text not null check (action in ('update', 'delete')),
  changed_fields text[] not null default '{}',
  old_data jsonb,
  new_data jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  note text
);
create index audit_log_org_changed_idx on public.audit_log (org_id, changed_at desc);
create index audit_log_record_idx on public.audit_log (org_id, record_id);

alter table public.audit_log enable row level security;

insert into public.app_permissions (key, module, module_label, module_order, label, description, sort_order, requires) values
  ('reports.audit', 'reports', 'Reports', 140, 'Audit reports', 'Deleted Transactions and Updated Transactions: who changed what', 5, '{}');

create policy "can view audit log"
  on public.audit_log for select using (has_permission(org_id, 'reports.audit'));

select grant_permission_to_role_everywhere('reports.audit', 'admin');
select grant_permission_to_role_everywhere('reports.audit', 'accountant');

-- New orgs: admin gets everything; accountant gets it explicitly; manager is
-- kept out of it like the financial reports.
create or replace function public.seed_default_roles(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role record;
begin
  for v_role in
    select * from (values
      ('owner', 'Owner', 'Full access to everything, including Security Groups and Reset Data. Can''t be changed.', 1),
      ('admin', 'Administrator', 'Runs the business day to day, including users and settings.', 2),
      ('manager', 'Manager', 'Sales, purchasing, stock and customers. No ledger or users.', 3),
      ('accountant', 'Accountant', 'Ledger, payments, bills, expenses and all reports.', 4),
      ('cashier', 'Cashier', 'Sales receipts, invoices, quotations and taking payments.', 5)
    ) as r(key, name, description, sort_order)
  loop
    insert into org_roles (org_id, key, name, description, is_system, sort_order)
    values (p_org_id, v_role.key, v_role.name, v_role.description, true, v_role.sort_order)
    on conflict (org_id, key) do nothing;

    -- Existing role (possibly customised by the owner): leave it alone.
    if not found then
      continue;
    end if;

    insert into role_permissions (org_id, role_key, permission_key)
    select p_org_id, v_role.key, p.key
    from app_permissions p
    where case v_role.key
      -- Owner holds everything implicitly: no rows.
      when 'owner' then false
      when 'admin' then true
      when 'manager' then p.key not in ('accounts.view', 'accounts.manage', 'journal.create', 'banking.transfer',
                                        'reports.financial', 'reports.audit', 'settings.company', 'users.manage')
      when 'accountant' then p.key like '%.view'
        or p.key in ('accounts.manage', 'journal.create', 'banking.transfer',
                     'customer_payments.receive', 'customer_payments.deposit',
                     'supplier_payments.create', 'supplier_bills.create', 'supplier_bills.void',
                     'expenses.create', 'expenses.void',
                     'credit_memos.create', 'credit_memos.void', 'refunds.create',
                     'inventory.adjust',
                     'reports.financial', 'reports.receivables_payables', 'reports.sales_purchases', 'reports.inventory',
                     'reports.audit')
      when 'cashier' then p.key in ('items.view', 'customers.view', 'customers.create',
                                    'sales.view', 'sales.create', 'invoices.view', 'invoices.create',
                                    'quotations.view', 'quotations.create',
                                    'sales_orders.view', 'sales_orders.create',
                                    'customer_payments.view', 'customer_payments.receive')
      else false
    end
    on conflict do nothing;
  end loop;
end;
$$;

-- Trigger: TG_ARGV[0] = doc_type, TG_ARGV[1] = the document-number column
-- ('' for purchase orders, which have none).
create or replace function public.audit_document_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_changed text[];
  v_number text;
begin
  if coalesce(current_setting('app.skip_audit', true), '') = 'on' then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    select coalesce(array_agg(n.key order by n.key), '{}')
    into v_changed
    from jsonb_each(v_new) n
    where n.key <> 'updated_at' and (v_old -> n.key) is distinct from n.value;

    if cardinality(v_changed) = 0 then
      return null;
    end if;
    -- A payment moving an invoice/bill between unpaid, partially_paid and
    -- paid: the payment itself is the record.
    if tg_table_name in ('invoices', 'supplier_bills')
       and v_changed <@ array['amount_paid', 'status']
       and v_new ->> 'status' <> 'void' then
      return null;
    end if;
    v_row := v_new;
  else
    v_old := to_jsonb(old);
    v_row := v_old;
  end if;

  v_number := case when tg_argv[1] = '' then 'PO-' || left(v_row ->> 'id', 8) else v_row ->> tg_argv[1] end;

  insert into audit_log (org_id, table_name, record_id, doc_type, doc_number, action, changed_fields,
                         old_data, new_data, changed_by)
  values ((v_row ->> 'org_id')::uuid, tg_table_name, (v_row ->> 'id')::uuid, tg_argv[0], v_number,
          lower(tg_op), coalesce(v_changed, '{}'), v_old, v_new, auth.uid());
  return null;
end;
$$;
revoke execute on function public.audit_document_change() from public, authenticated, anon;

create trigger invoices_audit after update or delete on public.invoices
  for each row execute function public.audit_document_change('invoice', 'invoice_number');
create trigger sales_receipts_audit after update or delete on public.sales_receipts
  for each row execute function public.audit_document_change('sales_receipt', 'receipt_number');
create trigger credit_memos_audit after update or delete on public.credit_memos
  for each row execute function public.audit_document_change('credit_memo', 'credit_memo_number');
create trigger quotations_audit after update or delete on public.quotations
  for each row execute function public.audit_document_change('quotation', 'quotation_number');
create trigger sales_orders_audit after update or delete on public.sales_orders
  for each row execute function public.audit_document_change('sales_order', 'order_number');
create trigger supplier_bills_audit after update or delete on public.supplier_bills
  for each row execute function public.audit_document_change('supplier_bill', 'bill_number');
create trigger purchase_orders_audit after update or delete on public.purchase_orders
  for each row execute function public.audit_document_change('purchase_order', '');
create trigger expenses_audit after update or delete on public.expenses
  for each row execute function public.audit_document_change('expense', 'expense_number');
create trigger refunds_audit after update or delete on public.refunds
  for each row execute function public.audit_document_change('refund', 'refund_number');
create trigger inventory_adjustments_audit after update or delete on public.inventory_adjustments
  for each row execute function public.audit_document_change('inventory_adjustment', 'adjustment_number');

-- Backfill: documents already void/cancelled, one row each, no user.
insert into audit_log (org_id, table_name, record_id, doc_type, doc_number, action, changed_fields, new_data, changed_at, note)
select org_id, 'invoices', id, 'invoice', invoice_number, 'update', '{status}'::text[], to_jsonb(t), updated_at,
       'Voided before the audit log existed, so who did it wasn''t recorded'
from invoices t where status = 'void'
union all
select org_id, 'sales_receipts', id, 'sales_receipt', receipt_number, 'update', '{status}'::text[], to_jsonb(t), coalesce(updated_at, created_at),
       'Voided before the audit log existed, so who did it wasn''t recorded'
from sales_receipts t where status = 'void'
union all
select org_id, 'credit_memos', id, 'credit_memo', credit_memo_number, 'update', '{status}'::text[], to_jsonb(t), updated_at,
       'Voided before the audit log existed, so who did it wasn''t recorded'
from credit_memos t where status = 'void'
union all
select org_id, 'quotations', id, 'quotation', quotation_number, 'update', '{status}'::text[], to_jsonb(t), updated_at,
       'Voided before the audit log existed, so who did it wasn''t recorded'
from quotations t where status = 'void'
union all
select org_id, 'supplier_bills', id, 'supplier_bill', bill_number, 'update', '{status}'::text[], to_jsonb(t), updated_at,
       'Voided before the audit log existed, so who did it wasn''t recorded'
from supplier_bills t where status = 'void'
union all
select org_id, 'expenses', id, 'expense', expense_number, 'update', '{status}'::text[], to_jsonb(t), created_at,
       'Voided before the audit log existed, so who did it wasn''t recorded'
from expenses t where status = 'void'
union all
select org_id, 'purchase_orders', id, 'purchase_order', 'PO-' || left(id::text, 8), 'update', '{status}'::text[], to_jsonb(t),
       coalesce(updated_at, created_at), 'Cancelled before the audit log existed, so who did it wasn''t recorded'
from purchase_orders t where status = 'cancelled';

-- ---------------------------------------------------------------------------
-- Reports (report-RPC convention; RLS on audit_log needs reports.audit).
-- ---------------------------------------------------------------------------

-- The document's own date and other party, read from its row snapshot.
create or replace function public.audit_doc_date(d jsonb)
returns date
language sql
immutable
as $$
  select coalesce(d ->> 'issue_date', d ->> 'sale_date', d ->> 'order_date', d ->> 'expense_date',
                  d ->> 'refund_date', d ->> 'adjustment_date', d ->> 'expected_date',
                  left(d ->> 'created_at', 10))::date;
$$;

-- Deleted Transactions: documents deleted, voided or cancelled in the period.
create or replace function public.deleted_transactions(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  log_id uuid, changed_at timestamptz, action text, doc_type text, doc_id uuid, doc_number text,
  doc_date date, party_name text, total numeric, changed_by_name text, note text
)
language sql
stable
set search_path = public
as $$
  select a.id, a.changed_at,
         case when a.action = 'delete' then 'Deleted'
              when coalesce(a.new_data, a.old_data) ->> 'status' = 'cancelled' then 'Cancelled'
              else 'Voided' end,
         a.doc_type, a.record_id, a.doc_number,
         audit_doc_date(coalesce(a.new_data, a.old_data)),
         coalesce(c.name, s.name, coalesce(a.new_data, a.old_data) ->> 'payee_name'),
         coalesce((coalesce(a.new_data, a.old_data) ->> 'total')::numeric,
                  (coalesce(a.new_data, a.old_data) ->> 'amount')::numeric,
                  (coalesce(a.new_data, a.old_data) ->> 'total_value_diff')::numeric),
         m.full_name,
         a.note
  from audit_log a
  left join customers c on c.id = (coalesce(a.new_data, a.old_data) ->> 'customer_id')::uuid
  left join suppliers s on s.id = coalesce((coalesce(a.new_data, a.old_data) ->> 'supplier_id')::uuid,
                                          (coalesce(a.new_data, a.old_data) ->> 'payee_supplier_id')::uuid)
  left join org_members m on m.org_id = a.org_id and m.user_id = a.changed_by
  where a.org_id = p_org_id
    and a.doc_type <> 'reset_data'
    and (a.action = 'delete'
         or ('status' = any(a.changed_fields) and a.new_data ->> 'status' in ('void', 'cancelled')))
    and (a.changed_at at time zone org_timezone(p_org_id))::date between p_start_date and p_end_date
  union all
  -- Reset Data runs: one row each.
  select a.id, a.changed_at, 'Reset Data', 'reset_data', null, null, null,
         array_to_string(a.changed_fields, ', '), null, m.full_name, a.note
  from audit_log a
  left join org_members m on m.org_id = a.org_id and m.user_id = a.changed_by
  where a.org_id = p_org_id and a.doc_type = 'reset_data'
    and (a.changed_at at time zone org_timezone(p_org_id))::date between p_start_date and p_end_date
  order by 2 desc;
$$;

-- Updated Transactions: every other recorded change, with before/after.
create or replace function public.updated_transactions(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  log_id uuid, changed_at timestamptz, doc_type text, doc_id uuid, doc_number text, doc_date date,
  party_name text, total numeric, changed_fields text[], old_data jsonb, new_data jsonb, changed_by_name text
)
language sql
stable
set search_path = public
as $$
  select a.id, a.changed_at, a.doc_type, a.record_id, a.doc_number,
         audit_doc_date(a.new_data),
         coalesce(c.name, s.name, a.new_data ->> 'payee_name'),
         coalesce((a.new_data ->> 'total')::numeric, (a.new_data ->> 'amount')::numeric),
         a.changed_fields, a.old_data, a.new_data, m.full_name
  from audit_log a
  left join customers c on c.id = (a.new_data ->> 'customer_id')::uuid
  left join suppliers s on s.id = coalesce((a.new_data ->> 'supplier_id')::uuid, (a.new_data ->> 'payee_supplier_id')::uuid)
  left join org_members m on m.org_id = a.org_id and m.user_id = a.changed_by
  where a.org_id = p_org_id
    and a.action = 'update'
    and a.doc_type <> 'reset_data'
    and not ('status' = any(a.changed_fields) and a.new_data ->> 'status' in ('void', 'cancelled'))
    and (a.changed_at at time zone org_timezone(p_org_id))::date between p_start_date and p_end_date
  order by a.changed_at desc;
$$;

-- ---------------------------------------------------------------------------
-- Reset Data: no per-row audit rows for its bulk deletes, one summary row
-- instead, and an 'audit_log' category to clear the log itself.
-- ---------------------------------------------------------------------------

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
      delete from journal_entries where org_id = p_org_id and reference_type in ('manual', 'fund_transfer', 'inventory_cutover');
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
