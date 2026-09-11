-- Real Inventory Adjustment: replaces the old bare quantity-tweak modal
-- (AdjustStockModal, plain stock_movements insert, zero ledger impact)
-- with a proper document: three adjustment modes (Quantity / Value /
-- Quantity and Value), a chosen Adjustment Account the value swing posts
-- against, and full integration with Perpetual Moving Average Costing --
-- a Value/Quantity&Value adjustment changes items.avg_cost, and that
-- change must survive the next recompute_item_avg_cost replay (triggered
-- by a later supplier bill) instead of being silently erased.
--
-- Design note: adjustments are folded directly into the existing replay
-- as one more event type, rather than a "reset point/seed" mechanism.
-- The original seed design was reviewed and found to (a) use a single
-- location's new_qty as an item-wide total, corrupting avg_cost for any
-- multi-location item, and (b) rely on created_at as a hard cutoff
-- boundary, which is not a true happens-before guarantee under
-- concurrent transactions and could double-count or permanently drop a
-- movement depending on commit order. Folding into the replay preserves
-- the engine's "pure function of the append-only log, safe to call from
-- anywhere, last-call-wins, self-healing" property instead of trading it
-- away.

create table public.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  adjustment_number text not null,
  adjustment_type text not null check (adjustment_type in ('quantity', 'value', 'quantity_and_value')),
  location_id uuid not null references public.locations (id),
  adjustment_account_id uuid not null references public.ledger_accounts (id),
  adjustment_date date not null default current_date,
  reference_number text,
  description text,
  total_value_diff numeric not null default 0,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create unique index inventory_adjustments_org_number_idx on public.inventory_adjustments (org_id, adjustment_number);
create index inventory_adjustments_org_created_at_idx on public.inventory_adjustments (org_id, created_at desc);

alter table public.inventory_adjustments enable row level security;

create policy "org members can select inventory adjustments"
  on public.inventory_adjustments for select
  using (is_org_member(org_id));

-- No insert/update/delete policy: written only via create_inventory_adjustment below.

-- Line-item child table exception (CLAUDE.md section 3): no own org_id,
-- scoped via EXISTS against the parent. unique(adjustment_id, item_id) --
-- unlike supplier_bill_items, an adjustment correcting the same item
-- twice in one physical count makes no business sense, so this is
-- enforced rather than needing a blended-cost lookup like supplier bills do.
create table public.inventory_adjustment_items (
  id uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null references public.inventory_adjustments (id) on delete cascade,
  item_id uuid not null references public.items (id),
  qty_on_hand_before numeric not null,
  current_value_before numeric not null,
  new_qty numeric not null,
  new_value numeric not null,
  resulting_avg_cost numeric not null,
  value_diff numeric not null,
  created_at timestamptz not null default now(),
  unique (adjustment_id, item_id)
);

create index inventory_adjustment_items_adjustment_id_idx on public.inventory_adjustment_items (adjustment_id);
create index inventory_adjustment_items_item_id_idx on public.inventory_adjustment_items (item_id);

alter table public.inventory_adjustment_items enable row level security;

create policy "org members can select inventory adjustment items"
  on public.inventory_adjustment_items for select
  using (
    exists (
      select 1 from inventory_adjustments ia
      where ia.id = inventory_adjustment_items.adjustment_id and is_org_member(ia.org_id)
    )
  );

-- =========================================================================
-- create_inventory_adjustment: atomic RPC, same shape as create_credit_memo
-- / create_expense (membership check, per-line org validation,
-- next_document_number, insert header+lines, conditional
-- post_journal_entry). Each line takes a lock on its item row before
-- reading avg_cost/stock_levels (same discipline as
-- recompute_item_avg_cost), so a concurrent adjustment or supplier bill
-- on the same item can't interleave.
--
-- p_lines: [{item_id, new_qty, new_value}, ...]. new_qty is required for
-- 'quantity'/'quantity_and_value' (ignored for 'value', which keeps the
-- current on-hand quantity); new_value is required for
-- 'value'/'quantity_and_value' (computed for 'quantity' as
-- new_qty * current_avg_cost, since a pure quantity correction doesn't
-- change the per-unit cost -- exactly like a sale/return).
--
-- resulting_avg_cost is computed org-wide, not just for this location,
-- for the value-affecting types: an adjustment document is scoped to one
-- location, but items.avg_cost is a single item-wide rate, so a
-- revaluation at one location must blend in whatever's still on hand,
-- untouched, at every other location.
-- =========================================================================

create or replace function public.create_inventory_adjustment(
  p_org_id uuid,
  p_location_id uuid,
  p_adjustment_type text,
  p_adjustment_account_id uuid,
  p_adjustment_date date,
  p_reference_number text,
  p_description text,
  p_lines jsonb
)
returns public.inventory_adjustments
language plpgsql
security definer
set search_path = public
as $$
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
  if not is_org_member(p_org_id) then
    raise exception 'not a member of this org';
  end if;

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
$$;

-- =========================================================================
-- recompute_item_avg_cost: add inventory_adjustment as one more replay
-- event type. No type branching needed here -- create_inventory_adjustment
-- already computed resulting_avg_cost correctly for whichever adjustment
-- type it was (unchanged for Quantity, cross-location-blended for
-- Value/Quantity&Value), so replaying it is always a correct, idempotent
-- overwrite.
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

-- =========================================================================
-- reset_org_data: extend the existing 'inventory_activity' category
-- ("Inventory Transfers & Adjustments" -- no new category, no UI change)
-- to also clean up the new document tables and their journal entries,
-- alongside its existing stock_movements cleanup.
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
$$;
