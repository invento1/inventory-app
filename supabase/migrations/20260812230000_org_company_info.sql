-- Company Info: address/contact/currency fields on orgs, used across the
-- app for money formatting and (later) printed invoices/receipts.

alter table public.orgs
  add column address text,
  add column phone text,
  add column email text,
  add column currency_symbol text not null default '$',
  add column currency_code text not null default 'USD';

-- orgs previously had only a select policy (org creation is manual/SQL-only,
-- per docs/onboarding-new-client.md) -- add the update policy Company Info
-- needs, restricted to owner/admin, same bar as other business-identity
-- actions (voiding invoices, deletes elsewhere).
create policy "admins can update their org"
  on public.orgs for update
  using (org_role(id) in ('owner', 'admin'))
  with check (org_role(id) in ('owner', 'admin'));
