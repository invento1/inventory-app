-- Optional customer history on an invoice (the old HashirHub's "Balance
-- Forward" + "Last 5 invoices / Last 5 payments", made a per-invoice choice).
--
-- Whoever creates the invoice decides whether its printout shows:
--   * the customer's previous balance, with a "Total amount due"
--     (this invoice's balance + previous balance);
--   * their most recent other invoices;
--   * their most recent payments.
-- Display only: the previous balance is never added to the invoice's own
-- total or to Accounts Receivable (that would count the old debt twice).
--
-- The history is computed "as at the moment the invoice was created"
-- (everything recorded before invoices.created_at), so reprinting an old
-- invoice shows what the original showed, not today's figures. The balance
-- uses the same definition as customer_statement / customer_balance_summary:
-- invoices - payments - credit memos, voids excluded.

alter table public.invoices
  add column show_previous_balance boolean not null default false,
  add column show_recent_invoices boolean not null default false,
  add column show_recent_payments boolean not null default false;

-- History for a customer as at p_cutoff (default: now), ignoring one invoice
-- (the one being printed). Report-RPC convention: SQL, stable, SECURITY
-- INVOKER, explicit org filter.
create or replace function public.customer_history(
  p_org_id uuid,
  p_customer_id uuid,
  p_cutoff timestamptz default null,
  p_exclude_invoice uuid default null,
  p_limit int default 5
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with params as (
    select coalesce(p_cutoff, now()) as cutoff
  ),
  inv as (
    select i.id, i.invoice_number, i.issue_date, i.created_at, i.total,
      coalesce((select sum(p.amount) from invoice_payments p
                where p.invoice_id = i.id and p.created_at < (select cutoff from params)), 0) as paid
    from invoices i
    where i.org_id = p_org_id and i.customer_id = p_customer_id and i.status <> 'void'
      and i.created_at < (select cutoff from params)
      and i.id is distinct from p_exclude_invoice
  ),
  pay as (
    select p.paid_at, p.created_at, p.amount, p.payment_method, p.reference_number, i.invoice_number
    from invoice_payments p
    join invoices i on i.id = p.invoice_id
    where p.org_id = p_org_id and i.customer_id = p_customer_id and i.status <> 'void'
      and p.created_at < (select cutoff from params)
      and i.id is distinct from p_exclude_invoice
  ),
  credits as (
    select coalesce(sum(c.total), 0) as total
    from credit_memos c
    where c.org_id = p_org_id and c.customer_id = p_customer_id and c.status <> 'void'
      and c.created_at < (select cutoff from params)
  )
  select jsonb_build_object(
    'as_of', (select cutoff from params),
    'previous_balance', (select coalesce(sum(total - paid), 0) from inv) - (select total from credits),
    'open_invoice_count', (select count(*) from inv where total - paid > 0.005),
    'credit_total', (select total from credits),
    'invoices', coalesce((
      select jsonb_agg(x order by x.issue_date desc, x.created_at desc)
      from (select invoice_number, issue_date, created_at, total, paid, total - paid as balance
            from inv order by issue_date desc, created_at desc limit p_limit) x
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(y order by y.paid_at desc, y.created_at desc)
      from (select paid_at, created_at, amount, payment_method, reference_number, invoice_number
            from pay order by paid_at desc, created_at desc limit p_limit) y
    ), '[]'::jsonb)
  );
$$;

-- The history as it stood when this invoice was created.
create or replace function public.invoice_customer_history(p_org_id uuid, p_invoice_id uuid, p_limit int default 5)
returns jsonb
language sql
stable
set search_path = public
as $$
  select customer_history(i.org_id, i.customer_id, i.created_at, i.id, p_limit)
  from invoices i
  where i.org_id = p_org_id and i.id = p_invoice_id;
$$;

-- Choose what the invoice's printout shows. Display metadata only (no stock
-- or ledger effect), so it can be changed any time, including on paid or
-- void invoices. invoices has no client update policy: this is the one way.
create or replace function public.set_invoice_history_options(
  p_invoice_id uuid,
  p_previous_balance boolean,
  p_recent_invoices boolean,
  p_recent_payments boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from invoices where id = p_invoice_id;
  if v_org is null then
    raise exception 'Invoice not found';
  end if;
  perform assert_permission(v_org, 'invoices.create');

  update invoices
  set show_previous_balance = coalesce(p_previous_balance, false),
      show_recent_invoices = coalesce(p_recent_invoices, false),
      show_recent_payments = coalesce(p_recent_payments, false),
      updated_at = now()
  where id = p_invoice_id;
end;
$$;
