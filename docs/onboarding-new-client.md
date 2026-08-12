# Onboarding a new client (business)

There's no public sign-up page on purpose — you (the app owner) create every new client's account manually. It's a few minutes of copy-pasting in the Supabase Dashboard, no coding required.

## One-time setup (only needed once, ever)

### a. Site URL

In the Supabase Dashboard → **Authentication → URL Configuration**, set the Site URL (and add as a Redirect URL) to your deployed app's address, e.g. `https://invento1.github.io/inventory-app/`. This makes sure invite emails send people to the right place.

Nothing else to configure here — the app itself handles Supabase's default invite link format (see `src/main.tsx`), so no email template editing or custom SMTP setup is required for invites to work. (Editing email templates is gated behind configuring custom SMTP in this Supabase project anyway; that's only worth doing later for production-grade deliverability/branding, not required for onboarding.)

## Steps for each new client

### 1. Invite the client's user

Supabase Dashboard → **Authentication → Users** → **"Invite user"** → enter their email address.

This sends them an email with a link. Clicking it logs them into the app and drops them on a "set your password" screen — nothing else to do here yet.

### 2. Find their user ID

Still on the **Users** page, click the person you just invited and copy their **User UID** (a long string like `a1b2c3d4-...`).

### 3. Create their business and link them to it

Supabase Dashboard → **SQL Editor** → paste and run this, filling in the three blanks:

```sql
with new_org as (
  insert into public.orgs (name, slug)
  values ('Client Business Name', 'client-slug')
  returning id
)
insert into public.org_members (org_id, user_id, role)
select id, '<pasted-user-uuid>', 'owner' from new_org;
```

- `Client Business Name` — whatever you want shown in the app (e.g. `Adil's Store`).
- `client-slug` — a short unique code for this client, lowercase, no spaces (e.g. `adil`). Used internally, never shown to the client.
- `<pasted-user-uuid>` — the User UID you copied in step 2.

### 4. Give them a starting location

Every business needs at least one location before items/stock/sales will work. Run this next (same `client-slug` as above):

```sql
insert into public.locations (org_id, name)
select id, 'Main' from public.orgs where slug = 'client-slug';
```

You (or the client) can rename "Main" or add more locations later from inside the app.

### 5. Verify it worked

```sql
select o.name as org, o.slug, u.email, m.role
from public.org_members m
join public.orgs o on o.id = m.org_id
join auth.users u on u.id = m.user_id
where o.slug = 'client-slug';
```

You should see one row with their email and role `owner`.

### 6. Client's first login

They click the invite email link → land on the app already signed in → set a password → from then on they log in normally at your app's URL with their email + that password.

## Adding a second staff member to an existing client

Same as steps 1–2 (invite + copy UID), then just:

```sql
insert into public.org_members (org_id, user_id, role)
select id, '<pasted-user-uuid>', 'staff' from public.orgs where slug = 'client-slug';
```

Use `role` = `'staff'` for regular employees, `'admin'` for someone who should be able to manage other users, or `'owner'` for a business co-owner.
