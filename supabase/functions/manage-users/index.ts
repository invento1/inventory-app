// manage-users: the one server-side piece of user management. Creating a
// login or sending an invite email needs the service-role key, which must
// never reach the browser, so those two steps live here. Every authorization
// decision is still made in Postgres, by calling the same checks the app uses
// (assert_can_assign_role / assert_can_manage_member) as the signed-in caller.
//
// Actions (POST JSON):
//   add            { org_id, email, full_name, role, method: 'invite' | 'password', password?, redirect_to? }
//   resend_invite  { org_id, user_id, redirect_to? }
//   set_password   { org_id, user_id, password }
//
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided
// to every Edge Function by Supabase; nothing needs configuring.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD = 8

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function redirectFrom(value: unknown): string | undefined {
  const url = str(value)
  return /^https?:\/\//.test(url) ? url : undefined
}

// Runs a permission-check RPC as the caller; its error message is user-facing.
async function check(caller: SupabaseClient, fn: string, args: Record<string, unknown>) {
  const { error } = await caller.rpc(fn, args)
  if (error) throw new HttpError(403, error.message)
}

async function addMember(caller: SupabaseClient, admin: SupabaseClient, callerId: string, body: Record<string, unknown>) {
  const orgId = str(body.org_id)
  const email = str(body.email).toLowerCase()
  const fullName = str(body.full_name)
  const role = str(body.role)
  const method = str(body.method)
  const password = typeof body.password === 'string' ? body.password : ''

  if (!orgId || !role) throw new HttpError(400, 'Missing business or role')
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address')
  if (!fullName) throw new HttpError(400, 'Enter the person’s name')
  if (method !== 'invite' && method !== 'password') throw new HttpError(400, 'Choose invite or password')
  if (method === 'password' && password.length < MIN_PASSWORD) {
    throw new HttpError(400, `Password must be at least ${MIN_PASSWORD} characters`)
  }

  await check(caller, 'assert_can_assign_role', { p_org_id: orgId, p_role_key: role })

  const { data: found, error: findError } = await admin.rpc('find_auth_user_by_email', { p_email: email })
  if (findError) throw findError
  const existing = (found as { user_id: string }[] | null)?.[0]

  let userId: string
  let outcome: 'invited' | 'created' | 'existing'
  let createdHere = false

  if (existing) {
    const { data: member } = await admin
      .from('org_members')
      .select('user_id')
      .eq('org_id', orgId)
      .eq('user_id', existing.user_id)
      .maybeSingle()
    if (member) throw new HttpError(409, 'That person is already a user of this business')
    // They already have a HashirHub login (e.g. in another business): add
    // them here and leave their password alone.
    userId = existing.user_id
    outcome = 'existing'
  } else if (method === 'invite') {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo: redirectFrom(body.redirect_to),
    })
    if (error) throw new HttpError(400, `Couldn’t send the invite: ${error.message}`)
    userId = data.user.id
    outcome = 'invited'
    createdHere = true
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })
    if (error) throw new HttpError(400, `Couldn’t create the login: ${error.message}`)
    userId = data.user.id
    outcome = 'created'
    createdHere = true
  }

  const { error: insertError } = await admin.from('org_members').insert({
    org_id: orgId,
    user_id: userId,
    role,
    full_name: fullName,
    invited_by: callerId,
  })
  if (insertError) {
    if (createdHere) await admin.auth.admin.deleteUser(userId)
    throw insertError
  }

  return { outcome, user_id: userId }
}

async function resendInvite(caller: SupabaseClient, admin: SupabaseClient, body: Record<string, unknown>) {
  const orgId = str(body.org_id)
  const userId = str(body.user_id)
  await check(caller, 'assert_can_manage_member', { p_org_id: orgId, p_user_id: userId })

  const { data, error } = await admin.auth.admin.getUserById(userId)
  if (error || !data.user?.email) throw new HttpError(404, 'User not found')
  if (data.user.last_sign_in_at) {
    throw new HttpError(400, 'This person has already signed in. Send them a password reset instead.')
  }

  const redirectTo = redirectFrom(body.redirect_to)
  if (!data.user.email_confirmed_at) {
    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(data.user.email, { redirectTo })
    if (inviteError) throw new HttpError(400, `Couldn’t resend the invite: ${inviteError.message}`)
    return { outcome: 'invited' }
  }
  // Created with a password and never signed in: a reset link lets them pick their own.
  const { error: resetError } = await caller.auth.resetPasswordForEmail(data.user.email, { redirectTo })
  if (resetError) throw new HttpError(400, `Couldn’t send the email: ${resetError.message}`)
  return { outcome: 'reset_sent' }
}

async function setPassword(caller: SupabaseClient, admin: SupabaseClient, body: Record<string, unknown>) {
  const orgId = str(body.org_id)
  const userId = str(body.user_id)
  const password = typeof body.password === 'string' ? body.password : ''
  if (password.length < MIN_PASSWORD) throw new HttpError(400, `Password must be at least ${MIN_PASSWORD} characters`)

  await check(caller, 'assert_can_manage_member', { p_org_id: orgId, p_user_id: userId })

  // A login shared with another business belongs to that person, not to
  // this business: setting it here would hand this business's admins access
  // to the other one.
  const { data: memberships, error } = await admin.from('org_members').select('org_id').eq('user_id', userId)
  if (error) throw error
  if ((memberships ?? []).some((m: { org_id: string }) => m.org_id !== orgId)) {
    throw new HttpError(
      403,
      'This person also uses HashirHub with another business, so only they can change their password. Send them a password reset email instead.',
    )
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password })
  if (updateError) throw new HttpError(400, updateError.message)
  return { outcome: 'password_set' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new HttpError(401, 'Not signed in')

    const url = Deno.env.get('SUPABASE_URL')!
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: userData, error: userError } = await caller.auth.getUser()
    if (userError || !userData.user) throw new HttpError(401, 'Your session has expired. Sign in again.')

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const body = (await req.json()) as Record<string, unknown>
    switch (body.action) {
      case 'add':
        return json(await addMember(caller, admin, userData.user.id, body))
      case 'resend_invite':
        return json(await resendInvite(caller, admin, body))
      case 'set_password':
        return json(await setPassword(caller, admin, body))
      default:
        throw new HttpError(400, 'Unknown action')
    }
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500
    // PostgrestError / AuthError aren't Error instances but do carry a message.
    const message = (err as { message?: string } | null)?.message || 'Something went wrong'
    if (status === 500) console.error(err)
    return json({ error: message }, status)
  }
})
