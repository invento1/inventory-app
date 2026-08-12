# Inventory SaaS — CLAUDE.md

## 1. Project Overview

Multi-tenant inventory management SaaS, replacing a Google Sheets "backend" that clients complained was too slow. One codebase serves several separate client businesses (orgs), each with isolated inventory data and users. Built on Supabase (Postgres + Auth + Realtime). **Speed is a first-class requirement** — every schema and architecture decision below exists to keep reads/writes fast, not just correct.

Status: greenfield. No app code, no Supabase project, no migrations exist yet. This document is the source of truth for architecture decisions made before implementation started, so later sessions build consistently instead of re-deriving them.

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

`orgs` and `org_members` need their own policies too (members can see their org and their own org's membership rows; only owner/admin can insert/update/delete members) — this is the one place `is_org_member` exists specifically to avoid RLS recursion on `org_members` itself.

**Rules to follow everywhere**:
- Never create a tenant-scoped table without an `org_id` column and RLS policies from the start — don't ship a table "temporarily" without RLS.
- Use `is_org_member(org_id)` / `org_role(org_id)` in policies; never inline the membership subquery repeatedly across tables.
- Client-side queries must still filter by `org_id` explicitly (`.eq('org_id', currentOrgId)`) even though RLS enforces it server-side too. This is defense-in-depth and a performance convention — don't rely on RLS alone to scope results, since an unfiltered query still forces Postgres to scan across all orgs' rows before RLS excludes them.
- The `service_role` key is never used client-side, never checked into the repo, and never referenced from the frontend. It only belongs in server-side contexts (Supabase Edge Functions, CI secrets) if and when the project needs one.

## 4. Schema Conventions

- snake_case, plural table names.
- Every table: `id uuid primary key default gen_random_uuid()`, `created_at timestamptz default now()`, and `updated_at` where rows are mutable.
- **Stock quantity is never written directly.** `stock_levels.quantity` is a derived cache, kept in sync by an `AFTER INSERT` trigger on `stock_movements` (`stock_levels.quantity += NEW.quantity_delta`). The app always writes to `stock_movements` (an append-only audit log — reason: receive/sale/adjustment/transfer, reference to the originating record). This keeps `stock_levels` reads O(1) while preserving full traceability of every quantity change.
- Aggregate or cross-row queries (total stock per item across locations, low-stock report) are Postgres **views** or **RPC functions**, not client-side joins/loops. Views inherit RLS from their base tables automatically — no separate policy needed on the view itself.
- Multi-step writes that must be atomic (e.g. receiving a PO line: update `purchase_order_lines.quantity_received`, insert a `stock_movements` row, let the trigger update `stock_levels`) are a single Postgres RPC function, not several round-trips from the client.

### Core tables (reference sketch — refine at migration time)

```
orgs                    -- tenants
org_members             -- user_id x org_id, role: owner/admin/staff
locations               -- org_id, name, address, is_active
items                   -- org_id, sku, barcode, name, description, unit, reorder_threshold, is_active
                        --   unique index (org_id, sku); index (org_id, barcode) for fast scan lookups
stock_levels            -- org_id, item_id, location_id, quantity
                        --   unique index (org_id, item_id, location_id)
stock_movements         -- org_id, item_id, location_id, quantity_delta, reason,
                        --   reference_type, reference_id, created_by, created_at
                        --   index (org_id, item_id, created_at desc)
suppliers               -- org_id, name, contact info
purchase_orders         -- org_id, supplier_id, status, created_by, expected_date
purchase_order_lines    -- po_id, item_id, quantity_ordered, quantity_received, unit_cost
```

Example low-stock view:

```sql
create view public.low_stock_report as
select sl.org_id, sl.item_id, sl.location_id, sl.quantity, i.reorder_threshold
from stock_levels sl
join items i on i.id = sl.item_id
where sl.quantity <= coalesce(i.reorder_threshold, 0);
```

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
│   ├── main.tsx / App.tsx
│   ├── lib/supabaseClient.ts      -- single createClient() instance
│   ├── auth/                      -- login, session context, org switcher
│   ├── features/
│   │   ├── items/
│   │   ├── stock/
│   │   ├── suppliers/
│   │   ├── purchase-orders/
│   │   └── alerts/
│   ├── components/                -- shared UI
│   └── types/                     -- generated via `supabase gen types typescript`
└── .github/workflows/deploy.yml
```

## 6. Dev Commands

- `npm run dev` / `npm run build` — frontend
- `supabase start` — local Supabase dev stack
- `supabase migration new <name>` — new migration
- `supabase db push` — apply migrations to the linked project
- `supabase gen types typescript --project-id <id> > src/types/supabase.ts` — regenerate types after every migration; never let them drift

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

## 10. Roadmap / Out of Scope

- No Google Sheets data migration needed — starting fresh.
- Not yet done: Supabase project creation, first migration, app scaffold, auth flow, feature UIs, CI/CD workflow. These are follow-up steps once this document is confirmed.
- This is a living document — update it as schema or architecture decisions evolve, don't let it drift from reality.
