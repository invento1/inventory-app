-- Phase 2: invoicing / accounts receivable. Invoices support partial
-- payments over time, due dates with a computed (not stored) overdue
-- condition, and voiding with a compensating stock reversal.
-- See CLAUDE.md sections 3-4 for the RLS/trigger/RPC conventions this
-- follows, mirroring create_sales_receipt/next_document_number/
-- dashboard_summary from the Phase 1 migration.

-- =========================================================================
-- Widen stock_movements.reason to cover a void's compensating entry.
-- Invoice creation itself reuses the existing 'sale' reason
-- (reference_type='invoice' already disambiguates it from a
-- sales_receipt); voiding needs its own reason because none of the
-- existing ones describe "a prior decrease was reversed" without
-- corrupting audit/report semantics ('adjustment' means a manual stock
-- count correction, not this).
-- =========================================================================

alter table public.stock_movements
  drop constraint stock_movements_reason_check;

alter table public.stock_movements
  add constraint stock_movements_reason_check
  check (reason in ('receive', 'sale', 'adjustment', 'transfer', 'void'));

-- =========================================================================
-- Invoices. Unlike sales_receipts, customer_id is required -- AR is
-- meaningless without knowing who owes the money. There is no 'draft'
-- status: create_invoice is atomic and final, exactly like
-- create_sales_receipt. 'overdue' is deliberately not a stored status --
-- see outstanding_invoices below.
-- =========================================================================

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  invoice_number text not null,
  customer_id uuid not null references public.customers (id),
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
  constraint invoices_due_date_after_issue check (due_date >= issue_date),
  constraint invoices_amount_paid_not_over_total check (amount_paid <= total)
);

create unique index invoices_org_invoice_number_idx on public.invoices (org_id, invoice_number);
create index invoices_org_created_at_idx on public.invoices (org_id, created_at desc);
create index invoices_org_status_idx on public.invoices (org_id, status);
create index invoices_org_due_date_idx on public.invoices (org_id, due_date);
create index invoices_customer_id_idx on public.invoices (customer_id);

alter table public.invoices enable row level security;

create policy "org members can select invoices"
  on public.invoices for select
  using (is_org_member(org_id));

-- No insert/update/delete policy: invoices are only ever written via
-- create_invoice / record_invoice_payment / void_invoice below (all
-- SECURITY DEFINER, each doing its own membership check) -- same shape as
-- sales_receipts.

-- =========================================================================
-- Invoice line items -- same "line-item child, no org_id" exception as
-- sales_receipt_items / purchase_order_lines (see CLAUDE.md section 3).
-- =========================================================================

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  item_id uuid not null references public.items (id),
  location_id uuid not null references public.locations (id),
  quantity numeric not null check (quantity > 0),
  unit_price numeric not null check (unit_price >= 0),
  line_total numeric not null,
  created_at timestamptz not null default now()
);

create index invoice_items_invoice_id_idx on public.invoice_items (invoice_id);

alter table public.invoice_items enable row level security;

create policy "org members can select invoice items"
  on public.invoice_items for select
  using (
    exists (
      select 1 from invoices inv
      where inv.id = invoice_items.invoice_id and is_org_member(inv.org_id)
    )
  );

-- =========================================================================
-- Invoice payments -- an append-only ledger like stock_movements (own
-- org_id, in case it's ever queried org-wide e.g. "cash received this
-- week"), but deliberately has NO client insert policy: unlike a stock
-- adjustment, a bare insert here would desync invoices.amount_paid/status.
-- Every payment must go through record_invoice_payment().
-- =========================================================================

create table public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  amount numeric not null check (amount > 0),
  payment_method text not null check (payment_method in ('cash', 'card', 'bank_transfer', 'other')),
  paid_at timestamptz not null default now(),
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index invoice_payments_org_invoice_idx on public.invoice_payments (org_id, invoice_id);
create index invoice_payments_org_created_at_idx on public.invoice_payments (org_id, created_at desc);

alter table public.invoice_payments enable row level security;

create policy "org members can select invoice payments"
  on public.invoice_payments for select
  using (is_org_member(org_id));

-- No insert/update/delete policy -- see comment above the table.

-- =========================================================================
-- Atomic invoice creation: header + lines + stock movements. Mirrors
-- create_sales_receipt exactly, except customer_id is required and there's
-- a due_date.
-- =========================================================================

create or replace function public.create_invoice(
  p_org_id uuid,
  p_customer_id uuid,
  p_due_date date,
  p_lines jsonb,
  p_notes text default null
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice invoices%rowtype;
  v_invoice_number text;
  v_subtotal numeric;
  v_customer_org uuid;
  v_line jsonb;
  v_item_id uuid;
  v_location_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_item_org uuid;
  v_location_org uuid;
begin
  if not is_org_member(p_org_id) then
    raise exception 'not a member of this org';
  end if;

  if p_customer_id is null then
    raise exception 'an invoice requires a customer';
  end if;

  select org_id into v_customer_org from customers where id = p_customer_id;
  if v_customer_org is distinct from p_org_id then
    raise exception 'customer does not belong to this org';
  end if;

  if p_due_date is null then
    raise exception 'an invoice requires a due date';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'an invoice must have at least one line item';
  end if;

  -- Total is computed here, server-side, from the lines -- never trusted
  -- from a client-sent total field (there is no such field on this RPC).
  select coalesce(sum((line ->> 'quantity')::numeric * (line ->> 'unit_price')::numeric), 0)
  into v_subtotal
  from jsonb_array_elements(p_lines) as line;

  v_invoice_number := next_document_number(p_org_id, 'invoice', 'INV');

  insert into invoices (org_id, invoice_number, customer_id, due_date, subtotal, total, notes, created_by)
  values (p_org_id, v_invoice_number, p_customer_id, p_due_date, v_subtotal, v_subtotal, p_notes, auth.uid())
  returning * into v_invoice;

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

    -- This function is SECURITY DEFINER and bypasses RLS, so it must not
    -- trust that the caller's item/location ids actually belong to
    -- p_org_id -- otherwise a caller could pass another org's ids and
    -- pollute their stock.
    select org_id into v_item_org from items where id = v_item_id;
    if v_item_org is distinct from p_org_id then
      raise exception 'item does not belong to this org';
    end if;

    select org_id into v_location_org from locations where id = v_location_id;
    if v_location_org is distinct from p_org_id then
      raise exception 'location does not belong to this org';
    end if;

    insert into invoice_items (invoice_id, item_id, location_id, quantity, unit_price, line_total)
    values (v_invoice.id, v_item_id, v_location_id, v_quantity, v_unit_price, v_quantity * v_unit_price);

    -- Same reason='sale' as create_sales_receipt -- reference_type='invoice'
    -- is what distinguishes this from a walk-in sale in the audit log. No
    -- stock-sufficiency check, matching create_sales_receipt: negative
    -- stock is allowed, surfaced via low_stock_report rather than blocked.
    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (p_org_id, v_item_id, v_location_id, -v_quantity, 'sale', 'invoice', v_invoice.id, auth.uid());
  end loop;

  return v_invoice;
end;
$$;

-- =========================================================================
-- Record a partial or full payment against an invoice. Inserts the payment
-- row and atomically recomputes amount_paid/status on the invoice -- the
-- two writes happen in one function call so they can never be observed in
-- a partially-applied state.
-- =========================================================================

create or replace function public.record_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_paid_at timestamptz default now(),
  p_notes text default null
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice invoices%rowtype;
  v_new_amount_paid numeric;
begin
  select * into v_invoice from invoices where id = p_invoice_id;
  if not found then
    raise exception 'invoice % not found', p_invoice_id;
  end if;

  if not is_org_member(v_invoice.org_id) then
    raise exception 'not a member of this org';
  end if;

  if v_invoice.status = 'void' then
    raise exception 'cannot record a payment against a voided invoice';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'payment amount must be positive';
  end if;

  v_new_amount_paid := v_invoice.amount_paid + p_amount;

  -- No credit-balance concept exists on customers (see CLAUDE.md) --
  -- overpayment is rejected rather than silently accepted, since there's
  -- nowhere for the excess to live.
  if v_new_amount_paid > v_invoice.total then
    raise exception 'payment of % exceeds remaining balance of %',
      p_amount, (v_invoice.total - v_invoice.amount_paid);
  end if;

  insert into invoice_payments (org_id, invoice_id, amount, payment_method, paid_at, notes, created_by)
  values (v_invoice.org_id, p_invoice_id, p_amount, p_payment_method, coalesce(p_paid_at, now()), p_notes, auth.uid());

  update invoices
  set amount_paid = v_new_amount_paid,
      status = case
        when v_new_amount_paid >= total then 'paid'
        when v_new_amount_paid > 0 then 'partially_paid'
        else 'unpaid'
      end,
      updated_at = now()
  where id = p_invoice_id
  returning * into v_invoice;

  return v_invoice;
end;
$$;

-- =========================================================================
-- Void an invoice: reverses the stock deduction via compensating
-- stock_movements entries and marks the invoice void. Restricted to
-- owner/admin (same bar as other destructive actions). Blocked once any
-- payment has been recorded -- there's no credit-note/refund model yet, so
-- voiding a paid invoice would leave real cash received with no
-- corresponding document.
-- =========================================================================

create or replace function public.void_invoice(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice invoices%rowtype;
  v_line record;
begin
  select * into v_invoice from invoices where id = p_invoice_id;
  if not found then
    raise exception 'invoice % not found', p_invoice_id;
  end if;

  if org_role(v_invoice.org_id) not in ('owner', 'admin') then
    raise exception 'only owners/admins can void an invoice';
  end if;

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
  end loop;

  update invoices
  set status = 'void', updated_at = now()
  where id = p_invoice_id
  returning * into v_invoice;

  return v_invoice;
end;
$$;

-- =========================================================================
-- Outstanding invoices -- one lightweight view for "who owes money", not a
-- full aging report suite. is_overdue is computed here, not stored, since
-- there's no cron job in this stack to flip a stored flag when a due date
-- passes (mirrors low_stock_report being a computed view over the
-- stock_levels cache rather than a stored flag on items).
-- =========================================================================

create view public.outstanding_invoices as
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
  (i.due_date < current_date and i.status in ('unpaid', 'partially_paid')) as is_overdue
from invoices i
join customers c on c.id = i.customer_id
where i.status in ('unpaid', 'partially_paid');

-- =========================================================================
-- Extend dashboard_summary with AR totals. Postgres won't let
-- CREATE OR REPLACE FUNCTION change a RETURNS TABLE column list, so the
-- old 4-column version must be dropped first.
-- =========================================================================

drop function public.dashboard_summary(uuid);

create function public.dashboard_summary(p_org_id uuid)
returns table (
  item_count bigint,
  low_stock_count bigint,
  today_sales_count bigint,
  today_sales_total numeric,
  outstanding_ar_total numeric,
  overdue_invoice_count bigint
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
    (select count(*) from invoices where org_id = p_org_id and status in ('unpaid', 'partially_paid') and due_date < current_date);
$$;
