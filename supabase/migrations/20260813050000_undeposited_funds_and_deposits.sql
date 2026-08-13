-- Phase 4 Stage 3: Undeposited Funds workflow (Receive Payment -> Record
-- Deposit) and Pay Bills polish (explicit paying account + reference
-- number). Mirrors the reference app's actual Customer/Supplier Payment
-- structure (Receive Payment / View Payments / Record Deposit / View
-- Deposits, Pay Bills / View Paid Bills) -- see CLAUDE.md for the
-- append-only/derive-don't-store conventions this follows.

-- =========================================================================
-- Deposits: batches one or more undeposited invoice_payments into a real
-- bank account. No client insert policy -- RPC only (record_deposit),
-- same convention as invoice_payments/journal_entries.
-- =========================================================================

create table public.deposits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  deposit_number text not null,
  account_id uuid not null references public.ledger_accounts (id),
  deposit_date date not null default current_date,
  memo text,
  total numeric not null default 0,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create unique index deposits_org_deposit_number_idx on public.deposits (org_id, deposit_number);
create index deposits_org_date_idx on public.deposits (org_id, deposit_date desc);

alter table public.deposits enable row level security;

create policy "org members can select deposits"
  on public.deposits for select
  using (is_org_member(org_id));

-- =========================================================================
-- invoice_payments: reference_number for traceability, deposit_id to know
-- whether (and into which deposit) a payment has been swept to a real
-- bank account. is_deposited is derived client-side as (deposit_id is not
-- null) -- never stored, same convention as low_stock_report/outstanding_invoices.
-- =========================================================================

alter table public.invoice_payments add column reference_number text;
alter table public.invoice_payments add column deposit_id uuid references public.deposits (id) on delete set null;
create index invoice_payments_deposit_id_idx on public.invoice_payments (deposit_id);

-- =========================================================================
-- supplier_bill_payments: reference_number, and an explicit account_id so
-- Pay Bills can record exactly which ledger account paid a bill. Null
-- means the payment went through the old Cash-or-Bank-by-payment_method
-- resolution (the quick per-bill "Record payment" modal keeps working
-- unchanged).
-- =========================================================================

alter table public.supplier_bill_payments add column reference_number text;
alter table public.supplier_bill_payments add column account_id uuid references public.ledger_accounts (id);

-- =========================================================================
-- record_invoice_payment: now takes an optional reference number, and its
-- posted entry's debit leg moves from Cash-or-Bank to Undeposited Funds --
-- a customer payment doesn't hit a real bank account until it's deposited
-- via record_deposit below. Everything else is unchanged from Stage 2.
-- =========================================================================

-- CREATE OR REPLACE cannot change a function's argument list -- adding a
-- trailing parameter creates a new, ambiguous overload instead of
-- replacing the old one (PostgREST would then fail to resolve which
-- overload a call means). Drop the old signature first.
drop function if exists public.record_invoice_payment(uuid, numeric, text, timestamptz, text);

create or replace function public.record_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_paid_at timestamptz default now(),
  p_notes text default null,
  p_reference_number text default null
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice invoices%rowtype;
  v_new_amount_paid numeric;
  v_payment_id uuid;
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

  if v_new_amount_paid > v_invoice.total then
    raise exception 'payment of % exceeds remaining balance of %',
      p_amount, (v_invoice.total - v_invoice.amount_paid);
  end if;

  insert into invoice_payments (org_id, invoice_id, amount, payment_method, paid_at, notes, reference_number, created_by)
  values (v_invoice.org_id, p_invoice_id, p_amount, p_payment_method, coalesce(p_paid_at, now()), p_notes, p_reference_number, auth.uid())
  returning id into v_payment_id;

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

  perform post_journal_entry(
    v_invoice.org_id, coalesce(p_paid_at, now())::date, 'Payment for invoice ' || v_invoice.invoice_number,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', get_or_create_default_account(v_invoice.org_id, 'Undeposited Funds', 'other_current_asset'),
        'debit', p_amount, 'credit', 0
      ),
      jsonb_build_object(
        'account_id', get_or_create_default_account(v_invoice.org_id, 'Accounts Receivable', 'accounts_receivable'),
        'debit', 0, 'credit', p_amount
      )
    ),
    'invoice_payment', v_payment_id
  );

  return v_invoice;
end;
$$;

-- =========================================================================
-- record_supplier_bill_payment: now takes an optional explicit paying
-- account + reference number. If p_account_id is given it's validated and
-- used directly (both stored on the payment row and posted to); otherwise
-- falls back to the existing Cash-or-Bank-by-payment_method resolution.
-- =========================================================================

drop function if exists public.record_supplier_bill_payment(uuid, numeric, text, timestamptz, text);

create or replace function public.record_supplier_bill_payment(
  p_bill_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_paid_at timestamptz default now(),
  p_notes text default null,
  p_account_id uuid default null,
  p_reference_number text default null
)
returns public.supplier_bills
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill supplier_bills%rowtype;
  v_new_amount_paid numeric;
  v_payment_id uuid;
  v_pay_account_id uuid;
  v_account_org uuid;
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

  if p_account_id is not null then
    select org_id into v_account_org from ledger_accounts where id = p_account_id;
    if v_account_org is distinct from v_bill.org_id then
      raise exception 'account does not belong to this org';
    end if;
    v_pay_account_id := p_account_id;
  else
    v_pay_account_id := get_or_create_default_account(
      v_bill.org_id, case when p_payment_method = 'cash' then 'Cash' else 'Bank' end, 'bank'
    );
  end if;

  v_new_amount_paid := v_bill.amount_paid + p_amount;

  if v_new_amount_paid > v_bill.total then
    raise exception 'payment of % exceeds remaining balance of %',
      p_amount, (v_bill.total - v_bill.amount_paid);
  end if;

  insert into supplier_bill_payments (org_id, bill_id, amount, payment_method, paid_at, notes, reference_number, account_id, created_by)
  values (v_bill.org_id, p_bill_id, p_amount, p_payment_method, coalesce(p_paid_at, now()), p_notes, p_reference_number, v_pay_account_id, auth.uid())
  returning id into v_payment_id;

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

  perform post_journal_entry(
    v_bill.org_id, coalesce(p_paid_at, now())::date, 'Payment for supplier bill ' || v_bill.bill_number,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', get_or_create_default_account(v_bill.org_id, 'Accounts Payable', 'accounts_payable'),
        'debit', p_amount, 'credit', 0
      ),
      jsonb_build_object('account_id', v_pay_account_id, 'debit', 0, 'credit', p_amount)
    ),
    'supplier_bill_payment', v_payment_id
  );

  return v_bill;
end;
$$;

-- =========================================================================
-- apply_customer_payment / apply_supplier_payment: pass the new optional
-- parameters through to each looped call. Validation/atomicity shape is
-- unchanged from Stage 2.
-- =========================================================================

drop function if exists public.apply_customer_payment(uuid, uuid, numeric, text, timestamptz, text, jsonb);

create or replace function public.apply_customer_payment(
  p_org_id uuid,
  p_customer_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_paid_at timestamptz,
  p_notes text,
  p_allocations jsonb,
  p_reference_number text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alloc jsonb;
  v_sum numeric := 0;
  v_customer_org uuid;
begin
  if not is_org_member(p_org_id) then
    raise exception 'not a member of this org';
  end if;

  select org_id into v_customer_org from customers where id = p_customer_id;
  if v_customer_org is distinct from p_org_id then
    raise exception 'customer does not belong to this org';
  end if;

  if p_allocations is null or jsonb_array_length(p_allocations) = 0 then
    raise exception 'select at least one invoice to apply payment to';
  end if;

  select coalesce(sum((a ->> 'amount')::numeric), 0) into v_sum from jsonb_array_elements(p_allocations) a;
  if abs(v_sum - p_amount) > 0.01 then
    raise exception 'allocations (%) must sum to the payment amount (%)', v_sum, p_amount;
  end if;

  for v_alloc in select * from jsonb_array_elements(p_allocations)
  loop
    perform record_invoice_payment(
      (v_alloc ->> 'invoice_id')::uuid,
      (v_alloc ->> 'amount')::numeric,
      p_payment_method,
      coalesce(p_paid_at, now()),
      p_notes,
      p_reference_number
    );
  end loop;
end;
$$;

drop function if exists public.apply_supplier_payment(uuid, uuid, numeric, text, timestamptz, text, jsonb);

create or replace function public.apply_supplier_payment(
  p_org_id uuid,
  p_supplier_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_paid_at timestamptz,
  p_notes text,
  p_allocations jsonb,
  p_account_id uuid default null,
  p_reference_number text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alloc jsonb;
  v_sum numeric := 0;
  v_supplier_org uuid;
begin
  if not is_org_member(p_org_id) then
    raise exception 'not a member of this org';
  end if;

  select org_id into v_supplier_org from suppliers where id = p_supplier_id;
  if v_supplier_org is distinct from p_org_id then
    raise exception 'supplier does not belong to this org';
  end if;

  if p_allocations is null or jsonb_array_length(p_allocations) = 0 then
    raise exception 'select at least one bill to apply payment to';
  end if;

  select coalesce(sum((a ->> 'amount')::numeric), 0) into v_sum from jsonb_array_elements(p_allocations) a;
  if abs(v_sum - p_amount) > 0.01 then
    raise exception 'allocations (%) must sum to the payment amount (%)', v_sum, p_amount;
  end if;

  for v_alloc in select * from jsonb_array_elements(p_allocations)
  loop
    perform record_supplier_bill_payment(
      (v_alloc ->> 'bill_id')::uuid,
      (v_alloc ->> 'amount')::numeric,
      p_payment_method,
      coalesce(p_paid_at, now()),
      p_notes,
      p_account_id,
      p_reference_number
    );
  end loop;
end;
$$;

-- =========================================================================
-- record_deposit: batches one or more undeposited invoice_payments into a
-- real bank account. Validates every payment id belongs to the org and
-- isn't already deposited, sums them, creates the deposits row, stamps
-- deposit_id on each payment, and posts Debit [account] / Credit
-- Undeposited Funds for the total.
-- =========================================================================

create or replace function public.record_deposit(
  p_org_id uuid,
  p_account_id uuid,
  p_deposit_date date,
  p_memo text,
  p_payment_ids uuid[]
)
returns public.deposits
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deposit deposits%rowtype;
  v_deposit_number text;
  v_total numeric;
  v_account_org uuid;
  v_requested_count integer;
  v_valid_count integer;
begin
  if not is_org_member(p_org_id) then
    raise exception 'not a member of this org';
  end if;

  if p_payment_ids is null or array_length(p_payment_ids, 1) is null then
    raise exception 'select at least one payment to deposit';
  end if;
  v_requested_count := array_length(p_payment_ids, 1);

  select org_id into v_account_org from ledger_accounts where id = p_account_id;
  if v_account_org is distinct from p_org_id then
    raise exception 'account does not belong to this org';
  end if;

  select count(*) into v_valid_count
  from invoice_payments
  where id = any(p_payment_ids) and org_id = p_org_id and deposit_id is null;

  if v_valid_count <> v_requested_count then
    raise exception 'one or more payments are invalid, belong to another org, or are already deposited';
  end if;

  select coalesce(sum(amount), 0) into v_total from invoice_payments where id = any(p_payment_ids);

  v_deposit_number := next_document_number(p_org_id, 'deposit', 'DEP');

  insert into deposits (org_id, deposit_number, account_id, deposit_date, memo, total, created_by)
  values (p_org_id, v_deposit_number, p_account_id, p_deposit_date, p_memo, v_total, auth.uid())
  returning * into v_deposit;

  update invoice_payments set deposit_id = v_deposit.id where id = any(p_payment_ids);

  perform post_journal_entry(
    p_org_id, p_deposit_date, 'Deposit ' || v_deposit_number,
    jsonb_build_array(
      jsonb_build_object('account_id', p_account_id, 'debit', v_total, 'credit', 0),
      jsonb_build_object(
        'account_id', get_or_create_default_account(p_org_id, 'Undeposited Funds', 'other_current_asset'),
        'debit', 0, 'credit', v_total
      )
    ),
    'deposit', v_deposit.id
  );

  return v_deposit;
end;
$$;
