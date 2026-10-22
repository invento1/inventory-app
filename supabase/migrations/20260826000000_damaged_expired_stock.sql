-- Damaged / expired stock tracking: the last missing feature behind the old
-- HashirHub's reports (Damaged / Expired Inventory).
--
-- * items.expiry_date: an optional "use by" date per item, as in the old app.
--   (One date per item, not per batch: stock isn't tracked by batch here.)
-- * inventory_adjustments.reason: why stock was adjusted. Stock count,
--   Damaged, Expired, Lost / stolen, Revaluation or Other. Existing
--   adjustments become 'other'. create_inventory_adjustment takes it as a new
--   trailing parameter (old signature dropped first).
-- * Reports: stock_write_offs (adjustments with reason damaged / expired in a
--   period: quantity and value written off) and expired_stock (items past, or
--   within N days of, their expiry date that are still in stock).

alter table public.items add column expiry_date date;

alter table public.inventory_adjustments
  add column reason text not null default 'other'
    check (reason in ('stock_count', 'damaged', 'expired', 'lost', 'revaluation', 'other'));

drop function if exists public.create_inventory_adjustment(uuid, uuid, text, uuid, date, text, text, jsonb);

CREATE FUNCTION public.create_inventory_adjustment(p_org_id uuid, p_location_id uuid, p_adjustment_type text, p_adjustment_account_id uuid, p_adjustment_date date, p_reference_number text, p_description text, p_lines jsonb, p_reason text DEFAULT 'other'::text)
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

  if coalesce(p_reason, 'other') not in ('stock_count', 'damaged', 'expired', 'lost', 'revaluation', 'other') then
    raise exception 'invalid adjustment reason: %', p_reason;
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
    adjustment_date, reference_number, description, reason, created_by
  )
  values (
    p_org_id, v_adjustment_number, p_adjustment_type, p_location_id, p_adjustment_account_id,
    coalesce(p_adjustment_date, current_date), p_reference_number, p_description, coalesce(p_reason, 'other'), auth.uid()
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

-- Stock written off as damaged or expired: per adjustment line, the quantity
-- removed and the value written off (positive numbers).
create or replace function public.stock_write_offs(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  adjustment_id uuid, adjustment_number text, adjustment_date date, reason text, location_name text,
  item_id uuid, sku text, item_name text, category_name text, quantity numeric, value numeric
)
language sql
stable
set search_path = public
as $$
  select a.id, a.adjustment_number, a.adjustment_date, a.reason, l.name,
         it.id, it.sku, it.name, cat.name,
         ai.qty_on_hand_before - ai.new_qty,
         -ai.value_diff
  from inventory_adjustments a
  join inventory_adjustment_items ai on ai.adjustment_id = a.id
  join items it on it.id = ai.item_id
  left join categories cat on cat.id = it.category_id
  left join locations l on l.id = a.location_id
  where a.org_id = p_org_id
    and a.reason in ('damaged', 'expired')
    and a.adjustment_date between p_start_date and p_end_date
  order by a.adjustment_date, a.adjustment_number, it.name;
$$;

-- Items in stock that are past their expiry date on p_as_of ('expired'), or
-- will be within p_within_days ('expiring'), valued at moving average cost.
create or replace function public.expired_stock(p_org_id uuid, p_as_of date, p_within_days integer default 30)
returns table (
  item_id uuid, sku text, item_name text, category_name text, expiry_date date,
  quantity numeric, value numeric, status text
)
language sql
stable
set search_path = public
as $$
  select it.id, it.sku, it.name, cat.name, it.expiry_date,
         sum(sl.quantity), sum(sl.quantity) * it.avg_cost,
         case when it.expiry_date <= p_as_of then 'expired' else 'expiring' end
  from items it
  join stock_levels sl on sl.item_id = it.id
  left join categories cat on cat.id = it.category_id
  where it.org_id = p_org_id
    and it.expiry_date is not null
    and it.expiry_date <= p_as_of + greatest(coalesce(p_within_days, 0), 0)
  group by it.id, it.sku, it.name, cat.name, it.expiry_date, it.avg_cost
  having sum(sl.quantity) > 0
  order by it.expiry_date, it.name;
$$;
