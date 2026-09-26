-- Tenant provisioning and the "every change is global" framework.
--
-- One entry point, initialize_new_org(), runs for every new org (trigger on
-- public.orgs) and does two things:
--   1. apply_org_defaults(org): the defaults EVERY org must have (Security
--      Groups, the system ledger accounts). Idempotent and non-destructive:
--      it only creates what's missing and never re-grants or overwrites
--      something an owner customised, so migrations can safely re-run it
--      for all existing orgs.
--   2. seed_org_starter_data(org): one-off starter data for a brand-new org
--      (a first location, a starter chart of accounts). Never re-run for
--      existing orgs -- their data is theirs.
--
-- provision_org() is the one-call script for creating a business and
-- linking its owner. tenant_schema_audit() checks the multi-tenancy rules
-- (RLS, org_id, views, SECURITY DEFINER guards, per-org defaults); it must
-- return no 'error' rows after every migration.

-- ---------------------------------------------------------------------------
-- Security Groups: create missing default roles only; grant defaults only to
-- a role created in this call (never re-grant to an existing role).
-- ---------------------------------------------------------------------------

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
                                        'reports.financial', 'settings.company', 'users.manage')
      when 'accountant' then p.key like '%.view'
        or p.key in ('accounts.manage', 'journal.create', 'banking.transfer',
                     'customer_payments.receive', 'customer_payments.deposit',
                     'supplier_payments.create', 'supplier_bills.create', 'supplier_bills.void',
                     'expenses.create', 'expenses.void',
                     'credit_memos.create', 'credit_memos.void', 'refunds.create',
                     'inventory.adjust',
                     'reports.financial', 'reports.receivables_payables', 'reports.sales_purchases', 'reports.inventory')
      when 'cashier' then p.key in ('items.view', 'customers.view', 'customers.create',
                                    'sales.view', 'sales.create', 'invoices.view', 'invoices.create',
                                    'quotations.view', 'quotations.create',
                                    'customer_payments.view', 'customer_payments.receive')
      else false
    end
    on conflict do nothing;
  end loop;
end;
$$;

revoke execute on function public.seed_default_roles(uuid) from public, authenticated, anon;

-- A migration that adds a permission uses this to hand it to a default role
-- in EVERY org (skipping orgs where that role doesn't exist).
create or replace function public.grant_permission_to_role_everywhere(p_permission text, p_role_key text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into role_permissions (org_id, role_key, permission_key)
  select r.org_id, r.key, p_permission
  from org_roles r
  where r.key = p_role_key
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.grant_permission_to_role_everywhere(text, text) from public, authenticated, anon;

-- ---------------------------------------------------------------------------
-- System ledger accounts: the accounts auto-posting RPCs post to. They used
-- to appear lazily on first use; now every org has them from day one, so
-- Capital Matrix, Account Balances and the Balance Sheet start complete.
-- ---------------------------------------------------------------------------

create or replace function public.seed_system_accounts(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account record;
begin
  -- Same (name, type) pairs the posting RPCs pass to get_or_create_default_account.
  for v_account in
    select * from (values
      ('Cash', 'bank'),
      ('Bank', 'bank'),
      ('Undeposited Funds', 'other_current_asset'),
      ('Accounts Receivable', 'accounts_receivable'),
      ('Inventory', 'other_current_asset'),
      ('Accounts Payable', 'accounts_payable'),
      ('Sales Income', 'income'),
      ('Cost of Goods Sold', 'cost_of_goods_sold'),
      ('Purchases', 'expense')
    ) as a(name, account_type)
  loop
    perform get_or_create_default_account(p_org_id, v_account.name, v_account.account_type);
  end loop;
end;
$$;

revoke execute on function public.seed_system_accounts(uuid) from public, authenticated, anon;

-- ---------------------------------------------------------------------------
-- Required defaults (every org, re-runnable) and starter data (new orgs only)
-- ---------------------------------------------------------------------------

create or replace function public.apply_org_defaults(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Add each future feature's required defaults here, as an idempotent,
  -- non-destructive seed_* function, AND run it for all existing orgs in the
  -- same migration (select apply_org_defaults(id) from orgs).
  perform seed_default_roles(p_org_id);
  perform seed_system_accounts(p_org_id);
end;
$$;

revoke execute on function public.apply_org_defaults(uuid) from public, authenticated, anon;

create or replace function public.seed_org_starter_data(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A first location: items, stock, sales and invoices all need one.
  if not exists (select 1 from locations where org_id = p_org_id) then
    insert into locations (org_id, name, type) values (p_org_id, 'Main Store', 'store');
  end if;

  -- A starter chart beyond the system accounts, so Expenses has categories
  -- and equity has somewhere to go. Owners rename or add to it freely.
  insert into ledger_accounts (org_id, name, account_type, description)
  select p_org_id, a.name, a.account_type, 'Starter account'
  from (values
    ('Owner''s Equity', 'equity'),
    ('General Expenses', 'expense'),
    ('Rent', 'expense'),
    ('Salaries & Wages', 'expense'),
    ('Utilities', 'expense')
  ) as a(name, account_type)
  where not exists (select 1 from ledger_accounts l where l.org_id = p_org_id and l.name = a.name);
end;
$$;

revoke execute on function public.seed_org_starter_data(uuid) from public, authenticated, anon;

create or replace function public.initialize_new_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform apply_org_defaults(new.id);
  perform seed_org_starter_data(new.id);
  return new;
end;
$$;

-- Replaces the roles-only trigger from 20260817000000.
drop trigger if exists orgs_seed_default_roles on public.orgs;
drop function if exists public.seed_default_roles_on_org_insert();

create trigger orgs_initialize
  after insert on public.orgs
  for each row execute function public.initialize_new_org();

-- Backfill: every existing org gets whatever required defaults it lacks.
select public.apply_org_defaults(id) from public.orgs;

-- Found by tenant_schema_audit on first run: these two were only revoked
-- from PUBLIC, but Supabase grants EXECUTE on public functions to anon and
-- authenticated directly, so any signed-in user could call them for any org
-- (burn another org's document numbers; force an avg-cost replay). Only
-- SECURITY DEFINER RPCs call them, and those run as the owner.
revoke execute on function public.next_document_number(uuid, text, text) from public, authenticated, anon;
revoke execute on function public.recompute_item_avg_cost(uuid) from public, authenticated, anon;

-- ---------------------------------------------------------------------------
-- provision_org: create a business and link its owner in one call.
-- Run as the database owner (SQL Editor or `npx supabase db query --linked`);
-- app users can't call it. The owner must already have a login -- invite
-- them first (Dashboard -> Authentication -> Users -> Invite user).
-- ---------------------------------------------------------------------------

create or replace function public.provision_org(
  p_name text,
  p_slug text,
  p_owner_email text,
  p_currency_symbol text default '$',
  p_currency_code text default 'USD',
  p_timezone text default null,
  p_location_name text default 'Main Store',
  p_owner_name text default null
)
returns table (
  org_id uuid,
  org_name text,
  slug text,
  owner_user_id uuid,
  owner_email text,
  roles int,
  ledger_accounts int,
  locations int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user auth.users%rowtype;
  v_org_id uuid;
begin
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Business name is required';
  end if;
  if p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Slug must be lowercase letters, numbers and single hyphens (e.g. adils-store)';
  end if;
  if exists (select 1 from orgs o where o.slug = p_slug) then
    raise exception 'Slug "%" is already taken', p_slug;
  end if;

  select * into v_user from auth.users u where lower(u.email) = lower(trim(p_owner_email));
  if not found then
    raise exception 'No login for %. Invite them first: Supabase Dashboard -> Authentication -> Users -> Invite user.',
      p_owner_email;
  end if;

  -- The orgs_initialize trigger seeds Security Groups, system accounts,
  -- starter accounts and a first location.
  insert into orgs (name, slug, currency_symbol, currency_code, timezone)
  values (trim(p_name), p_slug, coalesce(p_currency_symbol, '$'), coalesce(p_currency_code, 'USD'), p_timezone)
  returning id into v_org_id;

  insert into org_members (org_id, user_id, role, full_name)
  values (v_org_id, v_user.id, 'owner',
          coalesce(nullif(trim(p_owner_name), ''), v_user.raw_user_meta_data ->> 'full_name'));

  if coalesce(trim(p_location_name), '') <> '' then
    update locations l set name = trim(p_location_name)
    where l.org_id = v_org_id and l.name = 'Main Store';
  end if;

  return query
    select v_org_id, trim(p_name), p_slug, v_user.id, v_user.email::text,
      (select count(*)::int from org_roles r where r.org_id = v_org_id),
      (select count(*)::int from ledger_accounts a where a.org_id = v_org_id),
      (select count(*)::int from locations l where l.org_id = v_org_id);
end;
$$;

revoke execute on function public.provision_org(text, text, text, text, text, text, text, text) from public, authenticated, anon;

-- ---------------------------------------------------------------------------
-- tenant_schema_audit: the multi-tenancy rules, checked. Run after every
-- migration:  npx supabase db query --linked "select * from tenant_schema_audit()"
-- Any 'error' row must be fixed before shipping; 'warning' rows need a look.
-- ---------------------------------------------------------------------------

create or replace function public.tenant_schema_audit()
returns table (severity text, check_name text, object text, detail text)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  -- Global (not per-tenant) tables: the tenant registry itself and the
  -- permission catalog.
  v_global_tables text[] := array['orgs', 'app_permissions'];
  -- Tenant tables that deliberately have no client policies at all
  -- (system-managed, written only by SECURITY DEFINER functions).
  v_system_tables text[] := array['doc_number_counters'];
  -- SECURITY DEFINER functions that are safe for any signed-in user without
  -- a permission check (read-only helpers, or they check auth.uid() themselves).
  v_open_functions text[] := array['org_timezone', 'assert_accounts_not_controlled'];
  v_guard text := '(assert_permission|has_permission|is_org_member|org_role|assert_owner|assert_can_|auth\.uid)';
begin
  -- 1. Every public table has RLS.
  return query
    select 'error', 'rls_disabled', c.relname::text, 'Row Level Security is off: every row is readable with the anon key'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

  -- 2. Tenant tables carry org_id, or are line-item children whose policies
  --    scope through the parent (EXISTS ... is_org_member(p.org_id)).
  return query
    select 'error', 'missing_org_id', c.relname::text,
      'No org_id column and no parent-scoped policy (see CLAUDE.md §3 line-item exception)'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and not (c.relname = any(v_global_tables))
      and not exists (select 1 from information_schema.columns col
                      where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'org_id')
      and not exists (select 1 from pg_policies p
                      where p.schemaname = 'public' and p.tablename = c.relname
                        and coalesce(p.qual, p.with_check) ~ '(is_org_member|has_permission)\(\w+\.org_id\)|(is_org_member|has_permission)\(\w+\.org_id,');

  -- 3. Tenant tables can be read by their members (except system tables).
  return query
    select 'warning', 'no_select_policy', c.relname::text, 'RLS is on but nobody can select from it'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and not (c.relname = any(v_system_tables))
      and not exists (select 1 from pg_policies p
                      where p.schemaname = 'public' and p.tablename = c.relname and p.cmd in ('SELECT', 'ALL'));

  -- 4. Every policy on a tenant table is scoped to an org (or to the user).
  return query
    select 'error', 'policy_not_org_scoped', p.tablename || ': ' || p.policyname,
      'Policy expression never checks org membership, a permission or auth.uid()'
    from pg_policies p
    where p.schemaname = 'public'
      and not (p.tablename = 'app_permissions')
      and coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') !~ '(is_org_member|has_permission|org_role|auth\.uid)';

  -- 5. Views apply the base tables' RLS.
  return query
    select 'error', 'view_not_security_invoker', c.relname::text,
      'View runs as its owner and bypasses RLS; create it with (security_invoker = true)'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm')
      and not coalesce(c.reloptions @> array['security_invoker=true'], false)
      and not coalesce(c.reloptions @> array['security_invoker=on'], false);

  -- 6. SECURITY DEFINER functions callable by signed-in users check access.
  return query
    select 'warning', 'definer_function_unguarded', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
      'SECURITY DEFINER, executable by authenticated, and never checks membership/permission: revoke it or add assert_permission'
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not (p.proname = any(v_open_functions))
      and p.prosrc !~ v_guard;

  -- 7. Every org has its required defaults.
  return query
    select 'error', 'org_missing_roles', o.name || ' (' || o.slug || ')', 'Missing default Security Groups: run apply_org_defaults'
    from orgs o
    where (select count(*) from org_roles r where r.org_id = o.id and r.key in ('owner', 'admin', 'manager', 'accountant', 'cashier')) < 5;

  return query
    select 'error', 'org_missing_system_accounts', o.name || ' (' || o.slug || ')',
      'Missing system ledger accounts: ' || string_agg(a.name, ', ')
    from orgs o
    cross join (values ('Cash'), ('Bank'), ('Undeposited Funds'), ('Accounts Receivable'), ('Inventory'),
                       ('Accounts Payable'), ('Sales Income'), ('Cost of Goods Sold'), ('Purchases')) as a(name)
    where not exists (select 1 from ledger_accounts l where l.org_id = o.id and l.name = a.name)
    group by o.name, o.slug;

  return query
    select 'error', 'org_without_active_owner', o.name || ' (' || o.slug || ')', 'Nobody can manage this business'
    from orgs o
    where not exists (select 1 from org_members m where m.org_id = o.id and m.role = 'owner' and m.status = 'active');

  return query
    select 'warning', 'org_without_location', o.name || ' (' || o.slug || ')', 'Items, stock and sales need at least one location'
    from orgs o
    where not exists (select 1 from locations l where l.org_id = o.id);
end;
$$;

revoke execute on function public.tenant_schema_audit() from public, authenticated, anon;
