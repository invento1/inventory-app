-- Generated from the live definitions: each RPC's membership / owner-admin
-- check becomes a specific permission check. Bodies are otherwise unchanged.
-- (reset_org_data stays owner-only.)

-- apply_customer_payment: customer_payments.receive
CREATE OR REPLACE FUNCTION public.apply_customer_payment(p_org_id uuid, p_customer_id uuid, p_amount numeric, p_payment_method text, p_paid_at timestamp with time zone, p_notes text, p_allocations jsonb, p_reference_number text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_alloc jsonb;
  v_sum numeric := 0;
  v_customer_org uuid;
begin
  perform assert_permission(p_org_id, 'customer_payments.receive');

  select org_id into v_customer_org from customers where id = p_customer_id;
  if v_customer_org is distinct from p_org_id then
    raise exception 'customer does not belong to this org';
  end if;

  if p_allocations is null or jsonb_array_length(p_allocations) = 0 then
    raise exception 'select at least one invoice to apply payment to';
  end if;

  select coalesce(sum((a ->> 'amount')::numeric), 0) into v_sum from jsonb_array_elements(p_allocations) a;
  if abs(v_sum - p_amount) > 0.01 then
    raise exception 'allocations (%) must sum to the payment amount (%)', v_sum, p_amount;
  end if;

  for v_alloc in select * from jsonb_array_elements(p_allocations)
  loop
    perform record_invoice_payment(
      (v_alloc ->> 'invoice_id')::uuid,
      (v_alloc ->> 'amount')::numeric,
      p_payment_method,
      coalesce(p_paid_at, now()),
      p_notes,
      p_reference_number
    );
  end loop;
end;
$function$;

-- apply_supplier_payment: supplier_payments.create
CREATE OR REPLACE FUNCTION public.apply_supplier_payment(p_org_id uuid, p_supplier_id uuid, p_amount numeric, p_payment_method text, p_paid_at timestamp with time zone, p_notes text, p_allocations jsonb, p_account_id uuid DEFAULT NULL::uuid, p_reference_number text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_alloc jsonb;
  v_sum numeric := 0;
  v_supplier_org uuid;
begin
  perform assert_permission(p_org_id, 'supplier_payments.create');

  select org_id into v_supplier_org from suppliers where id = p_supplier_id;
  if v_supplier_org is distinct from p_org_id then
    raise exception 'supplier does not belong to this org';
  end if;

  if p_allocations is null or jsonb_array_length(p_allocations) = 0 then
    raise exception 'select at least one bill to apply payment to';
  end if;

  select coalesce(sum((a ->> 'amount')::numeric), 0) into v_sum from jsonb_array_elements(p_allocations) a;
  if abs(v_sum - p_amount) > 0.01 then
    raise exception 'allocations (%) must sum to the payment amount (%)', v_sum, p_amount;
  end if;

  for v_alloc in select * from jsonb_array_elements(p_allocations)
  loop
    perform record_supplier_bill_payment(
      (v_alloc ->> 'bill_id')::uuid,
      (v_alloc ->> 'amount')::numeric,
      p_payment_method,
      coalesce(p_paid_at, now()),
      p_notes,
      p_account_id,
      p_reference_number
    );
  end loop;
end;
$function$;

-- convert_purchase_order_to_bill: purchase_orders.receive
CREATE OR REPLACE FUNCTION public.convert_purchase_order_to_bill(p_po_id uuid, p_location_id uuid, p_due_date date, p_notes text DEFAULT NULL::text)
 RETURNS supplier_bills
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_po purchase_orders%rowtype;
  v_location_org uuid;
  v_lines jsonb;
  v_bill supplier_bills%rowtype;
  v_already_received boolean;
begin
  select * into v_po from purchase_orders where id = p_po_id;
  if not found then
    raise exception 'purchase order % not found', p_po_id;
  end if;

  perform assert_permission(v_po.org_id, 'purchase_orders.receive');

  if v_po.bill_id is not null then
    raise exception 'this purchase order has already been converted to a bill';
  end if;

  select exists (select 1 from purchase_order_lines where po_id = p_po_id and quantity_received > 0)
  into v_already_received;
  if v_already_received then
    raise exception 'this purchase order already has manually received lines -- convert before receiving, not after';
  end if;

  select org_id into v_location_org from locations where id = p_location_id;
  if v_location_org is distinct from v_po.org_id then
    raise exception 'location does not belong to this org';
  end if;

  select jsonb_agg(jsonb_build_object(
    'item_id', item_id,
    'location_id', p_location_id,
    'quantity', quantity_ordered,
    'unit_cost', coalesce(unit_cost, 0)
  ))
  into v_lines
  from purchase_order_lines
  where po_id = p_po_id;

  v_bill := create_supplier_bill(v_po.org_id, v_po.supplier_id, p_due_date, v_lines, p_notes);

  update supplier_bills set purchase_order_id = p_po_id where id = v_bill.id
  returning * into v_bill;

  update purchase_order_lines set quantity_received = quantity_ordered where po_id = p_po_id;

  update purchase_orders set status = 'received', bill_id = v_bill.id, updated_at = now()
  where id = p_po_id;

  return v_bill;
end;
$function$;

-- create_credit_memo: credit_memos.create
CREATE OR REPLACE FUNCTION public.create_credit_memo(p_org_id uuid, p_customer_id uuid, p_lines jsonb, p_notes text DEFAULT NULL::text)
 RETURNS credit_memos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_credit_memo credit_memos%rowtype;
  v_credit_memo_number text;
  v_subtotal numeric;
  v_customer_org uuid;
  v_line jsonb;
  v_item_id uuid;
  v_location_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_item_org uuid;
  v_location_org uuid;
begin
  perform assert_permission(p_org_id, 'credit_memos.create');

  if p_customer_id is null then
    raise exception 'a credit memo requires a customer';
  end if;

  select org_id into v_customer_org from customers where id = p_customer_id;
  if v_customer_org is distinct from p_org_id then
    raise exception 'customer does not belong to this org';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a credit memo must have at least one line item';
  end if;

  select coalesce(sum((line ->> 'quantity')::numeric * (line ->> 'unit_price')::numeric), 0)
  into v_subtotal
  from jsonb_array_elements(p_lines) as line;

  v_credit_memo_number := next_document_number(p_org_id, 'credit_memo', 'CM');

  insert into credit_memos (org_id, credit_memo_number, customer_id, subtotal, total, notes, created_by)
  values (p_org_id, v_credit_memo_number, p_customer_id, v_subtotal, v_subtotal, p_notes, auth.uid())
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

    select org_id into v_item_org from items where id = v_item_id;
    if v_item_org is distinct from p_org_id then
      raise exception 'item does not belong to this org';
    end if;

    select org_id into v_location_org from locations where id = v_location_id;
    if v_location_org is distinct from p_org_id then
      raise exception 'location does not belong to this org';
    end if;

    insert into credit_memo_items (credit_memo_id, item_id, location_id, quantity, unit_price, line_total)
    values (v_credit_memo.id, v_item_id, v_location_id, v_quantity, v_unit_price, v_quantity * v_unit_price);

    -- Positive: goods physically coming back, same direction as
    -- receive_purchase_order_line/create_supplier_bill.
    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (p_org_id, v_item_id, v_location_id, v_quantity, 'return', 'credit_memo', v_credit_memo.id, auth.uid());
  end loop;

  if v_subtotal > 0 then
    perform post_journal_entry(
      p_org_id, v_credit_memo.issue_date, 'Credit memo ' || v_credit_memo_number,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Sales Income', 'income'),
          'debit', v_subtotal, 'credit', 0
        ),
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Accounts Receivable', 'accounts_receivable'),
          'debit', 0, 'credit', v_subtotal
        )
      ),
      'credit_memo', v_credit_memo.id
    );
  end if;

  return v_credit_memo;
end;
$function$;

-- create_expense: expenses.create
CREATE OR REPLACE FUNCTION public.create_expense(p_org_id uuid, p_expense_date date, p_payee_supplier_id uuid, p_payee_name text, p_category_account_id uuid, p_amount numeric, p_payment_method text, p_account_id uuid DEFAULT NULL::uuid, p_reference_number text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS expenses
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_expense expenses%rowtype;
  v_expense_number text;
  v_category_org uuid;
  v_payee_org uuid;
  v_pay_account_id uuid;
  v_account_org uuid;
begin
  perform assert_permission(p_org_id, 'expenses.create');

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  select org_id into v_category_org from ledger_accounts where id = p_category_account_id;
  if v_category_org is distinct from p_org_id then
    raise exception 'category account does not belong to this org';
  end if;

  if p_payee_supplier_id is not null then
    select org_id into v_payee_org from suppliers where id = p_payee_supplier_id;
    if v_payee_org is distinct from p_org_id then
      raise exception 'payee supplier does not belong to this org';
    end if;
  end if;

  if p_account_id is not null then
    select org_id into v_account_org from ledger_accounts where id = p_account_id;
    if v_account_org is distinct from p_org_id then
      raise exception 'account does not belong to this org';
    end if;
    v_pay_account_id := p_account_id;
  else
    v_pay_account_id := get_or_create_default_account(
      p_org_id, case when p_payment_method = 'cash' then 'Cash' else 'Bank' end, 'bank'
    );
  end if;

  v_expense_number := next_document_number(p_org_id, 'expense', 'EXP');

  insert into expenses (
    org_id, expense_number, expense_date, payee_supplier_id, payee_name, category_account_id,
    amount, payment_method, account_id, reference_number, notes, created_by
  )
  values (
    p_org_id, v_expense_number, p_expense_date, p_payee_supplier_id, p_payee_name, p_category_account_id,
    p_amount, p_payment_method, v_pay_account_id, p_reference_number, p_notes, auth.uid()
  )
  returning * into v_expense;

  perform post_journal_entry(
    p_org_id, p_expense_date, 'Expense ' || v_expense_number,
    jsonb_build_array(
      jsonb_build_object('account_id', p_category_account_id, 'debit', p_amount, 'credit', 0),
      jsonb_build_object('account_id', v_pay_account_id, 'debit', 0, 'credit', p_amount)
    ),
    'expense', v_expense.id
  );

  return v_expense;
end;
$function$;

-- create_fund_transfer: banking.transfer
CREATE OR REPLACE FUNCTION public.create_fund_transfer(p_org_id uuid, p_from_account_id uuid, p_to_account_id uuid, p_amount numeric, p_transfer_date date, p_memo text)
 RETURNS journal_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_from_org uuid;
  v_to_org uuid;
begin
  perform assert_permission(p_org_id, 'banking.transfer');

  if p_from_account_id is null or p_to_account_id is null then
    raise exception 'both a from and to account are required';
  end if;

  if p_from_account_id = p_to_account_id then
    raise exception 'from and to accounts must differ';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  select org_id into v_from_org from ledger_accounts where id = p_from_account_id;
  select org_id into v_to_org from ledger_accounts where id = p_to_account_id;
  if v_from_org is distinct from p_org_id or v_to_org is distinct from p_org_id then
    raise exception 'account does not belong to this org';
  end if;

  perform assert_accounts_not_controlled(array[p_from_account_id, p_to_account_id]);

  return post_journal_entry(
    p_org_id, p_transfer_date, p_memo,
    jsonb_build_array(
      jsonb_build_object('account_id', p_to_account_id, 'debit', p_amount, 'credit', 0),
      jsonb_build_object('account_id', p_from_account_id, 'debit', 0, 'credit', p_amount)
    ),
    'fund_transfer', null
  );
end;
$function$;

-- create_inventory_adjustment: inventory.adjust
CREATE OR REPLACE FUNCTION public.create_inventory_adjustment(p_org_id uuid, p_location_id uuid, p_adjustment_type text, p_adjustment_account_id uuid, p_adjustment_date date, p_reference_number text, p_description text, p_lines jsonb)
 RETURNS inventory_adjustments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_adjustment inventory_adjustments%rowtype;
  v_adjustment_number text;
  v_location_org uuid;
  v_account_org uuid;
  v_line jsonb;
  v_item_id uuid;
  v_item_org uuid;
  v_qty_on_hand_before numeric;
  v_current_avg_cost numeric;
  v_current_value_before numeric;
  v_new_qty numeric;
  v_new_value numeric;
  v_resulting_avg_cost numeric;
  v_value_diff numeric;
  v_qty_other_locations numeric;
  v_value_other_locations numeric;
  v_new_total_qty numeric;
  v_new_total_value numeric;
  v_total_value_diff numeric := 0;
begin
  perform assert_permission(p_org_id, 'inventory.adjust');

  if p_adjustment_type not in ('quantity', 'value', 'quantity_and_value') then
    raise exception 'invalid adjustment type: %', p_adjustment_type;
  end if;

  select org_id into v_location_org from locations where id = p_location_id;
  if v_location_org is distinct from p_org_id then
    raise exception 'location does not belong to this org';
  end if;

  select org_id into v_account_org from ledger_accounts where id = p_adjustment_account_id;
  if v_account_org is distinct from p_org_id then
    raise exception 'adjustment account does not belong to this org';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'an inventory adjustment must have at least one line item';
  end if;

  v_adjustment_number := next_document_number(p_org_id, 'inventory_adjustment', 'ADJ');

  insert into inventory_adjustments (
    org_id, adjustment_number, adjustment_type, location_id, adjustment_account_id,
    adjustment_date, reference_number, description, created_by
  )
  values (
    p_org_id, v_adjustment_number, p_adjustment_type, p_location_id, p_adjustment_account_id,
    coalesce(p_adjustment_date, current_date), p_reference_number, p_description, auth.uid()
  )
  returning * into v_adjustment;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := (v_line ->> 'item_id')::uuid;

    select org_id into v_item_org from items where id = v_item_id;
    if v_item_org is distinct from p_org_id then
      raise exception 'item does not belong to this org';
    end if;

    -- Serialize against a concurrent adjustment or supplier bill for the
    -- same item before reading anything cost-related.
    perform id from items where id = v_item_id for update;

    select coalesce(quantity, 0) into v_qty_on_hand_before
    from stock_levels where item_id = v_item_id and location_id = p_location_id;
    v_qty_on_hand_before := coalesce(v_qty_on_hand_before, 0);

    select avg_cost into v_current_avg_cost from items where id = v_item_id;
    v_current_value_before := v_qty_on_hand_before * v_current_avg_cost;

    if p_adjustment_type = 'quantity' then
      if v_line ->> 'new_qty' is null then
        raise exception 'quantity adjustment requires a new quantity for every line';
      end if;
      v_new_qty := (v_line ->> 'new_qty')::numeric;
      v_new_value := v_new_qty * v_current_avg_cost;
      v_resulting_avg_cost := v_current_avg_cost;
    else
      if v_line ->> 'new_value' is null then
        raise exception '% adjustment requires a new value for every line', p_adjustment_type;
      end if;
      v_new_value := (v_line ->> 'new_value')::numeric;

      if p_adjustment_type = 'quantity_and_value' then
        if v_line ->> 'new_qty' is null then
          raise exception 'quantity and value adjustment requires a new quantity for every line';
        end if;
        v_new_qty := (v_line ->> 'new_qty')::numeric;
      else
        v_new_qty := v_qty_on_hand_before;
      end if;

      select coalesce(sum(quantity), 0) into v_qty_other_locations
      from stock_levels where item_id = v_item_id;
      v_qty_other_locations := v_qty_other_locations - v_qty_on_hand_before;
      v_value_other_locations := v_qty_other_locations * v_current_avg_cost;

      v_new_total_qty := v_qty_other_locations + v_new_qty;
      v_new_total_value := v_value_other_locations + v_new_value;
      v_resulting_avg_cost := case when v_new_total_qty > 0 then v_new_total_value / v_new_total_qty else 0 end;
    end if;

    if v_new_qty < 0 then
      raise exception 'new quantity cannot be negative';
    end if;

    v_value_diff := v_new_value - v_current_value_before;

    insert into inventory_adjustment_items (
      adjustment_id, item_id, qty_on_hand_before, current_value_before,
      new_qty, new_value, resulting_avg_cost, value_diff
    )
    values (
      v_adjustment.id, v_item_id, v_qty_on_hand_before, v_current_value_before,
      v_new_qty, v_new_value, v_resulting_avg_cost, v_value_diff
    );

    -- Always insert a stock_movements row, even at a zero delta (a pure
    -- Value adjustment doesn't change quantity) -- the MAC replay only
    -- ever looks at stock_movements to find events, so a Value-only
    -- adjustment needs this as its anchor or the replay would have no
    -- way to find and re-apply its cost correction later.
    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (p_org_id, v_item_id, p_location_id, v_new_qty - v_qty_on_hand_before, 'adjustment', 'inventory_adjustment', v_adjustment.id, auth.uid());

    update items set avg_cost = v_resulting_avg_cost, updated_at = now() where id = v_item_id;

    v_total_value_diff := v_total_value_diff + v_value_diff;
  end loop;

  update inventory_adjustments set total_value_diff = v_total_value_diff where id = v_adjustment.id
  returning * into v_adjustment;

  if v_total_value_diff > 0 then
    perform post_journal_entry(
      p_org_id, v_adjustment.adjustment_date, 'Inventory adjustment ' || v_adjustment_number,
      jsonb_build_array(
        jsonb_build_object('account_id', get_or_create_default_account(p_org_id, 'Inventory', 'other_current_asset'), 'debit', v_total_value_diff, 'credit', 0),
        jsonb_build_object('account_id', p_adjustment_account_id, 'debit', 0, 'credit', v_total_value_diff)
      ),
      'inventory_adjustment', v_adjustment.id
    );
  elsif v_total_value_diff < 0 then
    perform post_journal_entry(
      p_org_id, v_adjustment.adjustment_date, 'Inventory adjustment ' || v_adjustment_number,
      jsonb_build_array(
        jsonb_build_object('account_id', p_adjustment_account_id, 'debit', -v_total_value_diff, 'credit', 0),
        jsonb_build_object('account_id', get_or_create_default_account(p_org_id, 'Inventory', 'other_current_asset'), 'debit', 0, 'credit', -v_total_value_diff)
      ),
      'inventory_adjustment', v_adjustment.id
    );
  end if;

  return v_adjustment;
end;
$function$;

-- create_invoice: invoices.create
CREATE OR REPLACE FUNCTION public.create_invoice(p_org_id uuid, p_customer_id uuid, p_due_date date, p_lines jsonb, p_notes text DEFAULT NULL::text)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoice invoices%rowtype;
  v_invoice_number text;
  v_subtotal numeric;
  v_customer_org uuid;
  v_line jsonb;
  v_item_id uuid;
  v_location_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_item_org uuid;
  v_location_org uuid;
  v_item_cost numeric;
  v_total_cogs numeric := 0;
begin
  perform assert_permission(p_org_id, 'invoices.create');

  if p_customer_id is null then
    raise exception 'an invoice requires a customer';
  end if;

  select org_id into v_customer_org from customers where id = p_customer_id;
  if v_customer_org is distinct from p_org_id then
    raise exception 'customer does not belong to this org';
  end if;

  if p_due_date is null then
    raise exception 'an invoice requires a due date';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'an invoice must have at least one line item';
  end if;

  select coalesce(sum((line ->> 'quantity')::numeric * (line ->> 'unit_price')::numeric), 0)
  into v_subtotal
  from jsonb_array_elements(p_lines) as line;

  v_invoice_number := next_document_number(p_org_id, 'invoice', 'INV');

  insert into invoices (org_id, invoice_number, customer_id, due_date, subtotal, total, notes, created_by)
  values (p_org_id, v_invoice_number, p_customer_id, p_due_date, v_subtotal, v_subtotal, p_notes, auth.uid())
  returning * into v_invoice;

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

    select org_id into v_location_org from locations where id = v_location_id;
    if v_location_org is distinct from p_org_id then
      raise exception 'location does not belong to this org';
    end if;

    insert into invoice_items (invoice_id, item_id, location_id, quantity, unit_price, unit_cost, line_total)
    values (v_invoice.id, v_item_id, v_location_id, v_quantity, v_unit_price, v_item_cost, v_quantity * v_unit_price);

    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (p_org_id, v_item_id, v_location_id, -v_quantity, 'sale', 'invoice', v_invoice.id, auth.uid());

    v_total_cogs := v_total_cogs + (v_quantity * coalesce(v_item_cost, 0));
  end loop;

  if v_subtotal > 0 then
    perform post_journal_entry(
      p_org_id, v_invoice.issue_date, 'Invoice ' || v_invoice_number,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Accounts Receivable', 'accounts_receivable'),
          'debit', v_subtotal, 'credit', 0
        ),
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Sales Income', 'income'),
          'debit', 0, 'credit', v_subtotal
        )
      ),
      'invoice', v_invoice.id
    );
  end if;

  if v_total_cogs > 0 then
    perform post_journal_entry(
      p_org_id, v_invoice.issue_date, 'COGS for invoice ' || v_invoice_number,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Cost of Goods Sold', 'cost_of_goods_sold'),
          'debit', v_total_cogs, 'credit', 0
        ),
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Inventory', 'other_current_asset'),
          'debit', 0, 'credit', v_total_cogs
        )
      ),
      'invoice_cogs', v_invoice.id
    );
  end if;

  return v_invoice;
end;
$function$;

-- create_journal_entry: journal.create
CREATE OR REPLACE FUNCTION public.create_journal_entry(p_org_id uuid, p_entry_date date, p_memo text, p_lines jsonb, p_reference_type text DEFAULT 'manual'::text, p_reference_id uuid DEFAULT NULL::uuid)
 RETURNS journal_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform assert_permission(p_org_id, 'journal.create');

  if p_lines is null or jsonb_array_length(p_lines) < 2 then
    raise exception 'a journal entry needs at least two lines';
  end if;

  perform assert_accounts_not_controlled(
    array(select (line ->> 'account_id')::uuid from jsonb_array_elements(p_lines) as line)
  );

  return post_journal_entry(p_org_id, p_entry_date, p_memo, p_lines, coalesce(p_reference_type, 'manual'), p_reference_id);
end;
$function$;

-- create_quotation: quotations.create
CREATE OR REPLACE FUNCTION public.create_quotation(p_org_id uuid, p_customer_id uuid, p_expiry_date date, p_lines jsonb, p_notes text DEFAULT NULL::text)
 RETURNS quotations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_quotation quotations%rowtype;
  v_quotation_number text;
  v_subtotal numeric;
  v_customer_org uuid;
  v_line jsonb;
  v_item_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_item_org uuid;
begin
  perform assert_permission(p_org_id, 'quotations.create');

  if p_customer_id is not null then
    select org_id into v_customer_org from customers where id = p_customer_id;
    if v_customer_org is distinct from p_org_id then
      raise exception 'customer does not belong to this org';
    end if;
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a quotation must have at least one line item';
  end if;

  select coalesce(sum((line ->> 'quantity')::numeric * (line ->> 'unit_price')::numeric), 0)
  into v_subtotal
  from jsonb_array_elements(p_lines) as line;

  v_quotation_number := next_document_number(p_org_id, 'quotation', 'QT');

  insert into quotations (org_id, quotation_number, customer_id, expiry_date, subtotal, total, notes, created_by)
  values (p_org_id, v_quotation_number, p_customer_id, p_expiry_date, v_subtotal, v_subtotal, p_notes, auth.uid())
  returning * into v_quotation;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := (v_line ->> 'item_id')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_price := (v_line ->> 'unit_price')::numeric;

    if v_quantity <= 0 then
      raise exception 'quantity must be positive';
    end if;
    if v_unit_price < 0 then
      raise exception 'unit price cannot be negative';
    end if;

    select org_id into v_item_org from items where id = v_item_id;
    if v_item_org is distinct from p_org_id then
      raise exception 'item does not belong to this org';
    end if;

    insert into quotation_items (quotation_id, item_id, quantity, unit_price, line_total)
    values (v_quotation.id, v_item_id, v_quantity, v_unit_price, v_quantity * v_unit_price);
  end loop;

  return v_quotation;
end;
$function$;

-- create_refund: refunds.create
CREATE OR REPLACE FUNCTION public.create_refund(p_org_id uuid, p_customer_id uuid, p_amount numeric, p_payment_method text, p_account_id uuid DEFAULT NULL::uuid, p_refund_date date DEFAULT CURRENT_DATE, p_reference_number text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS refunds
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_refund refunds%rowtype;
  v_refund_number text;
  v_customer_org uuid;
  v_pay_account_id uuid;
  v_account_org uuid;
begin
  perform assert_permission(p_org_id, 'refunds.create');

  select org_id into v_customer_org from customers where id = p_customer_id;
  if v_customer_org is distinct from p_org_id then
    raise exception 'customer does not belong to this org';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  if p_account_id is not null then
    select org_id into v_account_org from ledger_accounts where id = p_account_id;
    if v_account_org is distinct from p_org_id then
      raise exception 'account does not belong to this org';
    end if;
    v_pay_account_id := p_account_id;
  else
    v_pay_account_id := get_or_create_default_account(
      p_org_id, case when p_payment_method = 'cash' then 'Cash' else 'Bank' end, 'bank'
    );
  end if;

  v_refund_number := next_document_number(p_org_id, 'refund', 'REF');

  insert into refunds (org_id, refund_number, customer_id, refund_date, amount, payment_method, account_id, reference_number, notes, created_by)
  values (p_org_id, v_refund_number, p_customer_id, coalesce(p_refund_date, current_date), p_amount, p_payment_method, v_pay_account_id, p_reference_number, p_notes, auth.uid())
  returning * into v_refund;

  perform post_journal_entry(
    p_org_id, v_refund.refund_date, 'Refund ' || v_refund_number,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', get_or_create_default_account(p_org_id, 'Sales Income', 'income'),
        'debit', p_amount, 'credit', 0
      ),
      jsonb_build_object('account_id', v_pay_account_id, 'debit', 0, 'credit', p_amount)
    ),
    'refund', v_refund.id
  );

  return v_refund;
end;
$function$;

-- create_sales_receipt: sales.create
CREATE OR REPLACE FUNCTION public.create_sales_receipt(p_org_id uuid, p_customer_id uuid, p_payment_method text, p_lines jsonb)
 RETURNS sales_receipts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_receipt sales_receipts%rowtype;
  v_receipt_number text;
  v_subtotal numeric;
  v_line jsonb;
  v_item_id uuid;
  v_location_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_item_org uuid;
  v_location_org uuid;
  v_item_cost numeric;
  v_total_cogs numeric := 0;
begin
  perform assert_permission(p_org_id, 'sales.create');

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a sale must have at least one line item';
  end if;

  select coalesce(sum((line ->> 'quantity')::numeric * (line ->> 'unit_price')::numeric), 0)
  into v_subtotal
  from jsonb_array_elements(p_lines) as line;

  v_receipt_number := next_document_number(p_org_id, 'sales_receipt', 'SR');

  insert into sales_receipts (org_id, receipt_number, customer_id, payment_method, subtotal, total, created_by)
  values (p_org_id, v_receipt_number, p_customer_id, p_payment_method, v_subtotal, v_subtotal, auth.uid())
  returning * into v_receipt;

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

    select org_id into v_location_org from locations where id = v_location_id;
    if v_location_org is distinct from p_org_id then
      raise exception 'location does not belong to this org';
    end if;

    insert into sales_receipt_items (sales_receipt_id, item_id, location_id, quantity, unit_price, unit_cost, line_total)
    values (v_receipt.id, v_item_id, v_location_id, v_quantity, v_unit_price, v_item_cost, v_quantity * v_unit_price);

    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (p_org_id, v_item_id, v_location_id, -v_quantity, 'sale', 'sales_receipt', v_receipt.id, auth.uid());

    v_total_cogs := v_total_cogs + (v_quantity * coalesce(v_item_cost, 0));
  end loop;

  if v_subtotal > 0 then
    perform post_journal_entry(
      p_org_id, current_date, 'Sales receipt ' || v_receipt_number,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', get_or_create_default_account(
            p_org_id, case when p_payment_method = 'cash' then 'Cash' else 'Bank' end, 'bank'
          ),
          'debit', v_subtotal, 'credit', 0
        ),
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Sales Income', 'income'),
          'debit', 0, 'credit', v_subtotal
        )
      ),
      'sales_receipt', v_receipt.id
    );
  end if;

  if v_total_cogs > 0 then
    perform post_journal_entry(
      p_org_id, current_date, 'COGS for sales receipt ' || v_receipt_number,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Cost of Goods Sold', 'cost_of_goods_sold'),
          'debit', v_total_cogs, 'credit', 0
        ),
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Inventory', 'other_current_asset'),
          'debit', 0, 'credit', v_total_cogs
        )
      ),
      'sales_receipt_cogs', v_receipt.id
    );
  end if;

  return v_receipt;
end;
$function$;

-- create_stock_transfer: inventory.transfer
CREATE OR REPLACE FUNCTION public.create_stock_transfer(p_org_id uuid, p_item_id uuid, p_from_location_id uuid, p_to_location_id uuid, p_quantity numeric, p_transfer_date date, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item_org uuid;
  v_from_org uuid;
  v_to_org uuid;
  v_ref uuid := gen_random_uuid();
begin
  perform assert_permission(p_org_id, 'inventory.transfer');

  if p_from_location_id = p_to_location_id then
    raise exception 'from and to locations must differ';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be positive';
  end if;

  select org_id into v_item_org from items where id = p_item_id;
  select org_id into v_from_org from locations where id = p_from_location_id;
  select org_id into v_to_org from locations where id = p_to_location_id;
  if v_item_org is distinct from p_org_id or v_from_org is distinct from p_org_id or v_to_org is distinct from p_org_id then
    raise exception 'item or location does not belong to this org';
  end if;

  insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, notes, created_by)
  values (p_org_id, p_item_id, p_from_location_id, -p_quantity, 'transfer', 'transfer', v_ref, p_notes, auth.uid());
  insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, notes, created_by)
  values (p_org_id, p_item_id, p_to_location_id, p_quantity, 'transfer', 'transfer', v_ref, p_notes, auth.uid());
end;
$function$;

-- create_supplier_bill: supplier_bills.create
CREATE OR REPLACE FUNCTION public.create_supplier_bill(p_org_id uuid, p_supplier_id uuid, p_due_date date, p_lines jsonb, p_notes text DEFAULT NULL::text)
 RETURNS supplier_bills
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_bill supplier_bills%rowtype;
  v_bill_number text;
  v_subtotal numeric;
  v_supplier_org uuid;
  v_line jsonb;
  v_item_id uuid;
  v_location_id uuid;
  v_quantity numeric;
  v_unit_cost numeric;
  v_item_org uuid;
  v_location_org uuid;
begin
  perform assert_permission(p_org_id, 'supplier_bills.create');

  if p_supplier_id is null then
    raise exception 'a bill requires a supplier';
  end if;

  select org_id into v_supplier_org from suppliers where id = p_supplier_id;
  if v_supplier_org is distinct from p_org_id then
    raise exception 'supplier does not belong to this org';
  end if;

  if p_due_date is null then
    raise exception 'a bill requires a due date';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a bill must have at least one line item';
  end if;

  select coalesce(sum((line ->> 'quantity')::numeric * (line ->> 'unit_cost')::numeric), 0)
  into v_subtotal
  from jsonb_array_elements(p_lines) as line;

  v_bill_number := next_document_number(p_org_id, 'supplier_bill', 'BILL');

  insert into supplier_bills (org_id, bill_number, supplier_id, due_date, subtotal, total, notes, created_by)
  values (p_org_id, v_bill_number, p_supplier_id, p_due_date, v_subtotal, v_subtotal, p_notes, auth.uid())
  returning * into v_bill;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := (v_line ->> 'item_id')::uuid;
    v_location_id := (v_line ->> 'location_id')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_cost := (v_line ->> 'unit_cost')::numeric;

    if v_quantity <= 0 then
      raise exception 'quantity must be positive';
    end if;
    if v_unit_cost < 0 then
      raise exception 'unit cost cannot be negative';
    end if;

    select org_id into v_item_org from items where id = v_item_id;
    if v_item_org is distinct from p_org_id then
      raise exception 'item does not belong to this org';
    end if;

    select org_id into v_location_org from locations where id = v_location_id;
    if v_location_org is distinct from p_org_id then
      raise exception 'location does not belong to this org';
    end if;

    insert into supplier_bill_items (bill_id, item_id, location_id, quantity, unit_cost, line_total)
    values (v_bill.id, v_item_id, v_location_id, v_quantity, v_unit_cost, v_quantity * v_unit_cost);

    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (p_org_id, v_item_id, v_location_id, v_quantity, 'receive', 'supplier_bill', v_bill.id, auth.uid());

    perform recompute_item_avg_cost(v_item_id);
  end loop;

  if v_subtotal > 0 then
    perform post_journal_entry(
      p_org_id, v_bill.issue_date, 'Supplier bill ' || v_bill_number,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Inventory', 'other_current_asset'),
          'debit', v_subtotal, 'credit', 0
        ),
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Accounts Payable', 'accounts_payable'),
          'debit', 0, 'credit', v_subtotal
        )
      ),
      'supplier_bill', v_bill.id
    );
  end if;

  return v_bill;
end;
$function$;

-- next_item_sku: items.create
CREATE OR REPLACE FUNCTION public.next_item_sku(p_org_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_next integer;
begin
  perform assert_permission(p_org_id, 'items.create');

  insert into doc_number_counters (org_id, doc_type, next_number)
  values (p_org_id, 'item_sku', 100001)
  on conflict (org_id, doc_type) do nothing;

  update doc_number_counters
  set next_number = next_number + 1
  where org_id = p_org_id and doc_type = 'item_sku'
  returning next_number - 1 into v_next;

  return v_next::text;
end;
$function$;

-- receive_purchase_order_line: purchase_orders.receive
CREATE OR REPLACE FUNCTION public.receive_purchase_order_line(p_po_line_id uuid, p_location_id uuid, p_quantity numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_line purchase_order_lines%rowtype;
  v_po purchase_orders%rowtype;
  v_remaining_open boolean;
begin
  select * into v_line from purchase_order_lines where id = p_po_line_id;
  if not found then
    raise exception 'purchase_order_line % not found', p_po_line_id;
  end if;

  select * into v_po from purchase_orders where id = v_line.po_id;

  perform assert_permission(v_po.org_id, 'purchase_orders.receive');

  if p_quantity <= 0 then
    raise exception 'quantity must be positive';
  end if;

  update purchase_order_lines
  set quantity_received = quantity_received + p_quantity
  where id = p_po_line_id;

  insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
  values (v_po.org_id, v_line.item_id, p_location_id, p_quantity, 'receive', 'purchase_order_line', p_po_line_id, auth.uid());

  select exists (
    select 1 from purchase_order_lines
    where po_id = v_po.id and quantity_received < quantity_ordered
  ) into v_remaining_open;

  update purchase_orders
  set status = case when v_remaining_open then 'partially_received' else 'received' end,
      updated_at = now()
  where id = v_po.id;
end;
$function$;

-- record_deposit: customer_payments.deposit
CREATE OR REPLACE FUNCTION public.record_deposit(p_org_id uuid, p_account_id uuid, p_deposit_date date, p_memo text, p_payment_ids uuid[])
 RETURNS deposits
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_deposit deposits%rowtype;
  v_deposit_number text;
  v_total numeric;
  v_account_org uuid;
  v_requested_count integer;
  v_valid_count integer;
begin
  perform assert_permission(p_org_id, 'customer_payments.deposit');

  if p_payment_ids is null or array_length(p_payment_ids, 1) is null then
    raise exception 'select at least one payment to deposit';
  end if;
  v_requested_count := array_length(p_payment_ids, 1);

  select org_id into v_account_org from ledger_accounts where id = p_account_id;
  if v_account_org is distinct from p_org_id then
    raise exception 'account does not belong to this org';
  end if;

  select count(*) into v_valid_count
  from invoice_payments
  where id = any(p_payment_ids) and org_id = p_org_id and deposit_id is null;

  if v_valid_count <> v_requested_count then
    raise exception 'one or more payments are invalid, belong to another org, or are already deposited';
  end if;

  select coalesce(sum(amount), 0) into v_total from invoice_payments where id = any(p_payment_ids);

  v_deposit_number := next_document_number(p_org_id, 'deposit', 'DEP');

  insert into deposits (org_id, deposit_number, account_id, deposit_date, memo, total, created_by)
  values (p_org_id, v_deposit_number, p_account_id, p_deposit_date, p_memo, v_total, auth.uid())
  returning * into v_deposit;

  update invoice_payments set deposit_id = v_deposit.id where id = any(p_payment_ids);

  perform post_journal_entry(
    p_org_id, p_deposit_date, 'Deposit ' || v_deposit_number,
    jsonb_build_array(
      jsonb_build_object('account_id', p_account_id, 'debit', v_total, 'credit', 0),
      jsonb_build_object(
        'account_id', get_or_create_default_account(p_org_id, 'Undeposited Funds', 'other_current_asset'),
        'debit', 0, 'credit', v_total
      )
    ),
    'deposit', v_deposit.id
  );

  return v_deposit;
end;
$function$;

-- record_invoice_payment: customer_payments.receive
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
  select * into v_invoice from invoices where id = p_invoice_id;
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

  if v_new_amount_paid > v_invoice.total then
    raise exception 'payment of % exceeds remaining balance of %',
      p_amount, (v_invoice.total - v_invoice.amount_paid);
  end if;

  insert into invoice_payments (org_id, invoice_id, amount, payment_method, paid_at, notes, reference_number, created_by)
  values (v_invoice.org_id, p_invoice_id, p_amount, p_payment_method, coalesce(p_paid_at, now()), p_notes, p_reference_number, auth.uid())
  returning id into v_payment_id;

  update invoices
  set amount_paid = v_new_amount_paid,
      status = case
        when v_new_amount_paid >= total then 'paid'
        when v_new_amount_paid > 0 then 'partially_paid'
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

-- record_supplier_bill_payment: supplier_payments.create
CREATE OR REPLACE FUNCTION public.record_supplier_bill_payment(p_bill_id uuid, p_amount numeric, p_payment_method text, p_paid_at timestamp with time zone DEFAULT now(), p_notes text DEFAULT NULL::text, p_account_id uuid DEFAULT NULL::uuid, p_reference_number text DEFAULT NULL::text)
 RETURNS supplier_bills
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_bill supplier_bills%rowtype;
  v_new_amount_paid numeric;
  v_payment_id uuid;
  v_pay_account_id uuid;
  v_account_org uuid;
begin
  select * into v_bill from supplier_bills where id = p_bill_id;
  if not found then
    raise exception 'supplier bill % not found', p_bill_id;
  end if;

  perform assert_permission(v_bill.org_id, 'supplier_payments.create');

  if v_bill.status = 'void' then
    raise exception 'cannot record a payment against a voided bill';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'payment amount must be positive';
  end if;

  if p_account_id is not null then
    select org_id into v_account_org from ledger_accounts where id = p_account_id;
    if v_account_org is distinct from v_bill.org_id then
      raise exception 'account does not belong to this org';
    end if;
    v_pay_account_id := p_account_id;
  else
    v_pay_account_id := get_or_create_default_account(
      v_bill.org_id, case when p_payment_method = 'cash' then 'Cash' else 'Bank' end, 'bank'
    );
  end if;

  v_new_amount_paid := v_bill.amount_paid + p_amount;

  if v_new_amount_paid > v_bill.total then
    raise exception 'payment of % exceeds remaining balance of %',
      p_amount, (v_bill.total - v_bill.amount_paid);
  end if;

  insert into supplier_bill_payments (org_id, bill_id, amount, payment_method, paid_at, notes, reference_number, account_id, created_by)
  values (v_bill.org_id, p_bill_id, p_amount, p_payment_method, coalesce(p_paid_at, now()), p_notes, p_reference_number, v_pay_account_id, auth.uid())
  returning id into v_payment_id;

  update supplier_bills
  set amount_paid = v_new_amount_paid,
      status = case
        when v_new_amount_paid >= total then 'paid'
        when v_new_amount_paid > 0 then 'partially_paid'
        else 'unpaid'
      end,
      updated_at = now()
  where id = p_bill_id
  returning * into v_bill;

  perform post_journal_entry(
    v_bill.org_id, coalesce(p_paid_at, now())::date, 'Payment for supplier bill ' || v_bill.bill_number,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', get_or_create_default_account(v_bill.org_id, 'Accounts Payable', 'accounts_payable'),
        'debit', p_amount, 'credit', 0
      ),
      jsonb_build_object('account_id', v_pay_account_id, 'debit', 0, 'credit', p_amount)
    ),
    'supplier_bill_payment', v_payment_id
  );

  return v_bill;
end;
$function$;

-- void_credit_memo: credit_memos.void
CREATE OR REPLACE FUNCTION public.void_credit_memo(p_credit_memo_id uuid)
 RETURNS credit_memos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_credit_memo credit_memos%rowtype;
  v_line record;
begin
  select * into v_credit_memo from credit_memos where id = p_credit_memo_id;
  if not found then
    raise exception 'credit memo % not found', p_credit_memo_id;
  end if;

  perform assert_permission(v_credit_memo.org_id, 'credit_memos.void');

  if v_credit_memo.status = 'void' then
    raise exception 'credit memo is already void';
  end if;

  for v_line in select * from credit_memo_items where credit_memo_id = p_credit_memo_id
  loop
    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (v_credit_memo.org_id, v_line.item_id, v_line.location_id, -v_line.quantity, 'void', 'credit_memo', v_credit_memo.id, auth.uid());
  end loop;

  update credit_memos
  set status = 'void', updated_at = now()
  where id = p_credit_memo_id
  returning * into v_credit_memo;

  if v_credit_memo.total > 0 then
    perform post_journal_entry(
      v_credit_memo.org_id, current_date, 'Void credit memo ' || v_credit_memo.credit_memo_number,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', get_or_create_default_account(v_credit_memo.org_id, 'Accounts Receivable', 'accounts_receivable'),
          'debit', v_credit_memo.total, 'credit', 0
        ),
        jsonb_build_object(
          'account_id', get_or_create_default_account(v_credit_memo.org_id, 'Sales Income', 'income'),
          'debit', 0, 'credit', v_credit_memo.total
        )
      ),
      'credit_memo_void', v_credit_memo.id
    );
  end if;

  return v_credit_memo;
end;
$function$;

-- void_expense: expenses.void
CREATE OR REPLACE FUNCTION public.void_expense(p_expense_id uuid)
 RETURNS expenses
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_expense expenses%rowtype;
begin
  select * into v_expense from expenses where id = p_expense_id;
  if not found then
    raise exception 'expense % not found', p_expense_id;
  end if;

  perform assert_permission(v_expense.org_id, 'expenses.void');

  if v_expense.status = 'void' then
    raise exception 'expense is already void';
  end if;

  update expenses
  set status = 'void'
  where id = p_expense_id
  returning * into v_expense;

  perform post_journal_entry(
    v_expense.org_id, current_date, 'Void expense ' || v_expense.expense_number,
    jsonb_build_array(
      jsonb_build_object('account_id', v_expense.account_id, 'debit', v_expense.amount, 'credit', 0),
      jsonb_build_object('account_id', v_expense.category_account_id, 'debit', 0, 'credit', v_expense.amount)
    ),
    'expense_void', v_expense.id
  );

  return v_expense;
end;
$function$;

-- void_invoice: invoices.void
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

  if v_invoice.total > 0 then
    perform post_journal_entry(
      v_invoice.org_id, current_date, 'Void invoice ' || v_invoice.invoice_number,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', get_or_create_default_account(v_invoice.org_id, 'Accounts Receivable', 'accounts_receivable'),
          'debit', 0, 'credit', v_invoice.total
        ),
        jsonb_build_object(
          'account_id', get_or_create_default_account(v_invoice.org_id, 'Sales Income', 'income'),
          'debit', v_invoice.total, 'credit', 0
        )
      ),
      'invoice_void', v_invoice.id
    );
  end if;

  if v_total_cogs > 0 then
    perform post_journal_entry(
      v_invoice.org_id, current_date, 'Reverse COGS for voided invoice ' || v_invoice.invoice_number,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', get_or_create_default_account(v_invoice.org_id, 'Inventory', 'other_current_asset'),
          'debit', v_total_cogs, 'credit', 0
        ),
        jsonb_build_object(
          'account_id', get_or_create_default_account(v_invoice.org_id, 'Cost of Goods Sold', 'cost_of_goods_sold'),
          'debit', 0, 'credit', v_total_cogs
        )
      ),
      'invoice_void_cogs', v_invoice.id
    );
  end if;

  return v_invoice;
end;
$function$;

-- void_quotation: quotations.void
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

  update quotations
  set status = 'void', updated_at = now()
  where id = p_quotation_id
  returning * into v_quotation;

  return v_quotation;
end;
$function$;

-- void_supplier_bill: supplier_bills.void
CREATE OR REPLACE FUNCTION public.void_supplier_bill(p_bill_id uuid)
 RETURNS supplier_bills
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_bill supplier_bills%rowtype;
  v_line record;
  v_received_at timestamptz;
  v_item_name text;
begin
  select * into v_bill from supplier_bills where id = p_bill_id;
  if not found then
    raise exception 'supplier bill % not found', p_bill_id;
  end if;

  perform assert_permission(v_bill.org_id, 'supplier_bills.void');

  if v_bill.status = 'void' then
    raise exception 'bill is already void';
  end if;

  if v_bill.amount_paid > 0 then
    raise exception 'cannot void a bill with recorded payments';
  end if;

  select min(created_at) into v_received_at
  from stock_movements
  where reference_type = 'supplier_bill' and reference_id = p_bill_id and reason = 'receive';

  for v_line in select distinct item_id from supplier_bill_items where bill_id = p_bill_id
  loop
    if exists (
      select 1 from stock_movements
      where item_id = v_line.item_id and created_at > v_received_at
    ) then
      select name into v_item_name from items where id = v_line.item_id;
      raise exception 'cannot void this bill -- stock for "%" has moved since it was received, which would desync inventory valuation. Void immediately after a mistaken bill, before anything else touches that item.',
        coalesce(v_item_name, 'an item on this bill');
    end if;
  end loop;

  for v_line in select * from supplier_bill_items where bill_id = p_bill_id
  loop
    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (v_bill.org_id, v_line.item_id, v_line.location_id, -v_line.quantity, 'void', 'supplier_bill', v_bill.id, auth.uid());
  end loop;

  update supplier_bills
  set status = 'void', updated_at = now()
  where id = p_bill_id
  returning * into v_bill;

  if v_bill.total > 0 then
    perform post_journal_entry(
      v_bill.org_id, current_date, 'Void supplier bill ' || v_bill.bill_number,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', get_or_create_default_account(v_bill.org_id, 'Inventory', 'other_current_asset'),
          'debit', 0, 'credit', v_bill.total
        ),
        jsonb_build_object(
          'account_id', get_or_create_default_account(v_bill.org_id, 'Accounts Payable', 'accounts_payable'),
          'debit', v_bill.total, 'credit', 0
        )
      ),
      'supplier_bill_void', v_bill.id
    );
  end if;

  return v_bill;
end;
$function$;

