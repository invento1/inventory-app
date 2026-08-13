-- Fix: Reset Data fails whenever a Purchase Order has been converted to a
-- Supplier Bill (purchase_orders.bill_id set), because both cross-
-- reference FKs added by convert_purchase_order_to_bill
-- (20260814030000) were left at the default ON DELETE NO ACTION.
-- reset_org_data deletes supplier_bills before purchase_orders in its
-- fixed order, so even selecting BOTH categories together fails --
-- purchase_orders.bill_id still points at the about-to-be-deleted bill
-- at the moment supplier_bills is deleted, and NO ACTION is checked
-- immediately, not deferred to the end of the transaction. The same
-- failure happens in reverse (purchase_orders alone, bill survives) via
-- supplier_bills.purchase_order_id.
--
-- Reproduced against the live database inside a rolled-back transaction
-- (zero risk to real data): selecting every Reset Data category
-- ("Select all") failed with
--   "Cannot complete this reset -- some selected data is still
--   referenced by 'purchase_orders' (constraint
--   purchase_orders_bill_id_fkey)."
-- even though 'purchase_orders' was included in the selection.
--
-- Both links are purely a display/traceability convenience (the "View
-- converted bill" / "From purchase order" links, both already coded to
-- handle a null reference), never load-bearing for any business logic,
-- so ON DELETE SET NULL is correct here -- same convention already used
-- for invoice_payments.deposit_id.

alter table public.purchase_orders
  drop constraint purchase_orders_bill_id_fkey,
  add constraint purchase_orders_bill_id_fkey
    foreign key (bill_id) references public.supplier_bills (id) on delete set null;

alter table public.supplier_bills
  drop constraint supplier_bills_purchase_order_id_fkey,
  add constraint supplier_bills_purchase_order_id_fkey
    foreign key (purchase_order_id) references public.purchase_orders (id) on delete set null;
