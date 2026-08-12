-- Phase 1: customers, sequential document numbering, sales receipts
-- (walk-in, paid-in-full sales), and a dashboard summary RPC.
-- See CLAUDE.md sections 3-4 for the RLS/trigger/RPC conventions this follows.

-- =========================================================================
-- Items: add a sellable price (no cost_price yet -- nothing populates it
-- until purchasing/costing is built in a later phase).
-- =========================================================================

alter table public.items
  add column unit_price numeric not null default 0 check (unit_price >= 0);

-- =========================================================================
-- Customers (same shape/RLS pattern as suppliers)
-- =========================================================================

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null,
  phone text,
  email text,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customers_org_id_idx on public.customers (org_id);

alter table public.customers enable row level security;

create policy "org members can select customers"
  on public.customers for select
  using (is_org_member(org_id));

create policy "org members can insert customers"
  on public.customers for insert
  with check (is_org_member(org_id));

create policy "org members can update customers"
  on public.customers for update
  using (is_org_member(org_id))
  with check (is_org_member(org_id));

create policy "admins can delete customers"
  on public.customers for delete
  using (org_role(org_id) in ('owner', 'admin'));

-- =========================================================================
-- Sequential, prefixed document numbering (reusable across document types)
-- =========================================================================

create table public.doc_number_counters (
  org_id uuid not null references public.orgs (id) on delete cascade,
  doc_type text not null,
  next_number integer not null default 1,
  primary key (org_id, doc_type)
);

alter table public.doc_number_counters enable row level security;
-- No policies: this table is system-managed only, written exclusively by
-- next_document_number() below -- same "no client policies" shape as
-- stock_levels.

create or replace function public.next_document_number(p_org_id uuid, p_doc_type text, p_prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  insert into doc_number_counters (org_id, doc_type, next_number)
  values (p_org_id, p_doc_type, 1)
  on conflict (org_id, doc_type) do nothing;

  update doc_number_counters
  set next_number = next_number + 1
  where org_id = p_org_id and doc_type = p_doc_type
  returning next_number - 1 into v_next;

  return p_prefix || '-' || lpad(v_next::text, 6, '0');
end;
$$;

-- No legitimate direct-call use case; only meant to be called from inside
-- other SECURITY DEFINER functions (which still work after this revoke,
-- since they run as the function owner).
revoke execute on function public.next_document_number(uuid, text, text) from public;

-- =========================================================================
-- Sales receipts (walk-in, paid-in-full sale -- no invoicing/AR in Phase 1)
-- =========================================================================

create table public.sales_receipts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  receipt_number text not null,
  customer_id uuid references public.customers (id),
  status text not null default 'completed' check (status in ('completed', 'voided')),
  payment_method text not null check (payment_method in ('cash', 'card', 'bank_transfer', 'other')),
  subtotal numeric not null default 0,
  total numeric not null default 0,
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index sales_receipts_org_receipt_number_idx on public.sales_receipts (org_id, receipt_number);
create index sales_receipts_org_created_at_idx on public.sales_receipts (org_id, created_at desc);

alter table public.sales_receipts enable row level security;

create policy "org members can select sales receipts"
  on public.sales_receipts for select
  using (is_org_member(org_id));

-- No insert/update/delete policy: receipts are only ever created via
-- create_sales_receipt() below (SECURITY DEFINER, bypasses RLS after its
-- own membership check) -- same shape as stock_levels being read-only from
-- the client. 'voided' exists in the check constraint so the schema
-- doesn't box out a future void feature, but no UI/RPC for voiding ships
-- in Phase 1.

-- =========================================================================
-- Sales receipt line items
--
-- No org_id of its own -- this follows the same pattern already used for
-- purchase_order_lines: a line-item child table that is only ever written
-- as part of one atomic parent transaction (entirely inside
-- create_sales_receipt) and only ever read scoped by an already-org-
-- filtered parent id. Scope through the parent via EXISTS instead of
-- duplicating org_id onto every line.
-- =========================================================================

create table public.sales_receipt_items (
  id uuid primary key default gen_random_uuid(),
  sales_receipt_id uuid not null references public.sales_receipts (id) on delete cascade,
  item_id uuid not null references public.items (id),
  location_id uuid not null references public.locations (id),
  quantity numeric not null check (quantity > 0),
  unit_price numeric not null check (unit_price >= 0),
  line_total numeric not null,
  created_at timestamptz not null default now()
);

create index sales_receipt_items_receipt_id_idx on public.sales_receipt_items (sales_receipt_id);

alter table public.sales_receipt_items enable row level security;

create policy "org members can select sales receipt items"
  on public.sales_receipt_items for select
  using (
    exists (
      select 1 from sales_receipts sr
      where sr.id = sales_receipt_items.sales_receipt_id and is_org_member(sr.org_id)
    )
  );

-- =========================================================================
-- Atomic sale creation: header + lines + stock movements in one call.
-- Mirrors receive_purchase_order_line's shape.
-- =========================================================================

create or replace function public.create_sales_receipt(
  p_org_id uuid,
  p_customer_id uuid,
  p_payment_method text,
  p_lines jsonb
)
returns public.sales_receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt sales_receipts%rowtype;
  v_receipt_number text;
  v_subtotal numeric;
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

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a sale must have at least one line item';
  end if;

  -- Total is computed here, server-side, from the lines -- never trusted
  -- from a client-sent total field (there is no such field on this RPC).
  select coalesce(sum((line ->> 'quantity')::numeric * (line ->> 'unit_price')::numeric), 0)
  into v_subtotal
  from jsonb_array_elements(p_lines) as line;

  v_receipt_number := next_document_number(p_org_id, 'sales_receipt', 'SR');

  insert into sales_receipts (org_id, receipt_number, customer_id, payment_method, subtotal, total, created_by)
  values (p_org_id, v_receipt_number, p_customer_id, p_payment_method, v_subtotal, v_subtotal, auth.uid())
  returning * into v_receipt;

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

    insert into sales_receipt_items (sales_receipt_id, item_id, location_id, quantity, unit_price, line_total)
    values (v_receipt.id, v_item_id, v_location_id, v_quantity, v_unit_price, v_quantity * v_unit_price);

    -- No stock-sufficiency check: sales are allowed to go negative rather
    -- than being blocked (matches the old app's behavior); the resulting
    -- shortfall surfaces via low_stock_report.
    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (p_org_id, v_item_id, v_location_id, -v_quantity, 'sale', 'sales_receipt', v_receipt.id, auth.uid());
  end loop;

  return v_receipt;
end;
$$;

-- =========================================================================
-- Dashboard summary -- one round trip instead of three or four.
-- Plain SQL, SECURITY INVOKER (the default): ordinary RLS applies, and it
-- still filters by p_org_id explicitly per the defense-in-depth convention.
-- =========================================================================

create or replace function public.dashboard_summary(p_org_id uuid)
returns table (
  item_count bigint,
  low_stock_count bigint,
  today_sales_count bigint,
  today_sales_total numeric
)
language sql
stable
set search_path = public
as $$
  select
    (select count(*) from items where org_id = p_org_id and is_active),
    (select count(*) from low_stock_report where org_id = p_org_id),
    (select count(*) from sales_receipts where org_id = p_org_id and status = 'completed' and created_at >= date_trunc('day', now())),
    (select coalesce(sum(total), 0) from sales_receipts where org_id = p_org_id and status = 'completed' and created_at >= date_trunc('day', now()));
$$;
