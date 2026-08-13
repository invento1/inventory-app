-- Phase 4 Stage 2, part A: Supplier Bills -- the accounts-payable mirror of
-- invoices/invoice_items/invoice_payments (Phase 2). Purchase Orders alone
-- have no "amount owed" concept (unit_cost is unenforced/display-only, no
-- total, no payment tracking) -- this is what Supplier Payment (built in a
-- later Stage 2 migration) applies payments against. See CLAUDE.md sections
-- 3-4 for the RLS/RPC conventions this mirrors from create_invoice/
-- record_invoice_payment/void_invoice.

-- =========================================================================
-- Supplier bills. Same shape as invoices, buy-side: supplier_id required,
-- no 'draft' status, atomic creation. Unlike an invoice's stock deduction,
-- a bill's lines represent goods *received* -- stock increases, mirroring
-- receive_purchase_order_line's direction rather than create_invoice's.
-- =========================================================================

create table public.supplier_bills (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  bill_number text not null,
  supplier_id uuid not null references public.suppliers (id),
  status text not null default 'unpaid'
    check (status in ('unpaid', 'partially_paid', 'paid', 'void')),
  issue_date date not null default current_date,
  due_date date not null,
  subtotal numeric not null default 0,
  total numeric not null default 0,
  amount_paid numeric not null default 0 check (amount_paid >= 0),
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_bills_due_date_after_issue check (due_date >= issue_date),
  constraint supplier_bills_amount_paid_not_over_total check (amount_paid <= total)
);

create unique index supplier_bills_org_bill_number_idx on public.supplier_bills (org_id, bill_number);
create index supplier_bills_org_created_at_idx on public.supplier_bills (org_id, created_at desc);
create index supplier_bills_org_status_idx on public.supplier_bills (org_id, status);
create index supplier_bills_org_due_date_idx on public.supplier_bills (org_id, due_date);
create index supplier_bills_supplier_id_idx on public.supplier_bills (supplier_id);

alter table public.supplier_bills enable row level security;

create policy "org members can select supplier bills"
  on public.supplier_bills for select
  using (is_org_member(org_id));

-- No insert/update/delete policy: bills are only ever written via
-- create_supplier_bill / record_supplier_bill_payment / void_supplier_bill
-- below (all SECURITY DEFINER, each doing its own membership check) --
-- same shape as invoices.

-- =========================================================================
-- Supplier bill line items -- same "line-item child, no org_id" exception
-- as invoice_items / purchase_order_lines (see CLAUDE.md section 3).
-- =========================================================================

create table public.supplier_bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.supplier_bills (id) on delete cascade,
  item_id uuid not null references public.items (id),
  location_id uuid not null references public.locations (id),
  quantity numeric not null check (quantity > 0),
  unit_cost numeric not null check (unit_cost >= 0),
  line_total numeric not null,
  created_at timestamptz not null default now()
);

create index supplier_bill_items_bill_id_idx on public.supplier_bill_items (bill_id);

alter table public.supplier_bill_items enable row level security;

create policy "org members can select supplier bill items"
  on public.supplier_bill_items for select
  using (
    exists (
      select 1 from supplier_bills b
      where b.id = supplier_bill_items.bill_id and is_org_member(b.org_id)
    )
  );

-- =========================================================================
-- Supplier bill payments -- append-only ledger, no client insert policy.
-- Every payment must go through record_supplier_bill_payment().
-- =========================================================================

create table public.supplier_bill_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  bill_id uuid not null references public.supplier_bills (id) on delete cascade,
  amount numeric not null check (amount > 0),
  payment_method text not null check (payment_method in ('cash', 'card', 'bank_transfer', 'other')),
  paid_at timestamptz not null default now(),
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index supplier_bill_payments_org_bill_idx on public.supplier_bill_payments (org_id, bill_id);
create index supplier_bill_payments_org_created_at_idx on public.supplier_bill_payments (org_id, created_at desc);

alter table public.supplier_bill_payments enable row level security;

create policy "org members can select supplier bill payments"
  on public.supplier_bill_payments for select
  using (is_org_member(org_id));

-- No insert/update/delete policy -- see comment above the table.

-- =========================================================================
-- Atomic bill creation: header + lines + stock movements (positive --
-- goods received). Mirrors create_invoice, with supplier instead of
-- customer and a positive stock_movements quantity_delta.
-- =========================================================================

create or replace function public.create_supplier_bill(
  p_org_id uuid,
  p_supplier_id uuid,
  p_due_date date,
  p_lines jsonb,
  p_notes text default null
)
returns public.supplier_bills
language plpgsql
security definer
set search_path = public
as $$
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
  if not is_org_member(p_org_id) then
    raise exception 'not a member of this org';
  end if;

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

    -- Positive delta: a bill represents goods received, same direction as
    -- receive_purchase_order_line (reason='receive'), not create_invoice's
    -- negative 'sale'. reference_type='supplier_bill' disambiguates it in
    -- the audit log.
    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (p_org_id, v_item_id, v_location_id, v_quantity, 'receive', 'supplier_bill', v_bill.id, auth.uid());
  end loop;

  return v_bill;
end;
$$;

-- =========================================================================
-- Record a partial or full payment against a bill. Exact mirror of
-- record_invoice_payment.
-- =========================================================================

create or replace function public.record_supplier_bill_payment(
  p_bill_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_paid_at timestamptz default now(),
  p_notes text default null
)
returns public.supplier_bills
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill supplier_bills%rowtype;
  v_new_amount_paid numeric;
begin
  select * into v_bill from supplier_bills where id = p_bill_id;
  if not found then
    raise exception 'supplier bill % not found', p_bill_id;
  end if;

  if not is_org_member(v_bill.org_id) then
    raise exception 'not a member of this org';
  end if;

  if v_bill.status = 'void' then
    raise exception 'cannot record a payment against a voided bill';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'payment amount must be positive';
  end if;

  v_new_amount_paid := v_bill.amount_paid + p_amount;

  if v_new_amount_paid > v_bill.total then
    raise exception 'payment of % exceeds remaining balance of %',
      p_amount, (v_bill.total - v_bill.amount_paid);
  end if;

  insert into supplier_bill_payments (org_id, bill_id, amount, payment_method, paid_at, notes, created_by)
  values (v_bill.org_id, p_bill_id, p_amount, p_payment_method, coalesce(p_paid_at, now()), p_notes, auth.uid());

  update supplier_bills
  set amount_paid = v_new_amount_paid,
      status = case
        when v_new_amount_paid >= total then 'paid'
        when v_new_amount_paid > 0 then 'partially_paid'
        else 'unpaid'
      end,
      updated_at = now()
  where id = p_bill_id
  returning * into v_bill;

  return v_bill;
end;
$$;

-- =========================================================================
-- Void a bill: reverses the stock receipt via compensating stock_movements
-- entries and marks the bill void. Owner/admin only, blocked once any
-- payment has been recorded -- mirrors void_invoice exactly.
-- =========================================================================

create or replace function public.void_supplier_bill(p_bill_id uuid)
returns public.supplier_bills
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill supplier_bills%rowtype;
  v_line record;
begin
  select * into v_bill from supplier_bills where id = p_bill_id;
  if not found then
    raise exception 'supplier bill % not found', p_bill_id;
  end if;

  if org_role(v_bill.org_id) not in ('owner', 'admin') then
    raise exception 'only owners/admins can void a supplier bill';
  end if;

  if v_bill.status = 'void' then
    raise exception 'bill is already void';
  end if;

  if v_bill.amount_paid > 0 then
    raise exception 'cannot void a bill with recorded payments';
  end if;

  for v_line in select * from supplier_bill_items where bill_id = p_bill_id
  loop
    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (v_bill.org_id, v_line.item_id, v_line.location_id, -v_line.quantity, 'void', 'supplier_bill', v_bill.id, auth.uid());
  end loop;

  update supplier_bills
  set status = 'void', updated_at = now()
  where id = p_bill_id
  returning * into v_bill;

  return v_bill;
end;
$$;

-- =========================================================================
-- Outstanding supplier bills -- AP mirror of outstanding_invoices.
-- =========================================================================

create view public.outstanding_supplier_bills as
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
  (b.due_date < current_date and b.status in ('unpaid', 'partially_paid')) as is_overdue
from supplier_bills b
join suppliers s on s.id = b.supplier_id
where b.status in ('unpaid', 'partially_paid');

-- =========================================================================
-- Extend dashboard_summary with AP totals, mirroring the AR columns added
-- in Phase 2. RETURNS TABLE column lists can't be changed by CREATE OR
-- REPLACE, so the old 9-column version must be dropped first.
-- =========================================================================

drop function public.dashboard_summary(uuid);

create function public.dashboard_summary(p_org_id uuid)
returns table (
  item_count bigint,
  low_stock_count bigint,
  today_sales_count bigint,
  today_sales_total numeric,
  outstanding_ar_total numeric,
  overdue_invoice_count bigint,
  customer_count bigint,
  revenue_this_week numeric,
  revenue_last_week numeric,
  outstanding_ap_total numeric,
  overdue_bill_count bigint
)
language sql
stable
set search_path = public
as $$
  select
    (select count(*) from items where org_id = p_org_id and is_active),
    (select count(*) from low_stock_report where org_id = p_org_id),
    (select count(*) from sales_receipts where org_id = p_org_id and status = 'completed' and created_at >= date_trunc('day', now())),
    (select coalesce(sum(total), 0) from sales_receipts where org_id = p_org_id and status = 'completed' and created_at >= date_trunc('day', now())),
    (select coalesce(sum(total - amount_paid), 0) from invoices where org_id = p_org_id and status in ('unpaid', 'partially_paid')),
    (select count(*) from invoices where org_id = p_org_id and status in ('unpaid', 'partially_paid') and due_date < current_date),
    (select count(*) from customers where org_id = p_org_id and is_active),
    (select coalesce(sum(total), 0) from sales_receipts where org_id = p_org_id and status = 'completed' and created_at >= date_trunc('week', now())),
    (select coalesce(sum(total), 0) from sales_receipts where org_id = p_org_id and status = 'completed' and created_at >= date_trunc('week', now()) - interval '7 days' and created_at < date_trunc('week', now())),
    (select coalesce(sum(total - amount_paid), 0) from supplier_bills where org_id = p_org_id and status in ('unpaid', 'partially_paid')),
    (select count(*) from supplier_bills where org_id = p_org_id and status in ('unpaid', 'partially_paid') and due_date < current_date);
$$;
