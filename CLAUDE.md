# Inventory SaaS — CLAUDE.md

## 1. Project Overview

Multi-tenant inventory management SaaS, replacing a Google Sheets "backend" that clients complained was too slow. One codebase serves several separate client businesses (orgs), each with isolated inventory data and users. Built on Supabase (Postgres + Auth + Realtime). **Speed is a first-class requirement** — every schema and architecture decision below exists to keep reads/writes fast, not just correct.

Status: Phase 1 (core inventory + walk-in sales), Phase 2 (invoicing/AR), Phase 3 (Settings + master data), and Phase 4 Stage 1 (double-entry ledger: Chart of Accounts + General Journal) are all shipped and tested. This document is the source of truth for architecture decisions, so later sessions build consistently instead of re-deriving them.

**Reference app**: the owner's previous system, "Hashir Hub," is a full multi-client double-entry accounting app (invoicing, AR/AP, ~30 reports, one Google Sheet + Apps Script per client), source reviewed locally under `assets/js/modules/*.js` (not in this repo) as a feature/data-model reference — its module names (`items.js`, `settings.js`, `master-data.js`, `accounts.js`) are a reliable guide to what a given feature area was called and contained there, worth re-checking before designing anything that sounds like it might have a Hashir Hub equivalent. It is explicitly **not** being ported wholesale, but phase by phase, adapted to this schema rather than copied verbatim: Phase 1 was items/stock/customers/suppliers/purchase-orders/a paid-in-full "sales receipt" flow, Phase 2 added invoicing/AR, Phase 3 added Settings/master data, Phase 4 Stage 1 added a real (but not-yet-auto-posting) double-entry ledger. AP/supplier-bills, the ledger-auto-posting wiring, and the ~30 report screens remain the open items — see §10.

## 2. Tech Stack

- **Backend**: Supabase (Postgres, Auth, Realtime — used sparingly, see §9). No bespoke API server; the SPA talks to Postgres directly via `supabase-js`, with Row Level Security (RLS) as the authorization boundary.
- **Frontend**: React + Vite + TypeScript, SPA.
- **Deployment**: GitHub Actions → GitHub Pages (source hosted on GitHub). Vercel/Netlify are viable lower-friction alternatives connected to the same repo if Pages' static-only limitations become a problem.
- **Package manager**: npm (default; revisit if the project wants pnpm/yarn).

## 3. Multi-Tenancy & RLS Conventions

This is the section most likely to be gotten wrong — read it before touching schema or queries.

**Pattern**: shared Postgres schema, not schema-per-tenant or database-per-tenant. Every tenant-scoped table has an `org_id uuid references orgs(id)` column. RLS is enabled on every table, no exceptions.

**Why table-lookup RLS instead of JWT custom claims**: JWT claims are baked in at token-issue time and only refresh on token refresh (~1hr default). If an owner revokes a staff member's access, claims-based RLS would let that user keep acting on stale claims until their token refreshes. A table-lookup check against `org_members` is always live — correct at the cost of a small join, which is mitigated by the helper functions below.

```sql
create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  created_at timestamptz not null default now()
);

create table public.org_members (
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','staff')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index on public.org_members (user_id);

-- SECURITY DEFINER so this can be used inside policies on org_members
-- itself without recursing; STABLE so Postgres can cache the result
-- within a single statement instead of re-running it per row.
create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from org_members
    where org_id = target_org and user_id = auth.uid()
  );
$$;

create or replace function public.org_role(target_org uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from org_members
  where org_id = target_org and user_id = auth.uid();
$$;
```

Every tenant-scoped table follows this shape:

```sql
alter table public.<table> enable row level security;

create policy "org members can select"
  on public.<table> for select
  using (is_org_member(org_id));

create policy "org members can insert"
  on public.<table> for insert
  with check (is_org_member(org_id));

-- Restrict destructive/admin actions further where it matters, e.g.:
create policy "admins can delete"
  on public.<table> for delete
  using (org_role(org_id) in ('owner','admin'));
```

`orgs` and `org_members` need their own policies too (members can see their org and their own org's membership rows; only owner/admin can insert/update/delete members) — this is the one place `is_org_member` exists specifically to avoid RLS recursion on `org_members` itself. `orgs` itself only ever had a select policy until Phase 3 added an owner/admin-only update policy (`org_role(id) in ('owner','admin')`) for the Company Info settings screen — org creation still only happens via manual SQL (`docs/onboarding-new-client.md`), there is still no insert policy.

**Line-item child table exception**: a table that is only ever written as part of one atomic parent-transaction (e.g. `purchase_order_lines` under `purchase_orders`, `sales_receipt_items` under `sales_receipts` — both created and read only through their parent header row, never queried org-wide on their own) may omit its own `org_id` and scope its policies via `EXISTS` against the parent instead:

```sql
create policy "org members can select <child>"
  on public.<child> for select
  using (
    exists (
      select 1 from <parent> p
      where p.id = <child>.<parent>_id and is_org_member(p.org_id)
    )
  );
```

This isn't the default — every other table still gets its own `org_id` column per the rule above. Only use this when the child truly has no independent access path.

**Rules to follow everywhere**:
- Never create a tenant-scoped table without an `org_id` column and RLS policies from the start — don't ship a table "temporarily" without RLS.
- Use `is_org_member(org_id)` / `org_role(org_id)` in policies; never inline the membership subquery repeatedly across tables.
- Client-side queries must still filter by `org_id` explicitly (`.eq('org_id', currentOrgId)`) even though RLS enforces it server-side too. This is defense-in-depth and a performance convention — don't rely on RLS alone to scope results, since an unfiltered query still forces Postgres to scan across all orgs' rows before RLS excludes them.
- The `service_role` key is never used client-side, never checked into the repo, and never referenced from the frontend. It only belongs in server-side contexts (Supabase Edge Functions, CI secrets) if and when the project needs one.

## 4. Schema Conventions

- snake_case, plural table names.
- Every table: `id uuid primary key default gen_random_uuid()`, `created_at timestamptz default now()`, and `updated_at` where rows are mutable.
- **Stock quantity is never written directly.** `stock_levels.quantity` is a derived cache, kept in sync by an `AFTER INSERT` trigger on `stock_movements` (`stock_levels.quantity += NEW.quantity_delta`). The app always writes to `stock_movements` (an append-only audit log — reason: receive/sale/adjustment/transfer/void, reference to the originating record). This keeps `stock_levels` reads O(1) while preserving full traceability of every quantity change.
- Aggregate or cross-row queries (total stock per item across locations, low-stock report) are Postgres **views** or **RPC functions**, not client-side joins/loops. Views inherit RLS from their base tables automatically — no separate policy needed on the view itself.
- Multi-step writes that must be atomic (e.g. receiving a PO line: update `purchase_order_lines.quantity_received`, insert a `stock_movements` row, let the trigger update `stock_levels`; or creating a sale: header + lines + stock movements) are a single Postgres RPC function, not several round-trips from the client.
- Sequential, prefixed document numbers (e.g. `SR-000123`) go through the shared `next_document_number(org_id, doc_type, prefix)` function backed by `doc_number_counters` — a single `UPDATE ... RETURNING` gives concurrency safety for free via Postgres's implicit row lock, no explicit locking needed. Reuse this for every future document type (invoices, POs) instead of inventing per-type counters.

### Core tables (reference sketch — refine at migration time)

```
orgs                    -- tenants -- org_id, name, slug, address, phone, email,
                        --   currency_symbol (default '$'), currency_code (default 'USD')
org_members             -- user_id x org_id, role: owner/admin/staff
locations               -- org_id, name, address, is_active, type ('store'|'warehouse', default 'store')
                        --   Settings' Stores/Warehouses tabs are both this one table, filtered by type --
                        --   keeps stock/sales/invoices/POs against a single location concept
items                   -- org_id, sku, barcode, name, description, unit, reorder_threshold, is_active, unit_price,
                        --   category_id, brand_id, supplier_id (nullable FKs, on delete set null)
                        --   unique index (org_id, sku); index (org_id, barcode) for fast scan lookups
                        --   sku is never typed by hand -- always assigned via next_item_sku(org_id), see below
                        --   no cost_price yet -- Phase 1 has no purchasing-driven costing automation
categories              -- org_id, name, parent_id (self-ref, hierarchical)
brands                  -- org_id, name
units_of_measure        -- org_id, name, abbreviation -- backs the Unit field on items (a Select, not free text);
                        --   items.unit itself stays a plain text column so old values never break
areas                   -- org_id, name, region (plain text, not its own table) -- customers.area_id references this
price_lists             -- org_id, list_date, list_type (retail/wholesale/custom), image_url -- a dated log of
                        --   price-sheet documents, NOT a per-item pricing engine (that's still deferred)
stock_levels            -- org_id, item_id, location_id, quantity
                        --   unique index (org_id, item_id, location_id)
stock_movements         -- org_id, item_id, location_id, quantity_delta, reason,
                        --   reference_type, reference_id, created_by, created_at
                        --   index (org_id, item_id, created_at desc)
suppliers               -- org_id, name, contact info
purchase_orders         -- org_id, supplier_id, status, created_by, expected_date
purchase_order_lines    -- po_id, item_id, quantity_ordered, quantity_received, unit_cost
customers               -- org_id, name, phone, email, address, is_active, area_id (nullable FK) (contact record
                        --   only -- no balance column; AR balance is always derived from invoices, never stored)
doc_number_counters     -- org_id, doc_type, next_number (system-managed, no client policies)
sales_receipts          -- org_id, receipt_number, customer_id, status, payment_method, subtotal, total
                        --   walk-in, paid-in-full sale only (customer_id nullable) -- for credit sales see invoices below
sales_receipt_items     -- sales_receipt_id, item_id, location_id, quantity, unit_price, line_total
                        --   no org_id (line-item child table exception, see §3)
invoices                -- org_id, invoice_number, customer_id (not null), status (unpaid/partially_paid/paid/void),
                        --   issue_date, due_date, subtotal, total, amount_paid, notes
                        --   'overdue' is NOT a stored status -- it's computed (due_date passed, balance > 0),
                        --   see outstanding_invoices below
invoice_items           -- invoice_id, item_id, location_id, quantity, unit_price, line_total
                        --   no org_id (line-item child table exception, see §3)
invoice_payments        -- org_id, invoice_id, amount, payment_method, paid_at, notes
                        --   append-only ledger; has its own org_id (unlike invoice_items) since it's a
                        --   plausible org-wide query target later, but NO client insert policy -- every
                        --   payment must go through record_invoice_payment so invoices.amount_paid/status
                        --   can never desync from the ledger
ledger_accounts         -- org_id, account_number, name, account_type (14-value check: income/expense/bank/
                        --   equity/accounts_receivable/accounts_payable/other_current_asset/other_asset/
                        --   fixed_asset/other_current_liability/long_term_liability/cost_of_goods_sold/
                        --   other_income/other_expense), parent_account_id (self-ref), description, is_active
                        --   named ledger_accounts, not accounts, to avoid ambiguity with unrelated "account"
                        --   concepts. Named "Capital Matrix" in the UI. Balance is NEVER a stored column --
                        --   always derived from journal_lines via the ledger_account_balances view (same
                        --   "derive, don't store" convention as stock_levels/outstanding_invoices).
                        --   insert/update/delete restricted to owner/admin.
journal_entries         -- org_id, entry_number (via next_document_number, prefix 'JE'), entry_date, memo,
                        --   reference_type (default 'manual'), reference_id
                        --   append-only, no update/delete policy -- corrections are a new reversing entry,
                        --   not an edit, same convention as stock_movements. Named "Fiscal Daybook" in the UI.
journal_lines           -- journal_entry_id, account_id, debit, credit, name, memo, line_order
                        --   no org_id (line-item child table exception, see §3); check constraint enforces
                        --   exactly one of debit/credit is positive and the other is zero on every line
```

`create_sales_receipt(org_id, customer_id, payment_method, lines jsonb)` is the atomic RPC for completing a sale: computes the total server-side from `lines` (never trusts a client-sent total), validates every `item_id`/`location_id` actually belongs to `org_id` (required because SECURITY DEFINER bypasses RLS), inserts the header + line items, and inserts one `stock_movements` row per line (`reason='sale'`) which the existing trigger turns into a `stock_levels` update. No stock-sufficiency check — sales are allowed to go negative, surfacing via `low_stock_report` rather than blocking the sale.

**Invoicing (Phase 2)** follows the same atomic-RPC shape as sales receipts, plus two more RPCs for the payment lifecycle:
- `create_invoice(org_id, customer_id, due_date, lines jsonb, notes)` — same validation/total-computation shape as `create_sales_receipt`; `customer_id` is required (unlike sales receipts' walk-in-friendly nullable one); deducts stock the same way (`reason='sale'`, `reference_type='invoice'`). There is no `draft` status — like sales receipts, creation is atomic and final.
- `record_invoice_payment(invoice_id, amount, payment_method, paid_at, notes)` — inserts an `invoice_payments` row and atomically recomputes `invoices.amount_paid`/`status` in the same call. Rejects overpayment (no customer credit-balance concept exists) and payments against a voided invoice.
- `void_invoice(invoice_id)` — owner/admin only; reverses the stock deduction via a compensating `stock_movements` entry (`reason='void'`); blocked once any payment has been recorded, since there's no credit-note/refund model yet (a paid invoice's cash would have nowhere to go on void).

`dashboard_summary(org_id)` returns item/low-stock/today's-sales/outstanding-AR/overdue-invoice/customer counts plus this-week and last-week revenue (calendar week, `date_trunc('week', ...)`) in one round trip; unlike the other RPCs here it's plain SQL with ordinary RLS (no `security definer`), since it only reads. It's a `RETURNS TABLE` function, so adding fields requires `DROP FUNCTION` first (`CREATE OR REPLACE` can't change a `RETURNS TABLE` column list) — this has already tripped up two migrations, don't forget it on the next one.

**Item SKUs are always system-assigned**, never typed by hand: `next_item_sku(org_id)` reuses the same `doc_number_counters` mechanism as `next_document_number` but is seeded to start at `100001` and returns a bare number with no prefix (`100001`, `100002`, ...). Unlike `next_document_number`, it's called directly by the client (item creation is a plain insert, not a SECURITY DEFINER RPC), so it does its own `is_org_member` check and is left executable by authenticated clients (no `revoke`).

**The double-entry ledger (Phase 4)** follows the same atomic-RPC shape as everything else: `create_journal_entry(org_id, entry_date, memo, lines jsonb, reference_type default 'manual', reference_id default null)` validates ≥2 lines, that `sum(debit) = sum(credit)` (server-computed, never trusted from the client), and that every `account_id` belongs to `org_id`, then inserts the entry + lines atomically. **Currently restricted to owner/admin unconditionally** — Stage 1 only has manual entries. When Stage 2 wires sales/invoices/bills to auto-post here, that role check will need to become conditional on `reference_type != 'manual'`, since a `staff` member completing a sale shouldn't be blocked from the automatic posting it triggers. `ledger_account_balances` is a view, not a stored column, computing each account's balance from `journal_lines` with the sign flipped for credit-normal account types (income/equity/accounts_payable/other_current_liability/long_term_liability/other_income) vs debit-normal (everything else).

Example low-stock view:

```sql
create view public.low_stock_report as
select sl.org_id, sl.item_id, sl.location_id, sl.quantity, i.reorder_threshold
from stock_levels sl
join items i on i.id = sl.item_id
where sl.quantity <= coalesce(i.reorder_threshold, 0);
```

`outstanding_invoices` is the equivalent lightweight view for AR: unpaid/partially-paid invoices joined to customer name, with `balance` and `is_overdue` computed columns (not stored on `invoices` itself — same "derive, don't store" reasoning as `low_stock_report`).

## 5. Folder Structure

```
/
├── CLAUDE.md
├── package.json / vite.config.ts / tsconfig.json
├── .env.example                   -- VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
├── supabase/
│   ├── migrations/                -- SQL migrations, supabase CLI managed
│   └── config.toml
├── src/
│   ├── main.tsx / App.tsx          -- providers (QueryClient, Auth, Org, HashRouter) + flat route table
│   │                                  (no per-section layout routes -- see Sidebar note below)
│   ├── lib/supabaseClient.ts      -- single createClient() instance
│   ├── lib/currency.ts            -- formatMoney(value, symbol) -- see §9, never hardcode "$"
│   ├── auth/                      -- AuthProvider, OrgProvider, ProtectedRoute, LoginPage, SetPasswordPage
│   ├── features/
│   │   ├── items/                 -- Item List / New Item / Search Item / Price Manager
│   │   ├── stock/
│   │   ├── suppliers/
│   │   ├── purchase-orders/
│   │   ├── customers/
│   │   ├── sales/                 -- barcode-driven sales receipt flow
│   │   ├── invoices/              -- credit sales / accounts receivable
│   │   ├── settings/              -- Company Info, Stores/Warehouses, Price Lists, Categories, Brands,
│   │   │                             Units, Regions & Areas -- all flat routes, no shared layout component
│   │   ├── accounts/              -- Capital Matrix (chart of accounts) + Fiscal Daybook (general journal)
│   │   └── dashboard/
│   ├── components/
│   │   ├── ui/                    -- hand-owned primitives (Button, Input, Card, Table, Modal, ...)
│   │   └── layout/                -- AppLayout, Sidebar (accordion nav -- see below)
│   └── types/                     -- generated via `supabase gen types typescript`
├── docs/onboarding-new-client.md  -- non-developer runbook for provisioning a new client org
└── .github/workflows/deploy.yml
```

**Navigation**: `Sidebar.tsx` is an accordion, not a flat list — Items/Settings/Account are collapsible groups whose sub-links render indented beneath them (only one group open at a time; auto-expands on load if the current route falls under it). This replaced an earlier design where each section had its own horizontal tab bar at the top of the page (`ItemsLayout.tsx`/`SettingsLayout.tsx`, both now deleted) — routes are flat (`/items/list`, `/settings/brands`, `/account/capital-matrix`, etc.) with the Sidebar as the only sub-navigation. Follow this pattern for any new multi-page feature section rather than reintroducing an in-page tab bar.

## 6. Dev Commands

- `npm run dev` / `npm run build` — frontend
- `supabase start` — local Supabase dev stack
- `supabase migration new <name>` — new migration
- `supabase db push` — apply migrations to the linked project
- `supabase gen types typescript --project-id <id> > src/types/supabase.ts` — regenerate types after every migration; never let them drift
- `supabase db query --linked "<sql>"` (or `-f <file>.sql`) — run SQL directly against the live linked project without opening the Dashboard SQL editor; useful for verifying an RPC/migration from the terminal. To exercise RLS as a specific member instead of the raw connection role, prefix with `select set_config('request.jwt.claims', json_build_object('sub','<user-uuid>','role','authenticated')::text, false); select set_config('role','authenticated', false);` in the same script/file.
- If `supabase`/`npm`/`node` aren't found in a given shell, they're very likely installed but PATH wasn't reloaded into that shell session — open a fresh terminal before assuming something is missing.

## 7. Environment Variables

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — the anon key is safe to ship client-side; RLS is the real security boundary.
- `.env` is never committed. `.env.example` documents the required keys with placeholder values.
- The `service_role` key is never an env var read by frontend code.

## 8. Deployment Process

- GitHub Actions builds and deploys the Vite app to GitHub Pages on push to `main`.
- GitHub Pages caveats to remember: static hosting only (no server secrets); client-side routing needs `HashRouter` or a manual 404 fallback since Pages doesn't support arbitrary rewrites; a custom domain needs a `CNAME` file in `public/`.
- Supabase migrations (`supabase db push`) are a **separate, deliberate step** — not auto-run on every frontend deploy — to avoid accidentally applying schema changes alongside an unrelated UI deploy.

## 9. Coding Conventions

- TypeScript strict mode. Use the generated Supabase types everywhere; no `any` for database rows/queries.
- Prefer RPC functions or views for anything aggregate; avoid N+1 client-side query patterns.
- Realtime subscriptions are used sparingly, only where live updates earn their cost (e.g. a shared stock view multiple staff are looking at concurrently) — not wired in by default across the whole app.
- Every Supabase client query filters by `org_id` explicitly, per §3.
- **Never hardcode a currency symbol.** Every money value is displayed via `formatMoney(value, currencySymbol)` (`src/lib/currency.ts`), with `currencySymbol` read from `useOrg()` (sourced from `orgs.currency_symbol`, editable on the Company Info settings page). `formatMoney` also drops trailing `.00` on whole amounts and adds thousands separators — don't hand-roll `` `$${x.toFixed(2)}` `` anywhere.
- **Auth callback / HashRouter gotcha**: Supabase's default invite/recovery email links return the session as `#access_token=...` in the URL hash, which collides with `HashRouter`'s own use of `#` for routing. `main.tsx` consumes that callback itself (parses the hash, calls `supabase.auth.setSession`, rewrites the URL to a clean `#/...` route) *before* `HashRouter` ever mounts, and `supabaseClient.ts` sets `detectSessionInUrl: false` so supabase-js doesn't race it. Don't re-enable `detectSessionInUrl` or move auth-callback handling into a component that mounts after the router without re-reading that code path first.

## 10. Roadmap / Out of Scope

- No Google Sheets data migration needed — starting fresh.
- **Phase 1** (shipped): items, stock (levels/movements/adjustments), suppliers, purchase orders + receiving, customers, a walk-in paid-in-full sales receipt flow (barcode/SKU lookup via USB scanner input, no camera scanning yet), a basic dashboard. No public signup — new client orgs are provisioned manually, see `docs/onboarding-new-client.md`.
- **Phase 2** (shipped): invoicing / accounts receivable — credit sales to a required customer, due dates, partial payments over time via an `invoice_payments` ledger, computed (not stored) overdue status, and voiding (blocked once any payment is recorded, since there's no credit-note/refund model yet). Dashboard extended with outstanding-AR total and overdue-invoice count.
- **Phase 3** (shipped): Settings section — Company Info (name/address/contact/currency, feeds `formatMoney` everywhere and will feed future printed documents), Stores/Warehouses (the existing `locations` table split by a new `type` column), Price Lists (a dated document log, not a pricing engine), and master data — Categories (hierarchical), Brands, Units of Measure, and Regions & Areas — wired into `items`/`customers` with inline "+" quick-add from their forms, not just standalone reference lists.
- **Phase 4, Stage 1** (shipped): double-entry ledger — Chart of Accounts ("Capital Matrix") and General Journal ("Fiscal Daybook"), see §4. **This lifts the "double-entry ledger deferred" note below for good** — it's real (accounts carry derived, always-balanced balances; journal entries must balance to post) but currently **manual only**: nothing elsewhere in the app posts to it automatically yet. That's Stage 2.
- **Phase 4, Stage 2** (not started — the natural next step): Supplier Bills (new tables mirroring `invoices`/`invoice_items`/`invoice_payments` on the buy side, since Purchase Orders alone have no "amount owed" concept), Customer Payment and Supplier Payment screens, Banking (fund transfers between ledger accounts + reusing Stage 1's account-ledger view), and — the big one — wiring `create_sales_receipt`/`create_invoice`/`record_invoice_payment`/the new supplier-bill RPCs to auto-post journal entries via `create_journal_entry` (which needs its owner/admin role check relaxed for non-manual `reference_type`s first, see §4). Note this app still has no per-item cost basis (`items.cost_price` doesn't exist), so COGS/Inventory-asset postings aren't possible yet without also building weighted-average costing — Stage 2 revenue-side postings (Debit Cash/AR, Credit Income) are achievable now; COGS entries are not.
- **Explicitly deferred to later phases**: weighted-average costing automation (blocks COGS ledger postings, see above), wholesale/multi-tier pricing, credit notes/refunds, the ~30 report screens from the old app, camera-based barcode scanning, multi-org switcher UI (schema supports multi-org membership already; Phase 1 UI just auto-selects a user's single org).
- This is a living document — update it as schema or architecture decisions evolve, don't let it drift from reality.
