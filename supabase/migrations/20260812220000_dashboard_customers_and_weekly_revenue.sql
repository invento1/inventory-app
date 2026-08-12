-- Extend dashboard_summary with a customer count and this/last week
-- revenue. "Revenue" here matches the existing today_sales_total
-- definition -- completed sales_receipts only, not invoices (invoiced
-- revenue isn't necessarily collected cash). Weeks are calendar weeks
-- (date_trunc('week', ...) is Monday-start in Postgres).
--
-- Postgres won't let CREATE OR REPLACE FUNCTION change a RETURNS TABLE
-- column list, so the old 6-column version must be dropped first.

drop function public.dashboard_summary(uuid);

create function public.dashboard_summary(p_org_id uuid)
returns table (
  item_count bigint,
  low_stock_count bigint,
  today_sales_count bigint,
  today_sales_total numeric,
  outstanding_ar_total numeric,
  overdue_invoice_count bigint,
  customer_count bigint,
  revenue_this_week numeric,
  revenue_last_week numeric
)
language sql
stable
set search_path = public
as $$
  select
    (select count(*) from items where org_id = p_org_id and is_active),
    (select count(*) from low_stock_report where org_id = p_org_id),
    (select count(*) from sales_receipts where org_id = p_org_id and status = 'completed' and created_at >= date_trunc('day', now())),
    (select coalesce(sum(total), 0) from sales_receipts where org_id = p_org_id and status = 'completed' and created_at >= date_trunc('day', now())),
    (select coalesce(sum(total - amount_paid), 0) from invoices where org_id = p_org_id and status in ('unpaid', 'partially_paid')),
    (select count(*) from invoices where org_id = p_org_id and status in ('unpaid', 'partially_paid') and due_date < current_date),
    (select count(*) from customers where org_id = p_org_id and is_active),
    (select coalesce(sum(total), 0) from sales_receipts where org_id = p_org_id and status = 'completed' and created_at >= date_trunc('week', now())),
    (select coalesce(sum(total), 0) from sales_receipts where org_id = p_org_id and status = 'completed' and created_at >= date_trunc('week', now()) - interval '7 days' and created_at < date_trunc('week', now()));
$$;
