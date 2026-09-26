-- Operator fallback for when email can't be used (Supabase's built-in SMTP
-- allows only a few emails an hour, and invite/reset links work once): set a
-- login's password directly and mark the email confirmed, so the person can
-- sign in at once. Database owner only (SQL Editor / `npx supabase db query`);
-- app users can't call it. Inside the app, owners/admins use Settings -> Users
-- -> Set a new password instead.
--
--   select set_login_password('person@example.com', 'a-new-password');
--
-- GoTrue stores bcrypt hashes; pgcrypto's crypt(..., gen_salt('bf')) produces
-- the same format.
create or replace function public.set_login_password(p_email text, p_password text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'Password must be at least 8 characters';
  end if;

  update auth.users
  set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      updated_at = now()
  where lower(email) = lower(trim(p_email))
  returning id into v_id;

  if v_id is null then
    raise exception 'No login for %', p_email;
  end if;

  return format('Password set for %s. They can sign in now.', lower(trim(p_email)));
end;
$$;

revoke execute on function public.set_login_password(text, text) from public, authenticated, anon;
