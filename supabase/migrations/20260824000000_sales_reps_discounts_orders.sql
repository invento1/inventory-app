-- Sales representatives, commission, discounts and Sales Orders: the missing
-- features behind 8 of the old HashirHub's reports (Sales / Return Stock by
-- Representative, Sales by Salesman, Financial Recovery, Customer / Item
-- Discounts, Sales Orders / Open Orders).
--
-- Sales representatives (old app: one "Sales Representatives" list, used as
-- rep, salesman and customer credit manager alike):
--   * sales_reps master data (Settings, settings.master_data);
--   * customers.sales_rep_id: the customer's default rep / credit manager;
--   * invoices, sales_receipts, credit_memos, sales_orders .sales_rep_id: the
--     rep on that document (the form defaults it from the customer);
--   * items.commission_rate (%), snapshotted onto invoice/receipt lines so a
--     later rate change never rewrites past commission.
--
-- Discounts, on invoices, sales receipts and sales orders:
--   * a per-line discount amount: line_total = qty * unit_price - discount;
--   * a whole-document discount amount: total = subtotal - discount, where
--     subtotal = sum(line_total).
-- Revenue is posted net (Credit Sales Income with the total), so every
-- existing report and the ledger keep agreeing. sales_lines spreads the
-- document discount across lines in proportion, so line-based reports still
-- add up to document totals.
--
-- Sales Orders: a customer's order before it's invoiced. Never touches stock
-- or the ledger (like a quotation). Editable and cancellable while open;
-- create_invoice(p_sales_order_id) converts it (status 'invoiced', linked),
-- and voiding that invoice reopens the order.

-- ---------------------------------------------------------------------------
-- Sales representatives
-- ---------------------------------------------------------------------------

create table public.sales_reps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  phone text,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index sales_reps_org_name_key on public.sales_reps (org_id, lower(name));

alter table public.sales_reps enable row level security;

create policy "org members can select sales reps"
  on public.sales_reps for select using (is_org_member(org_id));
create policy "can manage master data (insert)"
  on public.sales_reps for insert with check (has_permission(org_id, 'settings.master_data'));
create policy "can manage master data (update)"
  on public.sales_reps for update
  using (has_permission(org_id, 'settings.master_data'))
  with check (has_permission(org_id, 'settings.master_data'));
create policy "can manage master data (delete)"
  on public.sales_reps for delete using (has_permission(org_id, 'settings.master_data'));

alter table public.customers
  add column sales_rep_id uuid references public.sales_reps(id) on delete set null;
create index customers_sales_rep_id_idx on public.customers (sales_rep_id);

alter table public.items
  add column commission_rate numeric not null default 0
    check (commission_rate >= 0 and commission_rate <= 100);

alter table public.invoices
  add column sales_rep_id uuid references public.sales_reps(id) on delete set null,
  add column discount numeric not null default 0 check (discount >= 0);
alter table public.sales_receipts
  add column sales_rep_id uuid references public.sales_reps(id) on delete set null,
  add column discount numeric not null default 0 check (discount >= 0);
alter table public.credit_memos
  add column sales_rep_id uuid references public.sales_reps(id) on delete set null;

alter table public.invoice_items
  add column discount numeric not null default 0 check (discount >= 0),
  add column commission_rate numeric;
alter table public.sales_receipt_items
  add column discount numeric not null default 0 check (discount >= 0),
  add column commission_rate numeric;

comment on column public.invoice_items.discount is 'Line discount amount; line_total = quantity * unit_price - discount.';
comment on column public.invoice_items.commission_rate is 'items.commission_rate (%) at the moment of sale; NULL on lines from before commission existed.';
comment on column public.invoices.discount is 'Whole-invoice discount amount; total = subtotal - discount.';

create index invoices_sales_rep_id_idx on public.invoices (sales_rep_id);
create index sales_receipts_sales_rep_id_idx on public.sales_receipts (sales_rep_id);
create index credit_memos_sales_rep_id_idx on public.credit_memos (sales_rep_id);

-- Callers are SECURITY DEFINER RPCs, which bypass RLS: check the rep belongs
-- to the org being written.
create or replace function public.assert_sales_rep_in_org(p_org_id uuid, p_sales_rep_id uuid)
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if p_sales_rep_id is not null
     and (select org_id from sales_reps where id = p_sales_rep_id) is distinct from p_org_id then
    raise exception 'sales representative does not belong to this org';
  end if;
end;
$$;

-- Line discount check shared by every sales document RPC.
create or replace function public.assert_valid_line_discount(p_quantity numeric, p_unit_price numeric, p_discount numeric)
returns void
language plpgsql
immutable
as $$
begin
  if p_discount < 0 then
    raise exception 'a line discount cannot be negative';
  end if;
  if p_discount > p_quantity * p_unit_price then
    raise exception 'a line discount cannot be more than the line amount';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sales orders
-- ---------------------------------------------------------------------------

create table public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  order_number text not null,
  customer_id uuid not null references public.customers(id),
  sales_rep_id uuid references public.sales_reps(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'invoiced', 'cancelled')),
  order_date date not null,
  delivery_date date,
  subtotal numeric not null default 0,
  discount numeric not null default 0 check (discount >= 0),
  total numeric not null default 0,
  notes text,
  invoice_id uuid references public.invoices(id) on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index sales_orders_org_number_key on public.sales_orders (org_id, order_number);
create index sales_orders_org_date_idx on public.sales_orders (org_id, order_date desc);
create index sales_orders_invoice_id_idx on public.sales_orders (invoice_id);

create trigger sales_orders_fill_order_date before insert on public.sales_orders
  for each row execute function public.fill_org_local_date('order_date');

create table public.sales_order_items (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  item_id uuid not null references public.items(id),
  quantity numeric not null check (quantity > 0),
  unit_price numeric not null check (unit_price >= 0),
  discount numeric not null default 0 check (discount >= 0),
  line_total numeric not null,
  line_order int not null default 0,
  created_at timestamptz not null default now()
);
create index sales_order_items_order_idx on public.sales_order_items (sales_order_id);

-- Written only through the RPCs below, like quotations.
alter table public.sales_orders enable row level security;
alter table public.sales_order_items enable row level security;

create policy "org members can select sales orders"
  on public.sales_orders for select using (is_org_member(org_id));
create policy "org members can select sales order items"
  on public.sales_order_items for select
  using (exists (select 1 from sales_orders o where o.id = sales_order_items.sales_order_id and is_org_member(o.org_id)));

-- Permissions: module between Quotations (60) and Credit Memos (70).
insert into public.app_permissions (key, module, module_label, module_order, label, description, sort_order, requires) values
  ('sales_orders.view',   'sales_orders', 'Sales Orders', 65, 'View sales orders', null, 1, '{}'),
  ('sales_orders.create', 'sales_orders', 'Sales Orders', 65, 'Create & edit sales orders', 'Also converts an order into an invoice (that needs Create invoices too)', 2, '{sales_orders.view,customers.view,items.view}'),
  ('sales_orders.void',   'sales_orders', 'Sales Orders', 65, 'Cancel sales orders', null, 3, '{sales_orders.view}');

-- Existing orgs' built-in roles (new orgs get them from seed_default_roles).
select grant_permission_to_role_everywhere(k, 'admin') from unnest(array['sales_orders.view', 'sales_orders.create', 'sales_orders.void']) k;
select grant_permission_to_role_everywhere(k, 'manager') from unnest(array['sales_orders.view', 'sales_orders.create', 'sales_orders.void']) k;
select grant_permission_to_role_everywhere('sales_orders.view', 'accountant');
select grant_permission_to_role_everywhere(k, 'cashier') from unnest(array['sales_orders.view', 'sales_orders.create']) k;

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
                                    'sales_orders.view', 'sales_orders.create',
                                    'customer_payments.view', 'customer_payments.receive')
      else false
    end
    on conflict do nothing;
  end loop;
end;
$$;

-- Replaces an order's lines and returns the new subtotal. Called only from
-- the SECURITY DEFINER order RPCs (which have already checked permission).
create or replace function public.write_sales_order_lines(p_org_id uuid, p_order_id uuid, p_lines jsonb)
returns numeric
language plpgsql
set search_path = public
as $$
declare
  v_line jsonb;
  v_item_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_discount numeric;
  v_order int := 0;
  v_subtotal numeric := 0;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a sales order must have at least one line item';
  end if;

  delete from sales_order_items where sales_order_id = p_order_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := (v_line ->> 'item_id')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_price := (v_line ->> 'unit_price')::numeric;
    v_discount := coalesce((v_line ->> 'discount')::numeric, 0);

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'quantity must be positive';
    end if;
    if v_unit_price is null or v_unit_price < 0 then
      raise exception 'unit price cannot be negative';
    end if;
    perform assert_valid_line_discount(v_quantity, v_unit_price, v_discount);

    if (select org_id from items where id = v_item_id) is distinct from p_org_id then
      raise exception 'item does not belong to this org';
    end if;

    v_order := v_order + 1;
    insert into sales_order_items (sales_order_id, item_id, quantity, unit_price, discount, line_total, line_order)
    values (p_order_id, v_item_id, v_quantity, v_unit_price, v_discount, v_quantity * v_unit_price - v_discount, v_order);

    v_subtotal := v_subtotal + v_quantity * v_unit_price - v_discount;
  end loop;

  return v_subtotal;
end;
$$;
revoke execute on function public.write_sales_order_lines(uuid, uuid, jsonb) from public, authenticated, anon;

create or replace function public.create_sales_order(
  p_org_id uuid,
  p_customer_id uuid,
  p_delivery_date date,
  p_lines jsonb,
  p_notes text default null,
  p_sales_rep_id uuid default null,
  p_discount numeric default 0
)
returns sales_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order sales_orders%rowtype;
  v_subtotal numeric;
begin
  perform assert_permission(p_org_id, 'sales_orders.create');

  if p_customer_id is null then
    raise exception 'a sales order requires a customer';
  end if;
  if (select org_id from customers where id = p_customer_id) is distinct from p_org_id then
    raise exception 'customer does not belong to this org';
  end if;
  perform assert_sales_rep_in_org(p_org_id, p_sales_rep_id);

  insert into sales_orders (org_id, order_number, customer_id, sales_rep_id, delivery_date, notes, created_by)
  values (p_org_id, next_document_number(p_org_id, 'sales_order', 'SO'), p_customer_id, p_sales_rep_id,
          p_delivery_date, p_notes, auth.uid())
  returning * into v_order;

  v_subtotal := write_sales_order_lines(p_org_id, v_order.id, p_lines);

  if coalesce(p_discount, 0) < 0 or coalesce(p_discount, 0) > v_subtotal then
    raise exception 'the order discount must be between 0 and the subtotal';
  end if;

  update sales_orders
  set subtotal = v_subtotal, discount = coalesce(p_discount, 0), total = v_subtotal - coalesce(p_discount, 0)
  where id = v_order.id
  returning * into v_order;

  return v_order;
end;
$$;

create or replace function public.update_sales_order(
  p_order_id uuid,
  p_customer_id uuid,
  p_delivery_date date,
  p_lines jsonb,
  p_notes text default null,
  p_sales_rep_id uuid default null,
  p_discount numeric default 0
)
returns sales_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order sales_orders%rowtype;
  v_subtotal numeric;
begin
  select * into v_order from sales_orders where id = p_order_id for update;
  if not found then
    raise exception 'sales order % not found', p_order_id;
  end if;

  perform assert_permission(v_order.org_id, 'sales_orders.create');

  if v_order.status <> 'open' then
    raise exception 'only an open sales order can be edited (this one is %)', v_order.status;
  end if;
  if p_customer_id is null then
    raise exception 'a sales order requires a customer';
  end if;
  if (select org_id from customers where id = p_customer_id) is distinct from v_order.org_id then
    raise exception 'customer does not belong to this org';
  end if;
  perform assert_sales_rep_in_org(v_order.org_id, p_sales_rep_id);

  v_subtotal := write_sales_order_lines(v_order.org_id, v_order.id, p_lines);

  if coalesce(p_discount, 0) < 0 or coalesce(p_discount, 0) > v_subtotal then
    raise exception 'the order discount must be between 0 and the subtotal';
  end if;

  update sales_orders
  set customer_id = p_customer_id, sales_rep_id = p_sales_rep_id, delivery_date = p_delivery_date,
      notes = p_notes, subtotal = v_subtotal, discount = coalesce(p_discount, 0),
      total = v_subtotal - coalesce(p_discount, 0), updated_at = now()
  where id = v_order.id
  returning * into v_order;

  return v_order;
end;
$$;

create or replace function public.cancel_sales_order(p_order_id uuid)
returns sales_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order sales_orders%rowtype;
begin
  select * into v_order from sales_orders where id = p_order_id for update;
  if not found then
    raise exception 'sales order % not found', p_order_id;
  end if;

  perform assert_permission(v_order.org_id, 'sales_orders.void');

  if v_order.status <> 'open' then
    raise exception 'only an open sales order can be cancelled (this one is %)', v_order.status;
  end if;

  update sales_orders set status = 'cancelled', updated_at = now()
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sales document RPCs: rep, discounts, commission snapshot, order link.
-- New trailing parameters change the signatures, so drop the old ones first.
-- ---------------------------------------------------------------------------

drop function if exists public.create_invoice(uuid, uuid, date, jsonb, text);

create function public.create_invoice(
  p_org_id uuid,
  p_customer_id uuid,
  p_due_date date,
  p_lines jsonb,
  p_notes text default null,
  p_sales_rep_id uuid default null,
  p_discount numeric default 0,
  p_sales_order_id uuid default null
)
returns invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice invoices%rowtype;
  v_invoice_number text;
  v_subtotal numeric;
  v_discount numeric := coalesce(p_discount, 0);
  v_order sales_orders%rowtype;
  v_line jsonb;
  v_item_id uuid;
  v_location_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_line_discount numeric;
  v_item_org uuid;
  v_item_cost numeric;
  v_commission_rate numeric;
  v_total_cogs numeric := 0;
begin
  perform assert_permission(p_org_id, 'invoices.create');

  if p_customer_id is null then
    raise exception 'an invoice requires a customer';
  end if;
  if (select org_id from customers where id = p_customer_id) is distinct from p_org_id then
    raise exception 'customer does not belong to this org';
  end if;
  if p_due_date is null then
    raise exception 'an invoice requires a due date';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'an invoice must have at least one line item';
  end if;
  perform assert_sales_rep_in_org(p_org_id, p_sales_rep_id);

  select coalesce(sum((line ->> 'quantity')::numeric * (line ->> 'unit_price')::numeric
                      - coalesce((line ->> 'discount')::numeric, 0)), 0)
  into v_subtotal
  from jsonb_array_elements(p_lines) as line;

  if v_discount < 0 or v_discount > v_subtotal then
    raise exception 'the invoice discount must be between 0 and the subtotal';
  end if;

  if p_sales_order_id is not null then
    select * into v_order from sales_orders where id = p_sales_order_id for update;
    if not found or v_order.org_id <> p_org_id then
      raise exception 'sales order not found';
    end if;
    if v_order.status <> 'open' then
      raise exception 'sales order % is already %', v_order.order_number, v_order.status;
    end if;
    if v_order.customer_id <> p_customer_id then
      raise exception 'the invoice must be for the sales order''s customer';
    end if;
  end if;

  v_invoice_number := next_document_number(p_org_id, 'invoice', 'INV');

  insert into invoices (org_id, invoice_number, customer_id, sales_rep_id, due_date, subtotal, discount, total, notes, created_by)
  values (p_org_id, v_invoice_number, p_customer_id, p_sales_rep_id, p_due_date, v_subtotal, v_discount,
          v_subtotal - v_discount, p_notes, auth.uid())
  returning * into v_invoice;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := (v_line ->> 'item_id')::uuid;
    v_location_id := (v_line ->> 'location_id')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_price := (v_line ->> 'unit_price')::numeric;
    v_line_discount := coalesce((v_line ->> 'discount')::numeric, 0);

    if v_quantity <= 0 then
      raise exception 'quantity must be positive';
    end if;
    if v_unit_price < 0 then
      raise exception 'unit price cannot be negative';
    end if;
    perform assert_valid_line_discount(v_quantity, v_unit_price, v_line_discount);

    select org_id, avg_cost, commission_rate into v_item_org, v_item_cost, v_commission_rate
    from items where id = v_item_id;
    if v_item_org is distinct from p_org_id then
      raise exception 'item does not belong to this org';
    end if;
    if (select org_id from locations where id = v_location_id) is distinct from p_org_id then
      raise exception 'location does not belong to this org';
    end if;

    insert into invoice_items (invoice_id, item_id, location_id, quantity, unit_price, discount, unit_cost, commission_rate, line_total)
    values (v_invoice.id, v_item_id, v_location_id, v_quantity, v_unit_price, v_line_discount, v_item_cost,
            v_commission_rate, v_quantity * v_unit_price - v_line_discount);

    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (p_org_id, v_item_id, v_location_id, -v_quantity, 'sale', 'invoice', v_invoice.id, auth.uid());

    v_total_cogs := v_total_cogs + (v_quantity * coalesce(v_item_cost, 0));
  end loop;

  if v_invoice.total > 0 then
    perform post_journal_entry(
      p_org_id, v_invoice.issue_date, 'Invoice ' || v_invoice_number,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Accounts Receivable', 'accounts_receivable'),
          'debit', v_invoice.total, 'credit', 0
        ),
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Sales Income', 'income'),
          'debit', 0, 'credit', v_invoice.total
        )
      ),
      'invoice', v_invoice.id
    );
  end if;

  if v_total_cogs > 0 then
    perform post_journal_entry(
      p_org_id, v_invoice.issue_date, 'COGS for invoice ' || v_invoice_number,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Cost of Goods Sold', 'cost_of_goods_sold'),
          'debit', v_total_cogs, 'credit', 0
        ),
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Inventory', 'other_current_asset'),
          'debit', 0, 'credit', v_total_cogs
        )
      ),
      'invoice_cogs', v_invoice.id
    );
  end if;

  if p_sales_order_id is not null then
    update sales_orders set status = 'invoiced', invoice_id = v_invoice.id, updated_at = now()
    where id = p_sales_order_id;
  end if;

  return v_invoice;
end;
$$;

-- Voiding an invoice made from a sales order reopens the order.
create or replace function public.void_invoice(p_invoice_id uuid)
returns invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice invoices%rowtype;
  v_line record;
  v_total_cogs numeric := 0;
begin
  select * into v_invoice from invoices where id = p_invoice_id;
  if not found then
    raise exception 'invoice % not found', p_invoice_id;
  end if;

  perform assert_permission(v_invoice.org_id, 'invoices.void');

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

    v_total_cogs := v_total_cogs + (v_line.quantity * coalesce(v_line.unit_cost, 0));
  end loop;

  update invoices
  set status = 'void', updated_at = now()
  where id = p_invoice_id
  returning * into v_invoice;

  update sales_orders set status = 'open', invoice_id = null, updated_at = now()
  where invoice_id = p_invoice_id and status = 'invoiced';

  if v_invoice.total > 0 then
    perform post_journal_entry(
      v_invoice.org_id, current_date, 'Void invoice ' || v_invoice.invoice_number,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', get_or_create_default_account(v_invoice.org_id, 'Accounts Receivable', 'accounts_receivable'),
          'debit', 0, 'credit', v_invoice.total
        ),
        jsonb_build_object(
          'account_id', get_or_create_default_account(v_invoice.org_id, 'Sales Income', 'income'),
          'debit', v_invoice.total, 'credit', 0
        )
      ),
      'invoice_void', v_invoice.id
    );
  end if;

  if v_total_cogs > 0 then
    perform post_journal_entry(
      v_invoice.org_id, current_date, 'Reverse COGS for voided invoice ' || v_invoice.invoice_number,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', get_or_create_default_account(v_invoice.org_id, 'Inventory', 'other_current_asset'),
          'debit', v_total_cogs, 'credit', 0
        ),
        jsonb_build_object(
          'account_id', get_or_create_default_account(v_invoice.org_id, 'Cost of Goods Sold', 'cost_of_goods_sold'),
          'debit', 0, 'credit', v_total_cogs
        )
      ),
      'invoice_void_cogs', v_invoice.id
    );
  end if;

  return v_invoice;
end;
$$;

drop function if exists public.create_sales_receipt(uuid, uuid, text, jsonb);

create function public.create_sales_receipt(
  p_org_id uuid,
  p_customer_id uuid,
  p_payment_method text,
  p_lines jsonb,
  p_sales_rep_id uuid default null,
  p_discount numeric default 0
)
returns sales_receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt sales_receipts%rowtype;
  v_receipt_number text;
  v_subtotal numeric;
  v_discount numeric := coalesce(p_discount, 0);
  v_line jsonb;
  v_item_id uuid;
  v_location_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_line_discount numeric;
  v_item_org uuid;
  v_item_cost numeric;
  v_commission_rate numeric;
  v_total_cogs numeric := 0;
begin
  perform assert_permission(p_org_id, 'sales.create');

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a sale must have at least one line item';
  end if;
  if p_customer_id is not null
     and (select org_id from customers where id = p_customer_id) is distinct from p_org_id then
    raise exception 'customer does not belong to this org';
  end if;
  perform assert_sales_rep_in_org(p_org_id, p_sales_rep_id);

  select coalesce(sum((line ->> 'quantity')::numeric * (line ->> 'unit_price')::numeric
                      - coalesce((line ->> 'discount')::numeric, 0)), 0)
  into v_subtotal
  from jsonb_array_elements(p_lines) as line;

  if v_discount < 0 or v_discount > v_subtotal then
    raise exception 'the sale discount must be between 0 and the subtotal';
  end if;

  v_receipt_number := next_document_number(p_org_id, 'sales_receipt', 'SR');

  insert into sales_receipts (org_id, receipt_number, customer_id, sales_rep_id, payment_method, subtotal, discount, total, created_by)
  values (p_org_id, v_receipt_number, p_customer_id, p_sales_rep_id, p_payment_method, v_subtotal, v_discount,
          v_subtotal - v_discount, auth.uid())
  returning * into v_receipt;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := (v_line ->> 'item_id')::uuid;
    v_location_id := (v_line ->> 'location_id')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_price := (v_line ->> 'unit_price')::numeric;
    v_line_discount := coalesce((v_line ->> 'discount')::numeric, 0);

    if v_quantity <= 0 then
      raise exception 'quantity must be positive';
    end if;
    if v_unit_price < 0 then
      raise exception 'unit price cannot be negative';
    end if;
    perform assert_valid_line_discount(v_quantity, v_unit_price, v_line_discount);

    select org_id, avg_cost, commission_rate into v_item_org, v_item_cost, v_commission_rate
    from items where id = v_item_id;
    if v_item_org is distinct from p_org_id then
      raise exception 'item does not belong to this org';
    end if;
    if (select org_id from locations where id = v_location_id) is distinct from p_org_id then
      raise exception 'location does not belong to this org';
    end if;

    insert into sales_receipt_items (sales_receipt_id, item_id, location_id, quantity, unit_price, discount, unit_cost, commission_rate, line_total)
    values (v_receipt.id, v_item_id, v_location_id, v_quantity, v_unit_price, v_line_discount, v_item_cost,
            v_commission_rate, v_quantity * v_unit_price - v_line_discount);

    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (p_org_id, v_item_id, v_location_id, -v_quantity, 'sale', 'sales_receipt', v_receipt.id, auth.uid());

    v_total_cogs := v_total_cogs + (v_quantity * coalesce(v_item_cost, 0));
  end loop;

  if v_receipt.total > 0 then
    perform post_journal_entry(
      p_org_id, current_date, 'Sales receipt ' || v_receipt_number,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', get_or_create_default_account(
            p_org_id, case when p_payment_method = 'cash' then 'Cash' else 'Bank' end, 'bank'
          ),
          'debit', v_receipt.total, 'credit', 0
        ),
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Sales Income', 'income'),
          'debit', 0, 'credit', v_receipt.total
        )
      ),
      'sales_receipt', v_receipt.id
    );
  end if;

  if v_total_cogs > 0 then
    perform post_journal_entry(
      p_org_id, current_date, 'COGS for sales receipt ' || v_receipt_number,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Cost of Goods Sold', 'cost_of_goods_sold'),
          'debit', v_total_cogs, 'credit', 0
        ),
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Inventory', 'other_current_asset'),
          'debit', 0, 'credit', v_total_cogs
        )
      ),
      'sales_receipt_cogs', v_receipt.id
    );
  end if;

  return v_receipt;
end;
$$;

drop function if exists public.create_credit_memo(uuid, uuid, jsonb, text);

create function public.create_credit_memo(
  p_org_id uuid,
  p_customer_id uuid,
  p_lines jsonb,
  p_notes text default null,
  p_sales_rep_id uuid default null
)
returns credit_memos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credit_memo credit_memos%rowtype;
  v_credit_memo_number text;
  v_subtotal numeric;
  v_line jsonb;
  v_item_id uuid;
  v_location_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_item_org uuid;
  v_item_cost numeric;
  v_total_cost numeric := 0;
begin
  perform assert_permission(p_org_id, 'credit_memos.create');

  if p_customer_id is null then
    raise exception 'a credit memo requires a customer';
  end if;
  if (select org_id from customers where id = p_customer_id) is distinct from p_org_id then
    raise exception 'customer does not belong to this org';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a credit memo must have at least one line item';
  end if;
  perform assert_sales_rep_in_org(p_org_id, p_sales_rep_id);

  select coalesce(sum((line ->> 'quantity')::numeric * (line ->> 'unit_price')::numeric), 0)
  into v_subtotal
  from jsonb_array_elements(p_lines) as line;

  v_credit_memo_number := next_document_number(p_org_id, 'credit_memo', 'CM');

  insert into credit_memos (org_id, credit_memo_number, customer_id, sales_rep_id, subtotal, total, notes, created_by)
  values (p_org_id, v_credit_memo_number, p_customer_id, p_sales_rep_id, v_subtotal, v_subtotal, p_notes, auth.uid())
  returning * into v_credit_memo;

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

    select org_id, avg_cost into v_item_org, v_item_cost from items where id = v_item_id;
    if v_item_org is distinct from p_org_id then
      raise exception 'item does not belong to this org';
    end if;
    if (select org_id from locations where id = v_location_id) is distinct from p_org_id then
      raise exception 'location does not belong to this org';
    end if;

    insert into credit_memo_items (credit_memo_id, item_id, location_id, quantity, unit_price, unit_cost, line_total)
    values (v_credit_memo.id, v_item_id, v_location_id, v_quantity, v_unit_price, v_item_cost, v_quantity * v_unit_price);

    -- Positive: goods physically coming back.
    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (p_org_id, v_item_id, v_location_id, v_quantity, 'return', 'credit_memo', v_credit_memo.id, auth.uid());

    v_total_cost := v_total_cost + (v_quantity * coalesce(v_item_cost, 0));
  end loop;

  if v_subtotal > 0 then
    perform post_journal_entry(
      p_org_id, v_credit_memo.issue_date, 'Credit memo ' || v_credit_memo_number,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Sales Income', 'income'),
          'debit', v_subtotal, 'credit', 0
        ),
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Accounts Receivable', 'accounts_receivable'),
          'debit', 0, 'credit', v_subtotal
        )
      ),
      'credit_memo', v_credit_memo.id
    );
  end if;

  if v_total_cost > 0 then
    perform post_journal_entry(
      p_org_id, v_credit_memo.issue_date, 'Cost of returns for credit memo ' || v_credit_memo_number,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Inventory', 'other_current_asset'),
          'debit', v_total_cost, 'credit', 0
        ),
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Cost of Goods Sold', 'cost_of_goods_sold'),
          'debit', 0, 'credit', v_total_cost
        )
      ),
      'credit_memo_cogs', v_credit_memo.id
    );
  end if;

  return v_credit_memo;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reporting base: sales_lines gains the rep, discounts and commission rate.
-- amount stays "what the line actually earned": its line_total less its share
-- of the document discount, so sum(amount) per document = document total.
-- RETURNS TABLE changes, so drop first (the report functions that call it are
-- plain SQL and re-resolve it at run time).
-- ---------------------------------------------------------------------------

drop function if exists public.sales_lines(uuid, date, date);

create function public.sales_lines(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  doc_type text, doc_id uuid, doc_number text, txn_date date,
  customer_id uuid, customer_name text,
  item_id uuid, sku text, item_name text, category_id uuid, category_name text,
  quantity numeric, amount numeric, cogs numeric,
  sales_rep_id uuid, gross_amount numeric, line_discount numeric, discount numeric, commission_rate numeric
)
language sql
stable
set search_path = public
as $$
  select
    'invoice', inv.id, inv.invoice_number, inv.issue_date, inv.customer_id, c.name,
    it.id, it.sku, it.name, it.category_id, cat.name,
    ii.quantity,
    ii.line_total * coalesce(inv.total / nullif(inv.subtotal, 0), 1),
    ii.quantity * ii.unit_cost,
    inv.sales_rep_id,
    ii.quantity * ii.unit_price,
    ii.discount,
    ii.quantity * ii.unit_price - ii.line_total * coalesce(inv.total / nullif(inv.subtotal, 0), 1),
    ii.commission_rate
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
    sri.quantity,
    sri.line_total * coalesce(sr.total / nullif(sr.subtotal, 0), 1),
    sri.quantity * sri.unit_cost,
    sr.sales_rep_id,
    sri.quantity * sri.unit_price,
    sri.discount,
    sri.quantity * sri.unit_price - sri.line_total * coalesce(sr.total / nullif(sr.subtotal, 0), 1),
    sri.commission_rate
  from sales_receipts sr
  join sales_receipt_items sri on sri.sales_receipt_id = sr.id
  join items it on it.id = sri.item_id
  left join categories cat on cat.id = it.category_id
  left join customers c on c.id = sr.customer_id
  where sr.org_id = p_org_id
    and sr.status <> 'void'
    and sr.sale_date between p_start_date and p_end_date;
$$;

-- ---------------------------------------------------------------------------
-- Reports (report-RPC convention: SQL, stable, SECURITY INVOKER, explicit org).
-- ---------------------------------------------------------------------------

-- Sales By Representative: sales, discounts given and returns per rep.
create or replace function public.sales_by_rep(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  sales_rep_id uuid, rep_name text, doc_count bigint,
  gross_amount numeric, discount numeric, amount numeric, returns numeric, net_amount numeric
)
language sql
stable
set search_path = public
as $$
  with s as (
    select sales_rep_id, count(distinct doc_id) as docs, sum(gross_amount) as gross,
           sum(discount) as disc, sum(amount) as amt
    from sales_lines(p_org_id, p_start_date, p_end_date)
    group by sales_rep_id
  ),
  r as (
    select sales_rep_id, sum(total) as ret
    from credit_memos
    where org_id = p_org_id and status <> 'void' and issue_date between p_start_date and p_end_date
    group by sales_rep_id
  ),
  ids as (
    select sales_rep_id from s
    union
    select sales_rep_id from r
  )
  select ids.sales_rep_id, coalesce(sr.name, 'Unassigned'),
         coalesce(s.docs, 0), coalesce(s.gross, 0), coalesce(s.disc, 0), coalesce(s.amt, 0),
         coalesce(r.ret, 0), coalesce(s.amt, 0) - coalesce(r.ret, 0)
  from ids
  left join sales_reps sr on sr.id = ids.sales_rep_id
  left join s on s.sales_rep_id is not distinct from ids.sales_rep_id
  left join r on r.sales_rep_id is not distinct from ids.sales_rep_id
  order by 8 desc, 2;
$$;

-- Return Stock By Representative: per rep and item, sold vs returned.
create or replace function public.return_stock_by_rep(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  sales_rep_id uuid, rep_name text, item_id uuid, sku text, item_name text,
  sold_qty numeric, sold_amount numeric, returned_qty numeric, returned_amount numeric
)
language sql
stable
set search_path = public
as $$
  with sold as (
    select sales_rep_id, item_id, sum(quantity) as qty, sum(amount) as amt
    from sales_lines(p_org_id, p_start_date, p_end_date)
    group by sales_rep_id, item_id
  ),
  ret as (
    select cm.sales_rep_id, ci.item_id, sum(ci.quantity) as qty, sum(ci.line_total) as amt
    from credit_memos cm
    join credit_memo_items ci on ci.credit_memo_id = cm.id
    where cm.org_id = p_org_id and cm.status <> 'void' and cm.issue_date between p_start_date and p_end_date
    group by cm.sales_rep_id, ci.item_id
  ),
  k as (
    select sales_rep_id, item_id from sold
    union
    select sales_rep_id, item_id from ret
  )
  select k.sales_rep_id, coalesce(sr.name, 'Unassigned'), k.item_id, it.sku, it.name,
         coalesce(sold.qty, 0), coalesce(sold.amt, 0), coalesce(ret.qty, 0), coalesce(ret.amt, 0)
  from k
  join items it on it.id = k.item_id
  left join sales_reps sr on sr.id = k.sales_rep_id
  left join sold on sold.sales_rep_id is not distinct from k.sales_rep_id and sold.item_id = k.item_id
  left join ret on ret.sales_rep_id is not distinct from k.sales_rep_id and ret.item_id = k.item_id
  order by 2, 5;
$$;

-- Sales By Salesman: every sold line with the commission it earned
-- (net line amount x the commission rate recorded at the sale).
create or replace function public.sales_by_salesman(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  sales_rep_id uuid, rep_name text, doc_type text, doc_id uuid, doc_number text, txn_date date,
  item_id uuid, item_name text, quantity numeric, gross_amount numeric, amount numeric,
  commission_rate numeric, commission numeric
)
language sql
stable
set search_path = public
as $$
  select l.sales_rep_id, coalesce(sr.name, 'Unassigned'), l.doc_type, l.doc_id, l.doc_number, l.txn_date,
         l.item_id, l.item_name, l.quantity, l.gross_amount, l.amount,
         coalesce(l.commission_rate, 0), l.amount * coalesce(l.commission_rate, 0) / 100
  from sales_lines(p_org_id, p_start_date, p_end_date) l
  left join sales_reps sr on sr.id = l.sales_rep_id
  order by 2, l.txn_date, l.doc_number, l.item_name;
$$;

-- Financial Recovery & Sales Performance: per customer, grouped by the
-- customer's credit manager (their assigned rep). Sales and recoveries are
-- within the period; outstanding is the customer's balance at the period end
-- (customer_balance_summary's definition).
create or replace function public.financial_recovery(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  customer_id uuid, customer_name text, credit_manager_id uuid, credit_manager text,
  region text, area text, total_sales numeric, recovered numeric, outstanding numeric
)
language sql
stable
set search_path = public
as $$
  with s as (
    select customer_id, sum(amount) as amt
    from sales_lines(p_org_id, p_start_date, p_end_date)
    group by customer_id
  ),
  rec as (
    select i.customer_id, sum(p.amount) as amt
    from invoice_payments p
    join invoices i on i.id = p.invoice_id
    where p.org_id = p_org_id and i.status <> 'void' and p.paid_at::date between p_start_date and p_end_date
    group by i.customer_id
    union all
    -- A sales receipt is paid in full on the spot.
    select customer_id, sum(total)
    from sales_receipts
    where org_id = p_org_id and status <> 'void' and sale_date between p_start_date and p_end_date
    group by customer_id
  ),
  recovered as (
    select customer_id, sum(amt) as amt from rec group by customer_id
  ),
  bal as (
    select customer_id, balance from customer_balance_summary(p_org_id, p_end_date)
  ),
  ids as (
    select customer_id from s
    union
    select customer_id from recovered
    union
    select customer_id from bal where abs(balance) > 0.005
  )
  select ids.customer_id, coalesce(c.name, 'Walk-in customers'), c.sales_rep_id, rep.name,
         a.region, a.name,
         coalesce(s.amt, 0), coalesce(recovered.amt, 0), coalesce(bal.balance, 0)
  from ids
  left join customers c on c.id = ids.customer_id
  left join sales_reps rep on rep.id = c.sales_rep_id
  left join areas a on a.id = c.area_id
  left join s on s.customer_id is not distinct from ids.customer_id
  left join recovered on recovered.customer_id is not distinct from ids.customer_id
  left join bal on bal.customer_id = ids.customer_id
  order by rep.name nulls last, 2;
$$;

-- Customers Discounts Summary: customers who were given any discount.
create or replace function public.customer_discounts(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  customer_id uuid, customer_name text, doc_count bigint,
  gross_amount numeric, line_discount numeric, document_discount numeric, discount numeric, amount numeric
)
language sql
stable
set search_path = public
as $$
  select customer_id, coalesce(customer_name, 'Walk-in customers'), count(distinct doc_id),
         sum(gross_amount), sum(line_discount), sum(discount) - sum(line_discount), sum(discount), sum(amount)
  from sales_lines(p_org_id, p_start_date, p_end_date)
  group by customer_id, customer_name
  having sum(discount) > 0.005
  order by sum(discount) desc, 2;
$$;

-- Items Discounts Summary: items sold at a discount.
create or replace function public.item_discounts(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  item_id uuid, sku text, item_name text, category_name text, brand_name text,
  quantity numeric, gross_amount numeric, discount numeric, amount numeric
)
language sql
stable
set search_path = public
as $$
  select l.item_id, l.sku, l.item_name, l.category_name, b.name,
         sum(l.quantity), sum(l.gross_amount), sum(l.discount), sum(l.amount)
  from sales_lines(p_org_id, p_start_date, p_end_date) l
  join items it on it.id = l.item_id
  left join brands b on b.id = it.brand_id
  group by l.item_id, l.sku, l.item_name, l.category_name, b.name
  having sum(l.discount) > 0.005
  order by sum(l.discount) desc, 3;
$$;

-- Sales Orders Summary: every order dated in the period, any status.
create or replace function public.sales_orders_summary(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  order_id uuid, order_number text, order_date date, delivery_date date,
  customer_id uuid, customer_name text, rep_name text, status text, total numeric,
  invoice_id uuid, invoice_number text
)
language sql
stable
set search_path = public
as $$
  select o.id, o.order_number, o.order_date, o.delivery_date, o.customer_id, c.name, rep.name,
         o.status, o.total, o.invoice_id, inv.invoice_number
  from sales_orders o
  join customers c on c.id = o.customer_id
  left join sales_reps rep on rep.id = o.sales_rep_id
  left join invoices inv on inv.id = o.invoice_id
  where o.org_id = p_org_id and o.order_date between p_start_date and p_end_date
  order by o.order_date desc, o.order_number desc;
$$;

-- Open Orders Summary: orders still waiting to be invoiced, oldest first.
create or replace function public.open_orders(p_org_id uuid)
returns table (
  order_id uuid, order_number text, order_date date, delivery_date date,
  customer_id uuid, customer_name text, rep_name text, total numeric,
  days_open integer, is_overdue boolean
)
language sql
stable
set search_path = public
as $$
  select o.id, o.order_number, o.order_date, o.delivery_date, o.customer_id, c.name, rep.name, o.total,
         org_today(p_org_id) - o.order_date,
         o.delivery_date is not null and o.delivery_date < org_today(p_org_id)
  from sales_orders o
  join customers c on c.id = o.customer_id
  left join sales_reps rep on rep.id = o.sales_rep_id
  where o.org_id = p_org_id and o.status = 'open'
  order by o.order_date, o.order_number;
$$;

-- ---------------------------------------------------------------------------
-- Directory view: sales orders join All Transactions (and so global search).
-- ---------------------------------------------------------------------------

create or replace view public.all_transactions with (security_invoker = true) as
 SELECT sr.org_id, 'sales_receipt'::text AS doc_type, sr.id AS doc_id, sr.receipt_number AS doc_number,
    sr.sale_date AS txn_date, NULL::text AS party_name, sr.total, sr.status
   FROM sales_receipts sr
UNION ALL
 SELECT i.org_id, 'invoice'::text, i.id, i.invoice_number, i.issue_date, c.name, i.total, i.status
   FROM invoices i JOIN customers c ON c.id = i.customer_id
UNION ALL
 SELECT b.org_id, 'supplier_bill'::text, b.id, b.bill_number, b.issue_date, s.name, b.total, b.status
   FROM supplier_bills b JOIN suppliers s ON s.id = b.supplier_id
UNION ALL
 SELECT po.org_id, 'purchase_order'::text, po.id, 'PO-'::text || substr(po.id::text, 1, 8),
    COALESCE(po.expected_date, org_local_date(po.org_id, po.created_at)), s.name,
    COALESCE((SELECT sum(l.quantity_ordered * COALESCE(l.unit_cost, 0::numeric))
              FROM purchase_order_lines l WHERE l.po_id = po.id), 0::numeric),
    po.status
   FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
UNION ALL
 SELECT e.org_id, 'expense'::text, e.id, e.expense_number, e.expense_date,
    COALESCE(e.payee_name, sup.name, ''::text), e.amount, e.status
   FROM expenses e LEFT JOIN suppliers sup ON sup.id = e.payee_supplier_id
UNION ALL
 SELECT q.org_id, 'quotation'::text, q.id, q.quotation_number, q.issue_date, c.name, q.total, q.status
   FROM quotations q LEFT JOIN customers c ON c.id = q.customer_id
UNION ALL
 SELECT cm.org_id, 'credit_memo'::text, cm.id, cm.credit_memo_number, cm.issue_date, c.name, cm.total, cm.status
   FROM credit_memos cm JOIN customers c ON c.id = cm.customer_id
UNION ALL
 SELECT r.org_id, 'refund'::text, r.id, r.refund_number, r.refund_date, c.name, r.amount, 'completed'::text
   FROM refunds r JOIN customers c ON c.id = r.customer_id
UNION ALL
 SELECT so.org_id, 'sales_order'::text, so.id, so.order_number, so.order_date, c.name, so.total, so.status
   FROM sales_orders so JOIN customers c ON c.id = so.customer_id;

-- ---------------------------------------------------------------------------
-- Reset Data: a Sales Orders category, sales reps cleared with the other
-- reference lists, and the SO counter reset once no orders remain.
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
end;
$function$;
