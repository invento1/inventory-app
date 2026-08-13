-- PO -> Bill conversion: a Purchase Order is pure intent (no financial
-- entry); converting it to a Supplier Bill is what actually receives
-- stock and creates Accounts Payable. Reuses create_supplier_bill
-- verbatim (internal SQL call, not via supabase.rpc) so stock/ledger
-- posting logic isn't duplicated. Blocked if any line was already
-- manually received (old path) or the PO was already converted, since
-- neither system knows about the other otherwise and stock would double-count.

alter table public.purchase_orders add column bill_id uuid references public.supplier_bills (id);
alter table public.supplier_bills add column purchase_order_id uuid references public.purchase_orders (id);

create or replace function public.convert_purchase_order_to_bill(
  p_po_id uuid,
  p_location_id uuid,
  p_due_date date,
  p_notes text default null
)
returns public.supplier_bills
language plpgsql
security definer
set search_path = public
as $$
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

  if not is_org_member(v_po.org_id) then
    raise exception 'not a member of this org';
  end if;

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
$$;
