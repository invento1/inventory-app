import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Lock, Pencil, Plus } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Modal } from '../../components/ui/Modal'
import { PageSpinner } from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/cn'
import {
  togglePermission,
  useAppPermissions,
  useCreateRole,
  useDeleteRole,
  useOrgRoles,
  useRolePermissions,
  useSaveRolePermissions,
  useUpdateRole,
  type AppPermission,
  type OrgRole,
} from './api'

function errorMessage(err: unknown) {
  return (err as { message?: string } | null)?.message || 'Something went wrong'
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  return a.size === b.size && [...a].every((k) => b.has(k))
}

// Module header checkbox: ticked when the role has every permission in the
// module, indeterminate when it has some.
function ModuleCheckbox({
  checked,
  indeterminate,
  disabled,
  onChange,
  label,
}: {
  checked: boolean
  indeterminate: boolean
  disabled: boolean
  onChange: (on: boolean) => void
  label: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      className="h-4 w-4 cursor-pointer disabled:cursor-default"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
  )
}

export function SecurityGroupsPage() {
  const { orgId, isOwner } = useOrg()
  const { data: roles, isLoading: loadingRoles } = useOrgRoles(orgId)
  const { data: catalog, isLoading: loadingCatalog } = useAppPermissions()
  const { data: saved, isLoading: loadingSaved } = useRolePermissions(orgId)
  const saveRolePermissions = useSaveRolePermissions(orgId)
  const toast = useToast()

  // Unsaved edits: role key -> full permission set.
  const [draft, setDraft] = useState<Map<string, Set<string>>>(new Map())
  const [editingRole, setEditingRole] = useState<OrgRole | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  const modules = useMemo(() => {
    const groups: { module: string; label: string; permissions: AppPermission[] }[] = []
    for (const p of catalog ?? []) {
      const last = groups[groups.length - 1]
      if (last?.module === p.module) last.permissions.push(p)
      else groups.push({ module: p.module, label: p.module_label, permissions: [p] })
    }
    return groups
  }, [catalog])

  const allKeys = useMemo(() => new Set((catalog ?? []).map((p) => p.key)), [catalog])

  function permissionsOf(roleKey: string): ReadonlySet<string> {
    if (roleKey === 'owner') return allKeys
    return draft.get(roleKey) ?? saved?.get(roleKey) ?? new Set()
  }

  function update(roleKey: string, next: Set<string>) {
    setDraft((d) => {
      const copy = new Map(d)
      if (sameSet(next, saved?.get(roleKey) ?? new Set())) copy.delete(roleKey)
      else copy.set(roleKey, next)
      return copy
    })
  }

  function toggle(roleKey: string, key: string, on: boolean) {
    if (!catalog) return
    update(roleKey, togglePermission(permissionsOf(roleKey), key, on, catalog))
  }

  function toggleModule(roleKey: string, permissions: AppPermission[], on: boolean) {
    if (!catalog) return
    let next = new Set(permissionsOf(roleKey))
    for (const p of permissions) next = togglePermission(next, p.key, on, catalog)
    update(roleKey, next)
  }

  async function handleSave() {
    setError(null)
    try {
      await saveRolePermissions.mutateAsync(
        [...draft.entries()].map(([roleKey, set]) => ({ roleKey, permissions: [...set] })),
      )
      setDraft(new Map())
      toast.success('Security groups saved. Changes apply the next time each user loads a page.')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  if (loadingRoles || loadingCatalog || loadingSaved) return <PageSpinner />

  const editable = isOwner
  const dirty = draft.size > 0

  return (
    <div>
      <PageHeader
        title="Security Groups"
        subtitle="What each role can see and do. Owners always have full access."
        action={
          editable && (
            <div className="flex flex-wrap gap-2">
              {dirty && (
                <Button variant="secondary" onClick={() => setDraft(new Map())} disabled={saveRolePermissions.isPending}>
                  Discard
                </Button>
              )}
              <Button variant="secondary" onClick={() => setEditingRole(null)}>
                <Plus size={16} />
                New role
              </Button>
              <Button onClick={handleSave} disabled={!dirty || saveRolePermissions.isPending}>
                {saveRolePermissions.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-1 text-sm text-text-muted">
        {editable ? (
          <p>
            Ticking a permission also ticks what it needs (Create invoices needs View invoices); unticking one also
            unticks what depends on it. People get their role on the{' '}
            <Link to="/settings/users" className="font-medium text-accent-600 hover:text-accent-700">
              Users
            </Link>{' '}
            page.
          </p>
        ) : (
          <p className="flex items-center gap-1.5">
            <Lock size={14} /> Only an owner can change security groups. You can see them here.
          </p>
        )}
        {dirty && <p className="font-medium text-warning-600">You have unsaved changes.</p>}
        {error && <p className="text-danger-600">{error}</p>}
      </div>

      <Card className="overflow-hidden">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-20">
              <tr className="border-b border-border bg-surface-muted text-left">
                <th className="sticky left-0 z-30 min-w-56 bg-surface-muted px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  Permission
                </th>
                {roles?.map((role) => (
                  <th key={role.key} className="min-w-28 bg-surface-muted px-3 py-3 text-center align-bottom">
                    <div className="flex items-center justify-center gap-1">
                      <span className={cn('text-xs font-semibold text-text', draft.has(role.key) && 'text-warning-600')}>
                        {role.name}
                      </span>
                      {editable && role.key !== 'owner' && (
                        <button
                          type="button"
                          onClick={() => setEditingRole(role)}
                          aria-label={`Edit ${role.name}`}
                          className="rounded p-0.5 text-text-subtle hover:bg-surface hover:text-text"
                        >
                          <Pencil size={12} />
                        </button>
                      )}
                      {role.key === 'owner' && <Lock size={12} className="text-text-subtle" aria-label="Fixed" />}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modules.map((group) => (
                <Fragment key={group.module}>
                  <tr className="border-b border-border bg-surface-muted/60">
                    <td className="sticky left-0 z-10 bg-surface-muted px-4 py-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                      {group.label}
                    </td>
                    {roles?.map((role) => {
                      const has = permissionsOf(role.key)
                      const count = group.permissions.filter((p) => has.has(p.key)).length
                      return (
                        <td key={role.key} className="px-3 py-2 text-center">
                          <ModuleCheckbox
                            label={`${role.name}: all of ${group.label}`}
                            checked={count === group.permissions.length}
                            indeterminate={count > 0 && count < group.permissions.length}
                            disabled={!editable || role.key === 'owner'}
                            onChange={(on) => toggleModule(role.key, group.permissions, on)}
                          />
                        </td>
                      )
                    })}
                  </tr>
                  {group.permissions.map((p) => (
                    <tr key={p.key} className="border-b border-divider hover:bg-surface-muted/40">
                      <td className="sticky left-0 z-10 bg-surface px-4 py-2.5">
                        <p className="font-medium text-text">{p.label}</p>
                        {p.description && <p className="text-xs text-text-muted">{p.description}</p>}
                      </td>
                      {roles?.map((role) => (
                        <td key={role.key} className="px-3 py-2.5 text-center">
                          <input
                            type="checkbox"
                            aria-label={`${role.name}: ${p.label}`}
                            className="h-4 w-4 cursor-pointer disabled:cursor-default"
                            checked={permissionsOf(role.key).has(p.key)}
                            disabled={!editable || role.key === 'owner'}
                            onChange={(e) => toggle(role.key, p.key, e.target.checked)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="mt-3 text-xs text-text-muted">
        Reset Data and this page are always owner-only. These rules are enforced by the database, not just by
        hiding buttons.
      </p>

      {editingRole !== undefined && (
        <RoleModal role={editingRole} roles={roles ?? []} onClose={() => setEditingRole(undefined)} />
      )}
    </div>
  )
}

function RoleModal({ role, roles, onClose }: { role: OrgRole | null; roles: OrgRole[]; onClose: () => void }) {
  const { orgId } = useOrg()
  const createRole = useCreateRole(orgId)
  const updateRole = useUpdateRole(orgId)
  const deleteRole = useDeleteRole(orgId)
  const toast = useToast()
  const [name, setName] = useState(role?.name ?? '')
  const [description, setDescription] = useState(role?.description ?? '')
  const [copyFrom, setCopyFrom] = useState('cashier')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const saving = createRole.isPending || updateRole.isPending

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      if (role) {
        await updateRole.mutateAsync({ key: role.key, name, description })
        toast.success('Role updated')
      } else {
        await createRole.mutateAsync({ name, description, copyFrom: copyFrom || null })
        toast.success(`Role "${name.trim()}" created. Tick its permissions, then save.`)
      }
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function handleDelete() {
    if (!role) return
    setError(null)
    try {
      await deleteRole.mutateAsync(role.key)
      toast.success('Role deleted')
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Modal title={role ? `Edit ${role.name}` : 'New role'} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <Input label="Name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Delivery Man" />
        <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        {!role && (
          <Select label="Start with the permissions of" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            <option value="">Nothing (blank role)</option>
            {roles
              .filter((r) => r.key !== 'owner')
              .map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
          </Select>
        )}
        {role?.is_system && (
          <p className="text-xs text-text-muted">Built-in roles can be renamed and re-permissioned, but not deleted.</p>
        )}
        {error && <p className="text-sm text-danger-600">{error}</p>}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            {role &&
              !role.is_system &&
              (confirmingDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-muted">Delete this role?</span>
                  <Button type="button" variant="danger" size="sm" onClick={handleDelete} disabled={deleteRole.isPending}>
                    {deleteRole.isPending ? 'Deleting…' : 'Delete'}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                    Keep
                  </Button>
                </div>
              ) : (
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingDelete(true)}>
                  <span className="text-danger-600">Delete role</span>
                </Button>
              ))}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : role ? 'Save changes' : 'Create role'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
