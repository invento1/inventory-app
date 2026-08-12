-- Multi-tenant inventory schema: orgs, membership, RLS helpers, and core
-- inventory tables (locations, items, stock, suppliers, purchase orders).
-- See CLAUDE.md sections 3-4 for the reasoning behind these choices.

-- =========================================================================
-- Orgs & membership
-- =========================================================================

create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  created_at timestamptz not null default now()
);

create table public.org_members (
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'staff')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index org_members_user_id_idx on public.org_members (user_id);

-- SECURITY DEFINER so these can be referenced from policies on org_members
-- itself without recursing; STABLE so Postgres can cache the result within
-- a single statement instead of re-evaluating it per row.
create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from org_members
    where org_id = target_org and user_id = auth.uid()
  );
$$;

create or replace function public.org_role(target_org uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from org_members
  where org_id = target_org and user_id = auth.uid();
$$;

alter table public.orgs enable row level security;
alter table public.org_members enable row level security;

create policy "members can view their orgs"
  on public.orgs for select
  using (is_org_member(id));

create policy "members can view their own org's membership rows"
  on public.org_members for select
  using (is_org_member(org_id));

create policy "owners/admins can manage membership"
  on public.org_members for all
  using (org_role(org_id) in ('owner', 'admin'))
  with check (org_role(org_id) in ('owner', 'admin'));

-- =========================================================================
-- Locations
-- =========================================================================

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index locations_org_id_idx on public.locations (org_id);

alter table public.locations enable row level security;

create policy "org members can select locations"
  on public.locations for select
  using (is_org_member(org_id));

create policy "org members can insert locations"
  on public.locations for insert
  with check (is_org_member(org_id));

create policy "org members can update locations"
  on public.locations for update
  using (is_org_member(org_id))
  with check (is_org_member(org_id));

create policy "admins can delete locations"
  on public.locations for delete
  using (org_role(org_id) in ('owner', 'admin'));

-- =========================================================================
-- Items
-- =========================================================================

create table public.items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  sku text not null,
  barcode text,
  name text not null,
  description text,
  unit text not null default 'unit',
  reorder_threshold numeric,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index items_org_id_sku_idx on public.items (org_id, sku);
create index items_org_id_barcode_idx on public.items (org_id, barcode);

alter table public.items enable row level security;

create policy "org members can select items"
  on public.items for select
  using (is_org_member(org_id));

create policy "org members can insert items"
  on public.items for insert
  with check (is_org_member(org_id));

create policy "org members can update items"
  on public.items for update
  using (is_org_member(org_id))
  with check (is_org_member(org_id));

create policy "admins can delete items"
  on public.items for delete
  using (org_role(org_id) in ('owner', 'admin'));

-- =========================================================================
-- Stock levels (derived cache) & stock movements (append-only audit log)
-- =========================================================================

create table public.stock_levels (
  org_id uuid not null references public.orgs (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  quantity numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (item_id, location_id)
);

create index stock_levels_org_id_idx on public.stock_levels (org_id);

alter table public.stock_levels enable row level security;

create policy "org members can select stock levels"
  on public.stock_levels for select
  using (is_org_member(org_id));

-- No insert/update/delete policies: stock_levels is only ever written by
-- the apply_stock_movement trigger below (security definer), never
-- directly by client requests.

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  quantity_delta numeric not null,
  reason text not null check (reason in ('receive', 'sale', 'adjustment', 'transfer')),
  reference_type text,
  reference_id uuid,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index stock_movements_org_item_created_idx
  on public.stock_movements (org_id, item_id, created_at desc);

alter table public.stock_movements enable row level security;

create policy "org members can select stock movements"
  on public.stock_movements for select
  using (is_org_member(org_id));

create policy "org members can insert stock movements"
  on public.stock_movements for insert
  with check (is_org_member(org_id));

-- Movements are an append-only audit log: no update/delete policies.

create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into stock_levels (org_id, item_id, location_id, quantity, updated_at)
  values (new.org_id, new.item_id, new.location_id, new.quantity_delta, now())
  on conflict (item_id, location_id)
  do update set
    quantity = stock_levels.quantity + excluded.quantity,
    updated_at = now();

  return new;
end;
$$;

create trigger stock_movements_apply
  after insert on public.stock_movements
  for each row
  execute function public.apply_stock_movement();

-- =========================================================================
-- Suppliers & purchase orders
-- =========================================================================

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null,
  contact_name text,
  contact_email text,
  contact_phone text,
  created_at timestamptz not null default now()
);

create index suppliers_org_id_idx on public.suppliers (org_id);

alter table public.suppliers enable row level security;

create policy "org members can select suppliers"
  on public.suppliers for select
  using (is_org_member(org_id));

create policy "org members can insert suppliers"
  on public.suppliers for insert
  with check (is_org_member(org_id));

create policy "org members can update suppliers"
  on public.suppliers for update
  using (is_org_member(org_id))
  with check (is_org_member(org_id));

create policy "admins can delete suppliers"
  on public.suppliers for delete
  using (org_role(org_id) in ('owner', 'admin'));

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id),
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'partially_received', 'received', 'cancelled')),
  expected_date date,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index purchase_orders_org_id_idx on public.purchase_orders (org_id);

alter table public.purchase_orders enable row level security;

create policy "org members can select purchase orders"
  on public.purchase_orders for select
  using (is_org_member(org_id));

create policy "org members can insert purchase orders"
  on public.purchase_orders for insert
  with check (is_org_member(org_id));

create policy "org members can update purchase orders"
  on public.purchase_orders for update
  using (is_org_member(org_id))
  with check (is_org_member(org_id));

create policy "admins can delete purchase orders"
  on public.purchase_orders for delete
  using (org_role(org_id) in ('owner', 'admin'));

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders (id) on delete cascade,
  item_id uuid not null references public.items (id),
  quantity_ordered numeric not null check (quantity_ordered > 0),
  quantity_received numeric not null default 0,
  unit_cost numeric,
  created_at timestamptz not null default now()
);

create index purchase_order_lines_po_id_idx on public.purchase_order_lines (po_id);

alter table public.purchase_order_lines enable row level security;

-- purchase_order_lines has no org_id column of its own; scope through the
-- parent purchase_orders row.
create policy "org members can select po lines"
  on public.purchase_order_lines for select
  using (
    exists (
      select 1 from purchase_orders po
      where po.id = purchase_order_lines.po_id and is_org_member(po.org_id)
    )
  );

create policy "org members can insert po lines"
  on public.purchase_order_lines for insert
  with check (
    exists (
      select 1 from purchase_orders po
      where po.id = purchase_order_lines.po_id and is_org_member(po.org_id)
    )
  );

create policy "org members can update po lines"
  on public.purchase_order_lines for update
  using (
    exists (
      select 1 from purchase_orders po
      where po.id = purchase_order_lines.po_id and is_org_member(po.org_id)
    )
  )
  with check (
    exists (
      select 1 from purchase_orders po
      where po.id = purchase_order_lines.po_id and is_org_member(po.org_id)
    )
  );

-- Atomically records a receipt against a PO line: updates the line's
-- quantity_received, inserts a stock_movements row (which the trigger above
-- turns into a stock_levels update), and bumps the PO's status. Called via
-- RPC from the client instead of several separate round-trips.
create or replace function public.receive_purchase_order_line(
  p_po_line_id uuid,
  p_location_id uuid,
  p_quantity numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line purchase_order_lines%rowtype;
  v_po purchase_orders%rowtype;
  v_remaining_open boolean;
begin
  select * into v_line from purchase_order_lines where id = p_po_line_id;
  if not found then
    raise exception 'purchase_order_line % not found', p_po_line_id;
  end if;

  select * into v_po from purchase_orders where id = v_line.po_id;

  if not is_org_member(v_po.org_id) then
    raise exception 'not a member of this org';
  end if;

  if p_quantity <= 0 then
    raise exception 'quantity must be positive';
  end if;

  update purchase_order_lines
  set quantity_received = quantity_received + p_quantity
  where id = p_po_line_id;

  insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
  values (v_po.org_id, v_line.item_id, p_location_id, p_quantity, 'receive', 'purchase_order_line', p_po_line_id, auth.uid());

  select exists (
    select 1 from purchase_order_lines
    where po_id = v_po.id and quantity_received < quantity_ordered
  ) into v_remaining_open;

  update purchase_orders
  set status = case when v_remaining_open then 'partially_received' else 'received' end,
      updated_at = now()
  where id = v_po.id;
end;
$$;

-- =========================================================================
-- Low-stock report (view inherits RLS from its base tables automatically)
-- =========================================================================

create view public.low_stock_report as
select
  sl.org_id,
  sl.item_id,
  sl.location_id,
  sl.quantity,
  i.reorder_threshold
from stock_levels sl
join items i on i.id = sl.item_id
where i.reorder_threshold is not null
  and sl.quantity <= i.reorder_threshold;
