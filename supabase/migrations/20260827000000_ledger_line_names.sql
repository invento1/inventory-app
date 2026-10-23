-- General Ledger / Account Statement / Journal: fill the Name column.
-- journal_lines.name is only ever typed on manual Fiscal Daybook lines; every
-- auto-posted line left it empty, so the column was always blank. The name
-- is now derived from the document the entry came from (customer, supplier
-- or payee), for every entry past and future, with a typed name still
-- winning. Deposits, transfers, adjustments and the cutover have no party.

create or replace function public.journal_party_name(p_reference_type text, p_reference_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when p_reference_type in ('invoice', 'invoice_cogs', 'invoice_void', 'invoice_void_cogs') then
      (select c.name from invoices i join customers c on c.id = i.customer_id where i.id = p_reference_id)
    when p_reference_type = 'invoice_payment' then
      (select c.name from invoice_payments p join invoices i on i.id = p.invoice_id
         join customers c on c.id = i.customer_id where p.id = p_reference_id)
    when p_reference_type in ('sales_receipt', 'sales_receipt_cogs') then
      (select coalesce(c.name, 'Walk-in customer') from sales_receipts r
         left join customers c on c.id = r.customer_id where r.id = p_reference_id)
    when p_reference_type in ('credit_memo', 'credit_memo_void', 'credit_memo_cogs', 'credit_memo_void_cogs') then
      (select c.name from credit_memos m join customers c on c.id = m.customer_id where m.id = p_reference_id)
    when p_reference_type = 'refund' then
      (select c.name from refunds r join customers c on c.id = r.customer_id where r.id = p_reference_id)
    when p_reference_type in ('supplier_bill', 'supplier_bill_void') then
      (select s.name from supplier_bills b join suppliers s on s.id = b.supplier_id where b.id = p_reference_id)
    when p_reference_type = 'supplier_bill_payment' then
      (select s.name from supplier_bill_payments p join supplier_bills b on b.id = p.bill_id
         join suppliers s on s.id = b.supplier_id where p.id = p_reference_id)
    when p_reference_type in ('expense', 'expense_void') then
      (select coalesce(nullif(trim(e.payee_name), ''), s.name) from expenses e
         left join suppliers s on s.id = e.payee_supplier_id where e.id = p_reference_id)
  end;
$$;

CREATE OR REPLACE FUNCTION public.general_ledger(p_org_id uuid, p_start_date date, p_end_date date, p_account_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(account_id uuid, account_name text, account_type text, opening_balance numeric, line_id uuid, entry_id uuid, entry_number text, entry_date date, reference_type text, reference_id uuid, line_name text, memo text, debit numeric, credit numeric, running_balance numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
      coalesce(nullif(trim(jl.name), ''), journal_party_name(je.reference_type, je.reference_id)) as name,
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
$function$;

CREATE OR REPLACE FUNCTION public.journal_report(p_org_id uuid, p_start_date date, p_end_date date)
 RETURNS TABLE(entry_id uuid, entry_number text, entry_date date, reference_type text, reference_id uuid, entry_memo text, line_id uuid, account_id uuid, account_name text, line_name text, line_memo text, debit numeric, credit numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
    coalesce(nullif(trim(jl.name), ''), journal_party_name(je.reference_type, je.reference_id)) as name,
    jl.memo,
    jl.debit,
    jl.credit
  from journal_entries je
  join journal_lines jl on jl.journal_entry_id = je.id
  join ledger_accounts la on la.id = jl.account_id
  where je.org_id = p_org_id
    and je.entry_date between p_start_date and p_end_date
  order by je.entry_date, je.entry_number, jl.line_order, jl.id;
$function$;
