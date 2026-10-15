-- Credit memo returns now carry their cost, like a sale in reverse.
--
-- Before this, a credit memo put the goods back in stock and reversed the
-- revenue (Debit Sales Income / Credit AR), but the cost of those goods stayed
-- in Cost of Goods Sold and never went back into Inventory. Profit was
-- understated by the returned goods' cost, and the Inventory GL account fell
-- below the stock valuation (stock x avg_cost) by the same amount.
--
-- Now, mirroring create_invoice / void_invoice:
--   * each credit_memo_items line snapshots the item's current avg_cost into
--     unit_cost (NULL/0 = no cost basis, so no cost entry, as with sales);
--   * create_credit_memo posts a second entry, Debit Inventory / Credit Cost
--     of Goods Sold, for sum(quantity * unit_cost)  ('credit_memo_cogs');
--   * void_credit_memo reverses it from the stored snapshot, never the item's
--     since-changed avg_cost  ('credit_memo_void_cogs').
--
-- Credit memos aren't linked to the original invoice, so the goods come back
-- at the current moving-average cost (the usual rule for unlinked returns).
-- Returning units at the current average leaves the average unchanged, so the
-- MAC replay treats a return like an invoice void (stock up, cost unchanged)
-- and a credit memo void like a sale (stock down, cost unchanged). Including
-- them keeps the replay's running stock in step with stock_levels, so later
-- supplier bills blend against the right quantity.
--
-- No backfill: no org has a credit memo yet (checked before writing this).

alter table public.credit_memo_items
  add column unit_cost numeric;

comment on column public.credit_memo_items.unit_cost is
  'items.avg_cost at the moment of the return; NULL = no cost data. void_credit_memo reverses with this, not the current avg_cost.';

create or replace function public.create_credit_memo(p_org_id uuid, p_customer_id uuid, p_lines jsonb, p_notes text default null)
returns credit_memos
language plpgsql
security definer
set search_path = public
as $$
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
  v_item_cost numeric;
  v_total_cost numeric := 0;
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

    select org_id, avg_cost into v_item_org, v_item_cost from items where id = v_item_id;
    if v_item_org is distinct from p_org_id then
      raise exception 'item does not belong to this org';
    end if;

    select org_id into v_location_org from locations where id = v_location_id;
    if v_location_org is distinct from p_org_id then
      raise exception 'location does not belong to this org';
    end if;

    insert into credit_memo_items (credit_memo_id, item_id, location_id, quantity, unit_price, unit_cost, line_total)
    values (v_credit_memo.id, v_item_id, v_location_id, v_quantity, v_unit_price, v_item_cost, v_quantity * v_unit_price);

    -- Positive: goods physically coming back, same direction as
    -- receive_purchase_order_line/create_supplier_bill.
    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (p_org_id, v_item_id, v_location_id, v_quantity, 'return', 'credit_memo', v_credit_memo.id, auth.uid());

    v_total_cost := v_total_cost + (v_quantity * coalesce(v_item_cost, 0));
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

  if v_total_cost > 0 then
    perform post_journal_entry(
      p_org_id, v_credit_memo.issue_date, 'Cost of returns for credit memo ' || v_credit_memo_number,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Inventory', 'other_current_asset'),
          'debit', v_total_cost, 'credit', 0
        ),
        jsonb_build_object(
          'account_id', get_or_create_default_account(p_org_id, 'Cost of Goods Sold', 'cost_of_goods_sold'),
          'debit', 0, 'credit', v_total_cost
        )
      ),
      'credit_memo_cogs', v_credit_memo.id
    );
  end if;

  return v_credit_memo;
end;
$$;

create or replace function public.void_credit_memo(p_credit_memo_id uuid)
returns credit_memos
language plpgsql
security definer
set search_path = public
as $$
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

  for v_line in select * from credit_memo_items where credit_memo_id = p_credit_memo_id
  loop
    insert into stock_movements (org_id, item_id, location_id, quantity_delta, reason, reference_type, reference_id, created_by)
    values (v_credit_memo.org_id, v_line.item_id, v_line.location_id, -v_line.quantity, 'void', 'credit_memo', v_credit_memo.id, auth.uid());

    v_total_cost := v_total_cost + (v_line.quantity * coalesce(v_line.unit_cost, 0));
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

  if v_total_cost > 0 then
    perform post_journal_entry(
      v_credit_memo.org_id, current_date, 'Reverse cost of returns for voided credit memo ' || v_credit_memo.credit_memo_number,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', get_or_create_default_account(v_credit_memo.org_id, 'Cost of Goods Sold', 'cost_of_goods_sold'),
          'debit', v_total_cost, 'credit', 0
        ),
        jsonb_build_object(
          'account_id', get_or_create_default_account(v_credit_memo.org_id, 'Inventory', 'other_current_asset'),
          'debit', 0, 'credit', v_total_cost
        )
      ),
      'credit_memo_void_cogs', v_credit_memo.id
    );
  end if;

  return v_credit_memo;
end;
$$;

-- MAC replay: credit memo returns and their voids now count toward the
-- running stock. Neither changes the cost (the loop only re-costs on supplier
-- bills and inventory adjustments), exactly like invoice voids and sales.
create or replace function public.recompute_item_avg_cost(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
    end if;

    v_running_stock := v_running_stock + v_row.quantity_delta;
  end loop;

  update items set avg_cost = v_running_cost where id = p_item_id;
end;
$$;

-- The two new auto-postings are dated by the database (issue_date /
-- current_date), so they get the same org-timezone treatment as the rest.
create or replace function public.journal_entry_is_system_dated(p_reference_type text)
returns boolean
language sql
immutable
as $$
  select p_reference_type in (
    'sales_receipt', 'sales_receipt_cogs', 'invoice', 'invoice_cogs', 'invoice_void', 'invoice_void_cogs',
    'supplier_bill', 'supplier_bill_void', 'credit_memo', 'credit_memo_void',
    'credit_memo_cogs', 'credit_memo_void_cogs', 'expense_void', 'inventory_cutover'
  );
$$;

-- Reset Data: wiping credit memos also removes their cost entries (otherwise
-- they would survive as orphans referencing deleted credit memos). Live
-- definition, only the credit_memos category's reference_type list changed.
CREATE OR REPLACE FUNCTION public.reset_org_data(p_org_id uuid, p_categories text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_table text;
  v_constraint text;
  v_item_id uuid;
begin
  if org_role(p_org_id) <> 'owner' then
    raise exception 'only the owner can reset organization data';
  end if;

  if p_categories is null or array_length(p_categories, 1) is null then
    raise exception 'select at least one category to reset';
  end if;

  begin
    if 'sales_receipts' = any(p_categories) then
      delete from sales_receipts where org_id = p_org_id;
      delete from stock_movements where org_id = p_org_id and reference_type = 'sales_receipt';
      delete from journal_entries where org_id = p_org_id and reference_type in ('sales_receipt', 'sales_receipt_cogs');
    end if;

    if 'invoices' = any(p_categories) then
      delete from deposits where org_id = p_org_id;
      delete from invoices where org_id = p_org_id;
      delete from stock_movements where org_id = p_org_id and reference_type = 'invoice';
      delete from journal_entries where org_id = p_org_id and reference_type in ('invoice', 'invoice_payment', 'invoice_void', 'invoice_cogs', 'invoice_void_cogs', 'deposit');
    end if;

    if 'supplier_bills' = any(p_categories) then
      delete from supplier_bills where org_id = p_org_id;
      delete from stock_movements where org_id = p_org_id and reference_type = 'supplier_bill';
      delete from journal_entries where org_id = p_org_id and reference_type in ('supplier_bill', 'supplier_bill_payment', 'supplier_bill_void');
    end if;

    if 'purchase_orders' = any(p_categories) then
      delete from purchase_orders where org_id = p_org_id;
      delete from stock_movements where org_id = p_org_id and reference_type = 'purchase_order_line';
    end if;

    if 'quotations' = any(p_categories) then
      delete from quotations where org_id = p_org_id;
    end if;

    if 'credit_memos' = any(p_categories) then
      delete from credit_memos where org_id = p_org_id;
      delete from stock_movements where org_id = p_org_id and reference_type = 'credit_memo';
      delete from journal_entries where org_id = p_org_id and reference_type in ('credit_memo', 'credit_memo_void', 'credit_memo_cogs', 'credit_memo_void_cogs');
    end if;

    if 'refunds' = any(p_categories) then
      delete from refunds where org_id = p_org_id;
      delete from journal_entries where org_id = p_org_id and reference_type = 'refund';
    end if;

    if 'expenses' = any(p_categories) then
      delete from expenses where org_id = p_org_id;
      delete from journal_entries where org_id = p_org_id and reference_type in ('expense', 'expense_void');
    end if;

    if 'inventory_activity' = any(p_categories) then
      delete from inventory_adjustments where org_id = p_org_id;
      delete from stock_movements where org_id = p_org_id and reason in ('transfer', 'adjustment');
      delete from journal_entries where org_id = p_org_id and reference_type = 'inventory_adjustment';
    end if;

    if 'ledger_entries' = any(p_categories) then
      delete from journal_entries where org_id = p_org_id and reference_type in ('manual', 'fund_transfer', 'inventory_cutover');
    end if;

    -- Rebuild stock_levels from whatever stock_movements remain -- correct
    -- under any partial selection, not just a full reset.
    delete from stock_levels where org_id = p_org_id;
    insert into stock_levels (org_id, item_id, location_id, quantity)
    select org_id, item_id, location_id, sum(quantity_delta)
    from stock_movements
    where org_id = p_org_id
    group by org_id, item_id, location_id;

    if 'items' = any(p_categories) then
      delete from items where org_id = p_org_id;
    end if;

    if 'customers' = any(p_categories) then
      delete from customers where org_id = p_org_id;
    end if;

    if 'suppliers' = any(p_categories) then
      delete from suppliers where org_id = p_org_id;
    end if;

    if 'locations' = any(p_categories) then
      delete from locations where org_id = p_org_id;
    end if;

    if 'reference_data' = any(p_categories) then
      delete from categories where org_id = p_org_id;
      delete from brands where org_id = p_org_id;
      delete from units_of_measure where org_id = p_org_id;
      delete from areas where org_id = p_org_id;
    end if;

    if 'chart_of_accounts' = any(p_categories) then
      delete from ledger_accounts where org_id = p_org_id;
    end if;
  exception
    when foreign_key_violation then
      get stacked diagnostics v_table = table_name, v_constraint = constraint_name;
      raise exception 'Cannot complete this reset -- some selected data is still referenced by "%" (constraint %). Include the related category in your selection too.',
        coalesce(v_table, 'another table'), coalesce(v_constraint, 'unknown');
  end;

  -- Rebuild avg_cost for every surviving item, same "replay whatever
  -- history remains" idiom as the stock_levels rebuild above.
  for v_item_id in select id from items where org_id = p_org_id
  loop
    perform recompute_item_avg_cost(v_item_id);
  end loop;

  -- Reset document-number counters for any doc_type whose table is now
  -- completely empty for this org -- safe under partial selection, won't
  -- collide with a surviving document's number.
  if not exists (select 1 from sales_receipts where org_id = p_org_id) then
    delete from doc_number_counters where org_id = p_org_id and doc_type = 'sales_receipt';
  end if;
  if not exists (select 1 from invoices where org_id = p_org_id) then
    delete from doc_number_counters where org_id = p_org_id and doc_type = 'invoice';
  end if;
  if not exists (select 1 from supplier_bills where org_id = p_org_id) then
    delete from doc_number_counters where org_id = p_org_id and doc_type = 'supplier_bill';
  end if;
  if not exists (select 1 from quotations where org_id = p_org_id) then
    delete from doc_number_counters where org_id = p_org_id and doc_type = 'quotation';
  end if;
  if not exists (select 1 from credit_memos where org_id = p_org_id) then
    delete from doc_number_counters where org_id = p_org_id and doc_type = 'credit_memo';
  end if;
  if not exists (select 1 from refunds where org_id = p_org_id) then
    delete from doc_number_counters where org_id = p_org_id and doc_type = 'refund';
  end if;
  if not exists (select 1 from expenses where org_id = p_org_id) then
    delete from doc_number_counters where org_id = p_org_id and doc_type = 'expense';
  end if;
  if not exists (select 1 from deposits where org_id = p_org_id) then
    delete from doc_number_counters where org_id = p_org_id and doc_type = 'deposit';
  end if;
  if not exists (select 1 from inventory_adjustments where org_id = p_org_id) then
    delete from doc_number_counters where org_id = p_org_id and doc_type = 'inventory_adjustment';
  end if;
  if not exists (select 1 from journal_entries where org_id = p_org_id) then
    delete from doc_number_counters where org_id = p_org_id and doc_type = 'journal_entry';
  end if;
end;
$function$;
