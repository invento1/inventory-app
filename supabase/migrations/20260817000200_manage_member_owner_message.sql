-- Clearer refusal when a non-owner tries to change or remove an owner
-- (previously surfaced the role-assignment message, "Only an owner can give
-- someone the Owner role", which read oddly for a demotion or removal).
create or replace function public.assert_can_manage_member(p_org_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_role text;
begin
  perform assert_permission(p_org_id, 'users.manage');

  if p_user_id = auth.uid() then
    raise exception 'You can''t change your own access. Ask another owner or admin.';
  end if;

  select role into v_role from org_members where org_id = p_org_id and user_id = p_user_id;
  if v_role is null then
    raise exception 'That user isn''t a member of this business';
  end if;

  if v_role = 'owner' and coalesce(org_role(p_org_id), '') <> 'owner' then
    raise exception 'Only an owner can change another owner';
  end if;

  perform assert_can_assign_role(p_org_id, v_role);
end;
$$;
