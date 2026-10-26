-- Credit memos applied to specific invoices, and returns costed at the
-- original sale's cost.
--
-- Applying a credit changes nothing in the ledger: the credit memo already
-- credited Accounts Receivable when it was created, and the invoice debited
-- it. An application only records which invoice the credit settles, so that
-- invoice's balance (and status) goes down. Customer balances, statements and
-- the AR account are unaffected.
--
-- A credit memo can also be raised against one invoice (credit_memos.
-- invoice_id). Its lines must be items from that invoice, no more than were
-- sold less earlier returns, each is costed at that invoice's snapshot cost
-- (not today's average), and the credit is applied to that invoice at once.

alter table public.invoices
  add column amount_credited numeric not null default 0;

alter table public.credit_memos
  add column amount_applied numeric not null default 0,
  add column invoice_id uuid references public.invoices(id) on delete set null;

create index credit_memos_invoice_id_idx on public.credit_memos (invoice_id) where invoice_id is not null;

create table public.credit_memo_applications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  credit_memo_id uuid not null references public.credit_memos(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  amount numeric not null check (amount > 0),
  applied_date date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index credit_memo_applications_invoice_idx on public.credit_memo_applications (org_id, invoice_id);
create index credit_memo_applications_credit_memo_idx on public.credit_memo_applications (credit_memo_id);

create trigger credit_memo_applications_fill_date
  before insert on public.credit_memo_applications
  for each row execute function public.fill_org_local_date('applied_date');

alter table public.credit_memo_applications enable row level security;
create policy "org members can select credit memo applications"
  on public.credit_memo_applications for select
  using (is_org_member(org_id));
-- No write policies: apply_credit_memo / remove_credit_application only.

-- The one writer of invoices.amount_credited / credit_memos.amount_applied:
-- recomputed from the applications whenever one is added or removed
-- (including cascades from Reset Data).
create or replace function public.credit_memo_applications_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid := coalesce(new.invoice_id, old.invoice_id);
  v_credit_memo_id uuid := coalesce(new.credit_memo_id, old.credit_memo_id);
begin
  with s as (
    select coalesce(sum(amount), 0) as credited from credit_memo_applications where invoice_id = v_invoice_id
  )
  update invoices i
  set amount_credited = s.credited,
      status = case
        when i.status = 'void' then i.status
        when i.amount_paid + s.credited >= i.total then 'paid'
        when i.amount_paid + s.credited > 0 then 'partially_paid'
        else 'unpaid'
      end,
      updated_at = now()
  from s
  where i.id = v_invoice_id;

  update credit_memos
  set amount_applied = (select coalesce(sum(amount), 0) from credit_memo_applications where credit_memo_id = v_credit_memo_id),
      updated_at = now()
  where id = v_credit_memo_id;

  return null;
end;
$$;

create trigger credit_memo_applications_sync
  after insert or delete on public.credit_memo_applications
  for each row execute function public.credit_memo_applications_sync();

revoke execute on function public.credit_memo_applications_sync() from public, authenticated, anon;

-- Shared checks for putting a credit on an invoice. Returns the most that
-- can be applied (the smaller of the credit left and the invoice balance).
create or replace function public.credit_application_room(p_credit_memo credit_memos, p_invoice invoices)
returns numeric
language plpgsql
stable
set search_path = public
as $$
begin
  if p_credit_memo.org_id <> p_invoice.org_id then
    raise exception 'credit memo and invoice belong to different businesses';
  end if;
  if p_credit_memo.customer_id <> p_invoice.customer_id then
    raise exception 'A credit can only be applied to the same customer''s invoices';
  end if;
  if p_credit_memo.status = 'void' then
    raise exception 'Credit memo % is void', p_credit_memo.credit_memo_number;
  end if;
  if p_invoice.status not in ('unpaid', 'partially_paid') then
    raise exception 'Invoice % has nothing left to pay', p_invoice.invoice_number;
  end if;
  return least(
    p_credit_memo.total - p_credit_memo.amount_applied,
    p_invoice.total - p_invoice.amount_paid - p_invoice.amount_credited
  );
end;
$$;

create or replace function public.apply_credit_memo(p_org_id uuid, p_credit_memo_id uuid, p_invoice_id uuid, p_amount numeric)
returns credit_memo_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credit_memo credit_memos%rowtype;
  v_invoice invoices%rowtype;
  v_room numeric;
  v_row credit_memo_applications%rowtype;
begin
  perform assert_permission(p_org_id, 'customer_payments.receive');

  select * into v_credit_memo from credit_memos where id = p_credit_memo_id and org_id = p_org_id for update;
  if not found then
    raise exception 'credit memo not found';
  end if;
  select * into v_invoice from invoices where id = p_invoice_id and org_id = p_org_id for update;
  if not found then
    raise exception 'invoice not found';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;
  v_room := credit_application_room(v_credit_memo, v_invoice);
  if p_amount > v_room then
    raise exception 'You can apply at most % here (credit left %, invoice balance %)', v_room,
      v_credit_memo.total - v_credit_memo.amount_applied,
      v_invoice.total - v_invoice.amount_paid - v_invoice.amount_credited;
  end if;

  insert into credit_memo_applications (org_id, credit_memo_id, invoice_id, amount)
  values (p_org_id, p_credit_memo_id, p_invoice_id, p_amount)
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.remove_credit_application(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row credit_memo_applications%rowtype;
begin
  select * into v_row from credit_memo_applications where id = p_application_id;
  if not found then
    raise exception 'credit application not found';
  end if;
  perform assert_permission(v_row.org_id, 'customer_payments.receive');
  if (select status from invoices where id = v_row.invoice_id) = 'void' then
    raise exception 'that invoice is void';
  end if;
  delete from credit_memo_applications where id = p_application_id;
end;
$$;

-- Same columns as before (balance now nets credits), amount_credited added at the end.
create or replace view public.outstanding_invoices with (security_invoker = true) as
select
  i.id,
  i.org_id,
  i.invoice_number,
  i.customer_id,
  c.name as customer_name,
  i.status,
  i.issue_date,
  i.due_date,
  i.total,
  i.amount_paid,
  i.total - i.amount_paid - i.amount_credited as balance,
  (i.due_date < org_today(i.org_id)) and i.status in ('unpaid', 'partially_paid') as is_overdue,
  i.amount_credited
from invoices i
join customers c on c.id = i.customer_id
where i.status in ('unpaid', 'partially_paid');

drop function public.create_credit_memo(uuid, uuid, jsonb, text, uuid);

-- The functions below are the live definitions with the changes above.

CREATE OR REPLACE FUNCTION public.audit_document_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_changed text[];
  v_number text;
begin
  if coalesce(current_setting('app.skip_audit', true), '') = 'on' then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    -- Filled in by the same save that created the document (an order's or
    -- adjustment's totals are written just after its row): part of
    -- creating it, not a change to it. now() is fixed per transaction.
    if (v_old ->> 'created_at') is not null and (v_old ->> 'created_at')::timestamptz = now() then
      return null;
    end if;
    select coalesce(array_agg(n.key order by n.key), '{}')
    into v_changed
    from jsonb_each(v_new) n
    where n.key <> 'updated_at' and (v_old -> n.key) is distinct from n.value;

    if cardinality(v_changed) = 0 then
      return null;
    end if;
    -- A payment or applied credit moving an invoice/bill between unpaid,
    -- partially_paid and paid: the payment / application is the record.
    if tg_table_name in ('invoices', 'supplier_bills')
       and v_changed <@ array['amount_paid', 'amount_credited', 'status']
       and v_new ->> 'status' <> 'void' then
      return null;
    end if;
    if tg_table_name = 'credit_memos' and v_changed <@ array['amount_applied'] then
      return null;
    end if;
    v_row := v_new;
  else
    v_old := to_jsonb(old);
    v_row := v_old;
  end if;

  v_number := case when tg_argv[1] = '' then 'PO-' || left(v_row ->> 'id', 8) else v_row ->> tg_argv[1] end;

  insert into audit_log (org_id, table_name, record_id, doc_type, doc_number, action, changed_fields,
                         old_data, new_data, changed_by)
  values ((v_row ->> 'org_id')::uuid, tg_table_name, (v_row ->> 'id')::uuid, tg_argv[0], v_number,
          lower(tg_op), coalesce(v_changed, '{}'), v_old, v_new, auth.uid());
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.dashboard_summary(p_org_id uuid, p_tz text DEFAULT 'UTC'::text)
 RETURNS TABLE(item_count bigint, low_stock_count bigint, today_sales_count bigint, today_sales_total numeric, outstanding_ar_total numeric, overdue_invoice_count bigint, customer_count bigint, revenue_this_week numeric, revenue_last_week numeric, outstanding_ap_total numeric, overdue_bill_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
    (select coalesce(sum(total - amount_paid - amount_credited), 0) from invoices where org_id = p_org_id and status in ('unpaid', 'partially_paid')),
    (select count(*) from invoices, cal
      where org_id = p_org_id and status in ('unpaid', 'partially_paid') and due_date < cal.today),
    (select count(*) from customers where org_id = p_org_id and is_active),
    (select coalesce(sum(total), 0) from sales, cal where sales.day >= cal.week_start and sales.day <= cal.today),
    (select coalesce(sum(total), 0) from sales, cal where sales.day >= cal.week_start - 7 and sales.day < cal.week_start),
    (select coalesce(sum(total - amount_paid), 0) from supplier_bills where org_id = p_org_id and status in ('unpaid', 'partially_paid')),
    (select count(*) from supplier_bills, cal
      where org_id = p_org_id and status in ('unpaid', 'partially_paid') and due_date < cal.today);
$function$;

CREATE OR REPLACE FUNCTION public.record_invoice_payment(p_invoice_id uuid, p_amount numeric, p_payment_method text, p_paid_at timestamp with time zone DEFAULT now(), p_notes text DEFAULT NULL::text, p_reference_number text DEFAULT NULL::text)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoice invoices%rowtype;
  v_new_amount_paid numeric;
  v_payment_id uuid;
begin
  select * into v_invoice from invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice % not found', p_invoice_id;
  end if;

  perform assert_permission(v_invoice.org_id, 'customer_payments.receive');

  if v_invoice.status = 'void' then
    raise exception 'cannot record a payment against a voided invoice';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'payment amount must be positive';
  end if;

  v_new_amount_paid := v_invoice.amount_paid + p_amount;

  if v_new_amount_paid + v_invoice.amount_credited > v_invoice.total then
    raise exception 'payment of % exceeds remaining balance of %',
      p_amount, (v_invoice.total - v_invoice.amount_paid - v_invoice.amount_credited);
  end if;

  insert into invoice_payments (org_id, invoice_id, amount, payment_method, paid_at, notes, reference_number, created_by)
  values (v_invoice.org_id, p_invoice_id, p_amount, p_payment_method, coalesce(p_paid_at, now()), p_notes, p_reference_number, auth.uid())
  returning id into v_payment_id;

  update invoices
  set amount_paid = v_new_amount_paid,
      status = case
        when v_new_amount_paid + amount_credited >= total then 'paid'
        when v_new_amount_paid + amount_credited > 0 then 'partially_paid'
        else 'unpaid'
      end,
      updated_at = now()
  where id = p_invoice_id
  returning * into v_invoice;

  perform post_journal_entry(
    v_invoice.org_id, coalesce(p_paid_at, now())::date, 'Payment for invoice ' || v_invoice.invoice_number,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', get_or_create_default_account(v_invoice.org_id, 'Undeposited Funds', 'other_current_asset'),
        'debit', p_amount, 'credit', 0
      ),
      jsonb_build_object(
        'account_id', get_or_create_default_account(v_invoice.org_id, 'Accounts Receivable', 'accounts_receivable'),
        'debit', 0, 'credit', p_amount
      )
    ),
    'invoice_payment', v_payment_id
  );

  return v_invoice;
end;
$function$;

CREATE OR REPLACE FUNCTION public.recompute_item_avg_cost(p_item_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_running_cost numeric := 0;
  v_running_stock numeric := 0;
  v_row record;
  v_blended_cost numeric;
  v_adjustment_cost numeric;
begin
  perform id from items where id = p_item_id for update;

  for v_row in
    select quantity_delta, reason, reference_type, reference_id, created_at, id
    from stock_movements
    where item_id = p_item_id
      and (
        reference_type = 'supplier_bill'
        or reason = 'sale'
        or (reason = 'void' and reference_type = 'invoice')
        or reference_type = 'inventory_adjustment'
        or reference_type = 'credit_memo'
      )
    order by created_at, id
  loop
    if v_row.reference_type = 'supplier_bill' and v_row.quantity_delta > 0 then
      select sum(quantity * unit_cost) / nullif(sum(quantity), 0)
      into v_blended_cost
      from supplier_bill_items
      where bill_id = v_row.reference_id and item_id = p_item_id;

      v_running_stock := greatest(v_running_stock, 0);
      v_running_cost := ((v_running_stock * v_running_cost) + (v_row.quantity_delta * coalesce(v_blended_cost, 0)))
                         / (v_running_stock + v_row.quantity_delta);
    elsif v_row.reference_type = 'inventory_adjustment' then
      select resulting_avg_cost into v_adjustment_cost
      from inventory_adjustment_items
      where adjustment_id = v_row.reference_id and item_id = p_item_id;

      v_running_cost := coalesce(v_adjustment_cost, v_running_cost);
    elsif v_row.reference_type = 'credit_memo' then
      -- A return raised against an invoice is costed at that sale's cost;
      -- other returns come back at the running average (no cost change).
      select sum(cmi.quantity * cmi.unit_cost) / nullif(sum(cmi.quantity), 0)
      into v_blended_cost
      from credit_memo_items cmi
      join credit_memos cm on cm.id = cmi.credit_memo_id
      where cmi.credit_memo_id = v_row.reference_id and cmi.item_id = p_item_id
        and cm.invoice_id is not null and cmi.unit_cost is not null;

      if v_blended_cost is not null then
        if v_row.quantity_delta > 0 then
          v_running_stock := greatest(v_running_stock, 0);
          v_running_cost := ((v_running_stock * v_running_cost) + (v_row.quantity_delta * v_blended_cost))
                             / (v_running_stock + v_row.quantity_delta);
        elsif v_running_stock + v_row.quantity_delta > 0 then
          v_running_cost := greatest(((v_running_stock * v_running_cost) + (v_row.quantity_delta * v_blended_cost))
                             / (v_running_stock + v_row.quantity_delta), 0);
        end if;
      end if;
    end if;

    v_running_stock := v_running_stock + v_row.quantity_delta;
  end loop;

  update items set avg_cost = v_running_cost where id = p_item_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_credit_memo(p_org_id uuid, p_customer_id uuid, p_lines jsonb, p_notes text DEFAULT NULL::text, p_sales_rep_id uuid DEFAULT NULL::uuid, p_invoice_id uuid DEFAULT NULL::uuid)
 RETURNS credit_memos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_credit_memo credit_memos%rowtype;
  v_credit_memo_number text;
  v_subtotal numeric;
  v_line jsonb;
  v_item_id uuid;
  v_location_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_item_org uuid;
  v_item_cost numeric;
  v_total_cost numeric := 0;
  v_invoice invoices%rowtype;
  v_sold numeric;
  v_returned numeric;
  v_sale_cost numeric;
  v_apply numeric;
begin
  perform assert_permission(p_org_id, 'credit_memos.create');

  if p_customer_id is null then
    raise exception 'a credit memo requires a customer';
  end if;
  if (select org_id from customers where id = p_customer_id) is distinct from p_org_id then
    raise exception 'customer does not belong to this org';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a credit memo must have at least one line item';
  end if;
  perform assert_sales_rep_in_org(p_org_id, p_sales_rep_id);

  if p_invoice_id is not null then
    select * into v_invoice from invoices where id = p_invoice_id and org_id = p_org_id for update;
    if not found then
      raise exception 'invoice not found';
    end if;
    if v_invoice.customer_id <> p_customer_id then
      raise exception 'Invoice % is for a different customer', v_invoice.invoice_number;
    end if;
    if v_invoice.status = 'void' then
      raise exception 'Invoice % is void', v_invoice.invoice_number;
    end if;
  end if;

  select coalesce(sum((line ->> 'quantity')::numeric * (line ->> 'unit_price')::numeric), 0)
  into v_subtotal
  from jsonb_array_elements(p_lines) as line;

  v_credit_memo_number := next_document_number(p_org_id, 'credit_memo', 'CM');

  insert into credit_memos (org_id, credit_memo_number, customer_id, sales_rep_id, subtotal, total, notes, created_by, invoice_id)
  values (p_org_id, v_credit_memo_number, p_customer_id, p_sales_rep_id, v_subtotal, v_subtotal, p_notes, auth.uid(), p_invoice_id)
  returning * into v_credit_memo;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := (v_line ->> 'item_id')::uuid;
    v_location_id := (v_line ->> 'location_id')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_price := (v_line ->> 'unit_price')::numeric;

    if v_quantity <= 0 then
      raise exception 'quantity must be positive';
    end if;
    if v_unit_price < 0 then
      raise exception 'unit price cannot be negative';
    end if;

    select org_id, avg_cost into v_item_org, v_item_cost from items where id = v_item_id;
    if v_item_org is distinct from p_org_id then
      raise exception 'item does not belong to this org';
    end if;
    if (select org_id from locations where id = v_location_id) is distinct from p_org_id then
      raise exception 'location does not belong to this org';
    end if;

    if p_invoice_id is not null then
      select coalesce(sum(quantity), 0),
             sum(quantity * unit_cost) filter (where unit_cost is not null)
               / nullif(sum(quantity) filter (where unit_cost is not null), 0)
      into v_sold, v_sale_cost
      from invoice_items where invoice_id = p_invoice_id and item_id = v_item_id;
      if v_sold = 0 then
        raise exception '% is not on invoice %', (select name from items where id = v_item_id), v_invoice.invoice_number;
      end if;

      -- Includes this credit memo's earlier lines for the same item.
      select coalesce(sum(cmi.quantity), 0) into v_returned
      from credit_memo_items cmi
      join credit_memos cm on cm.id = cmi.credit_memo_id
      where cm.invoice_id = p_invoice_id and cm.status <> 'void' and cmi.item_id = v_item_id;
      if v_returned + v_quantity > v_sold then
        raise exception 'Only % of % can be returned against invoice % (% sold, % already returned)',
          v_sold - v_returned, (select name from items where id = v_item_id), v_invoice.invoice_number, v_sold, v_returned;
      end if;

      -- Back at what it cost when it was sold (invoices from before costing: today's average).
      v_item_cost := coalesce(v_sale_cost, v_item_cost);
    end if;

    insert into credit_memo_items (credit_memo_id, item_id, location_id, quantity, unit_price, unit_cost, line_total)
    values (v_credit_memo.id, v_item_id, v_location_id, v_quantity, v_unit_price, v_item_cost, v_quantity * v_unit_price);

    -- Positive: goods physically coming back.
    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (p_org_id, v_item_id, v_location_id, v_quantity, 'return', 'credit_memo', v_credit_memo.id, auth.uid());
    if p_invoice_id is not null then
      perform recompute_item_avg_cost(v_item_id);
    end if;

    v_total_cost := v_total_cost + (v_quantity * coalesce(v_item_cost, 0));
  end loop;

  -- Revenue reversed per item income account; returned goods' cost moved
  -- back per item Inventory / COGS account.
  if v_subtotal > 0 then
    perform post_journal_entry(
      p_org_id, v_credit_memo.issue_date, 'Credit memo ' || v_credit_memo_number,
      journal_lines_for(document_account_groups(p_org_id, 'credit_memo', v_credit_memo.id, 'income'), 'debit', v_subtotal)
      || jsonb_build_array(jsonb_build_object(
        'account_id', get_or_create_default_account(p_org_id, 'Accounts Receivable', 'accounts_receivable'),
        'debit', 0, 'credit', v_subtotal)),
      'credit_memo', v_credit_memo.id
    );
  end if;

  if v_total_cost > 0 then
    perform post_journal_entry(
      p_org_id, v_credit_memo.issue_date, 'Cost of returns for credit memo ' || v_credit_memo_number,
      journal_lines_for(document_account_groups(p_org_id, 'credit_memo', v_credit_memo.id, 'inventory'), 'debit', v_total_cost)
      || journal_lines_for(document_account_groups(p_org_id, 'credit_memo', v_credit_memo.id, 'cogs'), 'credit', v_total_cost),
      'credit_memo_cogs', v_credit_memo.id
    );
  end if;

  -- Against an invoice: the credit settles that invoice first.
  if p_invoice_id is not null and v_invoice.status in ('unpaid', 'partially_paid') then
    v_apply := least(v_subtotal, v_invoice.total - v_invoice.amount_paid - v_invoice.amount_credited);
    if v_apply > 0 then
      insert into credit_memo_applications (org_id, credit_memo_id, invoice_id, amount)
      values (p_org_id, v_credit_memo.id, p_invoice_id, v_apply);
    end if;
  end if;

  select * into v_credit_memo from credit_memos where id = v_credit_memo.id;
  return v_credit_memo;
end;
$function$;

CREATE OR REPLACE FUNCTION public.void_credit_memo(p_credit_memo_id uuid)
 RETURNS credit_memos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_credit_memo credit_memos%rowtype;
  v_line record;
  v_total_cost numeric := 0;
begin
  select * into v_credit_memo from credit_memos where id = p_credit_memo_id;
  if not found then
    raise exception 'credit memo % not found', p_credit_memo_id;
  end if;

  perform assert_permission(v_credit_memo.org_id, 'credit_memos.void');

  if v_credit_memo.status = 'void' then
    raise exception 'credit memo is already void';
  end if;

  -- Its credit comes off any invoices it was applied to; they reopen.
  delete from credit_memo_applications where credit_memo_id = p_credit_memo_id;

  for v_line in select * from credit_memo_items where credit_memo_id = p_credit_memo_id
  loop
    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (v_credit_memo.org_id, v_line.item_id, v_line.location_id, -v_line.quantity, 'void', 'credit_memo', v_credit_memo.id, auth.uid());
    if v_credit_memo.invoice_id is not null then
      perform recompute_item_avg_cost(v_line.item_id);
    end if;

    v_total_cost := v_total_cost + (v_line.quantity * coalesce(v_line.unit_cost, 0));
  end loop;

  update credit_memos
  set status = 'void', updated_at = now()
  where id = p_credit_memo_id
  returning * into v_credit_memo;

  -- Reversal built from the credit memo's lines with the accounts that apply now.
  if v_credit_memo.total > 0 then
    perform post_journal_entry(
      v_credit_memo.org_id, current_date, 'Void credit memo ' || v_credit_memo.credit_memo_number,
      jsonb_build_array(jsonb_build_object(
        'account_id', get_or_create_default_account(v_credit_memo.org_id, 'Accounts Receivable', 'accounts_receivable'),
        'debit', v_credit_memo.total, 'credit', 0))
      || journal_lines_for(document_account_groups(v_credit_memo.org_id, 'credit_memo', v_credit_memo.id, 'income'), 'credit', v_credit_memo.total),
      'credit_memo_void', v_credit_memo.id
    );
  end if;

  if v_total_cost > 0 then
    perform post_journal_entry(
      v_credit_memo.org_id, current_date, 'Reverse cost of returns for voided credit memo ' || v_credit_memo.credit_memo_number,
      journal_lines_for(document_account_groups(v_credit_memo.org_id, 'credit_memo', v_credit_memo.id, 'cogs'), 'debit', v_total_cost)
      || journal_lines_for(document_account_groups(v_credit_memo.org_id, 'credit_memo', v_credit_memo.id, 'inventory'), 'credit', v_total_cost),
      'credit_memo_void_cogs', v_credit_memo.id
    );
  end if;

  return v_credit_memo;
end;
$function$;

CREATE OR REPLACE FUNCTION public.void_invoice(p_invoice_id uuid)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoice invoices%rowtype;
  v_line record;
  v_total_cogs numeric := 0;
  v_returns text;
begin
  select * into v_invoice from invoices where id = p_invoice_id;
  if not found then
    raise exception 'invoice % not found', p_invoice_id;
  end if;

  perform assert_permission(v_invoice.org_id, 'invoices.void');

  if v_invoice.status = 'void' then
    raise exception 'invoice is already void';
  end if;

  if v_invoice.amount_paid > 0 then
    raise exception 'cannot void an invoice with recorded payments';
  end if;

  select string_agg(credit_memo_number, ', ' order by credit_memo_number) into v_returns
  from credit_memos where invoice_id = p_invoice_id and status <> 'void';
  if v_returns is not null then
    raise exception 'Invoice % has returns on credit memo %. Void the credit memo first.',
      v_invoice.invoice_number, v_returns;
  end if;

  -- Credits applied to it go back to their credit memos, unapplied.
  delete from credit_memo_applications where invoice_id = p_invoice_id;

  for v_line in select * from invoice_items where invoice_id = p_invoice_id
  loop
    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (v_invoice.org_id, v_line.item_id, v_line.location_id, v_line.quantity, 'void', 'invoice', v_invoice.id, auth.uid());

    v_total_cogs := v_total_cogs + (v_line.quantity * coalesce(v_line.unit_cost, 0));
  end loop;

  update invoices
  set status = 'void', updated_at = now()
  where id = p_invoice_id
  returning * into v_invoice;

  update sales_orders set status = 'open', invoice_id = null, updated_at = now()
  where invoice_id = p_invoice_id and status = 'invoiced';

  -- Reversal built from the invoice's lines with the accounts that apply now.
  if v_invoice.total > 0 then
    perform post_journal_entry(
      v_invoice.org_id, current_date, 'Void invoice ' || v_invoice.invoice_number,
      journal_lines_for(document_account_groups(v_invoice.org_id, 'invoice', v_invoice.id, 'income'), 'debit', v_invoice.total)
      || jsonb_build_array(jsonb_build_object(
        'account_id', get_or_create_default_account(v_invoice.org_id, 'Accounts Receivable', 'accounts_receivable'),
        'debit', 0, 'credit', v_invoice.total)),
      'invoice_void', v_invoice.id
    );
  end if;

  if v_total_cogs > 0 then
    perform post_journal_entry(
      v_invoice.org_id, current_date, 'Reverse COGS for voided invoice ' || v_invoice.invoice_number,
      journal_lines_for(document_account_groups(v_invoice.org_id, 'invoice', v_invoice.id, 'inventory'), 'debit', v_total_cogs)
      || journal_lines_for(document_account_groups(v_invoice.org_id, 'invoice', v_invoice.id, 'cogs'), 'credit', v_total_cogs),
      'invoice_void_cogs', v_invoice.id
    );
  end if;

  return v_invoice;
end;
$function$;

revoke execute on function public.recompute_item_avg_cost(uuid) from public, authenticated, anon;
