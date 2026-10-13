-- keep_alive(): the target of .github/workflows/keep-alive.yml, which calls it
-- every two days so the free-plan project is never paused for inactivity.
-- Returns only the server time: a real database query that exposes no data,
-- so it's deliberately callable with the public anon key. Plain SQL, not
-- SECURITY DEFINER.
create or replace function public.keep_alive()
returns timestamptz
language sql
stable
set search_path = public
as $$
  select now();
$$;

grant execute on function public.keep_alive() to anon, authenticated;
