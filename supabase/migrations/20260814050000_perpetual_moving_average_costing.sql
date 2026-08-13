-- Perpetual Moving Average Costing (MAC). Replaces
-- item_average_purchase_price (a naive lifetime-weighted-average view that
-- ignores anything already sold) with a real perpetual MAC: items.avg_cost
-- is a stored, sequentially-maintained value, updated only by supplier
-- bills, and read (never written) by sales to snapshot each sale's COGS.
--
-- This requires capitalizing purchases as an Inventory asset instead of
-- expensing them immediately to "Purchases" -- expensing the full purchase
-- AND expensing COGS at sale time would double-count. See CLAUDE.md for
-- the full design rationale (this is a deliberate, necessary consequence
-- of true MAC, not scope creep).

-- =========================================================================
-- Schema: items.avg_cost is a deliberate, narrow exception to this
-- codebase's "derive, don't store" convention -- directly parallel to the
-- one existing precedent, stock_levels.quantity (fast reads, single
-- controlled writer). Unlike stock_levels there's no simple trigger, since
-- the MAC formula is inherently sequential/order-dependent; it's written
-- only by recompute_item_avg_cost() below.
--
-- invoice_items.unit_cost / sales_receipt_items.unit_cost snapshot the
-- item's avg_cost at the moment of that specific sale (independent of
-- unit_price, the selling price) so historical P&L stays accurate as
-- avg_cost keeps moving after the sale. Nullable, not "not null default
-- 0" -- existing historical rows get real NULL (no cost data available),
-- never a misleading 0. New rows going forward always get a real value.
-- =========================================================================

alter table public.items add column avg_cost numeric not null default 0;
alter table public.invoice_items add column unit_cost numeric;
alter table public.sales_receipt_items add column unit_cost numeric;

-- =========================================================================
-- recompute_item_avg_cost: full replay of an item's stock_movements,
-- maintaining a running (stock, cost) pair. Deliberately a pure function
-- of the append-only event log -- no live join to supplier_bills.status --
-- because an earlier version of this design that excluded a bill's
-- receiving event once the bill was later voided made the function
-- retroactive (voiding an old bill would silently rewrite the cost math of
-- every purchase since), which both breaks this codebase's "corrections
-- are a new entry, never a rewrite" convention and isn't something a user
-- could ever observe or audit. Instead, both a receive AND its later void
-- compensating row are honored as literal history, in the order they
-- happened.
--
-- Only these stock_movements rows affect the (stock, cost) replay:
--   - reference_type='supplier_bill', quantity_delta > 0 (a genuine
--     receipt): applies the moving-average formula.
--   - reference_type='supplier_bill', quantity_delta < 0 (a bill's void
--     compensating row): stock decreases, no cost impact (mirrors a sale).
--   - reason='sale' (sales_receipt or invoice): stock decreases, no cost
--     impact -- the explicit rule that selling never changes avg_cost.
--   - reason='void', reference_type='invoice' (a sale reversal): stock
--     increases, no cost impact -- mirrors undoing a sale.
-- Deliberately NOT replayed at all: adjustments, transfers,
-- reason='return' (credit memo returns), and reference_type=
-- 'purchase_order_line' (the old direct-PO-receiving path, which has
-- always had zero financial modeling per CLAUDE.md). Their stock still
-- updates stock_levels normally -- they're just invisible to *cost*,
-- matching this pass's explicit scope (only Supplier Bills affect cost,
-- only Invoices/Sales Receipts consume it). This means the replay's
-- internal stock counter can diverge from real stock_levels for items
-- with heavy adjustment/return/PO-direct-receive activity -- an accepted,
-- documented limitation, not a bug.
--
-- Takes a SELECT ... FOR UPDATE lock on the item row first, to serialize
-- concurrent recomputes for the same item (this is a read-replay-then-
-- write, not an atomic increment like stock_levels' trigger, so it needs
-- an explicit lock to avoid a lost-update race between two concurrent
-- supplier bills for the same item).
-- =========================================================================

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
      )
    order by created_at, id
  loop
    if v_row.reference_type = 'supplier_bill' and v_row.quantity_delta > 0 then
      -- Aggregate rather than pick one line: if the same item appears
      -- twice in one bill (schema allows it, no unique constraint), a
      -- naive "limit 1" lookup would silently discard one line's real
      -- cost. This blended cost is mathematically exact per movement row
      -- since the weighted-average formula is linear.
      select sum(quantity * unit_cost) / nullif(sum(quantity), 0)
      into v_blended_cost
      from supplier_bill_items
      where bill_id = v_row.reference_id and item_id = p_item_id;

      v_running_stock := greatest(v_running_stock, 0);
      v_running_cost := ((v_running_stock * v_running_cost) + (v_row.quantity_delta * coalesce(v_blended_cost, 0)))
                         / (v_running_stock + v_row.quantity_delta);
    end if;

    v_running_stock := v_running_stock + v_row.quantity_delta;
  end loop;

  update items set avg_cost = v_running_cost where id = p_item_id;
end;
$$;

-- =========================================================================
-- create_supplier_bill: Debit "Inventory" (new default account,
-- other_current_asset) / Credit Accounts Payable -- was Debit "Purchases"
-- (expense). Capitalizing the purchase instead of expensing it immediately
-- is what makes COGS-at-sale-time correct instead of double-counted.
-- "Purchases" stops being auto-posted-to by this RPC; it still exists and
-- remains manually usable via Fiscal Daybook for anything else. Each
-- line's stock_movements insert is followed by a recompute of that item's
-- avg_cost.
-- =========================================================================

create or replace function public.create_supplier_bill(
  p_org_id uuid,
  p_supplier_id uuid,
  p_due_date date,
  p_lines jsonb,
  p_notes text default null
)
returns public.supplier_bills
language plpgsql
security definer
set search_path = public
as $$
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
  if not is_org_member(p_org_id) then
    raise exception 'not a member of this org';
  end if;

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
$$;

-- =========================================================================
-- void_supplier_bill: reversal now credits Inventory (was Purchases).
-- Gains a stock-sufficiency guard: blocked if any OTHER stock_movements
-- row exists for any item on this bill, timestamped after the bill's own
-- receiving movement -- i.e. voiding is only allowed if literally nothing
-- has touched that item's stock since. Stricter than "just don't let
-- stock go negative": once units are blended into a moving average, a
-- later void can't cleanly attribute cost back to just this one bill (MAC
-- is deliberately batch-blind) without either a mismatched reversal or a
-- variance line this app doesn't model. So voiding becomes a narrow
-- "catch it immediately" tool, consistent with void_invoice already being
-- narrow (blocked once any payment exists). Given the guard, the reversal
-- is always an exact dollar-for-dollar undo -- no recompute_item_avg_cost
-- call needed, since nothing could have changed the average in that
-- window.
-- =========================================================================

create or replace function public.void_supplier_bill(p_bill_id uuid)
returns public.supplier_bills
language plpgsql
security definer
set search_path = public
as $$
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

  if org_role(v_bill.org_id) not in ('owner', 'admin') then
    raise exception 'only owners/admins can void a supplier bill';
  end if;

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
$$;

-- =========================================================================
-- create_invoice / create_sales_receipt: each line now snapshots the
-- item's CURRENT avg_cost (a plain select, not a replay -- it's always
-- kept current by supplier bills, and sales never change it) onto the line
-- item's unit_cost, and accumulates total COGS across the sale. After the
-- existing revenue entry (unchanged, still only posted if subtotal > 0), a
-- second, separate journal entry posts Debit Cost of Goods Sold / Credit
-- Inventory, only if total COGS > 0 (same zero-guard pattern used
-- everywhere else, since journal_lines rejects a zero-value line). Its
-- entry_date is pinned to exactly match the revenue entry's date so
-- Revenue and COGS always land in the same P&L period.
-- =========================================================================

create or replace function public.create_invoice(
  p_org_id uuid,
  p_customer_id uuid,
  p_due_date date,
  p_lines jsonb,
  p_notes text default null
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
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
  if not is_org_member(p_org_id) then
    raise exception 'not a member of this org';
  end if;

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
$$;

create or replace function public.create_sales_receipt(
  p_org_id uuid,
  p_customer_id uuid,
  p_payment_method text,
  p_lines jsonb
)
returns public.sales_receipts
language plpgsql
security definer
set search_path = public
as $$
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
  if not is_org_member(p_org_id) then
    raise exception 'not a member of this org';
  end if;

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
$$;

-- =========================================================================
-- void_invoice: in addition to the existing stock and revenue reversal,
-- now also reverses the COGS entry -- computed from the invoice's OWN
-- stored snapshot invoice_items.unit_cost (not the item's possibly-since-
-- changed current avg_cost, which is exactly why the snapshot column
-- exists). Does not call recompute_item_avg_cost: per the explicit rule,
-- sales (and undoing sales) never affect avg_cost, only purchases do.
-- =========================================================================

create or replace function public.void_invoice(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice invoices%rowtype;
  v_line record;
  v_total_cogs numeric := 0;
begin
  select * into v_invoice from invoices where id = p_invoice_id;
  if not found then
    raise exception 'invoice % not found', p_invoice_id;
  end if;

  if org_role(v_invoice.org_id) not in ('owner', 'admin') then
    raise exception 'only owners/admins can void an invoice';
  end if;

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
$$;

-- =========================================================================
-- Control account guardrail extension: Inventory's GL balance is supposed
-- to reconcile to stock_levels * avg_cost, maintained only by the RPCs
-- above -- exactly the risk is_control_account (20260814040000) was built
-- for. Extend the auto-flag trigger to also match "Inventory" by name,
-- alongside the existing "Undeposited Funds" match, blocking it from
-- manual Journal Entries and Fund Transfers the same way. Cost of Goods
-- Sold doesn't need this -- it's a flow/expense account with no balance to
-- protect, same category as Sales Income/Purchases.
-- =========================================================================

create or replace function public.sync_control_account_flag()
returns trigger
language plpgsql
as $$
begin
  if new.name in ('Undeposited Funds', 'Inventory') then
    new.is_control_account := true;
  end if;
  return new;
end;
$$;

update public.ledger_accounts set is_control_account = true where name = 'Inventory';

-- Update the guard's error message to name Inventory too (it was
-- previously written only for the three Stage-3 control accounts).
create or replace function public.assert_accounts_not_controlled(p_account_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from ledger_accounts
    where id = any(p_account_ids)
      and (is_control_account or account_type in ('accounts_receivable', 'accounts_payable'))
  ) then
    raise exception 'Undeposited Funds, Accounts Receivable, Accounts Payable, and Inventory can''t be adjusted via a manual journal entry or fund transfer -- they''re kept in sync automatically by the RPCs that own them (Receive Payment, Pay Bills, Record Deposit, and Supplier Bills/Invoices/Sales Receipts respectively). Adjust something else instead.';
  end if;
end;
$$;

-- =========================================================================
-- Reset Data integration: mirrors the existing "rebuild stock_levels from
-- surviving stock_movements" step with an analogous avg_cost rebuild, so a
-- partial reset (e.g. wiping Supplier Bills but keeping Items) doesn't
-- leave avg_cost stale.
-- =========================================================================

create or replace function public.reset_org_data(
  p_org_id uuid,
  p_categories text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
      delete from journal_entries where org_id = p_org_id and reference_type in ('credit_memo', 'credit_memo_void');
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
      delete from stock_movements where org_id = p_org_id and reason in ('transfer', 'adjustment');
    end if;

    if 'ledger_entries' = any(p_categories) then
      -- inventory_cutover included here (not its own category): it's a
      -- one-time administrative entry from the MAC migration, not a
      -- document type, and without a cleanup path a Chart of Accounts
      -- wipe would permanently fail with a foreign_key_violation once one
      -- exists (journal_lines still referencing the account being deleted).
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
  if not exists (select 1 from journal_entries where org_id = p_org_id) then
    delete from doc_number_counters where org_id = p_org_id and doc_type = 'journal_entry';
  end if;
end;
$$;

-- =========================================================================
-- One-time backfill for real historical data already in this app's live
-- orgs. Does NOT backfill invoice_items/sales_receipt_items.unit_cost on
-- existing rows (left NULL) -- void_invoice only works pre-payment, so
-- genuinely old invoices are almost certainly already paid and unvoidable,
-- meaning a replay-per-historical-sale-line backfill would mostly serve
-- cosmetic old tooltips, not worth the cost on a live ledger. Does NOT
-- retroactively post COGS into historical P&L periods either -- mass-
-- backdating journal entries into a live ledger is exactly what the
-- append-only convention exists to prevent.
-- =========================================================================

-- 1. Seed avg_cost for every item with any purchase history.
do $$
declare
  v_item_id uuid;
begin
  for v_item_id in select distinct item_id from supplier_bill_items
  loop
    perform recompute_item_avg_cost(v_item_id);
  end loop;
end $$;

-- 2. Cutover entry per org: Debit Inventory / Credit Purchases for the
-- value of whatever stock is currently on hand, dated today (not
-- backdated). Standard practice for an expense-method -> perpetual-
-- costing conversion: seeds the new Inventory account to a reconciled
-- balance and reduces "Purchases" by exactly the value of what's still
-- unsold, without touching any past P&L period's reported numbers.
do $$
declare
  v_org record;
  v_total_value numeric;
begin
  for v_org in select id from orgs
  loop
    select coalesce(sum(sl.quantity * i.avg_cost), 0)
    into v_total_value
    from stock_levels sl
    join items i on i.id = sl.item_id
    where sl.org_id = v_org.id and sl.quantity > 0 and i.avg_cost > 0;

    if v_total_value > 0 then
      perform post_journal_entry(
        v_org.id, current_date,
        'Perpetual costing cutover -- capitalize existing on-hand inventory',
        jsonb_build_array(
          jsonb_build_object(
            'account_id', get_or_create_default_account(v_org.id, 'Inventory', 'other_current_asset'),
            'debit', v_total_value, 'credit', 0
          ),
          jsonb_build_object(
            'account_id', get_or_create_default_account(v_org.id, 'Purchases', 'expense'),
            'debit', 0, 'credit', v_total_value
          )
        ),
        'inventory_cutover', null
      );
    end if;
  end loop;
end $$;

-- =========================================================================
-- item_average_purchase_price is fully superseded by items.avg_cost.
-- =========================================================================

drop view if exists public.item_average_purchase_price;
