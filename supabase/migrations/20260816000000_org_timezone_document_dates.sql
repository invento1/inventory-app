-- Org timezone: document dates in the business's local calendar, not UTC.
--
-- Supabase sessions run in UTC, so every `current_date` default and every
-- `timestamp::date` cast was a UTC date. A document created between local
-- midnight and UTC midnight (00:00-01:00 in the UK in summer, 00:00-05:00 in
-- Pakistan) was dated yesterday -- on its printout, in All Transactions, and
-- in every report. The dashboard already compensates per viewer
-- (20260815000000); this fixes the stored dates themselves.
--
--   * orgs.timezone: IANA name set in Settings -> Company Info. NULL = not set
--     yet = UTC (the old behaviour), so nothing changes until it's chosen.
--   * Document dates the database stamps (invoices/credit memos/supplier bills/
--     quotations issue_date, and the other date columns whenever a caller
--     omits them) are filled by a BEFORE INSERT trigger with org_today().
--     Their `default current_date` is dropped so an omitted date reaches the
--     trigger as NULL; a date the caller passes is always kept as given.
--   * sales_receipts gets a stored sale_date (it only had created_at).
--   * Auto-posted journal entries that were stamped with UTC current_date are
--     re-dated to org_today() by a trigger on journal_entries (one place,
--     instead of editing every posting RPC).
--   * Report functions/views that cast timestamps to dates now use the org's
--     timezone.
--
-- Existing rows are NOT re-dated: the append-only convention (corrections are
-- new entries, never rewrites) applies, and past documents' dates already
-- match their journal entries. The new sale_date is backfilled with the same
-- UTC date the ledger already used, for the same reason.

-- ---------------------------------------------------------------------------
-- Setting + helpers

alter table public.orgs add column if not exists timezone text;

-- Reject names Postgres doesn't know (Company Info only offers valid ones,
-- but the column must never hold something at time zone would choke on).
create or replace function public.validate_org_timezone()
returns trigger
language plpgsql
as $$
begin
  if new.timezone is not null
     and not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown timezone: %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists orgs_validate_timezone on public.orgs;
create trigger orgs_validate_timezone
  before insert or update of timezone on public.orgs
  for each row execute function public.validate_org_timezone();

-- The org's timezone, or UTC while unset. SECURITY DEFINER so the triggers
-- below work regardless of the caller's orgs visibility; it only ever
-- returns a timezone name.
create or replace function public.org_timezone(p_org_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select timezone from orgs where id = p_org_id), 'UTC');
$$;

-- Today in the org's local calendar.
create or replace function public.org_today(p_org_id uuid)
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone org_timezone(p_org_id))::date;
$$;

-- The org-local calendar date a timestamp falls on.
create or replace function public.org_local_date(p_org_id uuid, p_ts timestamptz)
returns date
language sql
stable
set search_path = public
as $$
  select (p_ts at time zone org_timezone(p_org_id))::date;
$$;

-- ---------------------------------------------------------------------------
-- Document dates stamped in the org's calendar

-- BEFORE INSERT: if the date column named in TG_ARGV[0] was left NULL, fill
-- it with org_today(org_id). A date the caller supplied is untouched.
create or replace function public.fill_org_local_date()
returns trigger
language plpgsql
as $$
begin
  if to_jsonb(new) ->> tg_argv[0] is null then
    new := jsonb_populate_record(new, jsonb_build_object(tg_argv[0], org_today(new.org_id)));
  end if;
  return new;
end;
$$;

alter table public.invoices alter column issue_date drop default;
alter table public.credit_memos alter column issue_date drop default;
alter table public.supplier_bills alter column issue_date drop default;
alter table public.quotations alter column issue_date drop default;
alter table public.expenses alter column expense_date drop default;
alter table public.refunds alter column refund_date drop default;
alter table public.deposits alter column deposit_date drop default;
alter table public.inventory_adjustments alter column adjustment_date drop default;
alter table public.price_lists alter column list_date drop default;

drop trigger if exists invoices_fill_issue_date on public.invoices;
create trigger invoices_fill_issue_date before insert on public.invoices
  for each row execute function public.fill_org_local_date('issue_date');
drop trigger if exists credit_memos_fill_issue_date on public.credit_memos;
create trigger credit_memos_fill_issue_date before insert on public.credit_memos
  for each row execute function public.fill_org_local_date('issue_date');
drop trigger if exists supplier_bills_fill_issue_date on public.supplier_bills;
create trigger supplier_bills_fill_issue_date before insert on public.supplier_bills
  for each row execute function public.fill_org_local_date('issue_date');
drop trigger if exists quotations_fill_issue_date on public.quotations;
create trigger quotations_fill_issue_date before insert on public.quotations
  for each row execute function public.fill_org_local_date('issue_date');
drop trigger if exists expenses_fill_expense_date on public.expenses;
create trigger expenses_fill_expense_date before insert on public.expenses
  for each row execute function public.fill_org_local_date('expense_date');
drop trigger if exists refunds_fill_refund_date on public.refunds;
create trigger refunds_fill_refund_date before insert on public.refunds
  for each row execute function public.fill_org_local_date('refund_date');
drop trigger if exists deposits_fill_deposit_date on public.deposits;
create trigger deposits_fill_deposit_date before insert on public.deposits
  for each row execute function public.fill_org_local_date('deposit_date');
drop trigger if exists inventory_adjustments_fill_date on public.inventory_adjustments;
create trigger inventory_adjustments_fill_date before insert on public.inventory_adjustments
  for each row execute function public.fill_org_local_date('adjustment_date');
drop trigger if exists price_lists_fill_list_date on public.price_lists;
create trigger price_lists_fill_list_date before insert on public.price_lists
  for each row execute function public.fill_org_local_date('list_date');

-- Sales receipts: a stored local sale date. Existing receipts keep the UTC
-- date their journal entries already carry.
alter table public.sales_receipts add column if not exists sale_date date;
update public.sales_receipts set sale_date = created_at::date where sale_date is null;
alter table public.sales_receipts alter column sale_date set not null;
drop trigger if exists sales_receipts_fill_sale_date on public.sales_receipts;
create trigger sales_receipts_fill_sale_date before insert on public.sales_receipts
  for each row execute function public.fill_org_local_date('sale_date');

-- Auto-posted journal entries: the posting RPCs pass UTC current_date for the
-- system-dated types (sales receipts, voids, ...). Re-date those to the org's
-- today. Entries passed a document's own (now org-local) date differ from
-- UTC current_date only when that date is already correct, so they're kept;
-- manual/user-dated entries are never touched.
create or replace function public.journal_entry_org_date()
returns trigger
language plpgsql
as $$
begin
  if journal_entry_is_system_dated(new.reference_type) and new.entry_date = current_date then
    new.entry_date := org_today(new.org_id);
  end if;
  return new;
end;
$$;

drop trigger if exists journal_entries_org_date on public.journal_entries;
create trigger journal_entries_org_date before insert on public.journal_entries
  for each row execute function public.journal_entry_org_date();

-- ---------------------------------------------------------------------------
-- Report functions and views: timestamps -> org-local calendar dates.
-- (Bodies copied verbatim from their original migrations; only the marked
-- date expressions changed.)

create or replace function public.inventory_movement(
  p_org_id uuid,
  p_start_date date,
  p_end_date date,
  p_location_id uuid default null,
  p_category_id uuid default null
)
returns table (
  item_id uuid,
  sku text,
  item_name text,
  category_name text,
  opening_qty numeric,
  purchased numeric,
  sold numeric,
  returned numeric,
  transferred numeric,
  adjusted numeric,
  closing_qty numeric
)
language sql
stable
set search_path = public
as $$
  with recursive cats as (
    select c.id from categories c where c.id = p_category_id and c.org_id = p_org_id
    union all
    select c.id from categories c join cats on c.parent_id = cats.id
  ),
  moves as (
    select
      sm.item_id,
      sm.quantity_delta as q,
      org_local_date(p_org_id, sm.created_at) as d,
      case
        when sm.reason = 'receive' or (sm.reason = 'void' and sm.reference_type = 'supplier_bill') then 'purchased'
        when sm.reason = 'sale' or (sm.reason = 'void' and sm.reference_type in ('invoice', 'sales_receipt')) then 'sold'
        when sm.reason = 'return' or (sm.reason = 'void' and sm.reference_type = 'credit_memo') then 'returned'
        when sm.reason = 'transfer' then 'transferred'
        else 'adjusted'
      end as bucket
    from stock_movements sm
    where sm.org_id = p_org_id
      and sm.created_at < p_end_date + 2  -- coarse pre-filter; exact day via d below
      and (p_location_id is null or sm.location_id = p_location_id)
  ),
  agg as (
    select
      item_id,
      coalesce(sum(q) filter (where d < p_start_date), 0) as opening_qty,
      coalesce(sum(q) filter (where d >= p_start_date and bucket = 'purchased'), 0) as purchased,
      -coalesce(sum(q) filter (where d >= p_start_date and bucket = 'sold'), 0) as sold,
      coalesce(sum(q) filter (where d >= p_start_date and bucket = 'returned'), 0) as returned,
      coalesce(sum(q) filter (where d >= p_start_date and bucket = 'transferred'), 0) as transferred,
      coalesce(sum(q) filter (where d >= p_start_date and bucket = 'adjusted'), 0) as adjusted,
      coalesce(sum(q), 0) as closing_qty,
      count(*) filter (where d >= p_start_date) as moves_in_range
    from moves
    where d <= p_end_date
    group by item_id
  )
  select
    i.id,
    i.sku,
    i.name,
    cat.name,
    agg.opening_qty,
    agg.purchased,
    agg.sold,
    agg.returned,
    agg.transferred,
    agg.adjusted,
    agg.closing_qty
  from agg
  join items i on i.id = agg.item_id
  left join categories cat on cat.id = i.category_id
  where i.org_id = p_org_id
    and (p_category_id is null or i.category_id in (select id from cats))
    and (agg.moves_in_range > 0 or agg.opening_qty <> 0)
  order by cat.name nulls last, i.name;
$$;

create or replace function public.sales_lines(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  doc_type text,
  doc_id uuid,
  doc_number text,
  txn_date date,
  customer_id uuid,
  customer_name text,
  item_id uuid,
  sku text,
  item_name text,
  category_id uuid,
  category_name text,
  quantity numeric,
  amount numeric,
  cogs numeric
)
language sql
stable
set search_path = public
as $$
  select
    'invoice', inv.id, inv.invoice_number, inv.issue_date, inv.customer_id, c.name,
    it.id, it.sku, it.name, it.category_id, cat.name,
    ii.quantity, ii.line_total, ii.quantity * ii.unit_cost
  from invoices inv
  join invoice_items ii on ii.invoice_id = inv.id
  join items it on it.id = ii.item_id
  left join categories cat on cat.id = it.category_id
  left join customers c on c.id = inv.customer_id
  where inv.org_id = p_org_id
    and inv.status <> 'void'
    and inv.issue_date between p_start_date and p_end_date
  union all
  select
    'sales_receipt', sr.id, sr.receipt_number, sr.sale_date, sr.customer_id, c.name,
    it.id, it.sku, it.name, it.category_id, cat.name,
    sri.quantity, sri.line_total, sri.quantity * sri.unit_cost
  from sales_receipts sr
  join sales_receipt_items sri on sri.sales_receipt_id = sr.id
  join items it on it.id = sri.item_id
  left join categories cat on cat.id = it.category_id
  left join customers c on c.id = sr.customer_id
  where sr.org_id = p_org_id
    and sr.status <> 'void'
    and sr.sale_date between p_start_date and p_end_date;
$$;

create or replace function public.purchases_by_supplier(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  supplier_id uuid,
  supplier_name text,
  bill_count bigint,
  purchases numeric,
  paid numeric,
  balance numeric,
  po_count bigint
)
language sql
stable
set search_path = public
as $$
  with b as (
    select supplier_id, count(*) as n, sum(total) as total, sum(amount_paid) as paid
    from supplier_bills
    where org_id = p_org_id and status <> 'void' and issue_date between p_start_date and p_end_date
    group by supplier_id
  ),
  po as (
    select supplier_id, count(*) as n
    from purchase_orders
    where org_id = p_org_id and org_local_date(org_id, created_at) between p_start_date and p_end_date
    group by supplier_id
  )
  select
    s.id,
    s.name,
    coalesce(b.n, 0),
    coalesce(b.total, 0),
    coalesce(b.paid, 0),
    coalesce(b.total, 0) - coalesce(b.paid, 0),
    coalesce(po.n, 0)
  from suppliers s
  left join b on b.supplier_id = s.id
  left join po on po.supplier_id = s.id
  where s.org_id = p_org_id
    and (b.supplier_id is not null or po.supplier_id is not null)
  order by coalesce(b.total, 0) desc, s.name;
$$;

create or replace view public.all_transactions with (security_invoker = true) as
select sr.org_id, 'sales_receipt' as doc_type, sr.id as doc_id, sr.receipt_number as doc_number,
       sr.sale_date as txn_date, null::text as party_name, sr.total, sr.status
from sales_receipts sr
union all
select i.org_id, 'invoice', i.id, i.invoice_number, i.issue_date, c.name, i.total, i.status
from invoices i join customers c on c.id = i.customer_id
union all
select b.org_id, 'supplier_bill', b.id, b.bill_number, b.issue_date, s.name, b.total, b.status
from supplier_bills b join suppliers s on s.id = b.supplier_id
union all
select po.org_id, 'purchase_order', po.id, 'PO-' || substr(po.id::text, 1, 8),
       coalesce(po.expected_date, org_local_date(po.org_id, po.created_at)), s.name,
       coalesce((select sum(quantity_ordered * coalesce(unit_cost, 0)) from purchase_order_lines where po_id = po.id), 0),
       po.status
from purchase_orders po join suppliers s on s.id = po.supplier_id
union all
select e.org_id, 'expense', e.id, e.expense_number, e.expense_date, coalesce(e.payee_name, sup.name, ''), e.amount, e.status
from expenses e left join suppliers sup on sup.id = e.payee_supplier_id
union all
select q.org_id, 'quotation', q.id, q.quotation_number, q.issue_date, c.name, q.total, q.status
from quotations q left join customers c on c.id = q.customer_id
union all
select cm.org_id, 'credit_memo', cm.id, cm.credit_memo_number, cm.issue_date, c.name, cm.total, cm.status
from credit_memos cm join customers c on c.id = cm.customer_id
union all
select r.org_id, 'refund', r.id, r.refund_number, r.refund_date, c.name, r.amount, 'completed'
from refunds r join customers c on c.id = r.customer_id;

create or replace view public.outstanding_invoices with (security_invoker = true) as
select
  i.id,
  i.org_id,
  i.invoice_number,
  i.customer_id,
  c.name as customer_name,
  i.status,
  i.issue_date,
  i.due_date,
  i.total,
  i.amount_paid,
  (i.total - i.amount_paid) as balance,
  (i.due_date < org_today(i.org_id) and i.status in ('unpaid', 'partially_paid')) as is_overdue
from invoices i
join customers c on c.id = i.customer_id
where i.status in ('unpaid', 'partially_paid');

create or replace view public.outstanding_supplier_bills with (security_invoker = true) as
select
  b.id,
  b.org_id,
  b.bill_number,
  b.supplier_id,
  s.name as supplier_name,
  b.status,
  b.issue_date,
  b.due_date,
  b.total,
  b.amount_paid,
  (b.total - b.amount_paid) as balance,
  (b.due_date < org_today(b.org_id) and b.status in ('unpaid', 'partially_paid')) as is_overdue
from supplier_bills b
join suppliers s on s.id = b.supplier_id
where b.status in ('unpaid', 'partially_paid');
