-- Control account guardrails: Undeposited Funds, Accounts Receivable, and
-- Accounts Payable are sub-ledger-backed control accounts (their GL
-- balance must always reconcile to invoice_payments/deposits and
-- invoices/supplier_bills respectively). Every legitimate posting to them
-- already goes through a dedicated RPC (record_invoice_payment,
-- record_deposit, create_invoice, record_supplier_bill_payment, ...) that
-- keeps the sub-ledger in sync. Manual Journal Entries and Fund Transfers
-- bypassed that -- a user could pick "Undeposited Funds" directly in
-- Fiscal Daybook's or Banking's plain account dropdown and zero out the
-- GL balance without ever touching invoice_payments.deposit_id, leaving a
-- payment sitting in the Record Deposit queue forever with no matching GL
-- balance behind it (the deposit would then double-count Cash/Bank).
--
-- Fix: block these accounts at the two manual, user-facing entry points
-- only (create_journal_entry, create_fund_transfer). post_journal_entry
-- itself stays completely unrestricted -- it's the private, revoked-from-
-- clients function every auto-posting RPC calls internally, and those
-- legitimately post to these exact accounts on every invoice/payment/
-- deposit/bill.

alter table public.ledger_accounts add column is_control_account boolean not null default false;

update public.ledger_accounts
set is_control_account = true
where name = 'Undeposited Funds' or account_type in ('accounts_receivable', 'accounts_payable');

-- Accounts Receivable/Accounts Payable are already identifiable by
-- account_type alone (checked directly in assert_accounts_not_controlled
-- below), so this trigger only needs to cover Undeposited Funds, which has
-- no dedicated account_type. One-directional by design: it only ever sets
-- the flag to true, never clears it on rename, so a renamed control
-- account fails safe (stays restricted) rather than silently reopening
-- this exact bug.
create or replace function public.sync_control_account_flag()
returns trigger
language plpgsql
as $$
begin
  if new.name = 'Undeposited Funds' then
    new.is_control_account := true;
  end if;
  return new;
end;
$$;

create trigger ledger_accounts_control_flag
before insert or update of name on public.ledger_accounts
for each row execute function public.sync_control_account_flag();

create or replace function public.assert_accounts_not_controlled(p_account_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from ledger_accounts
    where id = any(p_account_ids)
      and (is_control_account or account_type in ('accounts_receivable', 'accounts_payable'))
  ) then
    raise exception 'Undeposited Funds, Accounts Receivable, and Accounts Payable can''t be adjusted via a manual journal entry or fund transfer -- they''re kept in sync with Record Deposit / invoice / bill payments automatically. Use Receive Payment, Pay Bills, or Record Deposit to clear these instead.';
  end if;
end;
$$;

create or replace function public.create_journal_entry(
  p_org_id uuid,
  p_entry_date date,
  p_memo text,
  p_lines jsonb,
  p_reference_type text default 'manual',
  p_reference_id uuid default null
)
returns public.journal_entries
language plpgsql
security definer
set search_path = public
as $$
begin
  if org_role(p_org_id) not in ('owner', 'admin') then
    raise exception 'only owners/admins can post journal entries';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) < 2 then
    raise exception 'a journal entry needs at least two lines';
  end if;

  perform assert_accounts_not_controlled(
    array(select (line ->> 'account_id')::uuid from jsonb_array_elements(p_lines) as line)
  );

  return post_journal_entry(p_org_id, p_entry_date, p_memo, p_lines, coalesce(p_reference_type, 'manual'), p_reference_id);
end;
$$;

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

  perform assert_accounts_not_controlled(array[p_from_account_id, p_to_account_id]);

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
