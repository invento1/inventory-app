-- Dashboard upgrade: editable sales windows, 30-day trend charts, and the
-- 7-day transactions summary. Read-only, plain SQL, STABLE, SECURITY
-- INVOKER (ordinary RLS), explicit org filter -- the report-RPC convention.
--
-- "Sales" = invoices (by issue_date) + sales receipts (by created_at::date),
-- excluding voids: the same accrual-at-creation rule as dashboard_summary and
-- the sales reports.

-- Total and count of sales in a date range (the dashboard's Today / This
-- week / Last week cards, whose ranges the user can edit).
create or replace function public.sales_totals(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  doc_count bigint,
  total numeric
)
language sql
stable
set search_path = public
as $$
  with docs as (
    select i.total
    from invoices i
    where i.org_id = p_org_id and i.status <> 'void' and i.issue_date between p_start_date and p_end_date
    union all
    select r.total
    from sales_receipts r
    where r.org_id = p_org_id and r.status <> 'void' and r.created_at::date between p_start_date and p_end_date
  )
  select count(*), coalesce(sum(total), 0) from docs;
$$;

-- One row per calendar day in the range (days with no activity included, as
-- zeros), for the two dashboard trend charts:
--   sales        -- invoices + sales receipts
--   collections  -- customer payments received against invoices
--   gross_profit -- (income + other income) - cost of goods sold
--   net_income   -- gross_profit - (expense + other expense)
-- The profit series come from the ledger, grouped by entry_date, and use the
-- same income/COGS/expense split as the Profit & Loss report, so a day's
-- figures always agree with P&L for that day.
create or replace function public.dashboard_daily_series(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  day date,
  sales numeric,
  collections numeric,
  gross_profit numeric,
  net_income numeric
)
language sql
stable
set search_path = public
as $$
  with days as (
    select generate_series(p_start_date, p_end_date, interval '1 day')::date as d
  ),
  sales as (
    select d, sum(t) as t
    from (
      select i.issue_date as d, i.total as t
      from invoices i
      where i.org_id = p_org_id and i.status <> 'void' and i.issue_date between p_start_date and p_end_date
      union all
      select r.created_at::date, r.total
      from sales_receipts r
      where r.org_id = p_org_id and r.status <> 'void' and r.created_at::date between p_start_date and p_end_date
    ) s
    group by d
  ),
  coll as (
    select p.paid_at::date as d, sum(p.amount) as t
    from invoice_payments p
    where p.org_id = p_org_id and p.paid_at::date between p_start_date and p_end_date
    group by 1
  ),
  pl as (
    select
      je.entry_date as d,
      sum(case when la.account_type in ('income', 'other_income') then jl.credit - jl.debit else 0 end) as income,
      sum(case when la.account_type = 'cost_of_goods_sold' then jl.debit - jl.credit else 0 end) as cogs,
      sum(case when la.account_type in ('expense', 'other_expense') then jl.debit - jl.credit else 0 end) as expenses
    from journal_entries je
    join journal_lines jl on jl.journal_entry_id = je.id
    join ledger_accounts la on la.id = jl.account_id
    where je.org_id = p_org_id and je.entry_date between p_start_date and p_end_date
    group by 1
  )
  select
    days.d,
    coalesce(sales.t, 0),
    coalesce(coll.t, 0),
    coalesce(pl.income, 0) - coalesce(pl.cogs, 0),
    coalesce(pl.income, 0) - coalesce(pl.cogs, 0) - coalesce(pl.expenses, 0)
  from days
  left join sales on sales.d = days.d
  left join coll on coll.d = days.d
  left join pl on pl.d = days.d
  order by days.d;
$$;

-- Daily totals per transaction type (the dashboard's 7-day Transactions
-- Summary table). Long format -- (metric, day, amount), only days with
-- activity -- and the client pivots it into rows x days. Voided documents
-- are excluded.
create or replace function public.daily_activity_summary(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  metric text,
  day date,
  amount numeric
)
language sql
stable
set search_path = public
as $$
  select 'invoices', issue_date, sum(total)
  from invoices
  where org_id = p_org_id and status <> 'void' and issue_date between p_start_date and p_end_date
  group by issue_date
  union all
  select 'sales_receipts', created_at::date, sum(total)
  from sales_receipts
  where org_id = p_org_id and status <> 'void' and created_at::date between p_start_date and p_end_date
  group by created_at::date
  union all
  select 'credit_memos', issue_date, sum(total)
  from credit_memos
  where org_id = p_org_id and status <> 'void' and issue_date between p_start_date and p_end_date
  group by issue_date
  union all
  select 'refunds', refund_date, sum(amount)
  from refunds
  where org_id = p_org_id and refund_date between p_start_date and p_end_date
  group by refund_date
  union all
  select 'customer_payments', paid_at::date, sum(amount)
  from invoice_payments
  where org_id = p_org_id and paid_at::date between p_start_date and p_end_date
  group by paid_at::date
  union all
  select 'supplier_bills', issue_date, sum(total)
  from supplier_bills
  where org_id = p_org_id and status <> 'void' and issue_date between p_start_date and p_end_date
  group by issue_date
  union all
  select 'supplier_payments', paid_at::date, sum(amount)
  from supplier_bill_payments
  where org_id = p_org_id and paid_at::date between p_start_date and p_end_date
  group by paid_at::date
  union all
  select 'expenses', expense_date, sum(amount)
  from expenses
  where org_id = p_org_id and status <> 'void' and expense_date between p_start_date and p_end_date
  group by expense_date;
$$;
