-- Phase 4 Stage 2, part C: multi-invoice/bill payment application (Customer
-- Payment / Supplier Payment screens) and Banking (fund transfers between
-- ledger accounts). See CLAUDE.md section 4/10 for the Stage 2 scope.

-- =========================================================================
-- apply_customer_payment: pick a customer, one lump payment, apply it
-- across several of their open invoices in a single atomic call.
-- record_invoice_payment already re-validates org membership, invoice
-- status, and overpayment per-invoice, and (per the prior migration) posts
-- its own per-invoice ledger entry -- looping it here keeps each
-- allocation independently correct and gives a clean per-invoice audit
-- trail in Fiscal Daybook, rather than inventing a second combined-entry
-- code path. If any allocation is invalid, record_invoice_payment raises
-- and the whole call rolls back atomically (single Postgres function
-- transaction).
-- =========================================================================

create or replace function public.apply_customer_payment(
  p_org_id uuid,
  p_customer_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_paid_at timestamptz,
  p_notes text,
  p_allocations jsonb -- [{invoice_id, amount}, ...]
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
      p_notes
    );
  end loop;
end;
$$;

-- =========================================================================
-- apply_supplier_payment: exact mirror against supplier bills.
-- =========================================================================

create or replace function public.apply_supplier_payment(
  p_org_id uuid,
  p_supplier_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_paid_at timestamptz,
  p_notes text,
  p_allocations jsonb -- [{bill_id, amount}, ...]
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
      p_notes
    );
  end loop;
end;
$$;

-- =========================================================================
-- create_fund_transfer: Banking. A transfer *is* a journal entry -- no new
-- table needed; the Banking screen's history is journal entries filtered
-- to reference_type = 'fund_transfer'.
-- =========================================================================

create or replace function public.create_fund_transfer(
  p_org_id uuid,
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount numeric,
  p_transfer_date date,
  p_memo text
)
returns public.journal_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_org uuid;
  v_to_org uuid;
begin
  if not is_org_member(p_org_id) then
    raise exception 'not a member of this org';
  end if;

  if p_from_account_id is null or p_to_account_id is null then
    raise exception 'both a from and to account are required';
  end if;

  if p_from_account_id = p_to_account_id then
    raise exception 'from and to accounts must differ';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  select org_id into v_from_org from ledger_accounts where id = p_from_account_id;
  select org_id into v_to_org from ledger_accounts where id = p_to_account_id;
  if v_from_org is distinct from p_org_id or v_to_org is distinct from p_org_id then
    raise exception 'account does not belong to this org';
  end if;

  return post_journal_entry(
    p_org_id, p_transfer_date, p_memo,
    jsonb_build_array(
      jsonb_build_object('account_id', p_to_account_id, 'debit', p_amount, 'credit', 0),
      jsonb_build_object('account_id', p_from_account_id, 'debit', 0, 'credit', p_amount)
    ),
    'fund_transfer', null
  );
end;
$$;
