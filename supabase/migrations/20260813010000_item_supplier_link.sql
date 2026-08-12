-- Link items to a (single, preferred) supplier -- nullable, on delete set
-- null since a supplier going away shouldn't delete the items it supplies.
alter table public.items add column supplier_id uuid references public.suppliers (id) on delete set null;
create index items_supplier_id_idx on public.items (supplier_id);
