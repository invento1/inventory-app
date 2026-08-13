-- dashboard_summary: "Revenue today"/"Revenue this week" used to be
-- sales_receipts only ("invoiced revenue isn't necessarily collected
-- cash" per the Phase 2 migration comment). Confirmed with the user this
-- undercounts real activity -- an invoice should count the moment it's
-- created (accrual-style), not when/if it's later paid. Column list is
-- unchanged (same 11 columns, same order), so this is a plain
-- CREATE OR REPLACE -- no DROP FUNCTION needed this time, that gotcha
-- only applies when the column list itself changes.

create or replace function public.dashboard_summary(p_org_id uuid)
returns table (
  item_count bigint,
  low_stock_count bigint,
  today_sales_count bigint,
  today_sales_total numeric,
  outstanding_ar_total numeric,
  overdue_invoice_count bigint,
  customer_count bigint,
  revenue_this_week numeric,
  revenue_last_week numeric,
  outstanding_ap_total numeric,
  overdue_bill_count bigint
)
language sql
stable
set search_path = public
as $$
  select
    (select count(*) from items where org_id = p_org_id and is_active),
    (select count(*) from low_stock_report where org_id = p_org_id),
    (select count(*) from sales_receipts where org_id = p_org_id and status = 'completed' and created_at >= date_trunc('day', now()))
      + (select count(*) from invoices where org_id = p_org_id and status != 'void' and issue_date = current_date),
    (select coalesce(sum(total), 0) from sales_receipts where org_id = p_org_id and status = 'completed' and created_at >= date_trunc('day', now()))
      + (select coalesce(sum(total), 0) from invoices where org_id = p_org_id and status != 'void' and issue_date = current_date),
    (select coalesce(sum(total - amount_paid), 0) from invoices where org_id = p_org_id and status in ('unpaid', 'partially_paid')),
    (select count(*) from invoices where org_id = p_org_id and status in ('unpaid', 'partially_paid') and due_date < current_date),
    (select count(*) from customers where org_id = p_org_id and is_active),
    (select coalesce(sum(total), 0) from sales_receipts where org_id = p_org_id and status = 'completed' and created_at >= date_trunc('week', now()))
      + (select coalesce(sum(total), 0) from invoices where org_id = p_org_id and status != 'void' and issue_date >= date_trunc('week', now())::date),
    (select coalesce(sum(total), 0) from sales_receipts where org_id = p_org_id and status = 'completed' and created_at >= date_trunc('week', now()) - interval '7 days' and created_at < date_trunc('week', now()))
      + (select coalesce(sum(total), 0) from invoices where org_id = p_org_id and status != 'void' and issue_date >= (date_trunc('week', now()) - interval '7 days')::date and issue_date < date_trunc('week', now())::date),
    (select coalesce(sum(total - amount_paid), 0) from supplier_bills where org_id = p_org_id and status in ('unpaid', 'partially_paid')),
    (select count(*) from supplier_bills where org_id = p_org_id and status in ('unpaid', 'partially_paid') and due_date < current_date);
$$;

-- =========================================================================
-- Profit & Loss: net income for a date range (entry_date-based, matching
-- how every other date-ranged concept in this app works). Income accounts
-- net as credit-normal, expense accounts as debit-normal -- same sign
-- convention as ledger_account_balances, just scoped to a range instead of
-- all-time. Left-joined so an account with zero activity in the chosen
-- range still appears at $0 rather than disappearing, matching how a real
-- P&L statement lists every applicable account. Plain SQL, ordinary RLS
-- (no SECURITY DEFINER), same shape as dashboard_summary -- this only reads.
-- =========================================================================

create function public.profit_and_loss(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  account_id uuid,
  account_name text,
  account_type text,
  amount numeric
)
language sql
stable
set search_path = public
as $$
  select
    la.id,
    la.name,
    la.account_type,
    case
      when la.account_type in ('income', 'other_income') then coalesce(sum(jl.credit - jl.debit), 0)
      else coalesce(sum(jl.debit - jl.credit), 0)
    end as amount
  from ledger_accounts la
  left join (
    journal_lines jl
    join journal_entries je
      on je.id = jl.journal_entry_id
      and je.entry_date between p_start_date and p_end_date
  ) on jl.account_id = la.id
  where la.org_id = p_org_id
    and la.is_active
    and la.account_type in ('income', 'other_income', 'expense', 'other_expense', 'cost_of_goods_sold')
  group by la.id, la.name, la.account_type
  order by la.account_type, la.name;
$$;
