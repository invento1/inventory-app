-- Stage 1 of the Accounts (double-entry ledger) feature: Chart of Accounts
-- ("Capital Matrix" in the UI) and General Journal ("Fiscal Daybook").
-- Named ledger_accounts (not accounts) to avoid ambiguity with unrelated
-- "account" concepts. See CLAUDE.md for the RLS/RPC conventions this
-- follows (mirrors create_sales_receipt/create_invoice's exact shape).

create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  account_number text,
  name text not null,
  account_type text not null check (account_type in (
    'income', 'expense', 'bank', 'equity', 'accounts_receivable', 'accounts_payable',
    'other_current_asset', 'other_asset', 'fixed_asset', 'other_current_liability',
    'long_term_liability', 'cost_of_goods_sold', 'other_income', 'other_expense'
  )),
  parent_account_id uuid references public.ledger_accounts (id) on delete set null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ledger_accounts_org_id_idx on public.ledger_accounts (org_id);

alter table public.ledger_accounts enable row level security;

-- select: all org members. insert/update/delete: owner/admin only (same bar
-- as Company Info -- this is business-identity/financial-structure data).
create policy "org members can select ledger accounts"
  on public.ledger_accounts for select
  using (is_org_member(org_id));

create policy "admins can insert ledger accounts"
  on public.ledger_accounts for insert
  with check (org_role(org_id) in ('owner', 'admin'));

create policy "admins can update ledger accounts"
  on public.ledger_accounts for update
  using (org_role(org_id) in ('owner', 'admin'))
  with check (org_role(org_id) in ('owner', 'admin'));

create policy "admins can delete ledger accounts"
  on public.ledger_accounts for delete
  using (org_role(org_id) in ('owner', 'admin'));

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  entry_number text not null,
  entry_date date not null default current_date,
  memo text,
  reference_type text not null default 'manual',
  reference_id uuid,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create unique index journal_entries_org_entry_number_idx on public.journal_entries (org_id, entry_number);
create index journal_entries_org_date_idx on public.journal_entries (org_id, entry_date desc);

alter table public.journal_entries enable row level security;

create policy "org members can select journal entries"
  on public.journal_entries for select
  using (is_org_member(org_id));

-- No insert/update/delete policy: only create_journal_entry() (SECURITY
-- DEFINER) writes here. Immutable once posted -- append-only, same
-- convention as stock_movements; corrections are a new reversing entry.

create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.journal_entries (id) on delete cascade,
  account_id uuid not null references public.ledger_accounts (id),
  debit numeric not null default 0 check (debit >= 0),
  credit numeric not null default 0 check (credit >= 0),
  name text,
  memo text,
  line_order integer not null default 0,
  constraint journal_lines_one_side check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);

create index journal_lines_entry_id_idx on public.journal_lines (journal_entry_id);
create index journal_lines_account_id_idx on public.journal_lines (account_id);

alter table public.journal_lines enable row level security;

-- Line-item child table exception (CLAUDE.md §3): no own org_id, scoped via
-- EXISTS against the parent journal_entries.org_id.
create policy "org members can select journal lines"
  on public.journal_lines for select
  using (
    exists (
      select 1 from journal_entries je
      where je.id = journal_lines.journal_entry_id and is_org_member(je.org_id)
    )
  );

create view public.ledger_account_balances as
select
  a.id as account_id,
  a.org_id,
  case
    when a.account_type in ('income', 'equity', 'accounts_payable', 'other_current_liability', 'long_term_liability', 'other_income')
    then coalesce(sum(jl.credit - jl.debit), 0)
    else coalesce(sum(jl.debit - jl.credit), 0)
  end as balance
from ledger_accounts a
left join journal_lines jl on jl.account_id = a.id
group by a.id, a.org_id, a.account_type;

-- =========================================================================
-- Atomic, balanced journal entry creation. Mirrors create_sales_receipt /
-- create_invoice's exact shape: SECURITY DEFINER, membership check first,
-- totals/validation computed server-side, every referenced account
-- re-validated against p_org_id since SECURITY DEFINER bypasses RLS.
-- =========================================================================

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
declare
  v_entry journal_entries%rowtype;
  v_entry_number text;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_line jsonb;
  v_account_id uuid;
  v_debit numeric;
  v_credit numeric;
  v_account_org uuid;
  v_order integer := 0;
begin
  -- Stage 1: every call is a manual entry from Fiscal Daybook, so this is
  -- an unconditional owner/admin gate. Stage 2 will need to relax this
  -- when other RPCs (sales, invoices, bills) start calling this
  -- internally to auto-post -- system-triggered postings shouldn't be
  -- blocked by the acting user's role.
  if org_role(p_org_id) not in ('owner', 'admin') then
    raise exception 'only owners/admins can post journal entries';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) < 2 then
    raise exception 'a journal entry needs at least two lines';
  end if;

  select coalesce(sum((line ->> 'debit')::numeric), 0), coalesce(sum((line ->> 'credit')::numeric), 0)
  into v_total_debit, v_total_credit
  from jsonb_array_elements(p_lines) as line;

  if abs(v_total_debit - v_total_credit) > 0.01 then
    raise exception 'debits (%) must equal credits (%)', v_total_debit, v_total_credit;
  end if;

  v_entry_number := next_document_number(p_org_id, 'journal_entry', 'JE');

  insert into journal_entries (org_id, entry_number, entry_date, memo, reference_type, reference_id, created_by)
  values (p_org_id, v_entry_number, p_entry_date, p_memo, coalesce(p_reference_type, 'manual'), p_reference_id, auth.uid())
  returning * into v_entry;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_account_id := (v_line ->> 'account_id')::uuid;
    v_debit := coalesce((v_line ->> 'debit')::numeric, 0);
    v_credit := coalesce((v_line ->> 'credit')::numeric, 0);

    if (v_debit > 0 and v_credit > 0) or (v_debit = 0 and v_credit = 0) then
      raise exception 'each line needs either a debit or a credit, not both or neither';
    end if;

    select org_id into v_account_org from ledger_accounts where id = v_account_id;
    if v_account_org is distinct from p_org_id then
      raise exception 'account does not belong to this org';
    end if;

    insert into journal_lines (journal_entry_id, account_id, debit, credit, name, memo, line_order)
    values (v_entry.id, v_account_id, v_debit, v_credit, v_line ->> 'name', v_line ->> 'memo', v_order);
    v_order := v_order + 1;
  end loop;

  return v_entry;
end;
$$;
