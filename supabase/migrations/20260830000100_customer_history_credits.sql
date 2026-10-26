-- Printed invoice history with applied credits (see 20260830000000).
-- A credit applied to the printed invoice already lowers that invoice's own
-- balance, so it's left out of "previous balance" (it would count twice).
-- Recent invoices show their balance net of credits applied before the cutoff.
-- The previous balance itself is unchanged otherwise: invoices - payments -
-- credit memos, the same as the statements.

CREATE OR REPLACE FUNCTION public.customer_history(p_org_id uuid, p_customer_id uuid, p_cutoff timestamp with time zone DEFAULT NULL::timestamp with time zone, p_exclude_invoice uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with params as (
    select coalesce(p_cutoff, now()) as cutoff
  ),
  inv as (
    select i.id, i.invoice_number, i.issue_date, i.created_at, i.total,
      coalesce((select sum(p.amount) from invoice_payments p
                where p.invoice_id = i.id and p.created_at < (select cutoff from params)), 0) as paid,
      coalesce((select sum(a.amount) from credit_memo_applications a
                where a.invoice_id = i.id and a.created_at < (select cutoff from params)), 0) as credited
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
    select coalesce(sum(c.total), 0) as total,
      -- Credit already netted off the excluded invoice's own balance.
      coalesce(sum((select sum(a.amount) from credit_memo_applications a
                    where a.credit_memo_id = c.id and a.invoice_id = p_exclude_invoice)), 0) as on_excluded
    from credit_memos c
    where c.org_id = p_org_id and c.customer_id = p_customer_id and c.status <> 'void'
      and c.created_at < (select cutoff from params)
  )
  select jsonb_build_object(
    'as_of', (select cutoff from params),
    'previous_balance', (select coalesce(sum(total - paid), 0) from inv) - (select total - on_excluded from credits),
    'open_invoice_count', (select count(*) from inv where total - paid - credited > 0.005),
    'credit_total', (select total from credits),
    'invoices', coalesce((
      select jsonb_agg(x order by x.issue_date desc, x.created_at desc)
      from (select invoice_number, issue_date, created_at, total, paid, total - paid - credited as balance
            from inv order by issue_date desc, created_at desc limit p_limit) x
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(y order by y.paid_at desc, y.created_at desc)
      from (select paid_at, created_at, amount, payment_method, reference_number, invoice_number
            from pay order by paid_at desc, created_at desc limit p_limit) y
    ), '[]'::jsonb)
  );
$function$;
