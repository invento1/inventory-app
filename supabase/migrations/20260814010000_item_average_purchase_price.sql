-- Replaces item_last_purchase_price (most recent cost) with a weighted
-- average across every non-voided supplier bill line for that item --
-- e.g. 10 units @ 6000 then 10 more @ 7000 should show 6500, not 7000.
-- Deliberately sourced from supplier_bill_items only, not
-- purchase_order_lines -- PO unit_cost is unenforced/display-only (never
-- validated, doesn't post to the ledger), while a supplier bill is the
-- real AP document (Debit Purchases / Credit Accounts Payable), so it's
-- the only trustworthy cost basis. Voided bills are excluded since their
-- stock/ledger impact was itself reversed.

drop view public.item_last_purchase_price;

create view public.item_average_purchase_price as
select
  sbi.item_id,
  sb.org_id,
  sum(sbi.quantity * sbi.unit_cost) / nullif(sum(sbi.quantity), 0) as avg_unit_cost,
  sum(sbi.quantity) as total_quantity,
  count(distinct sb.id) as bill_count
from supplier_bill_items sbi
join supplier_bills sb on sb.id = sbi.bill_id
where sb.status != 'void'
group by sbi.item_id, sb.org_id;
