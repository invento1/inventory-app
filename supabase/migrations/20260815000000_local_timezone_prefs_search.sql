-- 1. Dashboard date logic in the viewer's local timezone (was UTC).
-- 2. user_preferences: per-user, per-org UI settings (first use: the
--    dashboard Transactions Summary row layout).
-- 3. global_search: the header search bar.

-- ---------------------------------------------------------------------------
-- 1. Local-timezone helpers
--
-- Supabase sessions run in UTC, so `current_date`, `now()::date` and
-- `created_at::date` roll over at UTC midnight -- an hour late in the UK in
-- summer, five hours late in Pakistan. The dashboard now receives the
-- browser's IANA timezone (Intl.DateTimeFormat().resolvedOptions().timeZone)
-- and works out each record's *local* calendar day:
--   * real timestamps (sales_receipts.created_at, and the created_at of
--     documents whose date the database stamps itself: invoices, credit memos,
--     supplier bills, quotations, purchase orders) -> converted to local time;
--   * dates a person picked (expense_date, refund_date, deposit_date,
--     adjustment_date, manual journal entry_date) -> used as picked;
--   * payments: the forms send a date-only value, stored as 00:00:00 UTC --
--     local_day() keeps that as the picked date rather than shifting it.

-- An unknown/garbled timezone name falls back to UTC instead of erroring.
create or replace function public.safe_timezone(p_tz text)
returns text
language sql
stable
as $$
  select case
    when p_tz is not null and exists (select 1 from pg_timezone_names where name = p_tz) then p_tz
    else 'UTC'
  end;
$$;

-- The calendar day a timestamp falls on for the viewer. Exactly 00:00:00 UTC
-- means a date-only value someone picked (payment forms), which keeps its date.
create or replace function public.local_day(p_ts timestamptz, p_tz text)
returns date
language sql
stable
as $$
  select case
    when (p_ts at time zone 'UTC')::time = time '00:00' then (p_ts at time zone 'UTC')::date
    else (p_ts at time zone p_tz)::date
  end;
$$;

-- Journal entries whose entry_date the database stamped itself (UTC
-- current_date / issue_date) rather than a person choosing it.
create or replace function public.journal_entry_is_system_dated(p_reference_type text)
returns boolean
language sql
immutable
as $$
  select p_reference_type in (
    'sales_receipt', 'sales_receipt_cogs', 'invoice', 'invoice_cogs', 'invoice_void', 'invoice_void_cogs',
    'supplier_bill', 'supplier_bill_void', 'credit_memo', 'credit_memo_void', 'expense_void', 'inventory_cutover'
  );
$$;

-- dashboard_summary: same columns, now takes the viewer's timezone. RETURNS
-- TABLE + a new argument, so the old signature must be dropped first.
drop function if exists public.dashboard_summary(uuid);

create function public.dashboard_summary(p_org_id uuid, p_tz text default 'UTC')
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
  with tz as (
    select safe_timezone(p_tz) as z
  ),
  cal as (
    select
      (now() at time zone (select z from tz))::date as today,
      date_trunc('week', (now() at time zone (select z from tz))::date)::date as week_start
  ),
  -- Every non-void sale in (at most) the last ~2 weeks, on its local day.
  -- The created_at pre-filter keeps the scan index-friendly.
  sales as (
    select local_day(r.created_at, (select z from tz)) as day, r.total
    from sales_receipts r
    where r.org_id = p_org_id and r.status = 'completed' and r.created_at >= now() - interval '16 days'
    union all
    select local_day(i.created_at, (select z from tz)), i.total
    from invoices i
    where i.org_id = p_org_id and i.status <> 'void' and i.created_at >= now() - interval '16 days'
  )
  select
    (select count(*) from items where org_id = p_org_id and is_active),
    (select count(*) from low_stock_report where org_id = p_org_id),
    (select count(*) from sales, cal where sales.day = cal.today),
    (select coalesce(sum(total), 0) from sales, cal where sales.day = cal.today),
    (select coalesce(sum(total - amount_paid), 0) from invoices where org_id = p_org_id and status in ('unpaid', 'partially_paid')),
    (select count(*) from invoices, cal
      where org_id = p_org_id and status in ('unpaid', 'partially_paid') and due_date < cal.today),
    (select count(*) from customers where org_id = p_org_id and is_active),
    (select coalesce(sum(total), 0) from sales, cal where sales.day >= cal.week_start and sales.day <= cal.today),
    (select coalesce(sum(total), 0) from sales, cal where sales.day >= cal.week_start - 7 and sales.day < cal.week_start),
    (select coalesce(sum(total - amount_paid), 0) from supplier_bills where org_id = p_org_id and status in ('unpaid', 'partially_paid')),
    (select count(*) from supplier_bills, cal
      where org_id = p_org_id and status in ('unpaid', 'partially_paid') and due_date < cal.today);
$$;

-- dashboard_daily_series: now in local days. The date range comes from the
-- browser (local calendar dates already); p_tz converts the records.
drop function if exists public.dashboard_daily_series(uuid, date, date);

create function public.dashboard_daily_series(
  p_org_id uuid,
  p_start_date date,
  p_end_date date,
  p_tz text default 'UTC'
)
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
  with tz as (
    select safe_timezone(p_tz) as z
  ),
  days as (
    select generate_series(p_start_date, p_end_date, interval '1 day')::date as d
  ),
  sales as (
    select d, sum(t) as t
    from (
      select local_day(i.created_at, (select z from tz)) as d, i.total as t
      from invoices i
      where i.org_id = p_org_id and i.status <> 'void'
        and i.created_at >= p_start_date - 1 and i.created_at < p_end_date + 2
      union all
      select local_day(r.created_at, (select z from tz)), r.total
      from sales_receipts r
      where r.org_id = p_org_id and r.status <> 'void'
        and r.created_at >= p_start_date - 1 and r.created_at < p_end_date + 2
    ) s
    group by d
  ),
  coll as (
    select local_day(p.paid_at, (select z from tz)) as d, sum(p.amount) as t
    from invoice_payments p
    where p.org_id = p_org_id and p.paid_at >= p_start_date - 1 and p.paid_at < p_end_date + 2
    group by 1
  ),
  pl as (
    select
      case
        when journal_entry_is_system_dated(je.reference_type) then local_day(je.created_at, (select z from tz))
        else je.entry_date
      end as d,
      sum(case when la.account_type in ('income', 'other_income') then jl.credit - jl.debit else 0 end) as income,
      sum(case when la.account_type = 'cost_of_goods_sold' then jl.debit - jl.credit else 0 end) as cogs,
      sum(case when la.account_type in ('expense', 'other_expense') then jl.debit - jl.credit else 0 end) as expenses
    from journal_entries je
    join journal_lines jl on jl.journal_entry_id = je.id
    join ledger_accounts la on la.id = jl.account_id
    where je.org_id = p_org_id and je.entry_date between p_start_date - 1 and p_end_date + 1
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

-- daily_activity_summary: local days, and a longer master list of
-- transaction types for the customizable Transactions Summary. Long format
-- (metric, day, amount); the client shows whichever rows the user picked.
drop function if exists public.daily_activity_summary(uuid, date, date);

create function public.daily_activity_summary(
  p_org_id uuid,
  p_start_date date,
  p_end_date date,
  p_tz text default 'UTC'
)
returns table (
  metric text,
  day date,
  amount numeric
)
language sql
stable
set search_path = public
as $$
  with tz as (
    select safe_timezone(p_tz) as z
  ),
  raw as (
    select 'invoices' as metric, local_day(created_at, (select z from tz)) as day, total as amount
    from invoices
    where org_id = p_org_id and status <> 'void' and created_at >= p_start_date - 1 and created_at < p_end_date + 2
    union all
    select 'sales_receipts', local_day(created_at, (select z from tz)), total
    from sales_receipts
    where org_id = p_org_id and status <> 'void' and created_at >= p_start_date - 1 and created_at < p_end_date + 2
    union all
    select 'credit_memos', local_day(created_at, (select z from tz)), total
    from credit_memos
    where org_id = p_org_id and status <> 'void' and created_at >= p_start_date - 1 and created_at < p_end_date + 2
    union all
    select 'quotations', local_day(created_at, (select z from tz)), total
    from quotations
    where org_id = p_org_id and status <> 'void' and created_at >= p_start_date - 1 and created_at < p_end_date + 2
    union all
    select 'refunds', refund_date, amount
    from refunds
    where org_id = p_org_id and refund_date between p_start_date and p_end_date
    union all
    select 'customer_payments', local_day(paid_at, (select z from tz)), amount
    from invoice_payments
    where org_id = p_org_id and paid_at >= p_start_date - 1 and paid_at < p_end_date + 2
    union all
    select 'deposits', deposit_date, total
    from deposits
    where org_id = p_org_id and deposit_date between p_start_date and p_end_date
    union all
    select 'supplier_bills', local_day(created_at, (select z from tz)), total
    from supplier_bills
    where org_id = p_org_id and status <> 'void' and created_at >= p_start_date - 1 and created_at < p_end_date + 2
    union all
    select 'supplier_payments', local_day(paid_at, (select z from tz)), amount
    from supplier_bill_payments
    where org_id = p_org_id and paid_at >= p_start_date - 1 and paid_at < p_end_date + 2
    union all
    select 'purchase_orders', local_day(po.created_at, (select z from tz)),
           coalesce((select sum(l.quantity_ordered * coalesce(l.unit_cost, 0)) from purchase_order_lines l where l.po_id = po.id), 0)
    from purchase_orders po
    where po.org_id = p_org_id and po.status <> 'cancelled'
      and po.created_at >= p_start_date - 1 and po.created_at < p_end_date + 2
    union all
    select 'expenses', expense_date, amount
    from expenses
    where org_id = p_org_id and status <> 'void' and expense_date between p_start_date and p_end_date
    union all
    select 'inventory_adjustments', adjustment_date, total_value_diff
    from inventory_adjustments
    where org_id = p_org_id and adjustment_date between p_start_date and p_end_date
    union all
    select 'fund_transfers', je.entry_date, (select sum(jl.debit) from journal_lines jl where jl.journal_entry_id = je.id)
    from journal_entries je
    where je.org_id = p_org_id and je.reference_type = 'fund_transfer'
      and je.entry_date between p_start_date and p_end_date
  )
  select metric, day, sum(amount)
  from raw
  where day between p_start_date and p_end_date
  group by metric, day;
$$;

-- sales_totals backed an editable-sales-window idea that was dropped in
-- favour of keeping the dashboard tiles; nothing calls it.
drop function if exists public.sales_totals(uuid, date, date);

-- ---------------------------------------------------------------------------
-- 2. user_preferences: small per-user UI settings, scoped to an org. RLS: a
-- user only ever sees/writes their own rows, and only for orgs they belong to.

create table public.user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  key text not null,
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, org_id, key)
);

alter table public.user_preferences enable row level security;

create policy "users can select their own preferences"
  on public.user_preferences for select
  using (user_id = auth.uid() and is_org_member(org_id));

create policy "users can insert their own preferences"
  on public.user_preferences for insert
  with check (user_id = auth.uid() and is_org_member(org_id));

create policy "users can update their own preferences"
  on public.user_preferences for update
  using (user_id = auth.uid() and is_org_member(org_id))
  with check (user_id = auth.uid() and is_org_member(org_id));

create policy "users can delete their own preferences"
  on public.user_preferences for delete
  using (user_id = auth.uid() and is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- 3. global_search: the header search bar. Case-insensitive substring match
-- on document number, party name, or reference; plus customers, suppliers,
-- and items (name / SKU / barcode). Plain SQL, SECURITY INVOKER -- RLS and the
-- security_invoker all_transactions view scope everything to the caller's org.

create or replace function public.global_search(p_org_id uuid, p_query text, p_limit int default 20)
returns table (
  kind text,
  id uuid,
  title text,
  subtitle text,
  txn_date date,
  amount numeric
)
language sql
stable
set search_path = public
as $$
  with q as (
    -- Escape LIKE wildcards so a typed % or _ matches literally.
    select '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  ),
  docs as (
    select t.doc_type as kind, t.doc_id as id, t.doc_number as title, t.party_name as subtitle,
           t.txn_date, t.total as amount, 1 as rank
    from all_transactions t, q
    where t.org_id = p_org_id
      and (t.doc_number ilike q.pat or t.party_name ilike q.pat)
    order by t.txn_date desc, t.doc_number desc
    limit p_limit
  ),
  people as (
    select 'customer' as kind, c.id, c.name as title, coalesce(c.phone, c.email) as subtitle,
           null::date as txn_date, null::numeric as amount, 2 as rank
    from customers c, q
    where c.org_id = p_org_id and (c.name ilike q.pat or c.phone ilike q.pat or c.email ilike q.pat)
    union all
    select 'supplier', s.id, s.name, coalesce(s.contact_name, s.contact_phone), null, null, 2
    from suppliers s, q
    where s.org_id = p_org_id and (s.name ilike q.pat or s.contact_name ilike q.pat or s.contact_phone ilike q.pat)
  ),
  goods as (
    select 'item' as kind, i.id, i.name as title, i.sku as subtitle, null::date as txn_date,
           i.unit_price as amount, 3 as rank
    from items i, q
    where i.org_id = p_org_id and (i.name ilike q.pat or i.sku ilike q.pat or i.barcode ilike q.pat)
  )
  select kind, id, title, subtitle, txn_date, amount
  from (
    select * from docs
    union all
    (select * from people order by title limit 8)
    union all
    (select * from goods order by title limit 8)
  ) r
  where length(trim(p_query)) >= 2
  order by rank, txn_date desc nulls last, title;
$$;
