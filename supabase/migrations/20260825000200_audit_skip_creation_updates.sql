-- Audit log: creating a sales order or an inventory adjustment inserts the
-- row and then fills in its totals in the same transaction, which logged a
-- misleading "Total: 0 -> N" update at creation. Skip updates made in the
-- transaction that created the row.

create or replace function public.audit_document_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_changed text[];
  v_number text;
begin
  if coalesce(current_setting('app.skip_audit', true), '') = 'on' then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    -- Filled in by the same save that created the document (an order's or
    -- adjustment's totals are written just after its row): part of
    -- creating it, not a change to it. now() is fixed per transaction.
    if (v_old ->> 'created_at') is not null and (v_old ->> 'created_at')::timestamptz = now() then
      return null;
    end if;
    select coalesce(array_agg(n.key order by n.key), '{}')
    into v_changed
    from jsonb_each(v_new) n
    where n.key <> 'updated_at' and (v_old -> n.key) is distinct from n.value;

    if cardinality(v_changed) = 0 then
      return null;
    end if;
    -- A payment moving an invoice/bill between unpaid, partially_paid and
    -- paid: the payment itself is the record.
    if tg_table_name in ('invoices', 'supplier_bills')
       and v_changed <@ array['amount_paid', 'status']
       and v_new ->> 'status' <> 'void' then
      return null;
    end if;
    v_row := v_new;
  else
    v_old := to_jsonb(old);
    v_row := v_old;
  end if;

  v_number := case when tg_argv[1] = '' then 'PO-' || left(v_row ->> 'id', 8) else v_row ->> tg_argv[1] end;

  insert into audit_log (org_id, table_name, record_id, doc_type, doc_number, action, changed_fields,
                         old_data, new_data, changed_by)
  values ((v_row ->> 'org_id')::uuid, tg_table_name, (v_row ->> 'id')::uuid, tg_argv[0], v_number,
          lower(tg_op), coalesce(v_changed, '{}'), v_old, v_new, auth.uid());
  return null;
end;
$$;
