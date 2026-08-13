-- All Transactions: one row per top-level document across every document
-- type in the app -- a directory, not a full ledger (Fiscal Daybook/View
-- Payments/View Paid Bills/Stock Movements already cover the finer-grained
-- feeds). RLS-free -- inherits from base tables per the established view
-- convention (see low_stock_report/outstanding_invoices).

create view public.all_transactions as
select sr.org_id, 'sales_receipt' as doc_type, sr.id as doc_id, sr.receipt_number as doc_number,
       sr.created_at::date as txn_date, null::text as party_name, sr.total, sr.status
from sales_receipts sr
union all
select i.org_id, 'invoice', i.id, i.invoice_number, i.issue_date, c.name, i.total, i.status
from invoices i join customers c on c.id = i.customer_id
union all
select b.org_id, 'supplier_bill', b.id, b.bill_number, b.issue_date, s.name, b.total, b.status
from supplier_bills b join suppliers s on s.id = b.supplier_id
union all
select po.org_id, 'purchase_order', po.id, 'PO-' || substr(po.id::text, 1, 8),
       coalesce(po.expected_date, po.created_at::date), s.name,
       coalesce((select sum(quantity_ordered * coalesce(unit_cost, 0)) from purchase_order_lines where po_id = po.id), 0),
       po.status
from purchase_orders po join suppliers s on s.id = po.supplier_id
union all
select e.org_id, 'expense', e.id, e.expense_number, e.expense_date, coalesce(e.payee_name, sup.name, ''), e.amount, e.status
from expenses e left join suppliers sup on sup.id = e.payee_supplier_id
union all
select q.org_id, 'quotation', q.id, q.quotation_number, q.issue_date, c.name, q.total, q.status
from quotations q left join customers c on c.id = q.customer_id
union all
select cm.org_id, 'credit_memo', cm.id, cm.credit_memo_number, cm.issue_date, c.name, cm.total, cm.status
from credit_memos cm join customers c on c.id = cm.customer_id
union all
select r.org_id, 'refund', r.id, r.refund_number, r.refund_date, c.name, r.amount, 'completed'
from refunds r join customers c on c.id = r.customer_id;
