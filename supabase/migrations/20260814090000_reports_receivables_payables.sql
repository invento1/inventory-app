-- Reports, batch 2: receivables and payables. Plain SQL, STABLE, SECURITY
-- INVOKER, explicit org filter -- same shape as the batch 1 report functions.
--
-- Customer balances are built from documents so they reconcile to the
-- Accounts Receivable GL account: invoices raise AR, invoice payments and
-- credit memos lower it (create_credit_memo posts Credit AR). Refunds are
-- deliberately excluded -- create_refund posts Debit Sales Income / Credit
-- Cash and never touches AR. Voided invoices / credit memos / bills are
-- excluded outright (their void entries fully reverse the original posting).
-- Supplier balances mirror this against Accounts Payable.

create or replace function public.customer_balance_summary(p_org_id uuid, p_as_of date)
returns table (
  customer_id uuid,
  customer_name text,
  invoiced numeric,
  paid numeric,
  credited numeric,
  balance numeric
)
language sql
stable
set search_path = public
as $$
  with inv as (
    select i.customer_id, sum(i.total) as total
    from invoices i
    where i.org_id = p_org_id and i.status <> 'void' and i.issue_date <= p_as_of
    group by i.customer_id
  ),
  pay as (
    select i.customer_id, sum(p.amount) as total
    from invoice_payments p
    join invoices i on i.id = p.invoice_id
    where p.org_id = p_org_id and i.status <> 'void' and p.paid_at::date <= p_as_of
    group by i.customer_id
  ),
  cm as (
    select c.customer_id, sum(c.total) as total
    from credit_memos c
    where c.org_id = p_org_id and c.status <> 'void' and c.issue_date <= p_as_of
    group by c.customer_id
  )
  select
    c.id,
    c.name,
    coalesce(inv.total, 0),
    coalesce(pay.total, 0),
    coalesce(cm.total, 0),
    coalesce(inv.total, 0) - coalesce(pay.total, 0) - coalesce(cm.total, 0)
  from customers c
  left join inv on inv.customer_id = c.id
  left join pay on pay.customer_id = c.id
  left join cm on cm.customer_id = c.id
  where c.org_id = p_org_id
    and (inv.total is not null or cm.total is not null)
  order by c.name;
$$;

create or replace function public.supplier_balance_summary(p_org_id uuid, p_as_of date)
returns table (
  supplier_id uuid,
  supplier_name text,
  billed numeric,
  paid numeric,
  balance numeric
)
language sql
stable
set search_path = public
as $$
  with bills as (
    select b.supplier_id, sum(b.total) as total
    from supplier_bills b
    where b.org_id = p_org_id and b.status <> 'void' and b.issue_date <= p_as_of
    group by b.supplier_id
  ),
  pay as (
    select b.supplier_id, sum(p.amount) as total
    from supplier_bill_payments p
    join supplier_bills b on b.id = p.bill_id
    where p.org_id = p_org_id and b.status <> 'void' and p.paid_at::date <= p_as_of
    group by b.supplier_id
  )
  select
    s.id,
    s.name,
    bills.total,
    coalesce(pay.total, 0),
    bills.total - coalesce(pay.total, 0)
  from suppliers s
  join bills on bills.supplier_id = s.id
  left join pay on pay.supplier_id = s.id
  where s.org_id = p_org_id
  order by s.name;
$$;

-- Customer Statement: an 'opening' row (balance of everything before
-- p_start_date), then every invoice (charge), payment, and credit memo in
-- range with a running balance. Within a day, charges sort before payments
-- and credits so the running balance never dips below zero just because a
-- payment was timestamped earlier the same day than the invoice it pays. For payment rows doc_id/doc_number are the
-- invoice the payment was applied to, so the row links somewhere useful.
create or replace function public.customer_statement(
  p_org_id uuid,
  p_customer_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  txn_date date,
  doc_type text,
  doc_id uuid,
  doc_number text,
  memo text,
  charge numeric,
  payment numeric,
  balance numeric
)
language sql
stable
set search_path = public
as $$
  with txns as (
    select i.issue_date as d, i.created_at as ts, 'invoice' as t, i.id, i.invoice_number as num,
           i.notes as memo, i.total as charge, 0::numeric as payment
    from invoices i
    where i.org_id = p_org_id and i.customer_id = p_customer_id and i.status <> 'void'
    union all
    select p.paid_at::date, p.paid_at, 'payment', i.id, i.invoice_number,
           concat_ws(' · ', replace(p.payment_method, '_', ' '), p.reference_number), 0, p.amount
    from invoice_payments p
    join invoices i on i.id = p.invoice_id
    where p.org_id = p_org_id and i.customer_id = p_customer_id and i.status <> 'void'
    union all
    select c.issue_date, c.created_at, 'credit_memo', c.id, c.credit_memo_number, c.notes, 0, c.total
    from credit_memos c
    where c.org_id = p_org_id and c.customer_id = p_customer_id and c.status <> 'void'
  ),
  opening as (
    select coalesce(sum(charge - payment), 0) as bal from txns where d < p_start_date
  ),
  in_range as (
    select
      d, t, id, num, memo, charge, payment, ts,
      (select bal from opening) + sum(charge - payment) over (
        order by d, (charge = 0), ts, t, id rows between unbounded preceding and current row
      ) as bal
    from txns
    where d between p_start_date and p_end_date
  )
  select txn_date, doc_type, doc_id, doc_number, memo, charge, payment, balance
  from (
    select p_start_date as txn_date, 'opening' as doc_type, null::uuid as doc_id, null::text as doc_number,
           null::text as memo, 0::numeric as charge, 0::numeric as payment, bal as balance,
           0 as sort_group, null::timestamptz as ts
    from opening
    union all
    select d, t, id, num, memo, charge, payment, bal, 1, ts from in_range
  ) rows
  order by sort_group, txn_date, (charge = 0), ts, doc_type, doc_id;
$$;

-- Supplier Statement: AP mirror -- bills are charges (increase what's owed),
-- bill payments reduce it.
create or replace function public.supplier_statement(
  p_org_id uuid,
  p_supplier_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  txn_date date,
  doc_type text,
  doc_id uuid,
  doc_number text,
  memo text,
  charge numeric,
  payment numeric,
  balance numeric
)
language sql
stable
set search_path = public
as $$
  with txns as (
    select b.issue_date as d, b.created_at as ts, 'supplier_bill' as t, b.id, b.bill_number as num,
           b.notes as memo, b.total as charge, 0::numeric as payment
    from supplier_bills b
    where b.org_id = p_org_id and b.supplier_id = p_supplier_id and b.status <> 'void'
    union all
    select p.paid_at::date, p.paid_at, 'bill_payment', b.id, b.bill_number,
           concat_ws(' · ', replace(p.payment_method, '_', ' '), p.reference_number), 0, p.amount
    from supplier_bill_payments p
    join supplier_bills b on b.id = p.bill_id
    where p.org_id = p_org_id and b.supplier_id = p_supplier_id and b.status <> 'void'
  ),
  opening as (
    select coalesce(sum(charge - payment), 0) as bal from txns where d < p_start_date
  ),
  in_range as (
    select
      d, t, id, num, memo, charge, payment, ts,
      (select bal from opening) + sum(charge - payment) over (
        order by d, (charge = 0), ts, t, id rows between unbounded preceding and current row
      ) as bal
    from txns
    where d between p_start_date and p_end_date
  )
  select txn_date, doc_type, doc_id, doc_number, memo, charge, payment, balance
  from (
    select p_start_date as txn_date, 'opening' as doc_type, null::uuid as doc_id, null::text as doc_number,
           null::text as memo, 0::numeric as charge, 0::numeric as payment, bal as balance,
           0 as sort_group, null::timestamptz as ts
    from opening
    union all
    select d, t, id, num, memo, charge, payment, bal, 1, ts from in_range
  ) rows
  order by sort_group, txn_date, (charge = 0), ts, doc_type, doc_id;
$$;

-- Payment Collection: every customer payment received in range, with the
-- deposit it was banked in (if any yet).
create or replace function public.payment_collection(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  payment_id uuid,
  paid_at timestamptz,
  customer_id uuid,
  customer_name text,
  invoice_id uuid,
  invoice_number text,
  payment_method text,
  reference_number text,
  amount numeric,
  deposit_number text
)
language sql
stable
set search_path = public
as $$
  select
    p.id,
    p.paid_at,
    c.id,
    c.name,
    i.id,
    i.invoice_number,
    p.payment_method,
    p.reference_number,
    p.amount,
    d.deposit_number
  from invoice_payments p
  join invoices i on i.id = p.invoice_id
  join customers c on c.id = i.customer_id
  left join deposits d on d.id = p.deposit_id
  where p.org_id = p_org_id
    and p.paid_at::date between p_start_date and p_end_date
  order by p.paid_at, i.invoice_number;
$$;
