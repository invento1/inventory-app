-- Business Hub: Inventory Transfer (new RPC over an existing but never-used
-- stock_movements.reason='transfer'), plus 4 new document types --
-- Quotations, Expenses, Credit Memos, Refunds. See CLAUDE.md for the RLS/
-- RPC conventions this follows.

-- =========================================================================
-- stock_movements gains a free-text memo (useful on adjustments/transfers)
-- and a widened reason check for credit-memo returns.
-- =========================================================================

alter table public.stock_movements add column notes text;

alter table public.stock_movements drop constraint stock_movements_reason_check;
alter table public.stock_movements add constraint stock_movements_reason_check
  check (reason in ('receive', 'sale', 'adjustment', 'transfer', 'void', 'return'));

-- =========================================================================
-- Inventory Transfer: two coordinated stock_movements rows sharing a
-- reference_id, atomic (unlike the existing single-row AdjustStockModal
-- insert, a transfer genuinely needs two rows to succeed or fail together).
-- No new table -- mirrors Banking's fund transfers (a transfer is fully
-- represented by its paired rows, grouped client-side for display).
-- =========================================================================

create or replace function public.create_stock_transfer(
  p_org_id uuid,
  p_item_id uuid,
  p_from_location_id uuid,
  p_to_location_id uuid,
  p_quantity numeric,
  p_transfer_date date,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_org uuid;
  v_from_org uuid;
  v_to_org uuid;
  v_ref uuid := gen_random_uuid();
begin
  if not is_org_member(p_org_id) then
    raise exception 'not a member of this org';
  end if;

  if p_from_location_id = p_to_location_id then
    raise exception 'from and to locations must differ';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be positive';
  end if;

  select org_id into v_item_org from items where id = p_item_id;
  select org_id into v_from_org from locations where id = p_from_location_id;
  select org_id into v_to_org from locations where id = p_to_location_id;
  if v_item_org is distinct from p_org_id or v_from_org is distinct from p_org_id or v_to_org is distinct from p_org_id then
    raise exception 'item or location does not belong to this org';
  end if;

  insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, notes, created_by)
  values (p_org_id, p_item_id, p_from_location_id, -p_quantity, 'transfer', 'transfer', v_ref, p_notes, auth.uid());
  insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, notes, created_by)
  values (p_org_id, p_item_id, p_to_location_id, p_quantity, 'transfer', 'transfer', v_ref, p_notes, auth.uid());
end;
$$;

-- =========================================================================
-- Quotations: the one document type that never touches stock or the
-- ledger. Header + lines still go through an atomic RPC purely to keep the
-- same shape every other document uses; no post_journal_entry, no
-- stock_movements.
-- =========================================================================

create table public.quotations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  quotation_number text not null,
  customer_id uuid references public.customers (id),
  status text not null default 'open' check (status in ('open', 'void')),
  issue_date date not null default current_date,
  expiry_date date,
  subtotal numeric not null default 0,
  total numeric not null default 0,
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index quotations_org_quotation_number_idx on public.quotations (org_id, quotation_number);
create index quotations_org_created_at_idx on public.quotations (org_id, created_at desc);

alter table public.quotations enable row level security;

create policy "org members can select quotations"
  on public.quotations for select
  using (is_org_member(org_id));

-- No insert/update/delete policy: written only via create_quotation/void_quotation below.

create table public.quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations (id) on delete cascade,
  item_id uuid not null references public.items (id),
  quantity numeric not null check (quantity > 0),
  unit_price numeric not null check (unit_price >= 0),
  line_total numeric not null,
  created_at timestamptz not null default now()
);

create index quotation_items_quotation_id_idx on public.quotation_items (quotation_id);

alter table public.quotation_items enable row level security;

create policy "org members can select quotation items"
  on public.quotation_items for select
  using (
    exists (
      select 1 from quotations q
      where q.id = quotation_items.quotation_id and is_org_member(q.org_id)
    )
  );

create or replace function public.create_quotation(
  p_org_id uuid,
  p_customer_id uuid,
  p_expiry_date date,
  p_lines jsonb,
  p_notes text default null
)
returns public.quotations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quotation quotations%rowtype;
  v_quotation_number text;
  v_subtotal numeric;
  v_customer_org uuid;
  v_line jsonb;
  v_item_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_item_org uuid;
begin
  if not is_org_member(p_org_id) then
    raise exception 'not a member of this org';
  end if;

  if p_customer_id is not null then
    select org_id into v_customer_org from customers where id = p_customer_id;
    if v_customer_org is distinct from p_org_id then
      raise exception 'customer does not belong to this org';
    end if;
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a quotation must have at least one line item';
  end if;

  select coalesce(sum((line ->> 'quantity')::numeric * (line ->> 'unit_price')::numeric), 0)
  into v_subtotal
  from jsonb_array_elements(p_lines) as line;

  v_quotation_number := next_document_number(p_org_id, 'quotation', 'QT');

  insert into quotations (org_id, quotation_number, customer_id, expiry_date, subtotal, total, notes, created_by)
  values (p_org_id, v_quotation_number, p_customer_id, p_expiry_date, v_subtotal, v_subtotal, p_notes, auth.uid())
  returning * into v_quotation;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := (v_line ->> 'item_id')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_price := (v_line ->> 'unit_price')::numeric;

    if v_quantity <= 0 then
      raise exception 'quantity must be positive';
    end if;
    if v_unit_price < 0 then
      raise exception 'unit price cannot be negative';
    end if;

    select org_id into v_item_org from items where id = v_item_id;
    if v_item_org is distinct from p_org_id then
      raise exception 'item does not belong to this org';
    end if;

    insert into quotation_items (quotation_id, item_id, quantity, unit_price, line_total)
    values (v_quotation.id, v_item_id, v_quantity, v_unit_price, v_quantity * v_unit_price);
  end loop;

  return v_quotation;
end;
$$;

create or replace function public.void_quotation(p_quotation_id uuid)
returns public.quotations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quotation quotations%rowtype;
begin
  select * into v_quotation from quotations where id = p_quotation_id;
  if not found then
    raise exception 'quotation % not found', p_quotation_id;
  end if;

  if org_role(v_quotation.org_id) not in ('owner', 'admin') then
    raise exception 'only owners/admins can void a quotation';
  end if;

  if v_quotation.status = 'void' then
    raise exception 'quotation is already void';
  end if;

  update quotations
  set status = 'void', updated_at = now()
  where id = p_quotation_id
  returning * into v_quotation;

  return v_quotation;
end;
$$;

-- =========================================================================
-- Expenses: always paid in full immediately, mirrors create_sales_receipt's
-- simplicity. No AP-style status lifecycle beyond completed/void.
-- =========================================================================

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  expense_number text not null,
  expense_date date not null default current_date,
  payee_supplier_id uuid references public.suppliers (id),
  payee_name text,
  category_account_id uuid not null references public.ledger_accounts (id),
  amount numeric not null check (amount > 0),
  payment_method text not null check (payment_method in ('cash', 'card', 'bank_transfer', 'other')),
  account_id uuid references public.ledger_accounts (id),
  reference_number text,
  notes text,
  status text not null default 'completed' check (status in ('completed', 'void')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create unique index expenses_org_expense_number_idx on public.expenses (org_id, expense_number);
create index expenses_org_created_at_idx on public.expenses (org_id, created_at desc);

alter table public.expenses enable row level security;

create policy "org members can select expenses"
  on public.expenses for select
  using (is_org_member(org_id));

-- No insert/update/delete policy: written only via create_expense/void_expense below.

create or replace function public.create_expense(
  p_org_id uuid,
  p_expense_date date,
  p_payee_supplier_id uuid,
  p_payee_name text,
  p_category_account_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_account_id uuid default null,
  p_reference_number text default null,
  p_notes text default null
)
returns public.expenses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense expenses%rowtype;
  v_expense_number text;
  v_category_org uuid;
  v_payee_org uuid;
  v_pay_account_id uuid;
  v_account_org uuid;
begin
  if not is_org_member(p_org_id) then
    raise exception 'not a member of this org';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  select org_id into v_category_org from ledger_accounts where id = p_category_account_id;
  if v_category_org is distinct from p_org_id then
    raise exception 'category account does not belong to this org';
  end if;

  if p_payee_supplier_id is not null then
    select org_id into v_payee_org from suppliers where id = p_payee_supplier_id;
    if v_payee_org is distinct from p_org_id then
      raise exception 'payee supplier does not belong to this org';
    end if;
  end if;

  if p_account_id is not null then
    select org_id into v_account_org from ledger_accounts where id = p_account_id;
    if v_account_org is distinct from p_org_id then
      raise exception 'account does not belong to this org';
    end if;
    v_pay_account_id := p_account_id;
  else
    v_pay_account_id := get_or_create_default_account(
      p_org_id, case when p_payment_method = 'cash' then 'Cash' else 'Bank' end, 'bank'
    );
  end if;

  v_expense_number := next_document_number(p_org_id, 'expense', 'EXP');

  insert into expenses (
    org_id, expense_number, expense_date, payee_supplier_id, payee_name, category_account_id,
    amount, payment_method, account_id, reference_number, notes, created_by
  )
  values (
    p_org_id, v_expense_number, p_expense_date, p_payee_supplier_id, p_payee_name, p_category_account_id,
    p_amount, p_payment_method, v_pay_account_id, p_reference_number, p_notes, auth.uid()
  )
  returning * into v_expense;

  perform post_journal_entry(
    p_org_id, p_expense_date, 'Expense ' || v_expense_number,
    jsonb_build_array(
      jsonb_build_object('account_id', p_category_account_id, 'debit', p_amount, 'credit', 0),
      jsonb_build_object('account_id', v_pay_account_id, 'debit', 0, 'credit', p_amount)
    ),
    'expense', v_expense.id
  );

  return v_expense;
end;
$$;

create or replace function public.void_expense(p_expense_id uuid)
returns public.expenses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense expenses%rowtype;
begin
  select * into v_expense from expenses where id = p_expense_id;
  if not found then
    raise exception 'expense % not found', p_expense_id;
  end if;

  if org_role(v_expense.org_id) not in ('owner', 'admin') then
    raise exception 'only owners/admins can void an expense';
  end if;

  if v_expense.status = 'void' then
    raise exception 'expense is already void';
  end if;

  update expenses
  set status = 'void'
  where id = p_expense_id
  returning * into v_expense;

  perform post_journal_entry(
    v_expense.org_id, current_date, 'Void expense ' || v_expense.expense_number,
    jsonb_build_array(
      jsonb_build_object('account_id', v_expense.account_id, 'debit', v_expense.amount, 'credit', 0),
      jsonb_build_object('account_id', v_expense.category_account_id, 'debit', 0, 'credit', v_expense.amount)
    ),
    'expense_void', v_expense.id
  );

  return v_expense;
end;
$$;

-- =========================================================================
-- Credit Memos: standalone credit note. Creation immediately reduces
-- Accounts Receivable in aggregate (no per-invoice apply/amount_applied
-- tracking) and reverses stock for returned items (reason='return').
-- =========================================================================

create table public.credit_memos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  credit_memo_number text not null,
  customer_id uuid not null references public.customers (id),
  status text not null default 'open' check (status in ('open', 'void')),
  issue_date date not null default current_date,
  subtotal numeric not null default 0,
  total numeric not null default 0,
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index credit_memos_org_credit_memo_number_idx on public.credit_memos (org_id, credit_memo_number);
create index credit_memos_org_created_at_idx on public.credit_memos (org_id, created_at desc);

alter table public.credit_memos enable row level security;

create policy "org members can select credit memos"
  on public.credit_memos for select
  using (is_org_member(org_id));

-- No insert/update/delete policy: written only via create_credit_memo/void_credit_memo below.

create table public.credit_memo_items (
  id uuid primary key default gen_random_uuid(),
  credit_memo_id uuid not null references public.credit_memos (id) on delete cascade,
  item_id uuid not null references public.items (id),
  location_id uuid not null references public.locations (id),
  quantity numeric not null check (quantity > 0),
  unit_price numeric not null check (unit_price >= 0),
  line_total numeric not null,
  created_at timestamptz not null default now()
);

create index credit_memo_items_credit_memo_id_idx on public.credit_memo_items (credit_memo_id);

alter table public.credit_memo_items enable row level security;

create policy "org members can select credit memo items"
  on public.credit_memo_items for select
  using (
    exists (
      select 1 from credit_memos cm
      where cm.id = credit_memo_items.credit_memo_id and is_org_member(cm.org_id)
    )
  );

create or replace function public.create_credit_memo(
  p_org_id uuid,
  p_customer_id uuid,
  p_lines jsonb,
  p_notes text default null
)
returns public.credit_memos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credit_memo credit_memos%rowtype;
  v_credit_memo_number text;
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
    raise exception 'a credit memo requires a customer';
  end if;

  select org_id into v_customer_org from customers where id = p_customer_id;
  if v_customer_org is distinct from p_org_id then
    raise exception 'customer does not belong to this org';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a credit memo must have at least one line item';
  end if;

  select coalesce(sum((line ->> 'quantity')::numeric * (line ->> 'unit_price')::numeric), 0)
  into v_subtotal
  from jsonb_array_elements(p_lines) as line;

  v_credit_memo_number := next_document_number(p_org_id, 'credit_memo', 'CM');

  insert into credit_memos (org_id, credit_memo_number, customer_id, subtotal, total, notes, created_by)
  values (p_org_id, v_credit_memo_number, p_customer_id, v_subtotal, v_subtotal, p_notes, auth.uid())
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

    select org_id into v_item_org from items where id = v_item_id;
    if v_item_org is distinct from p_org_id then
      raise exception 'item does not belong to this org';
    end if;

    select org_id into v_location_org from locations where id = v_location_id;
    if v_location_org is distinct from p_org_id then
      raise exception 'location does not belong to this org';
    end if;

    insert into credit_memo_items (credit_memo_id, item_id, location_id, quantity, unit_price, line_total)
    values (v_credit_memo.id, v_item_id, v_location_id, v_quantity, v_unit_price, v_quantity * v_unit_price);

    -- Positive: goods physically coming back, same direction as
    -- receive_purchase_order_line/create_supplier_bill.
    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (p_org_id, v_item_id, v_location_id, v_quantity, 'return', 'credit_memo', v_credit_memo.id, auth.uid());
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

  return v_credit_memo;
end;
$$;

create or replace function public.void_credit_memo(p_credit_memo_id uuid)
returns public.credit_memos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credit_memo credit_memos%rowtype;
  v_line record;
begin
  select * into v_credit_memo from credit_memos where id = p_credit_memo_id;
  if not found then
    raise exception 'credit memo % not found', p_credit_memo_id;
  end if;

  if org_role(v_credit_memo.org_id) not in ('owner', 'admin') then
    raise exception 'only owners/admins can void a credit memo';
  end if;

  if v_credit_memo.status = 'void' then
    raise exception 'credit memo is already void';
  end if;

  for v_line in select * from credit_memo_items where credit_memo_id = p_credit_memo_id
  loop
    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (v_credit_memo.org_id, v_line.item_id, v_line.location_id, -v_line.quantity, 'void', 'credit_memo', v_credit_memo.id, auth.uid());
  end loop;

  update credit_memos
  set status = 'void', updated_at = now()
  where id = p_credit_memo_id
  returning * into v_credit_memo;

  if v_credit_memo.total > 0 then
    perform post_journal_entry(
      v_credit_memo.org_id, current_date, 'Void credit memo ' || v_credit_memo.credit_memo_number,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', get_or_create_default_account(v_credit_memo.org_id, 'Accounts Receivable', 'accounts_receivable'),
          'debit', v_credit_memo.total, 'credit', 0
        ),
        jsonb_build_object(
          'account_id', get_or_create_default_account(v_credit_memo.org_id, 'Sales Income', 'income'),
          'debit', 0, 'credit', v_credit_memo.total
        )
      ),
      'credit_memo_void', v_credit_memo.id
    );
  end if;

  return v_credit_memo;
end;
$$;

-- =========================================================================
-- Refunds: standalone cash-back document, not required to reference a
-- credit memo. A direct revenue reversal + cash out (not an AR entry --
-- refunding isn't collecting a receivable), same reasoning as void_invoice.
-- =========================================================================

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  refund_number text not null,
  customer_id uuid not null references public.customers (id),
  refund_date date not null default current_date,
  amount numeric not null check (amount > 0),
  payment_method text not null check (payment_method in ('cash', 'card', 'bank_transfer', 'other')),
  account_id uuid references public.ledger_accounts (id),
  reference_number text,
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create unique index refunds_org_refund_number_idx on public.refunds (org_id, refund_number);
create index refunds_org_created_at_idx on public.refunds (org_id, created_at desc);

alter table public.refunds enable row level security;

create policy "org members can select refunds"
  on public.refunds for select
  using (is_org_member(org_id));

-- No insert/update/delete policy: written only via create_refund below.

create or replace function public.create_refund(
  p_org_id uuid,
  p_customer_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_account_id uuid default null,
  p_refund_date date default current_date,
  p_reference_number text default null,
  p_notes text default null
)
returns public.refunds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund refunds%rowtype;
  v_refund_number text;
  v_customer_org uuid;
  v_pay_account_id uuid;
  v_account_org uuid;
begin
  if not is_org_member(p_org_id) then
    raise exception 'not a member of this org';
  end if;

  select org_id into v_customer_org from customers where id = p_customer_id;
  if v_customer_org is distinct from p_org_id then
    raise exception 'customer does not belong to this org';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  if p_account_id is not null then
    select org_id into v_account_org from ledger_accounts where id = p_account_id;
    if v_account_org is distinct from p_org_id then
      raise exception 'account does not belong to this org';
    end if;
    v_pay_account_id := p_account_id;
  else
    v_pay_account_id := get_or_create_default_account(
      p_org_id, case when p_payment_method = 'cash' then 'Cash' else 'Bank' end, 'bank'
    );
  end if;

  v_refund_number := next_document_number(p_org_id, 'refund', 'REF');

  insert into refunds (org_id, refund_number, customer_id, refund_date, amount, payment_method, account_id, reference_number, notes, created_by)
  values (p_org_id, v_refund_number, p_customer_id, coalesce(p_refund_date, current_date), p_amount, p_payment_method, v_pay_account_id, p_reference_number, p_notes, auth.uid())
  returning * into v_refund;

  perform post_journal_entry(
    p_org_id, v_refund.refund_date, 'Refund ' || v_refund_number,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', get_or_create_default_account(p_org_id, 'Sales Income', 'income'),
        'debit', p_amount, 'credit', 0
      ),
      jsonb_build_object('account_id', v_pay_account_id, 'debit', 0, 'credit', p_amount)
    ),
    'refund', v_refund.id
  );

  return v_refund;
end;
$$;
