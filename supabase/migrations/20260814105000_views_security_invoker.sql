-- Security fix: make every public view run with the CALLER's privileges.
--
-- Postgres views default to running as their owner (postgres), which
-- bypasses row level security on the base tables. Supabase also grants
-- SELECT on public views to anon/authenticated by default, so these five
-- views were readable, across every org, by anyone holding the public anon
-- key (which ships in the frontend bundle) -- verified before this fix:
-- as role anon, ledger_accounts returned 0 rows but ledger_account_balances
-- returned all 13.
--
-- security_invoker = true (Postgres 15+) makes each view apply the base
-- tables' RLS policies for whoever is querying, which is what CLAUDE.md
-- always assumed ("views inherit RLS from their base tables"). Every base
-- table involved already has an org-member select policy, so org members see
-- exactly what they saw before; anon and other orgs now see nothing.
alter view public.low_stock_report set (security_invoker = true);
alter view public.outstanding_invoices set (security_invoker = true);
alter view public.outstanding_supplier_bills set (security_invoker = true);
alter view public.ledger_account_balances set (security_invoker = true);
alter view public.all_transactions set (security_invoker = true);
