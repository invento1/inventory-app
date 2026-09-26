-- Role-based access control: per-org roles ("Security Groups"), a global
-- permission catalog, and a role x permission matrix the owner edits in
-- Settings -> Security Groups. Every write path (SECURITY DEFINER RPCs and
-- table policies) now checks a specific permission instead of plain
-- membership or a hardcoded owner/admin list.
--
-- Rules:
--   * The 'owner' role implicitly holds every permission and can't be edited.
--   * Everything else is data: role_permissions rows, toggled in the UI.
--   * has_permission() is the one check; policies and RPCs call it.
--   * Inactive members lose all access (is_org_member() is false for them).

-- ---------------------------------------------------------------------------
-- Permission catalog (global, read-only to clients)
-- ---------------------------------------------------------------------------

create table public.app_permissions (
  key text primary key,
  module text not null,
  module_label text not null,
  module_order int not null,
  label text not null,
  description text,
  sort_order int not null,
  -- Permissions this one depends on (e.g. create needs view). The Security
  -- Groups screen ticks these automatically; save_role_permissions enforces them.
  requires text[] not null default '{}'
);

alter table public.app_permissions enable row level security;
create policy "anyone signed in can read the permission catalog"
  on public.app_permissions for select to authenticated using (true);

insert into public.app_permissions (key, module, module_label, module_order, label, description, sort_order, requires) values
  ('items.view',                'items', 'Items & Inventory', 10, 'View items & stock', 'Item List, Search Item, Stock levels and movements, transfer and adjustment history', 1, '{}'),
  ('items.create',              'items', 'Items & Inventory', 10, 'Create items', null, 2, '{items.view}'),
  ('items.edit',                'items', 'Items & Inventory', 10, 'Edit items', 'Change item details, barcode, category, supplier', 3, '{items.view}'),
  ('items.prices',              'items', 'Items & Inventory', 10, 'Change prices', 'Price Manager: selling prices and reorder levels', 4, '{items.view}'),
  ('inventory.transfer',        'items', 'Items & Inventory', 10, 'Transfer stock', 'Move stock between stores and warehouses', 5, '{items.view}'),
  ('inventory.adjust',          'items', 'Items & Inventory', 10, 'Adjust inventory', 'Inventory Adjustments (changes quantity/value and posts to the ledger)', 6, '{items.view}'),

  ('customers.view',            'customers', 'Customers', 20, 'View customers', null, 1, '{}'),
  ('customers.create',          'customers', 'Customers', 20, 'Create customers', null, 2, '{customers.view}'),
  ('customers.edit',            'customers', 'Customers', 20, 'Edit customers', null, 3, '{customers.view}'),

  ('suppliers.view',            'suppliers', 'Suppliers', 30, 'View suppliers', null, 1, '{}'),
  ('suppliers.create',          'suppliers', 'Suppliers', 30, 'Create suppliers', null, 2, '{suppliers.view}'),
  ('suppliers.edit',            'suppliers', 'Suppliers', 30, 'Edit suppliers', null, 3, '{suppliers.view}'),

  ('sales.view',                'sales', 'POS / Sales Receipts', 40, 'View sales receipts', null, 1, '{}'),
  ('sales.create',              'sales', 'POS / Sales Receipts', 40, 'Create sales receipts', 'Ring up walk-in sales', 2, '{sales.view,items.view}'),

  ('invoices.view',             'invoices', 'Invoices', 50, 'View invoices', 'Includes printing', 1, '{}'),
  ('invoices.create',           'invoices', 'Invoices', 50, 'Create invoices', null, 2, '{invoices.view,customers.view,items.view}'),
  ('invoices.void',             'invoices', 'Invoices', 50, 'Void invoices', 'Unpaid invoices only; restores stock', 3, '{invoices.view}'),

  ('quotations.view',           'quotations', 'Quotations', 60, 'View quotations', null, 1, '{}'),
  ('quotations.create',         'quotations', 'Quotations', 60, 'Create quotations', null, 2, '{quotations.view,customers.view,items.view}'),
  ('quotations.void',           'quotations', 'Quotations', 60, 'Void quotations', null, 3, '{quotations.view}'),

  ('credit_memos.view',         'credit_memos', 'Credit Memos & Refunds', 70, 'View credit memos', null, 1, '{}'),
  ('credit_memos.create',       'credit_memos', 'Credit Memos & Refunds', 70, 'Create credit memos', 'Returns stock and reduces what the customer owes', 2, '{credit_memos.view,customers.view,items.view}'),
  ('credit_memos.void',         'credit_memos', 'Credit Memos & Refunds', 70, 'Void credit memos', null, 3, '{credit_memos.view}'),
  ('refunds.view',              'credit_memos', 'Credit Memos & Refunds', 70, 'View refunds', null, 4, '{}'),
  ('refunds.create',            'credit_memos', 'Credit Memos & Refunds', 70, 'Create refunds', 'Pay money back to a customer', 5, '{refunds.view,customers.view}'),

  ('customer_payments.view',    'customer_payments', 'Customer Payments', 80, 'View payments & deposits', 'View Payments, View Deposits', 1, '{}'),
  ('customer_payments.receive', 'customer_payments', 'Customer Payments', 80, 'Receive payments', 'Receive Payment, and Record payment on an invoice', 2, '{customer_payments.view,invoices.view}'),
  ('customer_payments.deposit', 'customer_payments', 'Customer Payments', 80, 'Record deposits', 'Move received payments into a bank account', 3, '{customer_payments.view}'),

  ('purchase_orders.view',      'purchase_orders', 'Purchase Orders', 90, 'View purchase orders', null, 1, '{}'),
  ('purchase_orders.create',    'purchase_orders', 'Purchase Orders', 90, 'Create purchase orders', null, 2, '{purchase_orders.view,suppliers.view,items.view}'),
  ('purchase_orders.receive',   'purchase_orders', 'Purchase Orders', 90, 'Receive purchase orders', 'Receive goods, or convert a PO to a supplier bill (which also needs Create supplier bills)', 3, '{purchase_orders.view}'),

  ('supplier_bills.view',       'supplier_bills', 'Supplier Bills', 100, 'View supplier bills', null, 1, '{}'),
  ('supplier_bills.create',     'supplier_bills', 'Supplier Bills', 100, 'Create supplier bills', 'Receives stock and records what you owe', 2, '{supplier_bills.view,suppliers.view,items.view}'),
  ('supplier_bills.void',       'supplier_bills', 'Supplier Bills', 100, 'Void supplier bills', null, 3, '{supplier_bills.view}'),

  ('supplier_payments.view',    'supplier_payments', 'Supplier Payments', 110, 'View paid bills', null, 1, '{}'),
  ('supplier_payments.create',  'supplier_payments', 'Supplier Payments', 110, 'Pay bills', null, 2, '{supplier_payments.view,supplier_bills.view}'),

  ('expenses.view',             'expenses', 'Expenses', 120, 'View expenses', null, 1, '{}'),
  ('expenses.create',           'expenses', 'Expenses', 120, 'Record expenses', null, 2, '{expenses.view}'),
  ('expenses.void',             'expenses', 'Expenses', 120, 'Void expenses', null, 3, '{expenses.view}'),

  ('accounts.view',             'accounts', 'General Ledger & Accounts', 130, 'View ledger & balances', 'Capital Matrix, Fiscal Daybook, account balances and the dashboard profit chart', 1, '{}'),
  ('accounts.manage',           'accounts', 'General Ledger & Accounts', 130, 'Manage chart of accounts', 'Create and edit ledger accounts', 2, '{accounts.view}'),
  ('journal.create',            'accounts', 'General Ledger & Accounts', 130, 'Post journal entries', 'Manual entries in the Fiscal Daybook', 3, '{accounts.view}'),
  ('banking.transfer',          'accounts', 'General Ledger & Accounts', 130, 'Transfer funds', 'Banking: move money between accounts', 4, '{accounts.view}'),

  ('reports.financial',         'reports', 'Reports', 140, 'Financial reports', 'Profit & Loss, Balance Sheet, Trial Balance, Journal, General Ledger, Account Statement', 1, '{accounts.view}'),
  ('reports.receivables_payables', 'reports', 'Reports', 140, 'Receivables & payables reports', 'Customer/supplier balances and statements, payment collection', 2, '{}'),
  ('reports.sales_purchases',   'reports', 'Reports', 140, 'Sales & purchases reports', 'Sales by item/category/customer, invoice summaries, purchases, batch print', 3, '{}'),
  ('reports.inventory',         'reports', 'Reports', 140, 'Inventory reports', 'Quantity on hand, valuation, movement, stock by supplier, worksheet', 4, '{}'),

  ('settings.company',          'settings', 'Settings & Users', 150, 'Edit company info', 'Name, contact details, currency, timezone', 1, '{}'),
  ('settings.master_data',      'settings', 'Settings & Users', 150, 'Manage master data', 'Stores, warehouses, price lists, categories, brands, units, regions & areas', 2, '{}'),
  ('users.manage',              'settings', 'Settings & Users', 150, 'Manage users', 'Invite users, change roles, deactivate or remove users', 3, '{}');

-- ---------------------------------------------------------------------------
-- Roles ("Security Groups") per org
-- ---------------------------------------------------------------------------

create table public.org_roles (
  org_id uuid not null references public.orgs(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]+$'),
  name text not null,
  description text,
  is_system boolean not null default false,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, key)
);

alter table public.org_roles enable row level security;
create policy "org members can select roles"
  on public.org_roles for select using (is_org_member(org_id));
-- No write policies: roles change only through the owner-only RPCs below.

create table public.role_permissions (
  org_id uuid not null,
  role_key text not null,
  permission_key text not null references public.app_permissions(key) on delete cascade,
  primary key (org_id, role_key, permission_key),
  foreign key (org_id, role_key) references public.org_roles(org_id, key) on delete cascade on update cascade
);

alter table public.role_permissions enable row level security;
create policy "org members can select role permissions"
  on public.role_permissions for select using (is_org_member(org_id));

-- Default roles and their starting permissions. Owner holds everything
-- implicitly, so it gets no rows.
create or replace function public.seed_default_roles(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into org_roles (org_id, key, name, description, is_system, sort_order) values
    (p_org_id, 'owner', 'Owner', 'Full access to everything, including Security Groups and Reset Data. Can''t be changed.', true, 1),
    (p_org_id, 'admin', 'Administrator', 'Runs the business day to day, including users and settings.', true, 2),
    (p_org_id, 'manager', 'Manager', 'Sales, purchasing, stock and customers. No ledger or users.', true, 3),
    (p_org_id, 'accountant', 'Accountant', 'Ledger, payments, bills, expenses and all reports.', true, 4),
    (p_org_id, 'cashier', 'Cashier', 'Sales receipts, invoices, quotations and taking payments.', true, 5)
  on conflict (org_id, key) do nothing;

  -- Administrator: everything.
  insert into role_permissions (org_id, role_key, permission_key)
  select p_org_id, 'admin', key from app_permissions
  on conflict do nothing;

  -- Manager: operations, no ledger / company settings / users / financial reports.
  insert into role_permissions (org_id, role_key, permission_key)
  select p_org_id, 'manager', key from app_permissions
  where key not in ('accounts.view', 'accounts.manage', 'journal.create', 'banking.transfer',
                    'reports.financial', 'settings.company', 'users.manage')
  on conflict do nothing;

  -- Accountant: sees everything, runs the money side, no selling/stock moves.
  insert into role_permissions (org_id, role_key, permission_key)
  select p_org_id, 'accountant', key from app_permissions
  where key like '%.view'
     or key in ('accounts.manage', 'journal.create', 'banking.transfer',
                'customer_payments.receive', 'customer_payments.deposit',
                'supplier_payments.create', 'supplier_bills.create', 'supplier_bills.void',
                'expenses.create', 'expenses.void',
                'credit_memos.create', 'credit_memos.void', 'refunds.create',
                'inventory.adjust',
                'reports.financial', 'reports.receivables_payables', 'reports.sales_purchases', 'reports.inventory')
  on conflict do nothing;

  -- Cashier: the till.
  insert into role_permissions (org_id, role_key, permission_key)
  select p_org_id, 'cashier', key from app_permissions
  where key in ('items.view', 'customers.view', 'customers.create',
                'sales.view', 'sales.create', 'invoices.view', 'invoices.create',
                'quotations.view', 'quotations.create',
                'customer_payments.view', 'customer_payments.receive')
  on conflict do nothing;
end;
$$;

revoke execute on function public.seed_default_roles(uuid) from public, authenticated, anon;

select public.seed_default_roles(id) from public.orgs;

create or replace function public.seed_default_roles_on_org_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform seed_default_roles(new.id);
  return new;
end;
$$;

create trigger orgs_seed_default_roles
  after insert on public.orgs
  for each row execute function public.seed_default_roles_on_org_insert();

-- ---------------------------------------------------------------------------
-- org_members: display name, status, role FK
-- ---------------------------------------------------------------------------

-- 'staff' no longer exists; its old access is closest to Manager.
update public.org_members set role = 'manager' where role = 'staff';

alter table public.org_members drop constraint if exists org_members_role_check;
alter table public.org_members
  add column full_name text,
  add column status text not null default 'active' check (status in ('active', 'inactive')),
  add column invited_by uuid references auth.users(id) on delete set null,
  add column updated_at timestamptz not null default now(),
  add constraint org_members_role_fkey
    foreign key (org_id, role) references public.org_roles(org_id, key) on update cascade;

-- Membership rows change only through the RPCs below and the manage-users
-- Edge Function. The old policy let any admin rewrite any membership,
-- including promoting themselves to owner or removing the owner.
drop policy if exists "owners/admins can manage membership" on public.org_members;

-- Lets a deactivated user see their own row, so the app can say why they're
-- locked out instead of "no organization".
create policy "users can see their own memberships"
  on public.org_members for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------

-- Inactive members are not members: every "org members can select" policy
-- in the app goes through this, so deactivating someone locks them out
-- everywhere at once.
create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from org_members
    where org_id = target_org and user_id = auth.uid() and status = 'active'
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
  where org_id = target_org and user_id = auth.uid() and status = 'active';
$$;

create or replace function public.has_permission(p_org_id uuid, p_permission text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from org_members m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and (
        m.role = 'owner'
        or exists (
          select 1 from role_permissions rp
          where rp.org_id = p_org_id and rp.role_key = m.role and rp.permission_key = p_permission
        )
      )
  );
$$;

create or replace function public.assert_permission(p_org_id uuid, p_permission text)
returns void
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_label text;
begin
  if not has_permission(p_org_id, p_permission) then
    select label into v_label from app_permissions where key = p_permission;
    raise exception 'You don''t have permission to do this (%). Ask the owner to update your security group.',
      coalesce(v_label, p_permission)
      using errcode = '42501';
  end if;
end;
$$;

-- The caller's effective permission keys (every key for the owner).
create or replace function public.my_permissions(p_org_id uuid)
returns text[]
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(array_agg(p.key order by p.key), '{}')
  from app_permissions p
  where has_permission(p_org_id, p.key);
$$;

-- Permission keys a role holds (every key for owner).
create or replace function public.role_permission_keys(p_org_id uuid, p_role_key text)
returns text[]
language sql
security definer
stable
set search_path = public
as $$
  select case
    when p_role_key = 'owner' then (select array_agg(key) from app_permissions)
    else coalesce((select array_agg(permission_key) from role_permissions
                   where org_id = p_org_id and role_key = p_role_key), '{}')
  end;
$$;

revoke execute on function public.role_permission_keys(uuid, text) from public, authenticated, anon;

-- Can the caller hand out / manage someone holding this role? Needs
-- users.manage, and (unless owner) the role may not be owner and may not
-- hold any permission the caller lacks -- otherwise an admin could create
-- a more powerful account for themselves.
create or replace function public.assert_can_assign_role(p_org_id uuid, p_role_key text)
returns void
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_extra text;
begin
  perform assert_permission(p_org_id, 'users.manage');

  if not exists (select 1 from org_roles where org_id = p_org_id and key = p_role_key) then
    raise exception 'Unknown role';
  end if;

  if org_role(p_org_id) = 'owner' then
    return;
  end if;

  if p_role_key = 'owner' then
    raise exception 'Only an owner can give someone the Owner role';
  end if;

  select p.label into v_extra
  from unnest(role_permission_keys(p_org_id, p_role_key)) k
  join app_permissions p on p.key = k
  where not has_permission(p_org_id, k)
  limit 1;

  if v_extra is not null then
    raise exception 'That role can do things you can''t (%), so only an owner can assign it', v_extra;
  end if;
end;
$$;

-- Can the caller change or remove this member?
create or replace function public.assert_can_manage_member(p_org_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_role text;
begin
  perform assert_permission(p_org_id, 'users.manage');

  if p_user_id = auth.uid() then
    raise exception 'You can''t change your own access. Ask another owner or admin.';
  end if;

  select role into v_role from org_members where org_id = p_org_id and user_id = p_user_id;
  if v_role is null then
    raise exception 'That user isn''t a member of this business';
  end if;

  perform assert_can_assign_role(p_org_id, v_role);
end;
$$;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

create or replace function public.list_org_members(p_org_id uuid)
returns table (
  user_id uuid,
  email text,
  full_name text,
  role text,
  status text,
  joined_at timestamptz,
  invited_at timestamptz,
  last_sign_in_at timestamptz,
  is_you boolean
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  perform assert_permission(p_org_id, 'users.manage');
  return query
    select m.user_id, u.email::text,
      coalesce(m.full_name, u.raw_user_meta_data ->> 'full_name'),
      m.role, m.status, m.created_at, u.invited_at, u.last_sign_in_at,
      m.user_id = auth.uid()
    from org_members m
    join auth.users u on u.id = m.user_id
    where m.org_id = p_org_id
    order by (m.role = 'owner') desc, lower(coalesce(m.full_name, u.email));
end;
$$;

-- Remaining active owners if this member were changed/removed.
create or replace function public.other_active_owner_count(p_org_id uuid, p_user_id uuid)
returns int
language sql
security definer
stable
set search_path = public
as $$
  select count(*)::int from org_members
  where org_id = p_org_id and role = 'owner' and status = 'active' and user_id <> p_user_id;
$$;

revoke execute on function public.other_active_owner_count(uuid, uuid) from public, authenticated, anon;

create or replace function public.update_org_member(
  p_org_id uuid,
  p_user_id uuid,
  p_full_name text,
  p_role text,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member org_members%rowtype;
begin
  select * into v_member from org_members where org_id = p_org_id and user_id = p_user_id for update;
  if not found then
    raise exception 'That user isn''t a member of this business';
  end if;

  if p_status not in ('active', 'inactive') then
    raise exception 'Status must be active or inactive';
  end if;

  if p_user_id = auth.uid() then
    -- Anyone may fix their own display name; nothing else.
    if p_role is distinct from v_member.role or p_status is distinct from v_member.status then
      raise exception 'You can''t change your own role or status. Ask another owner or admin.';
    end if;
    perform assert_permission(p_org_id, 'users.manage');
  else
    perform assert_can_manage_member(p_org_id, p_user_id);
    perform assert_can_assign_role(p_org_id, p_role);
  end if;

  if v_member.role = 'owner' and (p_role <> 'owner' or p_status <> 'active')
     and other_active_owner_count(p_org_id, p_user_id) = 0 then
    raise exception 'This is the only active owner. Make someone else an owner first.';
  end if;

  update org_members
  set full_name = nullif(trim(p_full_name), ''),
      role = p_role,
      status = p_status,
      updated_at = now()
  where org_id = p_org_id and user_id = p_user_id;
end;
$$;

create or replace function public.remove_org_member(p_org_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  perform assert_can_manage_member(p_org_id, p_user_id);

  select role into v_role from org_members where org_id = p_org_id and user_id = p_user_id;
  if v_role = 'owner' and other_active_owner_count(p_org_id, p_user_id) = 0 then
    raise exception 'This is the only active owner. Make someone else an owner first.';
  end if;

  -- user_preferences are per org; drop the removed user's.
  delete from user_preferences where org_id = p_org_id and user_id = p_user_id;
  delete from org_members where org_id = p_org_id and user_id = p_user_id;
end;
$$;

-- Used only by the manage-users Edge Function (service role).
create or replace function public.find_auth_user_by_email(p_email text)
returns table (user_id uuid, last_sign_in_at timestamptz, other_org_count int)
language sql
security definer
stable
set search_path = public
as $$
  select u.id, u.last_sign_in_at,
    (select count(*)::int from org_members m where m.user_id = u.id)
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;
$$;

revoke execute on function public.find_auth_user_by_email(text) from public, authenticated, anon;
grant execute on function public.find_auth_user_by_email(text) to service_role;

-- ---------------------------------------------------------------------------
-- Security Groups (owner-only editing)
-- ---------------------------------------------------------------------------

create or replace function public.assert_owner(p_org_id uuid)
returns void
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if coalesce(org_role(p_org_id), '') <> 'owner' then
    raise exception 'Only an owner can change security groups' using errcode = '42501';
  end if;
end;
$$;

-- Replace a role's whole permission set. Dependencies (app_permissions.requires)
-- must be included; the UI adds them automatically.
create or replace function public.save_role_permissions(p_org_id uuid, p_role_key text, p_permissions text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_missing text;
  v_unknown text;
begin
  perform assert_owner(p_org_id);

  if p_role_key = 'owner' then
    raise exception 'The Owner role always has every permission';
  end if;
  if not exists (select 1 from org_roles where org_id = p_org_id and key = p_role_key) then
    raise exception 'Unknown role';
  end if;

  select k into v_unknown from unnest(coalesce(p_permissions, '{}')) k
  where not exists (select 1 from app_permissions p where p.key = k) limit 1;
  if v_unknown is not null then
    raise exception 'Unknown permission %', v_unknown;
  end if;

  select format('%s needs %s', p.label, rp.label) into v_missing
  from app_permissions p
  cross join unnest(p.requires) r
  join app_permissions rp on rp.key = r
  where p.key = any(p_permissions) and not (r = any(p_permissions))
  limit 1;
  if v_missing is not null then
    raise exception 'Missing dependency: %', v_missing;
  end if;

  delete from role_permissions where org_id = p_org_id and role_key = p_role_key;
  insert into role_permissions (org_id, role_key, permission_key)
  select distinct p_org_id, p_role_key, k from unnest(p_permissions) k;
  update org_roles set updated_at = now() where org_id = p_org_id and key = p_role_key;
end;
$$;

create or replace function public.create_org_role(
  p_org_id uuid,
  p_name text,
  p_description text default null,
  p_copy_from text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
  v_key text;
  v_n int := 1;
begin
  perform assert_owner(p_org_id);

  if coalesce(trim(p_name), '') = '' then
    raise exception 'Role name is required';
  end if;
  if exists (select 1 from org_roles where org_id = p_org_id and lower(name) = lower(trim(p_name))) then
    raise exception 'A role called "%" already exists', trim(p_name);
  end if;

  v_base := trim(both '_' from regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '_', 'g'));
  if v_base = '' then v_base := 'role'; end if;
  v_key := v_base;
  while exists (select 1 from org_roles where org_id = p_org_id and key = v_key) loop
    v_n := v_n + 1;
    v_key := v_base || '_' || v_n;
  end loop;

  insert into org_roles (org_id, key, name, description, is_system, sort_order)
  values (p_org_id, v_key, trim(p_name), nullif(trim(p_description), ''), false,
          (select coalesce(max(sort_order), 0) + 1 from org_roles where org_id = p_org_id));

  if p_copy_from is not null then
    insert into role_permissions (org_id, role_key, permission_key)
    select p_org_id, v_key, k from unnest(role_permission_keys(p_org_id, p_copy_from)) k;
  end if;

  return v_key;
end;
$$;

create or replace function public.update_org_role(p_org_id uuid, p_role_key text, p_name text, p_description text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_owner(p_org_id);
  if p_role_key = 'owner' then
    raise exception 'The Owner role can''t be changed';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Role name is required';
  end if;
  if exists (select 1 from org_roles where org_id = p_org_id and key <> p_role_key and lower(name) = lower(trim(p_name))) then
    raise exception 'A role called "%" already exists', trim(p_name);
  end if;
  update org_roles
  set name = trim(p_name), description = nullif(trim(p_description), ''), updated_at = now()
  where org_id = p_org_id and key = p_role_key;
  if not found then
    raise exception 'Unknown role';
  end if;
end;
$$;

create or replace function public.delete_org_role(p_org_id uuid, p_role_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  perform assert_owner(p_org_id);
  if exists (select 1 from org_roles where org_id = p_org_id and key = p_role_key and is_system) then
    raise exception 'Built-in roles can''t be deleted (you can change what they can do)';
  end if;
  select count(*) into v_count from org_members where org_id = p_org_id and role = p_role_key;
  if v_count > 0 then
    raise exception 'Move the % user(s) in this role to another role first', v_count;
  end if;
  delete from org_roles where org_id = p_org_id and key = p_role_key;
end;
$$;

-- ---------------------------------------------------------------------------
-- Table policies: writes need a specific permission
-- ---------------------------------------------------------------------------

-- items: create / edit; Price Manager users (items.prices) may update only
-- prices and reorder levels -- enforced by the trigger below.
drop policy if exists "org members can insert items" on public.items;
drop policy if exists "org members can update items" on public.items;
drop policy if exists "admins can delete items" on public.items;

do $$
declare
  r record;
begin
  -- Drop every existing insert/update/delete policy on the tables whose
  -- write rules this migration replaces (names differ across migrations).
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and tablename in ('items', 'customers', 'suppliers', 'locations', 'categories', 'brands',
                        'units_of_measure', 'areas', 'price_lists', 'ledger_accounts', 'orgs',
                        'purchase_orders', 'purchase_order_lines', 'stock_movements')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end;
$$;

create policy "can create items" on public.items for insert
  with check (has_permission(org_id, 'items.create'));
create policy "can edit items" on public.items for update
  using (has_permission(org_id, 'items.edit') or has_permission(org_id, 'items.prices'))
  with check (has_permission(org_id, 'items.edit') or has_permission(org_id, 'items.prices'));
create policy "can delete items" on public.items for delete
  using (has_permission(org_id, 'items.edit'));

create or replace function public.items_guard_price_only_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- SECURITY DEFINER RPCs (MAC recompute writes avg_cost) run as the table
  -- owner, not as an app user: only police real client updates.
  if auth.uid() is null or current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if has_permission(new.org_id, 'items.edit') then
    return new;
  end if;
  if (to_jsonb(new) - '{unit_price,reorder_threshold,updated_at}'::text[])
     is distinct from (to_jsonb(old) - '{unit_price,reorder_threshold,updated_at}'::text[]) then
    raise exception 'You can only change prices and reorder levels' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger items_guard_price_only_update
  before update on public.items
  for each row execute function public.items_guard_price_only_update();

create policy "can create customers" on public.customers for insert
  with check (has_permission(org_id, 'customers.create'));
create policy "can edit customers" on public.customers for update
  using (has_permission(org_id, 'customers.edit')) with check (has_permission(org_id, 'customers.edit'));
create policy "can delete customers" on public.customers for delete
  using (has_permission(org_id, 'customers.edit'));

create policy "can create suppliers" on public.suppliers for insert
  with check (has_permission(org_id, 'suppliers.create'));
create policy "can edit suppliers" on public.suppliers for update
  using (has_permission(org_id, 'suppliers.edit')) with check (has_permission(org_id, 'suppliers.edit'));
create policy "can delete suppliers" on public.suppliers for delete
  using (has_permission(org_id, 'suppliers.edit'));

do $$
declare
  t text;
begin
  foreach t in array array['locations', 'categories', 'brands', 'units_of_measure', 'areas', 'price_lists'] loop
    execute format('create policy "can manage master data (insert)" on public.%I for insert with check (has_permission(org_id, ''settings.master_data''))', t);
    execute format('create policy "can manage master data (update)" on public.%I for update using (has_permission(org_id, ''settings.master_data'')) with check (has_permission(org_id, ''settings.master_data''))', t);
    execute format('create policy "can manage master data (delete)" on public.%I for delete using (has_permission(org_id, ''settings.master_data''))', t);
  end loop;
end;
$$;

create policy "can manage chart of accounts (insert)" on public.ledger_accounts for insert
  with check (has_permission(org_id, 'accounts.manage'));
create policy "can manage chart of accounts (update)" on public.ledger_accounts for update
  using (has_permission(org_id, 'accounts.manage')) with check (has_permission(org_id, 'accounts.manage'));
create policy "can manage chart of accounts (delete)" on public.ledger_accounts for delete
  using (has_permission(org_id, 'accounts.manage'));

create policy "can edit company info" on public.orgs for update
  using (has_permission(id, 'settings.company')) with check (has_permission(id, 'settings.company'));

create policy "can create purchase orders" on public.purchase_orders for insert
  with check (has_permission(org_id, 'purchase_orders.create'));
create policy "can edit purchase orders" on public.purchase_orders for update
  using (has_permission(org_id, 'purchase_orders.create')) with check (has_permission(org_id, 'purchase_orders.create'));
create policy "can delete purchase orders" on public.purchase_orders for delete
  using (has_permission(org_id, 'purchase_orders.create'));

create policy "can create purchase order lines" on public.purchase_order_lines for insert
  with check (exists (select 1 from purchase_orders po
                      where po.id = purchase_order_lines.po_id and has_permission(po.org_id, 'purchase_orders.create')));
create policy "can edit purchase order lines" on public.purchase_order_lines for update
  using (exists (select 1 from purchase_orders po
                 where po.id = purchase_order_lines.po_id and has_permission(po.org_id, 'purchase_orders.create')))
  with check (exists (select 1 from purchase_orders po
                      where po.id = purchase_order_lines.po_id and has_permission(po.org_id, 'purchase_orders.create')));

-- stock_movements: no client insert policy any more. Every stock change goes
-- through an RPC (sale, bill, transfer, adjustment...); the old direct insert
-- policy (from the retired quick-adjust modal) let any member change stock
-- with no document and no ledger entry.

-- Ledger reads need accounts.view. Reports and dashboard charts built on the
-- journal are SECURITY INVOKER, so they return nothing without it.
drop policy if exists "org members can select journal entries" on public.journal_entries;
drop policy if exists "org members can select journal_entries" on public.journal_entries;
drop policy if exists "org members can select journal lines" on public.journal_lines;
drop policy if exists "org members can select journal_lines" on public.journal_lines;
do $$
declare
  r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and cmd = 'SELECT' and tablename in ('journal_entries', 'journal_lines')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end;
$$;

create policy "can view the ledger" on public.journal_entries for select
  using (has_permission(org_id, 'accounts.view'));
create policy "can view ledger lines" on public.journal_lines for select
  using (exists (select 1 from journal_entries je
                 where je.id = journal_lines.journal_entry_id and has_permission(je.org_id, 'accounts.view')));
