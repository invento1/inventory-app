-- Item last purchase price: surfaced as a hover tooltip on the unit price
-- field when creating a sales receipt or invoice, so staff can see what was
-- last paid for an item (gauge how much discount room there is) without a
-- stored items.cost_price column (still doesn't exist, see CLAUDE.md).
-- Cost history lives in two places -- purchase_order_lines.unit_cost
-- (display-only, unenforced) and supplier_bill_items.unit_cost (the real
-- AP document) -- so this takes whichever is more recent per item.
-- RLS-free -- inherits from the base tables' own policies (both are
-- line-item children scoped via EXISTS against their parent's org_id), same
-- convention as every other view in this app.

create view public.item_last_purchase_price as
select distinct on (item_id) item_id, org_id, unit_cost, purchased_at
from (
  select sbi.item_id, sb.org_id, sbi.unit_cost, sbi.created_at as purchased_at
  from supplier_bill_items sbi
  join supplier_bills sb on sb.id = sbi.bill_id
  union all
  select pol.item_id, po.org_id, pol.unit_cost, pol.created_at as purchased_at
  from purchase_order_lines pol
  join purchase_orders po on po.id = pol.po_id
  where pol.unit_cost is not null
) combined
order by item_id, purchased_at desc;
