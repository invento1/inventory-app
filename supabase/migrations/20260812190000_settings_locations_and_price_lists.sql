-- Settings: Stores/Warehouses (both are the existing locations table,
-- distinguished by a new type column so stock/sales/invoices/POs keep
-- working against one unified location concept) and a simple Price Lists
-- log (date/type/optional image URL -- not a pricing engine, see CLAUDE.md
-- roadmap: wholesale pricing automation is a later phase).

alter table public.locations
  add column type text not null default 'store' check (type in ('store', 'warehouse'));

create table public.price_lists (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  list_date date not null default current_date,
  list_type text not null default 'retail' check (list_type in ('retail', 'wholesale', 'custom')),
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index price_lists_org_id_idx on public.price_lists (org_id);

alter table public.price_lists enable row level security;

create policy "org members can select price lists"
  on public.price_lists for select
  using (is_org_member(org_id));

create policy "org members can insert price lists"
  on public.price_lists for insert
  with check (is_org_member(org_id));

create policy "org members can update price lists"
  on public.price_lists for update
  using (is_org_member(org_id))
  with check (is_org_member(org_id));

create policy "admins can delete price lists"
  on public.price_lists for delete
  using (org_role(org_id) in ('owner', 'admin'));
