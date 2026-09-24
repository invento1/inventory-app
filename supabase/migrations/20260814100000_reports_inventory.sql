-- Reports, batch 3: inventory. Plain SQL, STABLE, SECURITY INVOKER, explicit
-- org filter -- same shape as the other report functions.

-- Current stock per item, optionally narrowed to one location, one category
-- (including its sub-categories), and/or one supplier. Backs Quantity On Hand,
-- Inventory Valuation, Stock by Supplier, and the Physical Inventory
-- Worksheet. value = quantity * items.avg_cost; avg_cost is a single
-- item-wide Moving Average Cost, so it's the right rate at any one location
-- too. Inactive items are still listed while they have stock.
create or replace function public.inventory_status(
  p_org_id uuid,
  p_location_id uuid default null,
  p_category_id uuid default null,
  p_supplier_id uuid default null
)
returns table (
  item_id uuid,
  sku text,
  item_name text,
  unit text,
  category_name text,
  supplier_id uuid,
  supplier_name text,
  quantity numeric,
  reorder_threshold numeric,
  avg_cost numeric,
  value numeric
)
language sql
stable
set search_path = public
as $$
  with recursive cats as (
    select c.id from categories c where c.id = p_category_id and c.org_id = p_org_id
    union all
    select c.id from categories c join cats on c.parent_id = cats.id
  ),
  stock as (
    select sl.item_id, sum(sl.quantity) as quantity
    from stock_levels sl
    where sl.org_id = p_org_id
      and (p_location_id is null or sl.location_id = p_location_id)
    group by sl.item_id
  )
  select
    i.id,
    i.sku,
    i.name,
    i.unit,
    cat.name,
    s.id,
    s.name,
    coalesce(st.quantity, 0),
    i.reorder_threshold,
    i.avg_cost,
    coalesce(st.quantity, 0) * i.avg_cost
  from items i
  left join stock st on st.item_id = i.id
  left join categories cat on cat.id = i.category_id
  left join suppliers s on s.id = i.supplier_id
  where i.org_id = p_org_id
    and (p_category_id is null or i.category_id in (select id from cats))
    and (p_supplier_id is null or i.supplier_id = p_supplier_id)
    and (i.is_active or coalesce(st.quantity, 0) <> 0)
  order by i.name;
$$;

-- Inventory Movement for a date range: per item, opening quantity (all
-- movements dated before p_start_date), movement in range split by source,
-- and closing quantity. Buckets are signed net amounts:
--   purchased   = supplier-bill / PO receipts, net of bill voids
--   sold        = sales (shown positive), net of invoice voids
--   returned    = credit-memo returns, net of credit-memo voids
--   transferred = transfers in/out (nets to zero org-wide; only non-zero
--                 when narrowed to one location)
--   adjusted    = everything else (inventory adjustments, and any future
--                 reason), so opening + purchased - sold + returned
--                 + transferred + adjusted = closing always holds
-- Dated by stock_movements.created_at (when stock actually moved).
create or replace function public.inventory_movement(
  p_org_id uuid,
  p_start_date date,
  p_end_date date,
  p_location_id uuid default null,
  p_category_id uuid default null
)
returns table (
  item_id uuid,
  sku text,
  item_name text,
  category_name text,
  opening_qty numeric,
  purchased numeric,
  sold numeric,
  returned numeric,
  transferred numeric,
  adjusted numeric,
  closing_qty numeric
)
language sql
stable
set search_path = public
as $$
  with recursive cats as (
    select c.id from categories c where c.id = p_category_id and c.org_id = p_org_id
    union all
    select c.id from categories c join cats on c.parent_id = cats.id
  ),
  moves as (
    select
      sm.item_id,
      sm.quantity_delta as q,
      sm.created_at::date as d,
      case
        when sm.reason = 'receive' or (sm.reason = 'void' and sm.reference_type = 'supplier_bill') then 'purchased'
        when sm.reason = 'sale' or (sm.reason = 'void' and sm.reference_type in ('invoice', 'sales_receipt')) then 'sold'
        when sm.reason = 'return' or (sm.reason = 'void' and sm.reference_type = 'credit_memo') then 'returned'
        when sm.reason = 'transfer' then 'transferred'
        else 'adjusted'
      end as bucket
    from stock_movements sm
    where sm.org_id = p_org_id
      and sm.created_at::date <= p_end_date
      and (p_location_id is null or sm.location_id = p_location_id)
  ),
  agg as (
    select
      item_id,
      coalesce(sum(q) filter (where d < p_start_date), 0) as opening_qty,
      coalesce(sum(q) filter (where d >= p_start_date and bucket = 'purchased'), 0) as purchased,
      -coalesce(sum(q) filter (where d >= p_start_date and bucket = 'sold'), 0) as sold,
      coalesce(sum(q) filter (where d >= p_start_date and bucket = 'returned'), 0) as returned,
      coalesce(sum(q) filter (where d >= p_start_date and bucket = 'transferred'), 0) as transferred,
      coalesce(sum(q) filter (where d >= p_start_date and bucket = 'adjusted'), 0) as adjusted,
      coalesce(sum(q), 0) as closing_qty,
      count(*) filter (where d >= p_start_date) as moves_in_range
    from moves
    group by item_id
  )
  select
    i.id,
    i.sku,
    i.name,
    cat.name,
    agg.opening_qty,
    agg.purchased,
    agg.sold,
    agg.returned,
    agg.transferred,
    agg.adjusted,
    agg.closing_qty
  from agg
  join items i on i.id = agg.item_id
  left join categories cat on cat.id = i.category_id
  where i.org_id = p_org_id
    and (p_category_id is null or i.category_id in (select id from cats))
    and (agg.moves_in_range > 0 or agg.opening_qty <> 0)
  order by cat.name nulls last, i.name;
$$;
