-- Convert a quotation into an invoice or a sales receipt.
--
-- A quotation gets a third status, 'converted', and a link to what it became
-- (invoice_id or sales_receipt_id). create_invoice / create_sales_receipt take
-- a trailing p_quotation_id: the quotation must be open, this org's, and for
-- the same customer (a walk-in quotation can go to any customer). It's marked
-- converted in the same transaction as the sale, like sales orders.
-- Voiding the invoice reopens the quotation. Sales receipts can't be voided,
-- so a quotation converted to one stays converted. A converted quotation
-- can't be voided itself.

alter table public.quotations drop constraint quotations_status_check;
alter table public.quotations add constraint quotations_status_check
  check (status in ('open', 'converted', 'void'));

alter table public.quotations
  add column invoice_id uuid references public.invoices(id) on delete set null,
  add column sales_receipt_id uuid references public.sales_receipts(id) on delete set null;

create index quotations_invoice_id_idx on public.quotations (invoice_id) where invoice_id is not null;

-- Locks and checks a quotation being converted.
create or replace function public.claim_quotation(p_org_id uuid, p_quotation_id uuid, p_customer_id uuid)
returns quotations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quotation quotations%rowtype;
begin
  select * into v_quotation from quotations where id = p_quotation_id for update;
  if not found or v_quotation.org_id <> p_org_id then
    raise exception 'quotation not found';
  end if;
  if v_quotation.status <> 'open' then
    raise exception 'Quotation % is already %', v_quotation.quotation_number, v_quotation.status;
  end if;
  if v_quotation.customer_id is not null and v_quotation.customer_id is distinct from p_customer_id then
    raise exception 'Quotation % is for a different customer', v_quotation.quotation_number;
  end if;
  return v_quotation;
end;
$$;
revoke execute on function public.claim_quotation(uuid, uuid, uuid) from public, authenticated, anon;

drop function public.create_invoice(uuid, uuid, date, jsonb, text, uuid, numeric, uuid);
drop function public.create_sales_receipt(uuid, uuid, text, jsonb, uuid, numeric);

CREATE OR REPLACE FUNCTION public.create_invoice(p_org_id uuid, p_customer_id uuid, p_due_date date, p_lines jsonb, p_notes text DEFAULT NULL::text, p_sales_rep_id uuid DEFAULT NULL::uuid, p_discount numeric DEFAULT 0, p_sales_order_id uuid DEFAULT NULL::uuid, p_quotation_id uuid DEFAULT NULL::uuid)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoice invoices%rowtype;
  v_invoice_number text;
  v_subtotal numeric;
  v_discount numeric := coalesce(p_discount, 0);
  v_order sales_orders%rowtype;
  v_line jsonb;
  v_item_id uuid;
  v_location_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_line_discount numeric;
  v_item_org uuid;
  v_item_cost numeric;
  v_commission_rate numeric;
  v_total_cogs numeric := 0;
begin
  perform assert_permission(p_org_id, 'invoices.create');

  if p_customer_id is null then
    raise exception 'an invoice requires a customer';
  end if;
  if (select org_id from customers where id = p_customer_id) is distinct from p_org_id then
    raise exception 'customer does not belong to this org';
  end if;
  if p_due_date is null then
    raise exception 'an invoice requires a due date';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'an invoice must have at least one line item';
  end if;
  perform assert_sales_rep_in_org(p_org_id, p_sales_rep_id);

  -- Check every line's discount first, so an oversized one is reported as
  -- such rather than as a document discount above a negative subtotal.
  perform assert_valid_line_discount((line ->> 'quantity')::numeric, (line ->> 'unit_price')::numeric,
                                     coalesce((line ->> 'discount')::numeric, 0))
  from jsonb_array_elements(p_lines) as line;

  select coalesce(sum((line ->> 'quantity')::numeric * (line ->> 'unit_price')::numeric
                      - coalesce((line ->> 'discount')::numeric, 0)), 0)
  into v_subtotal
  from jsonb_array_elements(p_lines) as line;

  if v_discount < 0 or v_discount > v_subtotal then
    raise exception 'the invoice discount must be between 0 and the subtotal';
  end if;

  -- Made from a quotation: it must still be open and for this customer.
  if p_quotation_id is not null then
    perform claim_quotation(p_org_id, p_quotation_id, p_customer_id);
  end if;

  if p_sales_order_id is not null then
    select * into v_order from sales_orders where id = p_sales_order_id for update;
    if not found or v_order.org_id <> p_org_id then
      raise exception 'sales order not found';
    end if;
    if v_order.status <> 'open' then
      raise exception 'sales order % is already %', v_order.order_number, v_order.status;
    end if;
    if v_order.customer_id <> p_customer_id then
      raise exception 'the invoice must be for the sales order''s customer';
    end if;
  end if;

  v_invoice_number := next_document_number(p_org_id, 'invoice', 'INV');

  insert into invoices (org_id, invoice_number, customer_id, sales_rep_id, due_date, subtotal, discount, total, notes, created_by)
  values (p_org_id, v_invoice_number, p_customer_id, p_sales_rep_id, p_due_date, v_subtotal, v_discount,
          v_subtotal - v_discount, p_notes, auth.uid())
  returning * into v_invoice;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := (v_line ->> 'item_id')::uuid;
    v_location_id := (v_line ->> 'location_id')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_price := (v_line ->> 'unit_price')::numeric;
    v_line_discount := coalesce((v_line ->> 'discount')::numeric, 0);

    if v_quantity <= 0 then
      raise exception 'quantity must be positive';
    end if;
    if v_unit_price < 0 then
      raise exception 'unit price cannot be negative';
    end if;
    perform assert_valid_line_discount(v_quantity, v_unit_price, v_line_discount);

    select org_id, avg_cost, commission_rate into v_item_org, v_item_cost, v_commission_rate
    from items where id = v_item_id;
    if v_item_org is distinct from p_org_id then
      raise exception 'item does not belong to this org';
    end if;
    if (select org_id from locations where id = v_location_id) is distinct from p_org_id then
      raise exception 'location does not belong to this org';
    end if;

    insert into invoice_items (invoice_id, item_id, location_id, quantity, unit_price, discount, unit_cost, commission_rate, line_total)
    values (v_invoice.id, v_item_id, v_location_id, v_quantity, v_unit_price, v_line_discount, v_item_cost,
            v_commission_rate, v_quantity * v_unit_price - v_line_discount);

    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (p_org_id, v_item_id, v_location_id, -v_quantity, 'sale', 'invoice', v_invoice.id, auth.uid());

    v_total_cogs := v_total_cogs + (v_quantity * coalesce(v_item_cost, 0));
  end loop;

  -- Revenue per item income account (the invoice discount spread in
  -- proportion), cost per item COGS / Inventory account. Items without their
  -- own accounts use Posting Settings.
  if v_invoice.total > 0 then
    perform post_journal_entry(
      p_org_id, v_invoice.issue_date, 'Invoice ' || v_invoice_number,
      jsonb_build_array(jsonb_build_object(
        'account_id', get_or_create_default_account(p_org_id, 'Accounts Receivable', 'accounts_receivable'),
        'debit', v_invoice.total, 'credit', 0))
      || journal_lines_for(document_account_groups(p_org_id, 'invoice', v_invoice.id, 'income'), 'credit', v_invoice.total),
      'invoice', v_invoice.id
    );
  end if;

  if v_total_cogs > 0 then
    perform post_journal_entry(
      p_org_id, v_invoice.issue_date, 'COGS for invoice ' || v_invoice_number,
      journal_lines_for(document_account_groups(p_org_id, 'invoice', v_invoice.id, 'cogs'), 'debit', v_total_cogs)
      || journal_lines_for(document_account_groups(p_org_id, 'invoice', v_invoice.id, 'inventory'), 'credit', v_total_cogs),
      'invoice_cogs', v_invoice.id
    );
  end if;

  if p_quotation_id is not null then
    update quotations set status = 'converted', invoice_id = v_invoice.id, updated_at = now()
    where id = p_quotation_id;
  end if;

  if p_sales_order_id is not null then
    update sales_orders set status = 'invoiced', invoice_id = v_invoice.id, updated_at = now()
    where id = p_sales_order_id;
  end if;

  return v_invoice;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_sales_receipt(p_org_id uuid, p_customer_id uuid, p_payment_method text, p_lines jsonb, p_sales_rep_id uuid DEFAULT NULL::uuid, p_discount numeric DEFAULT 0, p_quotation_id uuid DEFAULT NULL::uuid)
 RETURNS sales_receipts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_receipt sales_receipts%rowtype;
  v_receipt_number text;
  v_subtotal numeric;
  v_discount numeric := coalesce(p_discount, 0);
  v_line jsonb;
  v_item_id uuid;
  v_location_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_line_discount numeric;
  v_item_org uuid;
  v_item_cost numeric;
  v_commission_rate numeric;
  v_total_cogs numeric := 0;
begin
  perform assert_permission(p_org_id, 'sales.create');

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a sale must have at least one line item';
  end if;
  if p_customer_id is not null
     and (select org_id from customers where id = p_customer_id) is distinct from p_org_id then
    raise exception 'customer does not belong to this org';
  end if;
  perform assert_sales_rep_in_org(p_org_id, p_sales_rep_id);

  -- Made from a quotation: it must still be open and for this customer.
  if p_quotation_id is not null then
    perform claim_quotation(p_org_id, p_quotation_id, p_customer_id);
  end if;

  -- Check every line's discount first, so an oversized one is reported as
  -- such rather than as a document discount above a negative subtotal.
  perform assert_valid_line_discount((line ->> 'quantity')::numeric, (line ->> 'unit_price')::numeric,
                                     coalesce((line ->> 'discount')::numeric, 0))
  from jsonb_array_elements(p_lines) as line;

  select coalesce(sum((line ->> 'quantity')::numeric * (line ->> 'unit_price')::numeric
                      - coalesce((line ->> 'discount')::numeric, 0)), 0)
  into v_subtotal
  from jsonb_array_elements(p_lines) as line;

  if v_discount < 0 or v_discount > v_subtotal then
    raise exception 'the sale discount must be between 0 and the subtotal';
  end if;

  v_receipt_number := next_document_number(p_org_id, 'sales_receipt', 'SR');

  insert into sales_receipts (org_id, receipt_number, customer_id, sales_rep_id, payment_method, subtotal, discount, total, created_by)
  values (p_org_id, v_receipt_number, p_customer_id, p_sales_rep_id, p_payment_method, v_subtotal, v_discount,
          v_subtotal - v_discount, auth.uid())
  returning * into v_receipt;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := (v_line ->> 'item_id')::uuid;
    v_location_id := (v_line ->> 'location_id')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_price := (v_line ->> 'unit_price')::numeric;
    v_line_discount := coalesce((v_line ->> 'discount')::numeric, 0);

    if v_quantity <= 0 then
      raise exception 'quantity must be positive';
    end if;
    if v_unit_price < 0 then
      raise exception 'unit price cannot be negative';
    end if;
    perform assert_valid_line_discount(v_quantity, v_unit_price, v_line_discount);

    select org_id, avg_cost, commission_rate into v_item_org, v_item_cost, v_commission_rate
    from items where id = v_item_id;
    if v_item_org is distinct from p_org_id then
      raise exception 'item does not belong to this org';
    end if;
    if (select org_id from locations where id = v_location_id) is distinct from p_org_id then
      raise exception 'location does not belong to this org';
    end if;

    insert into sales_receipt_items (sales_receipt_id, item_id, location_id, quantity, unit_price, discount, unit_cost, commission_rate, line_total)
    values (v_receipt.id, v_item_id, v_location_id, v_quantity, v_unit_price, v_line_discount, v_item_cost,
            v_commission_rate, v_quantity * v_unit_price - v_line_discount);

    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (p_org_id, v_item_id, v_location_id, -v_quantity, 'sale', 'sales_receipt', v_receipt.id, auth.uid());

    v_total_cogs := v_total_cogs + (v_quantity * coalesce(v_item_cost, 0));
  end loop;

  -- Revenue per item income account (the sale discount spread in
  -- proportion), cost per item COGS / Inventory account.
  if v_receipt.total > 0 then
    perform post_journal_entry(
      p_org_id, current_date, 'Sales receipt ' || v_receipt_number,
      jsonb_build_array(jsonb_build_object(
        'account_id', get_or_create_default_account(
          p_org_id, case when p_payment_method = 'cash' then 'Cash' else 'Bank' end, 'bank'),
        'debit', v_receipt.total, 'credit', 0))
      || journal_lines_for(document_account_groups(p_org_id, 'sales_receipt', v_receipt.id, 'income'), 'credit', v_receipt.total),
      'sales_receipt', v_receipt.id
    );
  end if;

  if v_total_cogs > 0 then
    perform post_journal_entry(
      p_org_id, current_date, 'COGS for sales receipt ' || v_receipt_number,
      journal_lines_for(document_account_groups(p_org_id, 'sales_receipt', v_receipt.id, 'cogs'), 'debit', v_total_cogs)
      || journal_lines_for(document_account_groups(p_org_id, 'sales_receipt', v_receipt.id, 'inventory'), 'credit', v_total_cogs),
      'sales_receipt_cogs', v_receipt.id
    );
  end if;

  if p_quotation_id is not null then
    update quotations set status = 'converted', sales_receipt_id = v_receipt.id, updated_at = now()
    where id = p_quotation_id;
  end if;

  return v_receipt;
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

  update quotations set status = 'open', invoice_id = null, updated_at = now()
  where invoice_id = p_invoice_id and status = 'converted';

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

CREATE OR REPLACE FUNCTION public.void_quotation(p_quotation_id uuid)
 RETURNS quotations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_quotation quotations%rowtype;
begin
  select * into v_quotation from quotations where id = p_quotation_id;
  if not found then
    raise exception 'quotation % not found', p_quotation_id;
  end if;

  perform assert_permission(v_quotation.org_id, 'quotations.void');

  if v_quotation.status = 'void' then
    raise exception 'quotation is already void';
  end if;
  if v_quotation.status = 'converted' then
    raise exception 'quotation % has already been converted; void the invoice instead', v_quotation.quotation_number;
  end if;

  update quotations
  set status = 'void', updated_at = now()
  where id = p_quotation_id
  returning * into v_quotation;

  return v_quotation;
end;
$function$;
