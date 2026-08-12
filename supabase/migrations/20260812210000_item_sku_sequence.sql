-- Auto-assigned item SKUs: 100001, 100002, ... -- reuses the same
-- doc_number_counters table as next_document_number (see CLAUDE.md §4),
-- but seeded at 100001 and with no prefix/dash, since a SKU isn't a
-- prefixed document number. Unlike next_document_number, this IS meant to
-- be called directly by the client (item creation is a plain insert, not
-- a SECURITY DEFINER RPC), so it does its own is_org_member check instead
-- of relying on a wrapping RPC, and stays executable by authenticated
-- clients (no revoke).

create or replace function public.next_item_sku(p_org_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  if not is_org_member(p_org_id) then
    raise exception 'not a member of this org';
  end if;

  insert into doc_number_counters (org_id, doc_type, next_number)
  values (p_org_id, 'item_sku', 100001)
  on conflict (org_id, doc_type) do nothing;

  update doc_number_counters
  set next_number = next_number + 1
  where org_id = p_org_id and doc_type = 'item_sku'
  returning next_number - 1 into v_next;

  return v_next::text;
end;
$$;
