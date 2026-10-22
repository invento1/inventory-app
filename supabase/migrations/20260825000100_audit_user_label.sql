-- Audit reports: name the person even when their membership has no full_name
-- (both org owners have none), by falling back to their login email. Emails
-- live in auth.users, which the SECURITY INVOKER reports can't read, so this
-- small SECURITY DEFINER helper answers only for callers holding
-- reports.audit in that org (the same people who can read audit_log).

create or replace function public.audit_user_label(p_org_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_user_id is null or not has_permission(p_org_id, 'reports.audit') then null
    else coalesce(
      (select nullif(trim(full_name), '') from org_members where org_id = p_org_id and user_id = p_user_id),
      (select email from auth.users where id = p_user_id)
    )
  end;
$$;
revoke execute on function public.audit_user_label(uuid, uuid) from public, anon;
grant execute on function public.audit_user_label(uuid, uuid) to authenticated;

create or replace function public.deleted_transactions(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  log_id uuid, changed_at timestamptz, action text, doc_type text, doc_id uuid, doc_number text,
  doc_date date, party_name text, total numeric, changed_by_name text, note text
)
language sql
stable
set search_path = public
as $$
  select a.id, a.changed_at,
         case when a.action = 'delete' then 'Deleted'
              when coalesce(a.new_data, a.old_data) ->> 'status' = 'cancelled' then 'Cancelled'
              else 'Voided' end,
         a.doc_type, a.record_id, a.doc_number,
         audit_doc_date(coalesce(a.new_data, a.old_data)),
         coalesce(c.name, s.name, coalesce(a.new_data, a.old_data) ->> 'payee_name'),
         coalesce((coalesce(a.new_data, a.old_data) ->> 'total')::numeric,
                  (coalesce(a.new_data, a.old_data) ->> 'amount')::numeric,
                  (coalesce(a.new_data, a.old_data) ->> 'total_value_diff')::numeric),
         audit_user_label(a.org_id, a.changed_by),
         a.note
  from audit_log a
  left join customers c on c.id = (coalesce(a.new_data, a.old_data) ->> 'customer_id')::uuid
  left join suppliers s on s.id = coalesce((coalesce(a.new_data, a.old_data) ->> 'supplier_id')::uuid,
                                          (coalesce(a.new_data, a.old_data) ->> 'payee_supplier_id')::uuid)
  where a.org_id = p_org_id
    and a.doc_type <> 'reset_data'
    and (a.action = 'delete'
         or ('status' = any(a.changed_fields) and a.new_data ->> 'status' in ('void', 'cancelled')))
    and (a.changed_at at time zone org_timezone(p_org_id))::date between p_start_date and p_end_date
  union all
  -- Reset Data runs: one row each.
  select a.id, a.changed_at, 'Reset Data', 'reset_data', null, null, null,
         array_to_string(a.changed_fields, ', '), null, audit_user_label(a.org_id, a.changed_by), a.note
  from audit_log a
  where a.org_id = p_org_id and a.doc_type = 'reset_data'
    and (a.changed_at at time zone org_timezone(p_org_id))::date between p_start_date and p_end_date
  order by 2 desc;
$$;

create or replace function public.updated_transactions(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  log_id uuid, changed_at timestamptz, doc_type text, doc_id uuid, doc_number text, doc_date date,
  party_name text, total numeric, changed_fields text[], old_data jsonb, new_data jsonb, changed_by_name text
)
language sql
stable
set search_path = public
as $$
  select a.id, a.changed_at, a.doc_type, a.record_id, a.doc_number,
         audit_doc_date(a.new_data),
         coalesce(c.name, s.name, a.new_data ->> 'payee_name'),
         coalesce((a.new_data ->> 'total')::numeric, (a.new_data ->> 'amount')::numeric),
         a.changed_fields, a.old_data, a.new_data, audit_user_label(a.org_id, a.changed_by)
  from audit_log a
  left join customers c on c.id = (a.new_data ->> 'customer_id')::uuid
  left join suppliers s on s.id = coalesce((a.new_data ->> 'supplier_id')::uuid, (a.new_data ->> 'payee_supplier_id')::uuid)
  where a.org_id = p_org_id
    and a.action = 'update'
    and a.doc_type <> 'reset_data'
    and not ('status' = any(a.changed_fields) and a.new_data ->> 'status' in ('void', 'cancelled'))
    and (a.changed_at at time zone org_timezone(p_org_id))::date between p_start_date and p_end_date
  order by a.changed_at desc;
$$;
