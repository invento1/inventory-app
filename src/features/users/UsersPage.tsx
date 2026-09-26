import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Plus, UserRound } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import type { Permission } from '../../auth/permissions'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Modal } from '../../components/ui/Modal'
import { PageSpinner } from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/Toast'
import {
  useAddUser,
  useOrgMembers,
  useOrgRoles,
  useRemoveMember,
  useResendInvite,
  useRolePermissions,
  useSendPasswordReset,
  useSetUserPassword,
  useUpdateMember,
  type OrgMember,
  type OrgRole,
} from './api'

const MIN_PASSWORD = 8

function errorMessage(err: unknown) {
  return (err as { message?: string } | null)?.message || 'Something went wrong'
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
}

function memberState(m: OrgMember): { label: string; tone: 'success' | 'warning' | 'danger' } {
  if (m.status === 'inactive') return { label: 'Deactivated', tone: 'danger' }
  if (!m.last_sign_in_at) return { label: m.invited_at ? 'Invited' : 'Not signed in yet', tone: 'warning' }
  return { label: 'Active', tone: 'success' }
}

// Roles the current user may hand out: an owner may give any role; anyone
// else only roles that can't do more than they can (same rule as
// assert_can_assign_role in the database).
function useAssignableRoles(roles: OrgRole[] | undefined) {
  const { orgId, isOwner, can } = useOrg()
  const { data: rolePermissions } = useRolePermissions(orgId)
  return useMemo(() => {
    if (!roles) return []
    if (isOwner) return roles
    return roles.filter(
      (r) =>
        r.key !== 'owner' && [...(rolePermissions?.get(r.key) ?? [])].every((p) => can(p as Permission)),
    )
  }, [roles, rolePermissions, isOwner, can])
}

export function UsersPage() {
  const { orgId, orgName } = useOrg()
  const { data: members, isLoading } = useOrgMembers(orgId)
  const { data: roles } = useOrgRoles(orgId)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<OrgMember | null>(null)

  const roleName = (key: string) => roles?.find((r) => r.key === key)?.name ?? key

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle={`People who can sign in to ${orgName}`}
        action={
          <Button onClick={() => setAdding(true)}>
            <Plus size={16} />
            Add user
          </Button>
        }
      />

      <Card>
        {isLoading ? (
          <PageSpinner />
        ) : (
          <Table>
            <THead>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Last sign-in</Th>
            </THead>
            <tbody>
              {(!members || members.length === 0) && <EmptyState message="No users yet." />}
              {members?.map((m) => {
                const state = memberState(m)
                return (
                  <Tr key={m.user_id} onClick={() => setEditing(m)}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-50 text-accent-700">
                          <UserRound size={16} />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-text">
                            {m.full_name || m.email}
                            {m.is_you && <span className="ml-1.5 text-xs font-normal text-text-muted">(you)</span>}
                          </p>
                          {m.full_name && <p className="truncate text-xs text-text-muted">{m.email}</p>}
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={m.role === 'owner' ? 'accent' : 'neutral'}>{roleName(m.role)}</Badge>
                    </Td>
                    <Td>
                      <Badge tone={state.tone}>{state.label}</Badge>
                    </Td>
                    <Td className="text-text-muted">{formatDate(m.last_sign_in_at)}</Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <p className="mt-3 text-xs text-text-muted">
        What each role can do is set in{' '}
        <Link to="/settings/security-groups" className="font-medium text-accent-600 hover:text-accent-700">
          Security Groups
        </Link>
        .
      </p>

      {adding && <AddUserModal roles={roles ?? []} onClose={() => setAdding(false)} />}
      {editing && <EditUserModal member={editing} roles={roles ?? []} onClose={() => setEditing(null)} />}
    </div>
  )
}

function RoleSelect({
  roles,
  value,
  onChange,
  disabled,
}: {
  roles: OrgRole[]
  value: string
  onChange: (key: string) => void
  disabled?: boolean
}) {
  const description = roles.find((r) => r.key === value)?.description
  return (
    <div className="flex flex-col gap-1.5">
      <Select label="Role" required value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {roles.map((r) => (
          <option key={r.key} value={r.key}>
            {r.name}
          </option>
        ))}
      </Select>
      {description && <p className="text-xs text-text-muted">{description}</p>}
    </div>
  )
}

function AddUserModal({ roles, onClose }: { roles: OrgRole[]; onClose: () => void }) {
  const { orgId } = useOrg()
  const assignable = useAssignableRoles(roles)
  const addUser = useAddUser(orgId)
  const toast = useToast()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [method, setMethod] = useState<'invite' | 'password'>('invite')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Default to the least powerful built-in role on offer.
  const selectedRole = role || (assignable.find((r) => r.key === 'cashier') ?? assignable[assignable.length - 1])?.key || ''

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (method === 'password' && password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters`)
      return
    }
    try {
      const { outcome } = await addUser.mutateAsync({
        full_name: fullName.trim(),
        email: email.trim(),
        role: selectedRole,
        method,
        password: method === 'password' ? password : undefined,
      })
      toast.success(
        outcome === 'invited'
          ? `Invite sent to ${email.trim()}`
          : outcome === 'created'
            ? `${fullName.trim()} can now sign in with the password you set`
            : `${fullName.trim()} already had a HashirHub login and was added. They sign in with their existing password.`,
      )
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Modal title="Add user" onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <Input label="Full name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <Input
          label="Email"
          type="email"
          required
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <RoleSelect roles={assignable} value={selectedRole} onChange={setRole} />

        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1.5 font-medium text-text">How will they sign in?</legend>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 has-[:checked]:border-accent-600 has-[:checked]:bg-accent-50/60">
            <input
              type="radio"
              name="method"
              className="mt-0.5"
              checked={method === 'invite'}
              onChange={() => setMethod('invite')}
            />
            <span>
              <span className="font-medium text-text">Email them an invite</span>
              <span className="block text-xs text-text-muted">They click the link and choose their own password.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 has-[:checked]:border-accent-600 has-[:checked]:bg-accent-50/60">
            <input
              type="radio"
              name="method"
              className="mt-0.5"
              checked={method === 'password'}
              onChange={() => setMethod('password')}
            />
            <span>
              <span className="font-medium text-text">Set a password now</span>
              <span className="block text-xs text-text-muted">
                No email needed. Give them the password yourself; they can change it later.
              </span>
            </span>
          </label>
        </fieldset>

        {method === 'password' && (
          <Input
            label="Password"
            type="text"
            required
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={`At least ${MIN_PASSWORD} characters`}
          />
        )}
        {method === 'invite' && (
          <p className="text-xs text-text-muted">
            Invite emails come from Supabase's built-in mail service, which only sends a few per hour. If one
            doesn't arrive, choose "Set a password now" instead.
          </p>
        )}

        {error && <p className="text-sm text-danger-600">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={addUser.isPending || !selectedRole}>
            {addUser.isPending ? 'Adding…' : method === 'invite' ? 'Send invite' : 'Create user'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function EditUserModal({ member, roles, onClose }: { member: OrgMember; roles: OrgRole[]; onClose: () => void }) {
  const { orgId, isOwner } = useOrg()
  const assignable = useAssignableRoles(roles)
  const updateMember = useUpdateMember(orgId)
  const removeMember = useRemoveMember(orgId)
  const resendInvite = useResendInvite(orgId)
  const sendReset = useSendPasswordReset()
  const setUserPassword = useSetUserPassword(orgId)
  const toast = useToast()

  const [fullName, setFullName] = useState(member.full_name ?? '')
  const [role, setRole] = useState(member.role)
  const [status, setStatus] = useState<'active' | 'inactive'>(member.status === 'inactive' ? 'inactive' : 'active')
  const [newPassword, setNewPassword] = useState('')
  const [settingPassword, setSettingPassword] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isSelf = member.is_you
  // Non-owners can't manage owners or anyone in a role more powerful than theirs.
  const canManage = !isSelf && (isOwner || assignable.some((r) => r.key === member.role))
  // Keep the member's current role selectable even if the viewer couldn't assign it.
  const roleOptions = assignable.some((r) => r.key === member.role)
    ? assignable
    : [...roles.filter((r) => r.key === member.role), ...assignable]
  const neverSignedIn = !member.last_sign_in_at

  async function run<T>(action: () => Promise<T>, success: string | ((result: T) => string), close = false) {
    setError(null)
    try {
      const result = await action()
      toast.success(typeof success === 'function' ? success(result) : success)
      if (close) onClose()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  function handleSave(e: FormEvent) {
    e.preventDefault()
    void run(
      () => updateMember.mutateAsync({ userId: member.user_id, fullName, role, status }),
      'User updated',
      true,
    )
  }

  return (
    <Modal title={member.full_name || member.email || 'User'} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={handleSave}>
        <p className="-mt-1 text-sm text-text-muted">{member.email}</p>
        <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <RoleSelect roles={roleOptions} value={role} onChange={setRole} disabled={!canManage} />
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}
          disabled={!canManage}
        >
          <option value="active">Active: can sign in</option>
          <option value="inactive">Deactivated: blocked from this business</option>
        </Select>
        {isSelf && (
          <p className="text-xs text-text-muted">You can't change your own role or status. Ask another owner or admin.</p>
        )}
        {!isSelf && !canManage && (
          <p className="text-xs text-text-muted">Only an owner can change this user's role or status.</p>
        )}

        {canManage && (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-muted/60 p-3">
            <p className="text-sm font-medium text-text">Sign-in</p>
            <div className="flex flex-wrap gap-2">
              {neverSignedIn ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={resendInvite.isPending}
                  onClick={() =>
                    run(
                      () => resendInvite.mutateAsync(member.user_id),
                      ({ outcome }) =>
                        outcome === 'reset_sent'
                          ? `They already have a password, so a reset link was sent to ${member.email}`
                          : `Invite sent again to ${member.email}`,
                    )
                  }
                >
                  {resendInvite.isPending ? 'Sending…' : 'Resend invite'}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={sendReset.isPending}
                  onClick={() => run(() => sendReset.mutateAsync(member.email ?? ''), `Password reset email sent to ${member.email}`)}
                >
                  {sendReset.isPending ? 'Sending…' : 'Send password reset email'}
                </Button>
              )}
              <Button type="button" variant="ghost" size="sm" onClick={() => setSettingPassword((v) => !v)}>
                Set a new password
              </Button>
            </div>
            {settingPassword && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="sm:flex-1">
                  <Input
                    label="New password"
                    type="text"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={`At least ${MIN_PASSWORD} characters`}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="h-10"
                  disabled={setUserPassword.isPending || newPassword.length < MIN_PASSWORD}
                  onClick={() =>
                    run(async () => {
                      await setUserPassword.mutateAsync({ userId: member.user_id, password: newPassword })
                      setNewPassword('')
                      setSettingPassword(false)
                    }, 'Password changed. Let them know the new one.')
                  }
                >
                  {setUserPassword.isPending ? 'Saving…' : 'Set password'}
                </Button>
              </div>
            )}
          </div>
        )}

        {error && <p className="text-sm text-danger-600">{error}</p>}

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            {canManage &&
              (confirmingRemove ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-muted">Remove from this business?</span>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={removeMember.isPending}
                    onClick={() => run(() => removeMember.mutateAsync(member.user_id), 'User removed', true)}
                  >
                    {removeMember.isPending ? 'Removing…' : 'Remove'}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingRemove(false)}>
                    Keep
                  </Button>
                </div>
              ) : (
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingRemove(true)}>
                  <span className="text-danger-600">Remove user</span>
                </Button>
              ))}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateMember.isPending}>
              {updateMember.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
