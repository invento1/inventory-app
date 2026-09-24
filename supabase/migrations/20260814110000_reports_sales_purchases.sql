-- Reports, batch 4: sales and purchases. Plain SQL, STABLE, SECURITY INVOKER,
-- explicit org filter -- same shape as the other report functions.
--
-- "Sales" everywhere below means invoices + sales receipts, excluding voids,
-- dated by invoices.issue_date / sales_receipts.created_at -- the same
-- accrual-at-creation rule dashboard_summary uses for revenue. Credit memos
-- and refunds are not netted into the sales reports; Income by Customer is
-- the report that nets them.
--
-- cogs is quantity * the unit_cost snapshotted onto the line at sale time
-- (Perpetual MAC). Lines from before MAC shipped have a NULL unit_cost ("no
-- cost data"); they add nothing to cogs and set cost_missing so the UI can
-- say the margin is incomplete rather than silently overstating it.

create or replace function public.sales_lines(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  doc_type text,
  doc_id uuid,
  doc_number text,
  txn_date date,
  customer_id uuid,
  customer_name text,
  item_id uuid,
  sku text,
  item_name text,
  category_id uuid,
  category_name text,
  quantity numeric,
  amount numeric,
  cogs numeric
)
language sql
stable
set search_path = public
as $$
  select
    'invoice', inv.id, inv.invoice_number, inv.issue_date, inv.customer_id, c.name,
    it.id, it.sku, it.name, it.category_id, cat.name,
    ii.quantity, ii.line_total, ii.quantity * ii.unit_cost
  from invoices inv
  join invoice_items ii on ii.invoice_id = inv.id
  join items it on it.id = ii.item_id
  left join categories cat on cat.id = it.category_id
  left join customers c on c.id = inv.customer_id
  where inv.org_id = p_org_id
    and inv.status <> 'void'
    and inv.issue_date between p_start_date and p_end_date
  union all
  select
    'sales_receipt', sr.id, sr.receipt_number, sr.created_at::date, sr.customer_id, c.name,
    it.id, it.sku, it.name, it.category_id, cat.name,
    sri.quantity, sri.line_total, sri.quantity * sri.unit_cost
  from sales_receipts sr
  join sales_receipt_items sri on sri.sales_receipt_id = sr.id
  join items it on it.id = sri.item_id
  left join categories cat on cat.id = it.category_id
  left join customers c on c.id = sr.customer_id
  where sr.org_id = p_org_id
    and sr.status <> 'void'
    and sr.created_at::date between p_start_date and p_end_date;
$$;

create or replace function public.sales_by_item(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  item_id uuid,
  sku text,
  item_name text,
  category_name text,
  quantity numeric,
  amount numeric,
  cogs numeric,
  cost_missing boolean
)
language sql
stable
set search_path = public
as $$
  select item_id, sku, item_name, category_name,
         sum(quantity), sum(amount), coalesce(sum(cogs), 0), bool_or(cogs is null)
  from sales_lines(p_org_id, p_start_date, p_end_date)
  group by item_id, sku, item_name, category_name
  order by sum(amount) desc, item_name;
$$;

create or replace function public.sales_by_category(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  category_id uuid,
  category_name text,
  quantity numeric,
  amount numeric,
  cogs numeric,
  cost_missing boolean
)
language sql
stable
set search_path = public
as $$
  select category_id, coalesce(category_name, 'Uncategorized'),
         sum(quantity), sum(amount), coalesce(sum(cogs), 0), bool_or(cogs is null)
  from sales_lines(p_org_id, p_start_date, p_end_date)
  group by category_id, category_name
  order by sum(amount) desc, 2;
$$;

-- customer_id null = walk-in sales receipts, grouped together.
create or replace function public.sales_by_customer(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  customer_id uuid,
  customer_name text,
  doc_count bigint,
  amount numeric,
  cogs numeric,
  cost_missing boolean
)
language sql
stable
set search_path = public
as $$
  select customer_id, coalesce(customer_name, 'Walk-in customers'),
         count(distinct doc_id), sum(amount), coalesce(sum(cogs), 0), bool_or(cogs is null)
  from sales_lines(p_org_id, p_start_date, p_end_date)
  group by customer_id, customer_name
  order by sum(amount) desc, 2;
$$;

-- Invoices Summary: one row per sale document (invoices and sales receipts).
create or replace function public.sales_documents(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  doc_type text,
  doc_id uuid,
  doc_number text,
  txn_date date,
  customer_name text,
  line_count bigint,
  quantity numeric,
  amount numeric,
  cogs numeric,
  cost_missing boolean
)
language sql
stable
set search_path = public
as $$
  select doc_type, doc_id, doc_number, txn_date, customer_name,
         count(*), sum(quantity), sum(amount), coalesce(sum(cogs), 0), bool_or(cogs is null)
  from sales_lines(p_org_id, p_start_date, p_end_date)
  group by doc_type, doc_id, doc_number, txn_date, customer_name
  order by txn_date, doc_number;
$$;

-- Income by Customer: sales less credit memos and refunds (both reduce
-- Sales Income in the ledger), then less COGS for gross profit.
create or replace function public.income_by_customer(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  customer_id uuid,
  customer_name text,
  sales numeric,
  credit_memos numeric,
  refunds numeric,
  net_sales numeric,
  cogs numeric,
  gross_profit numeric,
  cost_missing boolean
)
language sql
stable
set search_path = public
as $$
  with s as (
    select customer_id, sum(amount) as sales, coalesce(sum(cogs), 0) as cogs, bool_or(cogs is null) as cost_missing
    from sales_lines(p_org_id, p_start_date, p_end_date)
    group by customer_id
  ),
  cm as (
    select customer_id, sum(total) as total
    from credit_memos
    where org_id = p_org_id and status <> 'void' and issue_date between p_start_date and p_end_date
    group by customer_id
  ),
  rf as (
    select customer_id, sum(amount) as total
    from refunds
    where org_id = p_org_id and refund_date between p_start_date and p_end_date
    group by customer_id
  ),
  ids as (
    select customer_id from s
    union
    select customer_id from cm
    union
    select customer_id from rf
  )
  select
    ids.customer_id,
    coalesce(c.name, 'Walk-in customers'),
    coalesce(s.sales, 0),
    coalesce(cm.total, 0),
    coalesce(rf.total, 0),
    coalesce(s.sales, 0) - coalesce(cm.total, 0) - coalesce(rf.total, 0),
    coalesce(s.cogs, 0),
    coalesce(s.sales, 0) - coalesce(cm.total, 0) - coalesce(rf.total, 0) - coalesce(s.cogs, 0),
    coalesce(s.cost_missing, false)
  from ids
  left join customers c on c.id = ids.customer_id
  left join s on s.customer_id is not distinct from ids.customer_id
  left join cm on cm.customer_id is not distinct from ids.customer_id
  left join rf on rf.customer_id is not distinct from ids.customer_id
  order by 6 desc, 2;
$$;

-- Invoice Items Summary: total quantity per item across a range of invoice
-- numbers (the numeric part, so "12" matches INV-000012). Either bound may be
-- null for open-ended.
create or replace function public.invoice_items_summary(
  p_org_id uuid,
  p_from_number int default null,
  p_to_number int default null
)
returns table (
  item_id uuid,
  sku text,
  item_name text,
  quantity numeric,
  amount numeric,
  invoice_count bigint
)
language sql
stable
set search_path = public
as $$
  with inv as (
    select i.id
    from invoices i
    where i.org_id = p_org_id
      and i.status <> 'void'
      and (p_from_number is null or substring(i.invoice_number from '(\d+)$')::int >= p_from_number)
      and (p_to_number is null or substring(i.invoice_number from '(\d+)$')::int <= p_to_number)
  )
  select it.id, it.sku, it.name, sum(ii.quantity), sum(ii.line_total),
         (select count(*) from inv)
  from inv
  join invoice_items ii on ii.invoice_id = inv.id
  join items it on it.id = ii.item_id
  group by it.id, it.sku, it.name
  order by it.name;
$$;

-- Purchases by Supplier: non-void bills issued in range (count, total, paid
-- to date, balance) plus purchase orders created in range. A supplier with
-- only POs still gets a row.
create or replace function public.purchases_by_supplier(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  supplier_id uuid,
  supplier_name text,
  bill_count bigint,
  purchases numeric,
  paid numeric,
  balance numeric,
  po_count bigint
)
language sql
stable
set search_path = public
as $$
  with b as (
    select supplier_id, count(*) as n, sum(total) as total, sum(amount_paid) as paid
    from supplier_bills
    where org_id = p_org_id and status <> 'void' and issue_date between p_start_date and p_end_date
    group by supplier_id
  ),
  po as (
    select supplier_id, count(*) as n
    from purchase_orders
    where org_id = p_org_id and created_at::date between p_start_date and p_end_date
    group by supplier_id
  )
  select
    s.id,
    s.name,
    coalesce(b.n, 0),
    coalesce(b.total, 0),
    coalesce(b.paid, 0),
    coalesce(b.total, 0) - coalesce(b.paid, 0),
    coalesce(po.n, 0)
  from suppliers s
  left join b on b.supplier_id = s.id
  left join po on po.supplier_id = s.id
  where s.org_id = p_org_id
    and (b.supplier_id is not null or po.supplier_id is not null)
  order by coalesce(b.total, 0) desc, s.name;
$$;

-- Transactions Summary: count and total of every document type in range,
-- from the all_transactions directory view. Voided documents are counted
-- separately and left out of the total.
create or replace function public.transactions_summary(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  doc_type text,
  doc_count bigint,
  total numeric,
  void_count bigint
)
language sql
stable
set search_path = public
as $$
  select
    doc_type,
    count(*) filter (where status <> 'void'),
    coalesce(sum(total) filter (where status <> 'void'), 0),
    count(*) filter (where status = 'void')
  from all_transactions
  where org_id = p_org_id
    and txn_date between p_start_date and p_end_date
  group by doc_type
  order by doc_type;
$$;
