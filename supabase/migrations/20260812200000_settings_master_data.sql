-- Settings master data: Categories (hierarchical), Brands, Units of Measure,
-- and Areas -- wired into items (category_id, brand_id) and customers
-- (area_id). Deleting a category/brand/area must not delete the
-- items/customers that reference it, so these FKs are "on delete set null"
-- rather than cascade -- these are descriptive tags, not ownership
-- relationships.

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null,
  parent_id uuid references public.categories (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index categories_org_id_idx on public.categories (org_id);

alter table public.categories enable row level security;

create policy "org members can select categories"
  on public.categories for select
  using (is_org_member(org_id));

create policy "org members can insert categories"
  on public.categories for insert
  with check (is_org_member(org_id));

create policy "org members can update categories"
  on public.categories for update
  using (is_org_member(org_id))
  with check (is_org_member(org_id));

create policy "admins can delete categories"
  on public.categories for delete
  using (org_role(org_id) in ('owner', 'admin'));

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index brands_org_id_idx on public.brands (org_id);

alter table public.brands enable row level security;

create policy "org members can select brands"
  on public.brands for select
  using (is_org_member(org_id));

create policy "org members can insert brands"
  on public.brands for insert
  with check (is_org_member(org_id));

create policy "org members can update brands"
  on public.brands for update
  using (is_org_member(org_id))
  with check (is_org_member(org_id));

create policy "admins can delete brands"
  on public.brands for delete
  using (org_role(org_id) in ('owner', 'admin'));

create table public.units_of_measure (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null,
  abbreviation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index units_of_measure_org_id_idx on public.units_of_measure (org_id);

alter table public.units_of_measure enable row level security;

create policy "org members can select units of measure"
  on public.units_of_measure for select
  using (is_org_member(org_id));

create policy "org members can insert units of measure"
  on public.units_of_measure for insert
  with check (is_org_member(org_id));

create policy "org members can update units of measure"
  on public.units_of_measure for update
  using (is_org_member(org_id))
  with check (is_org_member(org_id));

create policy "admins can delete units of measure"
  on public.units_of_measure for delete
  using (org_role(org_id) in ('owner', 'admin'));

create table public.areas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null,
  region text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index areas_org_id_idx on public.areas (org_id);

alter table public.areas enable row level security;

create policy "org members can select areas"
  on public.areas for select
  using (is_org_member(org_id));

create policy "org members can insert areas"
  on public.areas for insert
  with check (is_org_member(org_id));

create policy "org members can update areas"
  on public.areas for update
  using (is_org_member(org_id))
  with check (is_org_member(org_id));

create policy "admins can delete areas"
  on public.areas for delete
  using (org_role(org_id) in ('owner', 'admin'));

-- Wiring into items and customers.
alter table public.items add column category_id uuid references public.categories (id) on delete set null;
alter table public.items add column brand_id uuid references public.brands (id) on delete set null;
alter table public.customers add column area_id uuid references public.areas (id) on delete set null;

create index items_category_id_idx on public.items (category_id);
create index items_brand_id_idx on public.items (brand_id);
create index customers_area_id_idx on public.customers (area_id);
