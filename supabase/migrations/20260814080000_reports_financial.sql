-- Reports, batch 1: financial statements (Balance Sheet, Trial Balance, General
-- Ledger / Account Statement, Journal).
--
-- Every report function here is plain SQL, STABLE, SECURITY INVOKER (ordinary
-- RLS applies), and additionally filters by p_org_id explicitly -- exactly the
-- shape of profit_and_loss. They only read; nothing here writes.

-- Sign convention shared with the ledger_account_balances view: these types
-- carry a credit-normal balance, everything else is debit-normal.
create or replace function public.account_is_credit_normal(p_account_type text)
returns boolean
language sql
immutable
as $$
  select p_account_type in (
    'income', 'equity', 'accounts_payable', 'other_current_liability',
    'long_term_liability', 'other_income'
  );
$$;

-- Presentation order for accounts on every financial report: assets,
-- liabilities, equity, then income/COGS/expense (standard statement order).
create or replace function public.account_type_sort_order(p_account_type text)
returns int
language sql
immutable
as $$
  select case p_account_type
    when 'bank' then 1
    when 'accounts_receivable' then 2
    when 'other_current_asset' then 3
    when 'fixed_asset' then 4
    when 'other_asset' then 5
    when 'accounts_payable' then 6
    when 'other_current_liability' then 7
    when 'long_term_liability' then 8
    when 'equity' then 9
    when 'income' then 10
    when 'other_income' then 11
    when 'cost_of_goods_sold' then 12
    when 'expense' then 13
    when 'other_expense' then 14
    else 99
  end;
$$;

-- Balance Sheet as of a date. One row per balance-sheet account (every type
-- except the five P&L types), sign-normalized like ledger_account_balances.
-- Profit & loss activity has no equity account of its own in this ledger, so
-- two synthetic equity rows (account_id null) carry it: Retained Earnings (all
-- P&L activity before the start of the as-of date's calendar year) and Net
-- Income (calendar year-to-date). With those, Assets = Liabilities + Equity
-- holds by construction, since every journal entry balances.
create or replace function public.balance_sheet(p_org_id uuid, p_as_of date)
returns table (
  account_id uuid,
  account_name text,
  account_type text,
  balance numeric
)
language sql
stable
set search_path = public
as $$
  with bs as (
    select
      la.id,
      la.name,
      la.account_type,
      la.is_active,
      coalesce(sum(
        case when account_is_credit_normal(la.account_type)
          then jl.credit - jl.debit
          else jl.debit - jl.credit
        end
      ), 0) as balance
    from ledger_accounts la
    left join (
      journal_lines jl
      join journal_entries je
        on je.id = jl.journal_entry_id
        and je.entry_date <= p_as_of
    ) on jl.account_id = la.id
    where la.org_id = p_org_id
      and la.account_type not in ('income', 'other_income', 'expense', 'other_expense', 'cost_of_goods_sold')
    group by la.id, la.name, la.account_type, la.is_active
  ),
  pl as (
    select
      coalesce(sum(
        case when je.entry_date < date_trunc('year', p_as_of)::date then jl.credit - jl.debit else 0 end
      ), 0) as retained,
      coalesce(sum(
        case when je.entry_date >= date_trunc('year', p_as_of)::date then jl.credit - jl.debit else 0 end
      ), 0) as current_year
    from journal_lines jl
    join journal_entries je on je.id = jl.journal_entry_id
    join ledger_accounts la on la.id = jl.account_id
    where je.org_id = p_org_id
      and je.entry_date <= p_as_of
      and la.account_type in ('income', 'other_income', 'expense', 'other_expense', 'cost_of_goods_sold')
  )
  select id, name, account_type, balance
  from bs
  where is_active or balance <> 0
  union all
  select null, 'Retained Earnings', 'equity', retained from pl
  union all
  select null, 'Net Income', 'equity', current_year from pl
  order by 3, 2;
$$;

-- Trial Balance as of a date: every account with a non-zero net balance,
-- placed in the Debit or Credit column by the sign of (debits - credits).
create or replace function public.trial_balance(p_org_id uuid, p_as_of date)
returns table (
  account_id uuid,
  account_name text,
  account_type text,
  debit numeric,
  credit numeric
)
language sql
stable
set search_path = public
as $$
  with net as (
    select
      la.id,
      la.name,
      la.account_type,
      coalesce(sum(jl.debit - jl.credit), 0) as net
    from ledger_accounts la
    join journal_lines jl on jl.account_id = la.id
    join journal_entries je on je.id = jl.journal_entry_id and je.entry_date <= p_as_of
    where la.org_id = p_org_id
    group by la.id, la.name, la.account_type
  )
  select id, name, account_type, greatest(net, 0), greatest(-net, 0)
  from net
  where net <> 0
  order by account_type_sort_order(account_type), name;
$$;

-- General Ledger for a date range, optionally narrowed to one account (which
-- is also what the Account Statement report is). One row per journal line in
-- range, each carrying its account's opening balance (everything dated before
-- p_start) and a running balance, both sign-normalized per account type.
-- Accounts with no lines in range but a non-zero opening balance still get one
-- row with entry_id null, so their balance isn't silently dropped; when a
-- single account is requested it always gets at least that row.
create or replace function public.general_ledger(
  p_org_id uuid,
  p_start_date date,
  p_end_date date,
  p_account_id uuid default null
)
returns table (
  account_id uuid,
  account_name text,
  account_type text,
  opening_balance numeric,
  line_id uuid,
  entry_id uuid,
  entry_number text,
  entry_date date,
  reference_type text,
  reference_id uuid,
  line_name text,
  memo text,
  debit numeric,
  credit numeric,
  running_balance numeric
)
language sql
stable
set search_path = public
as $$
  with accts as (
    select la.id, la.name, la.account_type, account_is_credit_normal(la.account_type) as credit_normal
    from ledger_accounts la
    where la.org_id = p_org_id
      and (p_account_id is null or la.id = p_account_id)
  ),
  opening as (
    select
      a.id,
      coalesce(sum(
        case when a.credit_normal then jl.credit - jl.debit else jl.debit - jl.credit end
      ), 0) as balance
    from accts a
    left join (
      journal_lines jl
      join journal_entries je
        on je.id = jl.journal_entry_id
        and je.entry_date < p_start_date
    ) on jl.account_id = a.id
    group by a.id
  ),
  lines as (
    select
      jl.account_id,
      jl.id as line_id,
      je.id as entry_id,
      je.entry_number,
      je.entry_date,
      je.reference_type,
      je.reference_id,
      jl.name,
      coalesce(nullif(jl.memo, ''), je.memo) as memo,
      jl.debit,
      jl.credit,
      jl.line_order,
      case when a.credit_normal then jl.credit - jl.debit else jl.debit - jl.credit end as signed
    from accts a
    join journal_lines jl on jl.account_id = a.id
    join journal_entries je on je.id = jl.journal_entry_id
    where je.entry_date between p_start_date and p_end_date
  )
  select
    a.id,
    a.name,
    a.account_type,
    o.balance,
    l.line_id,
    l.entry_id,
    l.entry_number,
    l.entry_date,
    l.reference_type,
    l.reference_id,
    l.name,
    l.memo,
    l.debit,
    l.credit,
    o.balance + coalesce(sum(l.signed) over (
      partition by a.id
      order by l.entry_date, l.entry_number, l.line_order, l.line_id
      rows between unbounded preceding and current row
    ), 0)
  from accts a
  join opening o on o.id = a.id
  left join lines l on l.account_id = a.id
  where l.line_id is not null or o.balance <> 0 or p_account_id is not null
  order by account_type_sort_order(a.account_type), a.name, a.id,
    l.entry_date, l.entry_number, l.line_order, l.line_id;
$$;

-- Journal for a date range: every journal line, grouped by entry.
create or replace function public.journal_report(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  entry_id uuid,
  entry_number text,
  entry_date date,
  reference_type text,
  reference_id uuid,
  entry_memo text,
  line_id uuid,
  account_id uuid,
  account_name text,
  line_name text,
  line_memo text,
  debit numeric,
  credit numeric
)
language sql
stable
set search_path = public
as $$
  select
    je.id,
    je.entry_number,
    je.entry_date,
    je.reference_type,
    je.reference_id,
    je.memo,
    jl.id,
    la.id,
    la.name,
    jl.name,
    jl.memo,
    jl.debit,
    jl.credit
  from journal_entries je
  join journal_lines jl on jl.journal_entry_id = je.id
  join ledger_accounts la on la.id = jl.account_id
  where je.org_id = p_org_id
    and je.entry_date between p_start_date and p_end_date
  order by je.entry_date, je.entry_number, jl.line_order, jl.id;
$$;
