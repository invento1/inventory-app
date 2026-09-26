# Onboarding a new client (business)

There's no public sign-up page on purpose — you (the app owner) create every new client's account manually. It's two short steps in the Supabase Dashboard, no coding required.

## One-time setup (only needed once, ever)

### a. Site URL

In the Supabase Dashboard → **Authentication → URL Configuration**, set the Site URL (and add as a Redirect URL) to your deployed app's address, e.g. `https://invento1.github.io/inventory-app/`. This makes sure invite emails send people to the right place.

Nothing else to configure here — the app itself handles Supabase's default invite link format (see `src/main.tsx`), so no email template editing or custom SMTP setup is required for invites to work. (Editing email templates is gated behind configuring custom SMTP in this Supabase project anyway; that's only worth doing later for production-grade deliverability/branding, not required for onboarding.)

## Steps for each new client

### 1. Invite the business owner

Supabase Dashboard → **Authentication → Users** → **"Invite user"** → enter the owner's email address.

This sends them an email with a link. Clicking it logs them into the app and drops them on a "set your password" screen. (Until step 2 is done they'll see "No organization access" — that's expected.)

### 2. Create their business

Supabase Dashboard → **SQL Editor** → paste this, change the values, and run it:

```sql
select * from provision_org(
  p_name            => 'Adil''s Store',        -- shown in the app (type two '' for an apostrophe)
  p_slug            => 'adils-store',          -- short unique code: lowercase, numbers, hyphens
  p_owner_email     => 'owner@example.com',    -- the email you invited in step 1
  p_currency_symbol => 'Rs',                   -- optional (default $)
  p_currency_code   => 'PKR',                  -- optional (default USD)
  p_timezone        => 'Asia/Karachi',         -- optional; sets the business's calendar day
  p_location_name   => 'Main Store'            -- optional; their first store
);
```

It shows one row with the new business and a count of what was set up — you should see **5 roles, 14 ledger accounts and 1 location**. That one call creates:

- the business itself, with its currency and timezone;
- the owner, linked with full access;
- five security groups (Owner, Administrator, Manager, Accountant, Cashier) with sensible starting permissions;
- a starting chart of accounts: the accounts the app posts to automatically (Cash, Bank, Undeposited Funds, Accounts Receivable, Inventory, Accounts Payable, Sales Income, Cost of Goods Sold, Purchases) plus Owner's Equity, General Expenses, Rent, Salaries & Wages and Utilities;
- their first store.

If something's wrong it stops and says why (for example, "No login for …" means step 1 wasn't done or the email is different; "Slug … is already taken" means pick another code). Nothing is half-created.

### 3. Client's first login

They click the invite email link → land on the app already signed in → set a password → from then on they log in normally at your app's URL with their email + that password. They can fill in their address and phone in **Settings → Company Info**, rename the store or add more in **Settings → Stores / Warehouses**, and add accounts in **Capital Matrix**.

### If the invite link doesn't work

- **"This link has expired or was already used"**: each link works once and expires after 24 hours; opening it twice or opening an older email shows this. Get a fresh one with **Forgot password?** on the sign-in page, or send a new invite.
- **Test invites in a private/incognito window.** A browser holds one sign-in at a time, so opening someone else's invite link where you're signed in replaces your session. The Set password page shows which account it's for.
- **"email rate limit exceeded"**: Supabase's built-in email sends only a few emails per hour. Instead of waiting, set the owner's password yourself in the SQL Editor and tell them what it is (they can change it later with Forgot password?):

  ```sql
  select set_login_password('owner@example.com', 'a-temporary-password');
  ```

  For anyone else in a business, the owner or an admin can do the same inside the app: **Settings → Users →** click the person **→ Set a new password**.

### 4. (Optional) Health check

```sql
select * from tenant_schema_audit();
```

No rows means every business, including the new one, is set up correctly.

## Adding more users to an existing client

No SQL needed any more. The client's owner (or an admin) does it inside the app: **Settings → Users → Add user**, with their name, email and role. They choose either:

- **Email them an invite**: the person gets a link and picks their own password; or
- **Set a password now**: no email is sent; the owner tells the person their password.

Supabase's built-in email only sends a few messages per hour. If invites stop arriving, use "Set a password now" (or set up custom SMTP in the Supabase Dashboard).

What each role can do is set in **Settings → Security Groups** (owner only). Deactivating or removing someone in Settings → Users locks them out straight away.

Adding users runs through a Supabase Edge Function called `manage-users` (it's the only thing that can create logins). It's already deployed. If it ever needs redeploying:

```
npx supabase functions deploy manage-users --use-api --project-ref qkxquryxqpwsckdezxjh
```
