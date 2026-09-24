# Inventory SaaS — CLAUDE.md

## 1. Project Overview

Multi-tenant inventory management SaaS, replacing a Google Sheets "backend" that clients complained was too slow. One codebase serves several separate client businesses (orgs), each with isolated inventory data and users. Built on Supabase (Postgres + Auth + Realtime). **Speed is a first-class requirement** — every schema and architecture decision below exists to keep reads/writes fast, not just correct.

Status: Phase 1 (core inventory + walk-in sales), Phase 2 (invoicing/AR), Phase 3 (Settings + master data), Phase 4 (double-entry ledger — Stage 1: Chart of Accounts + General Journal; Stage 2: Supplier Bills, Customer/Supplier Payment, Banking, and auto-posting; Stage 3: Undeposited Funds workflow — Receive Payment/View Payments/Record Deposit/View Deposits, and Pay Bills/View Paid Bills), and Phase 5 (Business Hub — Inventory Transfer/Adjustment, Expenses, Quotations, Credit Memos, Refunds, and an All Transactions directory) are all shipped and tested, followed by a run of post-Phase-5 work: a Profit & Loss report, PO → Supplier Bill conversion, control-account guardrails, Perpetual Moving Average Costing with real COGS, a rebuilt Inventory Adjustment document, HashirHub branding, a responsive mobile layout, and a **Reports** section of 25 reports (see §10). The product is branded **HashirHub** in the UI (browser tab title, sidebar header, favicon/app icons); the repo, package, and GitHub Pages path are still named `inventory-app`. This document is the source of truth for architecture decisions, so later sessions build consistently instead of re-deriving them.

**Reference app**: the owner's previous system, "Hashir Hub," is a full multi-client double-entry accounting app (invoicing, AR/AP, ~30 reports, one Google Sheet + Apps Script per client), source reviewed locally under `assets/js/modules/*.js` (not in this repo) as a feature/data-model reference — its module names (`items.js`, `settings.js`, `master-data.js`, `accounts.js`) are a reliable guide to what a given feature area was called and contained there, worth re-checking before designing anything that sounds like it might have a Hashir Hub equivalent. It is explicitly **not** being ported wholesale, but phase by phase, adapted to this schema rather than copied verbatim: Phase 1 was items/stock/customers/suppliers/purchase-orders/a paid-in-full "sales receipt" flow, Phase 2 added invoicing/AR, Phase 3 added Settings/master data, Phase 4 added a real, fully auto-posting double-entry ledger plus Supplier Bills (AP). Its ~30 report screens are now mostly built (§4 Reports); the ones still open are each blocked on a missing feature — see §10. **Diyar** (`diyar.app`) is a related app sharing Hashir Hub's design; the owner sometimes shares screenshots of both side by side as a design brief (Inventory Adjustment was modeled on both). Screenshots arrive in the gitignored `new updates/` folder at the repo root — treat it as a scratch drop the owner clears after each change, never commit it.

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
- **Stock quantity is never written directly.** `stock_levels.quantity` is a derived cache, kept in sync by an `AFTER INSERT` trigger on `stock_movements` (`stock_levels.quantity += NEW.quantity_delta`). The app always writes to `stock_movements` (an append-only audit log — reason: receive/sale/adjustment/transfer/void/return, reference to the originating record). This keeps `stock_levels` reads O(1) while preserving full traceability of every quantity change.
- Aggregate or cross-row queries (total stock per item across locations, low-stock report) are Postgres **views** or **RPC functions**, not client-side joins/loops. **Every view must be created `with (security_invoker = true)`.** Postgres views default to running as their *owner*, which bypasses RLS on the base tables — and Supabase grants `anon`/`authenticated` SELECT on public views by default, so a plain view leaks every org's rows to anyone holding the public anon key (which ships in the frontend bundle). This was a real bug in all five of this app's views until `20260814105000_views_security_invoker.sql` (verified before the fix: as role `anon`, `ledger_accounts` returned 0 rows but `ledger_account_balances` returned all of them). With `security_invoker`, a view applies its base tables' RLS for whoever queries it, so it needs no policy of its own.
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
                        --   category_id, brand_id, supplier_id (nullable FKs, on delete set null), avg_cost
                        --   unique index (org_id, sku); index (org_id, barcode) for fast scan lookups
                        --   sku is never typed by hand -- always assigned via next_item_sku(org_id), see below
                        --   avg_cost (added post-Phase-5): a stored, mutable Perpetual Moving Average Cost --
                        --   see the MAC paragraph below for why this is a deliberate exception to "derive,
                        --   don't store", parallel to stock_levels.quantity
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
sales_receipt_items     -- sales_receipt_id, item_id, location_id, quantity, unit_price, unit_cost, line_total
                        --   no org_id (line-item child table exception, see §3). unit_cost (added post-
                        --   Phase-5) snapshots the item's avg_cost at the moment of sale -- nullable (existing
                        --   pre-MAC rows are NULL, "no cost data", never a misleading 0)
invoices                -- org_id, invoice_number, customer_id (not null), status (unpaid/partially_paid/paid/void),
                        --   issue_date, due_date, subtotal, total, amount_paid, notes
                        --   'overdue' is NOT a stored status -- it's computed (due_date passed, balance > 0),
                        --   see outstanding_invoices below
invoice_items           -- invoice_id, item_id, location_id, quantity, unit_price, unit_cost, line_total
                        --   no org_id (line-item child table exception, see §3). unit_cost: same MAC
                        --   snapshot as sales_receipt_items.unit_cost above
invoice_payments        -- org_id, invoice_id, amount, payment_method, paid_at, notes, reference_number,
                        --   deposit_id (nullable FK to deposits, set by record_deposit -- see Stage 3 below)
                        --   append-only ledger; has its own org_id (unlike invoice_items) since it's a
                        --   plausible org-wide query target later, but NO client insert policy -- every
                        --   payment must go through record_invoice_payment so invoices.amount_paid/status
                        --   can never desync from the ledger. is_deposited is NEVER a stored column --
                        --   always derived client-side as (deposit_id is not null)
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
supplier_bills          -- org_id, bill_number, supplier_id (not null), status (unpaid/partially_paid/paid/void),
                        --   issue_date, due_date, subtotal, total, amount_paid, notes -- exact AP mirror of
                        --   invoices; exists purely so Supplier Payment has something to apply against, since
                        --   purchase_orders/purchase_order_lines carry no amount-owed concept at all
                        --   (unit_cost there is unenforced/display-only)
supplier_bill_items     -- bill_id, item_id, location_id, quantity, unit_cost, line_total
                        --   no org_id (line-item child table exception, see §3); increases stock on creation
                        --   (reason='receive', same direction as receive_purchase_order_line, not a sale)
supplier_bill_payments  -- org_id, bill_id, amount, payment_method, paid_at, notes, reference_number,
                        --   account_id (nullable FK to ledger_accounts -- which account actually paid;
                        --   null means the old Cash-or-Bank-by-payment_method default resolution was used)
                        --   exact AP mirror of invoice_payments; append-only, no client insert policy,
                        --   RPC-only writes
deposits                -- org_id, deposit_number (via next_document_number, prefix 'DEP'), account_id
                        --   (the real bank account deposited into), deposit_date, memo, total
                        --   append-only, no client insert policy -- RPC-only (record_deposit, Stage 3).
                        --   Batches one or more undeposited invoice_payments into a real bank account --
                        --   see the Undeposited Funds paragraph below
quotations              -- org_id, quotation_number (prefix 'QT'), customer_id (nullable, walk-in-friendly
                        --   like sales_receipts), status (open/void), issue_date, expiry_date, subtotal, total,
                        --   notes -- the one document type that never touches stock or the ledger (a pure
                        --   estimate); still written via create_quotation for the same atomic header+lines
                        --   shape every other document uses, just with no stock_movements/post_journal_entry
quotation_items         -- quotation_id, item_id, quantity, unit_price, line_total -- no location_id (nothing
                        --   to deduct from) and no org_id (line-item child table exception, see §3)
expenses                -- org_id, expense_number (prefix 'EXP'), expense_date, payee_supplier_id (nullable FK),
                        --   payee_name (free text, for non-supplier payees), category_account_id (FK to a
                        --   ledger_accounts row of type 'expense'), amount, payment_method, account_id (which
                        --   Cash/Bank account paid), reference_number, notes, status (completed/void) -- always
                        --   paid in full immediately (mirrors sales_receipts' shape, not supplier_bills' AP
                        --   lifecycle -- avoids a second, overlapping AP system)
credit_memos            -- org_id, credit_memo_number (prefix 'CM'), customer_id (not null), status (open/void),
                        --   issue_date, subtotal, total, notes -- a standalone credit note: creating one
                        --   immediately reduces Accounts Receivable in aggregate, no per-invoice
                        --   amount_applied tracking (deliberately the simple end of the design space -- see
                        --   the Credit Memos paragraph below for why)
credit_memo_items       -- credit_memo_id, item_id, location_id, quantity, unit_price, line_total -- has
                        --   location_id (unlike quotation_items) since returned goods really do land back in
                        --   stock somewhere; no org_id (line-item child table exception, see §3)
refunds                 -- org_id, refund_number (prefix 'REF'), customer_id (not null), refund_date, amount,
                        --   payment_method, account_id (nullable, explicit-with-fallback like supplier_bill_payments),
                        --   reference_number, notes -- standalone cash-back document, no FK to credit_memos
inventory_adjustments   -- org_id, adjustment_number (prefix 'ADJ'), adjustment_type (quantity/value/
                        --   quantity_and_value), location_id (not null), adjustment_account_id (FK
                        --   ledger_accounts), adjustment_date, reference_number, description, total_value_diff
inventory_adjustment_items -- adjustment_id, item_id, qty_on_hand_before, current_value_before, new_qty,
                        --   new_value, resulting_avg_cost, value_diff -- no org_id (line-item child
                        --   exception, see §3); unique (adjustment_id, item_id)
```

`create_sales_receipt(org_id, customer_id, payment_method, lines jsonb)` is the atomic RPC for completing a sale: computes the total server-side from `lines` (never trusts a client-sent total), validates every `item_id`/`location_id` actually belongs to `org_id` (required because SECURITY DEFINER bypasses RLS), inserts the header + line items, and inserts one `stock_movements` row per line (`reason='sale'`) which the existing trigger turns into a `stock_levels` update. No stock-sufficiency check — sales are allowed to go negative, surfacing via `low_stock_report` rather than blocking the sale.

**Invoicing (Phase 2)** follows the same atomic-RPC shape as sales receipts, plus two more RPCs for the payment lifecycle:
- `create_invoice(org_id, customer_id, due_date, lines jsonb, notes)` — same validation/total-computation shape as `create_sales_receipt`; `customer_id` is required (unlike sales receipts' walk-in-friendly nullable one); deducts stock the same way (`reason='sale'`, `reference_type='invoice'`). There is no `draft` status — like sales receipts, creation is atomic and final.
- `record_invoice_payment(invoice_id, amount, payment_method, paid_at, notes)` — inserts an `invoice_payments` row and atomically recomputes `invoices.amount_paid`/`status` in the same call. Rejects overpayment (no customer credit-balance concept exists) and payments against a voided invoice.
- `void_invoice(invoice_id)` — owner/admin only; reverses the stock deduction via a compensating `stock_movements` entry (`reason='void'`); blocked once any payment has been recorded, since there's no credit-note/refund model yet (a paid invoice's cash would have nowhere to go on void).

`dashboard_summary(org_id)` returns item/low-stock/today's-sales/outstanding-AR/overdue-invoice/customer/outstanding-AP/overdue-bill counts plus this-week and last-week revenue (calendar week, `date_trunc('week', ...)`) in one round trip; unlike the other RPCs here it's plain SQL with ordinary RLS (no `security definer`), since it only reads. It's a `RETURNS TABLE` function, so adding fields requires `DROP FUNCTION` first (`CREATE OR REPLACE` can't change a `RETURNS TABLE` column list) — this has now tripped up three migrations in a row, don't forget it on the next one. **`today_sales_count`/`today_sales_total`/`revenue_this_week`/`revenue_last_week` count both `sales_receipts` *and* `invoices`** (by `issue_date`, `status != 'void'`) — originally sales-receipts-only ("invoiced revenue isn't necessarily collected cash" per the Phase 2 comment), changed because that undercounted real activity: an invoice counts as revenue the moment it's *created* (accrual-style), not when/if it's later paid or deposited. This was a same-column-list edit (no `DROP FUNCTION` needed, the gotcha above only bites when the column list itself changes) — `outstanding_ar_total` is unaffected and still tracks unpaid/partial balance separately, since that's a balance-sheet concept, not a revenue one; both can move independently without conflicting.

**`convert_purchase_order_to_bill(po_id, location_id, due_date, notes)`**: Purchase Orders have zero financial modeling (§4 above, `unit_cost` unenforced/display-only) — this is the correct-accounting fix: a PO is intent only (no journal entry), and *converting* it to a Supplier Bill is what actually receives stock and posts to Accounts Payable (Debit Inventory as of the MAC work, was Purchases before it — see that paragraph). Internally just builds a `lines jsonb` array from `purchase_order_lines` and calls `create_supplier_bill` directly (a plain SQL call, not `supabase.rpc()`) so posting logic lives in exactly one place. Sets `quantity_received = quantity_ordered` on every line and `purchase_orders.status = 'received'`/`bill_id = <new bill>`; the new bill gets `purchase_order_id` set back to the PO (both columns added this pass, nullable, one bill per PO in v1). Blocked (clear error, not a silent no-op) if the PO already has a `bill_id`, or if any line already has `quantity_received > 0` from the old manual `receive_purchase_order_line` path — the two receiving paths don't know about each other, so mixing them on one PO would double-count stock. `PurchaseOrderDetailPage.tsx` only shows "Convert to Bill" when neither condition applies; once converted, the old per-line "Receive" UI naturally shows "Fully received" for every line since `quantity_received` was already set to match. Both `purchase_orders.bill_id` and `supplier_bills.purchase_order_id` are `on delete set null` (fixed post-launch — they originally defaulted to `NO ACTION`, which meant `reset_org_data` would fail with a `foreign_key_violation` on *any* org that had ever converted a PO, even when both "Purchase Orders" and "Supplier Bills" were selected together: the fixed deletion order processes Supplier Bills before Purchase Orders, and `NO ACTION` checks immediately rather than at transaction end, so the still-referencing PO row blocked the bill delete before its own turn came up. Reproduced against the live database inside a rolled-back transaction before fixing, confirmed clean afterward). Both links are display-only traceability (the "View converted bill" / "From purchase order" UI links), never load-bearing, so `SET NULL` is correct — same convention as `invoice_payments.deposit_id`.

**`profit_and_loss(org_id, start_date, end_date)`** is a Profit & Loss report for an arbitrary date range (Reports → Profit & Loss) — one row per active income/expense-type `ledger_accounts` row (`income`, `other_income`, `expense`, `other_expense`, `cost_of_goods_sold`) with its net activity in that range, income accounts credit-normal and expense accounts debit-normal (same sign convention as `ledger_account_balances`, just range-scoped instead of all-time). Plain SQL, ordinary RLS, same shape as `dashboard_summary`. The join from `ledger_accounts` to `journal_lines`/`journal_entries` is structured as `left join (journal_lines join journal_entries on ... and entry_date between ...) on account_id = ...` rather than two independent left joins — the date filter has to gate whether `journal_lines` matches *at all*, not just null out the `journal_entries` columns, or activity outside the range would still get summed into the total. This is what makes a zero-activity account still show up at $0 (a real P&L lists every applicable account, not just the ones with a number) while genuinely excluding anything outside the chosen range. Net profit itself isn't a returned column — it's `sum(income rows) - sum(expense rows)`, computed client-side (`src/features/reports/ProfitLossReport.tsx`), which as of the MAC work below also breaks the "expense" bucket into a **Cost of Goods Sold** table and an **Operating Expenses** table (split purely client-side on `account_type === 'cost_of_goods_sold'`, no RPC change needed since that type was already in the report's filter) and shows a **Gross Profit** line (Total Income − Total COGS) above Net Profit — Net Profit's underlying math is unchanged, this is a presentational breakdown.

**Reports** (`src/features/reports/`, migrations `20260814080000`–`20260814110000`): a Reports sidebar group plus an All Reports directory at `/reports`, both rendered from `catalog.ts` — the single source of truth, where `status: 'ready' | 'blocked'` (blocked reports are listed greyed out with the missing feature named, never routed). Every report page wraps `ReportShell` (back link, Export CSV via `csv.ts`, Print, a filter card, and the printable document header), with date-range / as-of presets from `dates.ts` (local calendar dates via `ymd()`, never `toISOString()`). **Report RPC convention**: plain `language sql stable`, SECURITY INVOKER (ordinary RLS), still filters `p_org_id` explicitly, read-only — the `profit_and_loss` shape. Shared immutable helpers `account_is_credit_normal(type)` and `account_type_sort_order(type)` — reuse them rather than re-listing the credit-normal types.
- **Financial**: `balance_sheet(org, as_of)` returns every balance-sheet account plus two synthetic equity rows (`account_id` null): *Retained Earnings* (all P&L activity before Jan 1 of the as-of year) and *Net Income* (calendar year-to-date). The ledger has no closing entries, so these rows are what make Assets = Liabilities + Equity. `trial_balance(org, as_of)`, `journal_report(org, start, end)`, and `general_ledger(org, start, end, account_id default null)` — one row per journal line carrying its account's opening balance and a window-function running balance (an account with no lines in range but a non-zero opening still gets one row, `line_id` null). The same RPC with an account id *is* the Account Statement.
- **Receivables/Payables**: `customer_balance_summary` / `supplier_balance_summary(org, as_of)`, `customer_statement` / `supplier_statement(org, party_id, start, end)` (first row is `doc_type='opening'`; within a day charges sort before payments), and `payment_collection(org, start, end)`. Balances are built from documents — invoices − payments − credit memos, and bills − bill payments — deliberately excluding refunds, which post Sales Income/Cash and never touch AR. That's what makes the totals reconcile exactly to the AR/AP GL accounts (verified).
- **Inventory**:
  - `inventory_status(org, location?, category?, supplier?)` powers Quantity On Hand, Inventory Valuation, Stock by Supplier, and the Physical Inventory Worksheet.
  - `inventory_movement(org, start, end, location?, category?)` buckets `stock_movements` into purchased, sold, returned, transferred, and adjusted. Voids net into the bucket they reverse, and `adjusted` is the catch-all, so opening + buckets = closing always holds.
  - Category filters include sub-categories (recursive CTE).
  - Valuation is stock × `avg_cost`. It can differ from the Inventory GL account where stock moved without a cost entry (credit memo returns, old PO-direct receipts).
- **Sales/Purchases**:
  - `sales_lines(org, start, end)` is the one base that `sales_by_item`, `sales_by_category`, `sales_by_customer`, and `sales_documents` aggregate, so the sales reports can never disagree with each other. It covers invoices plus sales receipts, excludes voids, and dates by `issue_date` / `created_at::date` (the dashboard's accrual rule).
  - COGS is qty × the snapshot `unit_cost`. Pre-MAC lines have a NULL cost, which sets `cost_missing` so the UI can say margins are overstated.
  - `income_by_customer` nets credit memos and refunds. Its net sales total equals the Sales Income GL activity.
  - `invoice_items_summary(org, from_number int, to_number int)` matches the numeric suffix of `invoice_number`.
  - `purchases_by_supplier` and `transactions_summary` (built on `all_transactions`).
- **Frontend conventions**:
  - Any RPC whose args are exactly `(p_org_id, p_start_date, p_end_date)` uses the generic typed `useRangeReport('fn_name', ...)` hook in `reports/api.ts`. Don't write a new hook for those.
  - Drill-downs pass `?account=` / `?customer=` / `?supplier=` plus `?from=&to=` (or `?asOf=`), which `useDateRange` / `useAsOfDate` read as their initial state.
  - Report cells (`ReportParts.tsx`) deliberately set no default text colour or conflicting padding, because `cn()` is plain `clsx` with no tailwind-merge. A caller's `className` colour only wins if the base doesn't also set one.
  - Printing: `AppLayout` and `Sidebar` carry `print:` classes that hide the app chrome and un-clip the scroll container, and `ReportShell` hides its own controls. `window.print()` therefore prints just the report document.
  - P&L moved from Account to Reports; `/account/profit-loss` redirects.

**Item SKUs are always system-assigned**, never typed by hand: `next_item_sku(org_id)` reuses the same `doc_number_counters` mechanism as `next_document_number` but is seeded to start at `100001` and returns a bare number with no prefix (`100001`, `100002`, ...). Unlike `next_document_number`, it's called directly by the client (item creation is a plain insert, not a SECURITY DEFINER RPC), so it does its own `is_org_member` check and is left executable by authenticated clients (no `revoke`).

**Supplier Bills (Phase 4 Stage 2)** is the exact AP mirror of Invoicing: `create_supplier_bill(org_id, supplier_id, due_date, lines jsonb, notes)`, `record_supplier_bill_payment(bill_id, amount, payment_method, paid_at, notes)`, `void_supplier_bill(bill_id)` — same validation/status-machine/void-blocked-once-paid shape as their invoice counterparts, with one deliberate difference: bill line items *increase* stock on creation (`reason='receive'`, same direction as `receive_purchase_order_line`) since a bill represents goods received, not sold. `outstanding_supplier_bills` is the AP mirror of `outstanding_invoices`.

**The double-entry ledger is now fully auto-posting (Phase 4 Stage 2)**. `create_journal_entry(org_id, entry_date, memo, lines jsonb, reference_type default 'manual', reference_id default null)` — the client-facing RPC Fiscal Daybook calls — remains owner/admin-only exactly as in Stage 1; it did **not** get a conditional role check, because doing so would have let any staff member call it directly from the browser console with a fabricated `reference_type` to bypass the admin gate. Instead its validation/insert logic was extracted verbatim into a private `post_journal_entry(org_id, entry_date, memo, lines jsonb, reference_type, reference_id)` with **no role check at all** (the caller's responsibility) and `revoke execute ... from public, authenticated, anon` — same technique as `next_document_number` — so it's only reachable as a plain SQL call from inside another `SECURITY DEFINER` function, never via `supabase.rpc()`. `create_journal_entry` itself is now a thin wrapper: check owner/admin, then call `post_journal_entry`.

Every money-moving RPC — `create_sales_receipt`, `create_invoice`, `record_invoice_payment`, `void_invoice`, `create_supplier_bill`, `record_supplier_bill_payment`, `void_supplier_bill`, `record_deposit` — calls `post_journal_entry` internally right before returning (skipped entirely for a $0 line, since a zero-amount leg isn't a valid journal line):
- `create_sales_receipt` → Debit Cash-or-Bank / Credit Sales Income, **plus a second, separate entry** Debit Cost of Goods Sold / Credit Inventory (only if the sold items have any cost basis — see the Perpetual Moving Average Costing paragraph below)
- `create_invoice` → Debit Accounts Receivable / Credit Sales Income, plus the same COGS/Inventory pairing as above
- `record_invoice_payment` → Debit **Undeposited Funds** / Credit Accounts Receivable (reference_id is the *payment's* id, not the invoice's — see the Undeposited Funds paragraph below for why this doesn't hit Cash/Bank directly)
- `void_invoice` → reversal of the creation entry (only reachable pre-payment, so always a clean reversal), **plus a reversal of the COGS entry** using the invoice's own stored snapshot cost
- `create_supplier_bill` → Debit **Inventory** / Credit Accounts Payable (capitalizes the purchase — see the MAC paragraph for why this isn't "Purchases" anymore)
- `record_supplier_bill_payment` → Debit Accounts Payable / Credit **the explicit `p_account_id` if given, else Cash-or-Bank** (see below)
- `void_supplier_bill` → reversal of the creation entry (now guarded — see the MAC paragraph)
- `record_deposit` → Debit `[chosen bank account]` / Credit Undeposited Funds

"Cash-or-Bank" resolves to `Cash` when `payment_method='cash'`, else `Bank` (card/bank_transfer/other all share one bank bucket — no per-payment-method account granularity beyond that split). Which literal `ledger_accounts` row each of `Cash`/`Bank`/`Accounts Receivable`/`Accounts Payable`/`Sales Income`/`Purchases`/`Undeposited Funds`/`Inventory`/`Cost of Goods Sold` resolves to is decided by `get_or_create_default_account(org_id, name, account_type)`: an idempotent lookup-by-name that auto-creates the account the first time it's needed, so posting works immediately with zero setup screen. **Caveat**: this only reuses an existing account if its name matches one of those nine *exactly* — an org that already manually created differently-named equivalents (e.g. "Cash in-hand" instead of "Cash") will end up with duplicate-looking accounts side by side in Capital Matrix; the fix is just renaming the manual one to the exact expected name (or vice versa) so future postings converge on one account. `get_or_create_default_account` is revoked from `public`/`authenticated`/`anon` the same way as `post_journal_entry`. `Purchases` itself is no longer auto-posted to by anything (see the MAC paragraph) but still exists and remains manually usable via Fiscal Daybook.

**Undeposited Funds (Phase 4 Stage 3)**: a customer payment does **not** hit a real bank account directly — `record_invoice_payment` always debits an `Undeposited Funds` holding account (`other_current_asset`), mirroring how a business actually piles up checks/cash before taking them to the bank. A separate `record_deposit(org_id, account_id, deposit_date, memo, payment_ids uuid[])` RPC later batches one or more undeposited payments into a real bank account: validates every id belongs to the org and isn't already deposited, sums them, creates a `deposits` row via `next_document_number(org_id, 'deposit', 'DEP')`, stamps `deposit_id` on each `invoice_payments` row, and posts Debit `[account]` / Credit `Undeposited Funds`. Supplier-side payments don't have this indirection — `record_supplier_bill_payment` takes an optional `p_account_id`; when given (from the Pay Bills screen) it's validated and posted to directly, otherwise it falls back to the Cash-or-Bank default (the older single-bill "Record payment" modal keeps working unchanged this way).

**Multi-document payment application**: `apply_customer_payment(org_id, customer_id, amount, payment_method, paid_at, notes, allocations jsonb, reference_number default null)` takes one lump payment and a `[{invoice_id, amount}, ...]` allocation list, validates the allocations sum to `amount`, then loops calling `record_invoice_payment` per allocation — each allocation gets its own ledger entry (a clean per-invoice audit trail in Fiscal Daybook) rather than one combined entry, and the whole call is one Postgres transaction so an invalid allocation (overpayment, voided invoice) rolls back everything. `apply_supplier_payment` is the exact AP mirror, looping `record_supplier_bill_payment`, with an added `account_id default null` param passed through per-allocation. Both RPCs' signatures changed in Stage 3 (new trailing params) — since `CREATE OR REPLACE FUNCTION` can't change an argument list without creating an ambiguous overload, the migration explicitly `DROP FUNCTION`s the old signature first, same gotcha as `dashboard_summary`'s `RETURNS TABLE` column list.

The Receive Payment / Pay Bills screens don't require the top-line "Amount" field to be filled in — it's either derived from ticking individual invoices/bills (each auto-fills with its own balance), or, if the user fills a lump amount with nothing ticked and clicks Split, distributed **equally across every open document** via a waterfall algorithm (equal share per remaining document, capped at each one's balance, remainder rolled to the rest — ported from the reference app's `rp-split`/`pb-split` handlers). The RPC-level `amount`/`allocations` contract didn't need to change for this — the frontend just always computes `amount` as the literal sum of the allocations table before calling.

**Banking** has no dedicated table — a fund transfer *is* a journal entry. `create_fund_transfer(org_id, from_account_id, to_account_id, amount, transfer_date, memo)` validates both accounts belong to the org and differ, then calls `post_journal_entry` directly with a 2-line array (Debit to / Credit from, `reference_type='fund_transfer'`). The Banking page's history is just journal entries filtered to that `reference_type`.

**Control account guardrails**: `Undeposited Funds`, `Accounts Receivable`, `Accounts Payable`, and (as of the MAC work below) `Inventory` are sub-ledger-backed — their GL balance must always reconcile to `invoice_payments`/`deposits` (Undeposited Funds), `invoices`/`supplier_bills` (AR/AP), or `stock_levels * items.avg_cost` (Inventory), and every legitimate posting to them already goes through a dedicated RPC that keeps that sub-ledger in sync. `create_journal_entry` (Fiscal Daybook) and `create_fund_transfer` (Banking) originally let a user pick *any* account, including these — manually crediting `Undeposited Funds` there would zero out its GL balance without ever touching `invoice_payments.deposit_id`, leaving a payment stuck in the Record Deposit queue forever with no GL balance behind it (and the real deposit, if made later, would double-count into Cash/Bank; the same class of desync applies to Inventory once its balance can drift from real stock valuation). `ledger_accounts.is_control_account` (a trigger-maintained, one-directional flag — only ever set `true`, e.g. on rename, never cleared, so a renamed control account fails safe rather than reopening the bug; the trigger matches `'Undeposited Funds'` and `'Inventory'` by exact name) plus a plain `account_type in ('accounts_receivable','accounts_payable')` check are enforced by a shared `assert_accounts_not_controlled(account_ids uuid[])` helper, called only from `create_journal_entry` and `create_fund_transfer` — **never** from `post_journal_entry` itself, which stays completely unrestricted since every auto-posting RPC (`record_invoice_payment`, `record_deposit`, `create_invoice`, `record_supplier_bill_payment`, `create_supplier_bill`, ...) legitimately posts to these exact accounts internally. Both screens also filter these out of their account `<Select>`s client-side (`isManuallyPostable` in `src/features/accounts/api.ts`) as defense in depth, with an explanatory note pointing at Receive Payment/Pay Bills/Record Deposit instead. `Cost of Goods Sold` deliberately does **not** get this treatment — it's a pure flow/expense account with no point-in-time balance to protect, same category as Sales Income/Purchases.

**New Journal Entry live balance hint**: selecting an account on a New Journal Entry line shows that account's current GL balance under the picker, read from the `balance` `useLedgerAccounts()` already joins in from `ledger_account_balances` (no extra query, so it's instant). Balance-sheet types (bank/asset/liability/equity) get a prominent badge — warning-toned when a true *asset* account is at zero or negative, as an "about to overdraw" cue — while income/expense/COGS accounts get plain muted text, since their balance is a period total rather than a spendable amount.

**Perpetual Moving Average Costing (MAC)** replaced `item_average_purchase_price` (a view that computed a naive lifetime-weighted-average across all non-voided supplier bills, ignoring anything already sold) with real MAC: `items.avg_cost` is a stored, sequentially-maintained value — a deliberate, narrow exception to "derive, don't store", parallel to the one existing precedent, `stock_levels.quantity` (fast reads, single controlled writer; unlike `stock_levels` there's no simple trigger, since the MAC formula is inherently sequential/order-dependent). It's written only by `recompute_item_avg_cost(item_id)`, which takes a `select ... for update` lock on the item row (a read-replay-then-write, not an atomic increment, so it needs an explicit lock to avoid a lost-update race between two concurrent supplier bills for the same item) and replays that item's `stock_movements` in `(created_at, id)` order maintaining a running `(stock, cost)` pair. The replay is deliberately a **pure function of the append-only event log** — it does **not** live-join to `supplier_bills.status` to decide whether to honor an old receipt, because an earlier version of this design that excluded a bill's receiving event once the bill was later voided made the function retroactive (voiding an old bill would silently rewrite the cost math of every purchase since), which both breaks the "corrections are a new entry, never a rewrite" convention and isn't something a user could ever audit. Instead, a receipt AND its later void compensating row are both honored as literal history, in the order they happened. Only these `stock_movements` rows affect the replay: `reference_type='supplier_bill'` with `quantity_delta > 0` (a genuine receipt — applies the moving-average formula, using an aggregate `sum(quantity*unit_cost)/sum(quantity)` blended cost per `(bill_id, item_id)` rather than picking one line, since the same item can appear twice in one bill with no unique constraint stopping it and a naive `limit 1` lookup would silently discard one line's real cost), `reference_type='supplier_bill'` with `quantity_delta < 0` (a bill's void — stock decreases, no cost impact, mirrors a sale), `reason='sale'` (stock decreases, no cost impact — the explicit rule that selling never changes avg_cost), and `reason='void', reference_type='invoice'` (a sale reversal — stock increases, no cost impact, mirrors undoing a sale). A fifth event type, `reference_type='inventory_adjustment'`, was added later — see the Inventory Adjustment paragraph below. Deliberately **not** replayed at all: transfers, *legacy* adjustments (plain `reason='adjustment'` rows written by the since-retired `AdjustStockModal`, which have no `reference_type` — Inventory Adjustment *documents* are a different thing and are replayed), `reason='return'` (credit memo returns), and `reference_type='purchase_order_line'` (the old direct-PO-receiving path, which has always had zero financial modeling). Their stock still updates `stock_levels` normally — they're just invisible to *cost* — a documented limitation, not a bug, and the reason the replay's internal stock counter can diverge from real `stock_levels` for items with legacy-adjustment/return/PO-direct-receive activity.

`create_supplier_bill` calls `recompute_item_avg_cost` per line after inserting its `stock_movements` row (redundant-but-harmless if the same item appears twice in one bill, since the function always does a fresh full replay and the last call wins). `create_invoice`/`create_sales_receipt` do the opposite: read the item's **current** `avg_cost` with a plain `select` (never a replay — it's always kept current by purchases, and sales never change it), snapshot it onto that line's `unit_cost`, and accumulate total COGS across the sale for the second journal entry described above. `void_invoice` reverses using the invoice's **own stored snapshot** `sum(quantity * unit_cost)`, not the item's possibly-since-changed current `avg_cost` — exactly why the snapshot column exists — and does not call `recompute_item_avg_cost`, since undoing a sale doesn't touch avg_cost either. `void_supplier_bill` gained a stock-sufficiency guard: blocked if any *other* `stock_movements` row exists for any item on the bill, timestamped after the bill's own receiving movement — i.e. voiding only works if literally nothing has touched that item's stock since. This is stricter than "just don't let stock go negative": once units are blended into a moving average, a later void can't cleanly attribute cost back to just one bill (MAC is deliberately batch-blind), so rather than accept a mismatched reversal or a variance line this app doesn't model, voiding becomes a narrow "catch it immediately" tool (consistent with `void_invoice` already being narrow — blocked once any payment exists). Given the guard, the reversal is always an exact dollar-for-dollar undo, so no recompute call is needed on void.

This is a real re-architecture, not additive: expensing the full purchase to "Purchases" immediately **and** expensing COGS at sale time would double-count, so `create_supplier_bill`/`void_supplier_bill` capitalize to **Inventory** (`other_current_asset`) instead of expensing to Purchases (see the posting-model bullets above) — "Purchases" still exists and is still manually usable via Fiscal Daybook, it's just not auto-posted-to by bills anymore. This app has real historical data, so the migration that shipped this (`20260814050000_perpetual_moving_average_costing.sql`) did three things on top of the schema/function changes: (1) seeded `avg_cost` for every item with purchase history via `recompute_item_avg_cost`; (2) deliberately did **not** backfill `unit_cost` on existing `invoice_items`/`sales_receipt_items` rows (left `NULL` — `void_invoice` only works pre-payment, so old invoices are almost certainly already paid and unvoidable, meaning a replay-per-historical-line backfill would mostly serve cosmetic old tooltips) and deliberately did **not** retroactively post COGS into historical P&L periods (mass-backdating journal entries into a live ledger is exactly what the append-only convention exists to prevent — old sales keep showing $0 COGS in past periods, nothing rewritten); (3) posted a one-time **cutover entry** per org, Debit Inventory / Credit Purchases for `sum(stock_levels.quantity * avg_cost)` across whatever's currently on hand, dated at cutover (not backdated) — the standard way to convert from expense-method to perpetual-asset costing mid-stream: it seeds Inventory to a reconciled starting balance and reduces Purchases by exactly the value of what's still unsold, without touching any past P&L period's reported numbers. `reset_org_data` mirrors its existing "rebuild `stock_levels` from surviving `stock_movements`" step with an analogous `recompute_item_avg_cost` pass over every surviving item, and its `'ledger_entries'` category also now sweeps up `reference_type='inventory_cutover'` entries (grouped with `manual`/`fund_transfer` rather than its own category, since it's a one-time administrative entry, not a document type) — without that, a Chart of Accounts wipe would permanently fail with a `foreign_key_violation` once a cutover entry exists and still references the account being deleted.

Tooltips on New Sale/New Invoice and a read-only "Avg. cost" column on Price Manager all read `items.avg_cost` directly (it rides along for free on the existing `useItems()` fetch — no separate query, unlike the old view-backed hook it replaced).

`ledger_account_balances` is a view, not a stored column, computing each account's balance from `journal_lines` with the sign flipped for credit-normal account types (income/equity/accounts_payable/other_current_liability/long_term_liability/other_income) vs debit-normal (everything else).

**Business Hub (Phase 5)** adds Inventory Transfer, a promoted Inventory Adjustment, and four new document types, plus an All Transactions directory:
- **Inventory Transfer**: `create_stock_transfer(org_id, item_id, from_location_id, to_location_id, quantity, transfer_date, notes)` — the one genuinely new stock-only RPC. Unlike the pre-existing `AdjustStockModal` (a plain client-side single-row insert — `stock_movements` has always had a direct insert policy for org members), a transfer needs two coordinated rows (`-qty` at source, `+qty` at destination) to succeed or fail together, so it's a real RPC. No dedicated table — like Banking's fund transfers, the two rows share a `reference_id` and are grouped client-side for display. `stock_movements.reason = 'transfer'` has existed since Phase 1 but nothing wrote it until this RPC.
- **Inventory Adjustment** originally stayed a plain `stock_movements` insert via `AdjustStockModal` (now also reachable from its own Business Hub page, not just the Stock page) — later rebuilt into a real document with ledger and MAC impact; see the dedicated paragraph below (`AdjustStockModal` no longer exists).
- **Quotations**: `create_quotation(org_id, customer_id, expiry_date, lines jsonb, notes)` / `void_quotation(quotation_id)` — see table sketch above.
- **Expenses**: `create_expense(org_id, expense_date, payee_supplier_id, payee_name, category_account_id, amount, payment_method, account_id default null, reference_number, notes)` posts Debit `category_account_id` / Credit (`account_id` if given, else Cash-or-Bank-by-`payment_method`) immediately. `void_expense(expense_id)` reverses it.
- **Credit Memos**: `create_credit_memo(org_id, customer_id, lines jsonb, notes)` — per line, inserts a **positive** `stock_movements` row (`reason='return'`, goods physically coming back — `stock_movements_reason_check` was widened to add `'return'` alongside the existing `receive`/`sale`/`adjustment`/`transfer`/`void`), then posts Debit `Sales Income` / Credit `Accounts Receivable` for the total. `void_credit_memo(credit_memo_id)` reverses both the stock and the ledger entry; blocked only once already void (there's no payment lifecycle to check, unlike `void_invoice`).
- **Refunds**: `create_refund(org_id, customer_id, amount, payment_method, account_id default null, refund_date, reference_number, notes)` posts Debit `Sales Income` / Credit (`account_id` if given, else Cash-or-Bank) — a direct revenue reversal + cash out, **not** an Accounts Receivable entry, since refunding isn't collecting a receivable (same reasoning as `void_invoice`'s reversal direction). No void RPC — nothing else in this app supports undoing a reversal either.
- **`all_transactions`** is a directory view, not a full ledger — one row per top-level document (`doc_type`, `doc_id`, `doc_number`, `txn_date`, `party_name`, `total`, `status`) `union all`'d across `sales_receipts`, `invoices`, `supplier_bills`, `purchase_orders`, `expenses`, `quotations`, `credit_memos`, `refunds`. Purchase orders have no real document-number concept (CLAUDE.md has always noted POs are purely stock-receiving), so their row synthesizes one (`'PO-' || substr(id, 1, 8)`) purely for display. Needs no policy of its own — `security_invoker = true` makes it apply the base tables' RLS (see the views rule above).
- **Item cost tooltips** on New Sale / New Invoice and Price Manager originally read from `item_average_purchase_price`, a view computing a naive lifetime weighted average across supplier bills (itself a replacement for an even earlier `item_last_purchase_price`, most-recent-price-only view). Both are now fully superseded by real Perpetual Moving Average Costing — see the MAC paragraph earlier in this section — which additionally feeds real COGS into the ledger and P&L, not just a display tooltip.

Credit Memos and Refunds close the "no credit-note/refund model yet" gap this app carried since Phase 2 (overpayment used to be rejected outright because there was nowhere for the excess to live) — deliberately at the simple end of the design space: no per-invoice "apply a credit" step, no `amount_applied` tracking. A credit memo's AR reduction is immediate and aggregate; if a business wants to track that a specific credit "paid for" a specific later invoice, that's a bookkeeping note today, not a modeled relationship.

**Inventory Adjustment (rebuilt post-Phase-5)** replaced `AdjustStockModal` (a bare quantity tweak, zero ledger impact) with a real document — `inventory_adjustments`/`inventory_adjustment_items` — modeled on two reference apps' shared design: three modes (Quantity / Value / Quantity and Value), a chosen Adjustment Account the value swing posts against, and read-only Qty-on-hand/Current-Value columns pulled live from the system. `create_inventory_adjustment(org_id, location_id, adjustment_type, adjustment_account_id, adjustment_date, reference_number, description, lines jsonb)` mirrors `create_credit_memo`/`create_expense`'s exact shape. Per line: **Quantity** type computes the value automatically (`new_qty * current avg_cost`) and never changes `avg_cost` — treated exactly like a sale/return for costing purposes. **Value**/**Quantity and Value** types let the user set a new value directly, which *does* change `avg_cost` — computed org-wide, not just for the adjusted line's location (`resulting_avg_cost = (value still on hand at every other location + this line's new value) / (quantity still on hand at every other location + this line's new quantity)`), since `items.avg_cost` is a single item-wide rate but an adjustment document is scoped to one location. Every line always inserts a `stock_movements` row (`reason='adjustment'`, `reference_type='inventory_adjustment'`) **even at a zero quantity delta** (a pure Value adjustment doesn't move physical stock) — this is the only anchor `recompute_item_avg_cost`'s replay has to find and re-apply the correction later.

This directly extends the MAC replay rather than inventing a parallel mechanism: `recompute_item_avg_cost` gained `reference_type = 'inventory_adjustment'` as one more event type, alongside `supplier_bill`/`sale`/`invoice-void` — `v_running_stock += quantity_delta`, then an **unconditional overwrite** of `v_running_cost` from that line's stored `resulting_avg_cost` (looked up from `inventory_adjustment_items`, unique per `(adjustment_id, item_id)` so — unlike `supplier_bill_items` — no blended-lookup is needed). No type branching inside the replay: a Quantity-type line's stored `resulting_avg_cost` is simply the unchanged current cost at creation time, so replaying it is always a correct no-op overwrite. An earlier design considered a "reset point" that seeded the replay from the most recent adjustment and skipped everything before it — rejected after review found it (a) used a single location's quantity as if it were the item's org-wide total, silently wrong for any multi-location item, and (b) relied on `created_at` as a hard cutoff, which isn't a true happens-before guarantee under concurrent transactions and could double-count or permanently drop a movement depending on commit order. Folding into the uniform replay instead preserves the original engine's "pure function of the append-only log, safe to call from anywhere, last-call-wins, self-healing" property. `create_inventory_adjustment` takes the same `select ... for update` item lock as `recompute_item_avg_cost` before reading `stock_levels`/`avg_cost`, so a concurrent adjustment or supplier bill on the *same* item can't interleave.

`reset_org_data`'s existing `'inventory_activity'` category ("Inventory Transfers & Adjustments" — no new category was added) now also deletes `inventory_adjustments`/`inventory_adjustment_items` and their `journal_entries`, alongside its existing `stock_movements` cleanup.

Both the Stock page's old quick-adjust shortcut and the Business Hub tab now go through this one document (`/inventory-adjustments/new`) — there is no separate fast/no-accounting path anymore, per explicit instruction to retire it rather than keep two divergent tools.

**Reset Data (Settings → Reset Data)** is the most destructive capability in the app — a self-serve, granular wipe built for clearing test/demo activity now and clearing it again at customer handover time, when a developer may not be available. `reset_org_data(org_id, categories text[])` is gated stricter than every other destructive RPC here: **owner-only** (`org_role(org_id) = 'owner'`, not `in ('owner','admin')`). The frontend adds its own layers on top per an explicit user request — real password re-entry (`supabase.auth.signInWithPassword`, not a stored PIN) plus a "type RESET" phrase — but the RPC itself is the actual safety boundary, not the UI.

`p_categories` is a flat array of ~16 keys (`sales_receipts`, `invoices`, `supplier_bills`, `purchase_orders`, `quotations`, `credit_memos`, `refunds`, `expenses`, `inventory_activity`, `ledger_entries`, `items`, `customers`, `suppliers`, `locations`, `reference_data`, `chart_of_accounts` — see `RESET_DATA_CATEGORIES` in `src/features/settings/api.ts`, the single source of truth the checklist UI renders from). Deletes always run in a fixed safe order internally (transactional categories first, each also clearing its own `stock_movements`/`journal_entries` by `reference_type`; then a full `stock_levels` rebuild — delete-all-and-reinsert as `sum(quantity_delta)` grouped by item+location from whatever `stock_movements` survive, correct under *any* partial selection, not just a full reset; then master data) regardless of what order the array was passed in.

**Deliberately no hand-maintained dependency table.** The real foreign keys already encode what blocks what (e.g. `invoice_items.item_id` has no cascade, so Items can't go while Invoices survive; `items.category_id`/`brand_id`/`supplier_id` are `on delete set null` per §4 above, so Categories/Suppliers *can* go standalone) — the whole delete block runs inside `exception when foreign_key_violation`, which uses `get stacked diagnostics ... = table_name, ... = constraint_name` to name the actual blocking table in a specific, actionable re-raised message. Since it's one transaction, a rejected combination leaves the org completely untouched — never half-wiped. After the deletes, `doc_number_counters` rows are dropped per doc-type **only if that type's table is now empty for the org** (so partially wiping, say, only Sales Receipts doesn't reset the shared `journal_entry` counter while Invoices' journal entries still exist, which would otherwise collide on the next auto-post).

Example low-stock view:

```sql
create view public.low_stock_report as
select sl.org_id, sl.item_id, sl.location_id, sl.quantity, i.reorder_threshold
from stock_levels sl
join items i on i.id = sl.item_id
where sl.quantity <= coalesce(i.reorder_threshold, 0);
```

`outstanding_invoices` is the equivalent lightweight view for AR: unpaid/partially-paid invoices joined to customer name, with `balance` and `is_overdue` computed columns (not stored on `invoices` itself — same "derive, don't store" reasoning as `low_stock_report`). `outstanding_supplier_bills` is its AP counterpart (§4 above).

## 5. Folder Structure

```
/
├── CLAUDE.md
├── package.json / vite.config.ts / tsconfig.json
├── .env.example                   -- VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
├── index.html                     -- the app's only <head>: title "HashirHub", favicon/icon/apple-touch/
│                                     manifest links, theme-color (this is a Vite SPA -- there is no
│                                     Next.js-style app/layout.tsx; translate such requests to here + public/)
├── public/                        -- static assets served at the base path: favicon.ico (16/32/48 ICO),
│                                     icon.svg, icon.png (512), apple-icon.png (180), icon-192/512.png,
│                                     manifest.json (PWA install icons)
├── new updates/                   -- owner's scratch drop for reference screenshots; gitignored, never commit
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
│   │   ├── sales/                 -- barcode-driven sales receipt flow ("Sales Receipt" in the sidebar)
│   │   ├── invoices/              -- credit sales / accounts receivable
│   │   ├── supplier-bills/        -- goods received / accounts payable (AP mirror of invoices/)
│   │   ├── settings/              -- Company Info, Stores/Warehouses, Price Lists, Categories, Brands,
│   │   │                             Units, Regions & Areas, Reset Data -- all flat routes, no shared
│   │   │                             layout component
│   │   ├── accounts/              -- Capital Matrix, Fiscal Daybook, Receive Payment, View Payments,
│   │   │                             Record Deposit, View Deposits, Pay Bills, View Paid Bills, Banking
│   │   ├── transactions/          -- All Transactions directory (Phase 5)
│   │   ├── inventory/             -- Inventory Transfer + Inventory Adjustment. Adjustment was rebuilt
│   │   │                             post-Phase-5 into a real List/New/Detail document (§4) -- the old
│   │   │                             stock/AdjustStockModal.tsx no longer exists
│   │   ├── expenses/              -- Phase 5, paid-in-full-immediately (mirrors sales/'s simplicity)
│   │   ├── quotations/            -- Phase 5, standalone estimates -- never touch stock or the ledger
│   │   ├── credit-memos/          -- Phase 5, standalone customer credit notes (AR mirror of a return)
│   │   ├── refunds/               -- Phase 5, standalone cash-back documents
│   │   ├── reports/               -- Reports section: catalog.ts (directory + sidebar source of truth),
│   │   │                             ReportShell/ReportControls/ReportParts, dates.ts, csv.ts, one page per
│   │   │                             report (P&L lives here now, not accounts/) -- see §4 Reports
│   │   └── dashboard/
│   ├── components/
│   │   ├── ui/                    -- hand-owned primitives (Button, Input, Card, Table, Modal, ...)
│   │   └── layout/                -- AppLayout (owns sidebarOpen + hamburger), Sidebar (accordion nav,
│   │                                 off-canvas drawer below lg -- see below and §9)
│   └── types/                     -- generated via `supabase gen types typescript`
├── docs/onboarding-new-client.md  -- non-developer runbook for provisioning a new client org
└── .github/workflows/deploy.yml
```

**Navigation**: `Sidebar.tsx` is an accordion, not a flat list — Items/Business Hub/Account/Reports/Settings are collapsible groups whose sub-links render indented beneath them (only one top-level group open at a time; auto-expands on load if the current route falls under it). This replaced an earlier design where each section had its own horizontal tab bar at the top of the page (`ItemsLayout.tsx`/`SettingsLayout.tsx`, both now deleted) — routes are flat (`/items/list`, `/settings/brands`, `/account/capital-matrix`, `/expenses`, etc.) with the Sidebar as the only sub-navigation. Follow this pattern for any new multi-page feature section rather than reintroducing an in-page tab bar.

The Account group additionally nests a **second accordion level** (`NavChild` can itself be a `type: 'group'`, not just a leaf) — Customer Payment (Receive Payment/View Payments/Record Deposit/View Deposits) and Supplier Payment (Pay Bills/View Paid Bills) are sub-groups within Account, each with its own independent open/closed state (`openSubGroup`) alongside the top-level `openGroup`. Business Hub's order is owner-specified, not alphabetical: All Transactions, Purchase Orders, Supplier Bills, Expenses, Suppliers, Customers, Stock, Sales Receipt, Invoices, Inventory Transfer, Inventory Adjustment, Quotations, then **Credit Memos & Refunds** — a nested sub-group using the same second-level pattern, since those two are naturally paired. Everything else in Business Hub stays flat. The **Reports** group is generated from `features/reports/catalog.ts`: an "All Reports" leaf (`end: true` on `NavLeaf` makes it match `/reports` exactly instead of every `/reports/*` path) plus one sub-group per report category with at least one ready report. Reach for the second-level pattern only when a group's children are themselves naturally paired sub-screens (like Receive/View/Deposit or Credit Memos/Refunds), not just "there are a lot of them."

The sidebar header is the HashirHub icon + name and links to `/` (Dashboard). Its `<img>` uses `` `${import.meta.env.BASE_URL}icon.png` `` rather than a bare `/icon.png` — see §9. Below the `lg` breakpoint the whole sidebar becomes an off-canvas drawer (hamburger in the top header, backdrop to dismiss, and every `NavLink` calls `onClose` so tapping a destination closes it); at `lg` and up it's the same static column as always.

## 6. Dev Commands

- `npm run dev` / `npm run build` — frontend
- `supabase start` — local Supabase dev stack
- `supabase migration new <name>` — new migration
- `supabase db push` — apply migrations to the linked project
- `supabase gen types typescript --project-id <id> > src/types/supabase.ts` — regenerate types after every migration; never let them drift
- `supabase db query --linked "<sql>"` (or `-f <file>.sql`) — run SQL directly against the live linked project without opening the Dashboard SQL editor; useful for verifying an RPC/migration from the terminal. To exercise RLS as a specific member instead of the raw connection role, prefix with `select set_config('request.jwt.claims', json_build_object('sub','<user-uuid>','role','authenticated')::text, false); select set_config('role','authenticated', false);` in the same script/file.
- If `supabase`/`npm`/`node` aren't found in a given shell, they're very likely installed but PATH wasn't reloaded into that shell session — open a fresh terminal before assuming something is missing. On the owner's laptop the bare `supabase` command isn't on PATH for automated shells at all; **`npx supabase ...` always works** — use that for every command above.

**Accounts & auth (this laptop is dedicated to this project)**:
- **Supabase**: project `inventory-app`, ref `qkxquryxqpwsckdezxjh`. The CLI is authenticated with a personal access token (`npx supabase login --token <sbp_...>`) — the interactive browser login fails in non-TTY shells. `npx supabase link` returns a 403 with this token, but that's harmless: the project is already linked locally, and `db push`, `db query --linked`, `migration list --linked`, and `gen types` all work. First thing to check if anything Supabase-related 403s: `npx supabase projects list` must show `inventory-app` — if it shows other projects, the CLI was logged into a different account and needs `login --token` again.
- **GitHub**: repo `github.com/invento1/inventory-app`, pushed as the **`invento1`** account. Git credentials for `github.com` are routed through the **GitHub CLI** (`credential.https://github.com.helper = !gh auth git-credential` in the global `~/.gitconfig`), *not* Git Credential Manager — so `git credential approve`/GCM changes have no effect; check and fix with `gh auth status` / `echo <token> | gh auth login --with-token`. Commits are authored as `hashirhub-uk <yasir.visal@gmail.com>` (the local git identity) — that's expected and differs from the pushing account on purpose; don't change it. Verify push access non-destructively with `git push --dry-run`.

**Testing gotchas against the live database**:
- `db query --linked -f <file>.sql` runs the **whole file as one transaction** and returns **only the last statement's result set** — put one check per invocation if you need to see several results. Because it's one transaction, every row inserted in that file gets the **same `now()`/`created_at`**; the MAC replay orders events by `(created_at, id)`, so two RPC calls that must happen in sequence (e.g. a supplier bill, then an inventory adjustment) have to be separate invocations or the tiebreak by random UUID can reorder them and produce a wrong-looking `avg_cost`. In real use every RPC call is its own transaction, so this only bites tests.
- To exercise a destructive RPC (e.g. `reset_org_data`) against **real** data with zero risk, wrap it: `begin; <jwt prefix>; select reset_org_data(...); <check query>; rollback;` — explicit `begin`/`rollback` inside the file works with this tool. This is how the Reset Data FK bug was reproduced safely.
- Throwaway test data (items, bills, etc.) created while verifying must be deleted afterwards in FK-safe order: `journal_lines` → `journal_entries` → line items → `stock_movements` → headers → `stock_levels` → `items`. `journal_entries` has no delete policy, so cleanup must run **without** the RLS/JWT prefix.

**Windows shell gotcha**: never bulk-edit source files with PowerShell `Get-Content`/`Set-Content` — they mis-decode UTF-8 and silently turn `…` into `â€¦` (and `—` into `â€"`) in every file touched. It happened once across 23 files and had to be reverted. Use the Edit tool, or a Node script (`fs.readFileSync(f, 'utf8')` / `writeFileSync`). After any bulk edit, `grep -rl 'â€' src/` must return nothing.

## 7. Environment Variables

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — the anon key is safe to ship client-side; RLS is the real security boundary.
- `.env` is never committed. `.env.example` documents the required keys with placeholder values.
- The `service_role` key is never an env var read by frontend code.

## 8. Deployment Process

- GitHub Actions builds and deploys the Vite app to GitHub Pages on push to `main`. Live site: **https://invento1.github.io/inventory-app/** (`vite.config.ts` has `base: '/inventory-app/'`).
- **Verify a deploy against GitHub, not local git state** — a clean `git push` doesn't mean the Pages deploy succeeded (the `actions/deploy-pages` step has failed on GitHub's side before, fixed by pushing an empty retrigger commit). There's no `gh`-based check needed; the public API works unauthenticated: `curl -s "https://api.github.com/repos/invento1/inventory-app/actions/runs?per_page=1"` and confirm `head_sha` matches the pushed commit with `status: completed`, `conclusion: success`. A deploy typically takes 30–90s and can sit in `queued`/`waiting` for a while first.
- GitHub Pages caveats to remember: static hosting only (no server secrets); client-side routing needs `HashRouter` or a manual 404 fallback since Pages doesn't support arbitrary rewrites; a custom domain needs a `CNAME` file in `public/`.
- Supabase migrations (`supabase db push`) are a **separate, deliberate step** — not auto-run on every frontend deploy — to avoid accidentally applying schema changes alongside an unrelated UI deploy.

## 9. Coding Conventions

- TypeScript strict mode. Use the generated Supabase types everywhere; no `any` for database rows/queries.
- Prefer RPC functions or views for anything aggregate; avoid N+1 client-side query patterns.
- Realtime subscriptions are used sparingly, only where live updates earn their cost (e.g. a shared stock view multiple staff are looking at concurrently) — not wired in by default across the whole app.
- Every Supabase client query filters by `org_id` explicitly, per §3.
- **Colours come only from the theme tokens** in `src/index.css`'s `@theme` block — `primary` (navy, primary buttons), `accent-*` (indigo: active nav, links, focus rings), surfaces (`surface`, `surface-muted` = slate-50), borders (`border` = slate-200/80 for cards, `border-strong` = slate-300 for form controls and outline buttons, `divider` = slate-100 for table rows), a text hierarchy (`text` slate-900, `text-secondary` slate-700, `text-muted` slate-500 labels, `text-subtle` slate-400 icons/placeholders), and the semantic pairs `success`/`warning`/`danger`/`info` (`-50` pastel background; `-600` is deliberately the *dark* text shade — emerald-700 / amber-700 / rose-600 / slate-600 — so badges, error text, and negative amounts clear WCAG AA 4.5:1; `danger-700` for hover). Never use raw Tailwind palette classes (`bg-white`, `text-red-600`, `text-slate-400`, ...) — use the token — so a re-theme stays a one-file edit. Depth/motion tokens: `shadow-card` (+ `hover:shadow-card-hover` on `Card`), `shadow-button`, `shadow-control`, `animate-fade-in`/`animate-modal-in` (always behind `motion-safe:`). Every text-like form control — including the few hand-rolled `<input>`/`<textarea>` on pages — uses `fieldBase`/`fieldError` from `src/components/ui/fieldStyles.ts`. Table/report cells never set a default text colour (`cn()` is plain clsx, so a default `text-text` would silently beat a caller's `text-danger-600`).
- **Never hardcode a currency symbol.** Every money value is displayed via `formatMoney(value, currencySymbol)` (`src/lib/currency.ts`), with `currencySymbol` read from `useOrg()` (sourced from `orgs.currency_symbol`, editable on the Company Info settings page). `formatMoney` also drops trailing `.00` on whole amounts and adds thousands separators — don't hand-roll `` `$${x.toFixed(2)}` `` anywhere.
- **Responsive layout (mobile + desktop)** — every page must work at phone width:
  - Form grids are never a bare `grid-cols-N`. Start at one column and step up: `grid-cols-1 sm:grid-cols-2` for 2-up, `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` (or `lg:grid-cols-4`/`lg:grid-cols-5`) for wider rows. Two-panel page layouts use `grid-cols-1 lg:grid-cols-3` with `lg:col-span-*` on the children (see New Sale's cart/summary split). Dashboard stat cards are `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`.
  - Multi-field line-item rows (`grid-cols-12` with `col-span-*` children — Invoice, Supplier Bill, Quotation, Credit Memo, Purchase Order, Sales Receipt cart) are **not** restacked; the list of rows is wrapped in `<div className="overflow-x-auto"><div className="flex min-w-[640px] flex-col gap-3">…</div></div>` so it scrolls sideways on phones, with the "Add line" button outside the scroll wrapper. `Table` already wraps itself in `overflow-x-auto`, so tables need nothing extra.
  - `PageHeader` wraps (`flex-wrap`) so a long title and its action button stack instead of overflowing. The top header hides the user's email and the "Sign out" label below `sm`, and `main` padding is `p-4 sm:p-6`.
  - The sidebar is an off-canvas drawer below `lg` (§5). New nav links must pass `onClick={onClose}` like the existing ones, or they'll navigate without closing the drawer on mobile.
- **Asset paths under the GitHub Pages base**: the app is served from `/inventory-app/`, not `/`. Tags in `index.html` can use root paths (`/favicon.ico`) — Vite rewrites them at build time. But anything referenced from TSX (e.g. an `<img src>` for a file in `public/`) must be `` `${import.meta.env.BASE_URL}file.png` ``; a bare `/file.png` works in `npm run dev` and breaks on the deployed site.
- **Auth callback / HashRouter gotcha**: Supabase's default invite/recovery email links return the session as `#access_token=...` in the URL hash, which collides with `HashRouter`'s own use of `#` for routing. `main.tsx` consumes that callback itself (parses the hash, calls `supabase.auth.setSession`, rewrites the URL to a clean `#/...` route) *before* `HashRouter` ever mounts, and `supabaseClient.ts` sets `detectSessionInUrl: false` so supabase-js doesn't race it. Don't re-enable `detectSessionInUrl` or move auth-callback handling into a component that mounts after the router without re-reading that code path first.

### Visual design reference

- **Target look**: `public/refernce image made by chatgpt.png` (sic — the filename's spelling is the owner's) is a ChatGPT-made mockup of the dashboard that sets the visual direction: slate/indigo palette, and soft floating sea-wave gradients, styled after the NHS Aqua Theatre management system layout. The waves sit at the bottom-left of the layout behind the sidebar, with a tinted wave in the bottom-right corner of each metric tile. Re-read it before any visual or theme work. It is **gitignored and local only**: it shows real account data (the owner's email, org data), the repo is **public**, and everything in `public/` is also served as-is on the live site. Never commit it or move it somewhere tracked. If a future session needs the design shared, describe it rather than publishing the screenshot.
- **Ambient waves** (`src/components/layout/WaveBackground.tsx`):
  - **Layer:** a fixed, full-width, `pointer-events-none`, `overflow-hidden` layer at `z-0` along the bottom of the viewport, rendered first inside `AppLayout`.
  - **Stacking:** the content column is `relative z-10`. The sidebar is `lg:relative lg:z-10` with a translucent `lg:bg-surface/45 lg:backdrop-blur-md`, so the swell shows through behind it on desktop; on mobile it stays an opaque drawer.
  - **Shapes:** three stacked SVG waves (back, middle, front) coloured by `--color-wave-back`, `--color-wave-middle` and `--color-wave-front` in the `@theme` block. Each is a 200%-wide path holding two identical periods, so the `floatWave` keyframe (translateX 0 to -50%) loops seamlessly.
  - **Motion:** an outer `waveSwell` keyframe adds a vertical bob. Timings are staggered 12s/16s/22s with alternating directions (`.hub-wave--*` in `index.css`). All motion is transform-only CSS (no JS), frozen under `prefers-reduced-motion`, and hidden in print.
  - **Fade:** a left-to-right mask keeps it strongest at the bottom-left.
  - **New layouts:** any new full-page layout that should share the look must keep its content above `z-0`.
- **Tile corner waves** (`src/components/ui/CornerWave.tsx`): a static decorative SVG in the bottom-right of a card, drawn in `currentColor`, so the caller picks the hue with a text colour class. The dashboard passes each tile's icon `text-*` tone. The card must be `relative overflow-hidden`, and its content `relative` so it paints above the wave.

## 10. Roadmap / Out of Scope

- No Google Sheets data migration needed — starting fresh.
- **Phase 1** (shipped): items, stock (levels/movements/adjustments), suppliers, purchase orders + receiving, customers, a walk-in paid-in-full sales receipt flow (barcode/SKU lookup via USB scanner input, no camera scanning yet), a basic dashboard. No public signup — new client orgs are provisioned manually, see `docs/onboarding-new-client.md`.
- **Phase 2** (shipped): invoicing / accounts receivable — credit sales to a required customer, due dates, partial payments over time via an `invoice_payments` ledger, computed (not stored) overdue status, and voiding (blocked once any payment is recorded — `void_invoice` still isn't credit-memo-aware even after Phase 5 added Credit Memos, see below; a paid invoice's cash has nowhere to go on a plain void). Dashboard extended with outstanding-AR total and overdue-invoice count.
- **Phase 3** (shipped): Settings section — Company Info (name/address/contact/currency, feeds `formatMoney` everywhere and will feed future printed documents), Stores/Warehouses (the existing `locations` table split by a new `type` column), Price Lists (a dated document log, not a pricing engine), and master data — Categories (hierarchical), Brands, Units of Measure, and Regions & Areas — wired into `items`/`customers` with inline "+" quick-add from their forms, not just standalone reference lists.
- **Phase 4, Stage 1** (shipped): double-entry ledger — Chart of Accounts ("Capital Matrix") and General Journal ("Fiscal Daybook"), see §4. Real (accounts carry derived, always-balanced balances; journal entries must balance to post) but at this stage still manual only.
- **Phase 4, Stage 2** (shipped): Supplier Bills (AP mirror of invoices, see §4), Customer Payment and Supplier Payment screens (multi-invoice/bill payment application — one lump payment applied across several open documents in one atomic call, not just a launcher in front of the single-document "Record payment" modal), Banking (simple fund transfer between two ledger accounts), and full auto-posting — every money-moving RPC now posts a balanced journal entry via the private `post_journal_entry`/`get_or_create_default_account` helpers (§4). Sales-side postings are revenue-only (Debit Cash/AR, Credit Income) and bill-side postings are plain expense recognition (Debit Purchases, Credit AP) — this app still has no per-item cost basis (`items.cost_price` doesn't exist), so true COGS/Inventory-asset postings still aren't possible without also building weighted-average costing. *(Since built — Perpetual Moving Average Costing replaced the Purchases-at-bill-time posting; see §4 and the Phase 5 bullet below.)*
- **Phase 4, Stage 3** (shipped): the Customer Payment / Supplier Payment single pages from Stage 2 were split into the reference app's actual structure — **Receive Payment / View Payments / Record Deposit / View Deposits** (customer side) and **Pay Bills / View Paid Bills** (supplier side), all as flat sidebar entries under the Account group (§5). This introduced the **Undeposited Funds** workflow Stage 2 deliberately deferred: `record_invoice_payment` now debits `Undeposited Funds` instead of Cash/Bank directly, and a new `record_deposit` RPC + `deposits` table batches undeposited payments into a real bank account (see §4's Undeposited Funds paragraph) — the supplier side didn't need this indirection, it just gained an explicit `p_account_id`/reference-number pair on `record_supplier_bill_payment`. Receive Payment/Pay Bills also gained the "lump sum → Split" equal-allocation tool (§4). View Payments/View Deposits/View Paid Bills are deliberately **read-only** history lists (click through to the parent document) rather than the reference app's edit/delete-and-redo pattern, staying consistent with this codebase's append-only-ledger convention.
- **Phase 5** (shipped): **Business Hub** — a new sidebar group nesting the existing Stock/Suppliers/Purchase Orders/Customers/Sales (relabeled "Sales Receipt")/Invoices/Supplier Bills tabs alongside 7 new ones. Of those 7: **Inventory Transfer** and a promoted **Inventory Adjustment** are pure stock operations (§4); **Expenses**, **Quotations**, **Credit Memos**, and **Refunds** are new document types (§4); **All Transactions** is a read-only directory view spanning every document type. Credit Memos + Refunds close the "no credit-note/refund model" gap noted since Phase 2 — see §4's Credit Memos paragraph for the deliberately simple scope (no per-invoice apply/`amount_applied` tracking). Also added: `item_average_purchase_price` (§4, later corrected from a "most recent price" view to a true weighted average — see below), surfaced as a hover tooltip on the unit price field in New Sale/New Invoice, and per-line on-hand quantity (from `stock_levels`, keyed by the line's chosen item+location) in both of those same forms — neither required a schema change to `items` itself, `items.cost_price` still doesn't exist. Also added **Reset Data** (Settings → Reset Data, §4) — a granular, owner-only, password-re-gated wipe built for clearing test activity now and doing the same at customer handover time without needing a developer on hand. A follow-up pass added a customer quick-add "+" (same `onCreated` pattern as every other inline quick-add in this app) to New Invoice's customer picker, corrected the purchase-price hover to a real weighted average (§4), fixed the dashboard's revenue cards to count Invoices at creation time instead of Sales-Receipts-only (§4), added a **Profit & Loss** report (§4) — the first genuine financial report in the app, and the first item off the "~30 report screens from the old app" deferred list — and closed the long-standing "linking Supplier Bills to Purchase Orders" gap via **`convert_purchase_order_to_bill`** (§4): a PO is pure ordering intent with no financial entry; converting it is what actually receives stock and creates Accounts Payable, reusing `create_supplier_bill` internally rather than duplicating its posting logic. A later pass added **control account guardrails** (§4) after discovering a real desync in the live test org: a manual Fiscal Daybook entry or Banking transfer could touch `Undeposited Funds`/`Accounts Receivable`/`Accounts Payable` directly, bypassing the RPCs that keep those accounts' sub-ledgers in sync — now blocked server-side (`assert_accounts_not_controlled`, enforced only on the two manual entry points, never on internal auto-posting) and filtered out of both screens' account pickers client-side. A final pass built real **Perpetual Moving Average Costing** (§4): `items.avg_cost` is now a genuine, sequentially-maintained MAC value (not the old naive lifetime-average view), `create_supplier_bill` capitalizes purchases to a new **Inventory** asset account instead of expensing them immediately to Purchases, and `create_invoice`/`create_sales_receipt` post real **Cost of Goods Sold** at sale time using a per-line snapshot cost — extending the control-account guardrail to Inventory, adding a Gross Profit / COGS breakdown to the Profit & Loss report, and running a one-time cutover entry to capitalize the live org's existing on-hand inventory value. A still later pass rebuilt **Inventory Adjustment** (§4) from a bare quantity-tweak modal into a real document — three modes (Quantity/Value/Quantity and Value), a chosen Adjustment Account, and full integration with the MAC replay engine (folded in as one more event type rather than the "reset point" design an independent review found two real bugs in — a multi-location cost-corruption bug and a concurrency TOCTOU issue) — retiring the old `AdjustStockModal` entirely, including its Stock-page shortcut.
- **Post-Phase-5 polish** (shipped): a live GL balance hint under each New Journal Entry account picker (§4); a **Reset Data** fix — it failed on any org that had ever converted a PO to a Bill, because `purchase_orders.bill_id`/`supplier_bills.purchase_order_id` defaulted to `NO ACTION` (now `ON DELETE SET NULL`, §4); the Business Hub sidebar reordered to the owner's preferred order with Credit Memos & Refunds nested as one sub-group (§5); **HashirHub branding** — favicon, app/Apple/PWA icons, `manifest.json`, the "HashirHub" tab title, and a branded sidebar header that links home (§5; the icons were cropped from a marketing mockup, so `icon.svg` embeds a PNG rather than being true vector art — swap in real vector artwork if the owner ever supplies it); and a **responsive mobile layout** — sidebar drawer, stacking form grids, horizontally-scrolling line-item rows (§9).
- **Reports** (shipped): 25 reports built from the old app's REPORT_TREE (§4 Reports):
  - **Company & Financial**: Profit & Loss (moved here from Account), Balance Sheet, Trial Balance, Income by Customer, Transactions Summary.
  - **Receivables**: Customer Balance Summary, Customer Statement, Payment Collection.
  - **Payables**: Supplier Balance Summary, Supplier Statement.
  - **Accounts**: Journal, General Ledger, Account Statement.
  - **Inventory**: Quantity On Hand, Inventory Valuation, Inventory Movement, Stock by Supplier, Physical Inventory Worksheet.
  - **Purchases**: Purchases by Supplier.
  - **Sales**: Sales by Item / Category / Customer, Invoices Summary, Invoice Items Summary, Customer Item Sales.

  All of them offer CSV export and Print, and drill down to statements and source documents. The same pass fixed a pre-existing **security leak**: all five views were readable across orgs with the public anon key (§4 views rule).
- **Explicitly deferred to later phases**: linking Credit Memos to specific invoices (currently an immediate, aggregate AR reduction only — and credit memo returns still don't reverse COGS or touch `avg_cost`, matching Credit Memos' deliberately simple scope), converting a Quotation into an Invoice/Sales Receipt (currently a fully standalone estimate), a Posting Settings screen for explicit default-account configuration (currently auto-created by fixed name on first use instead, see §4's caveat about name collisions with manually-created accounts), wholesale/multi-tier pricing, the old-app reports still blocked on a missing feature (listed greyed-out in the Reports catalog: Sales by Representative / Return Stock by Representative / Sales by Salesman / Financial Recovery need sales reps, salesmen with commission, and customer credit managers; Customer & Item Discounts need line discounts; Sales Orders & Open Orders need a Sales Orders document; Deleted/Updated Transactions need an audit log; Damaged/Expired Inventory needs expiry/damage tracking; Invoice Batch Print needs a printable invoice layout), camera-based barcode scanning, multi-org switcher UI (schema supports multi-org membership already; Phase 1 UI just auto-selects a user's single org).
- This is a living document — update it as schema or architecture decisions evolve, don't let it drift from reality.
