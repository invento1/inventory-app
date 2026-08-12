import { useState, type FormEvent } from 'react'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import {
  useLedgerAccounts,
  useCreateLedgerAccount,
  useUpdateLedgerAccount,
  ACCOUNT_TYPES,
  type LedgerAccount,
  type LedgerAccountInput,
} from './api'

const emptyForm: LedgerAccountInput = {
  name: '',
  account_type: 'bank',
  parent_account_id: null,
  description: '',
  is_active: true,
}

export function LedgerAccountForm({
  orgId,
  account,
  onClose,
}: {
  orgId: string
  account?: LedgerAccount | null
  onClose: () => void
}) {
  const { data: accounts } = useLedgerAccounts(orgId)
  const [form, setForm] = useState<LedgerAccountInput>(
    account
      ? {
          name: account.name,
          account_type: account.account_type,
          parent_account_id: account.parent_account_id,
          description: account.description,
          is_active: account.is_active,
        }
      : emptyForm,
  )
  const [error, setError] = useState<string | null>(null)
  const createAccount = useCreateLedgerAccount(orgId)
  const updateAccount = useUpdateLedgerAccount(orgId)
  const toast = useToast()
  const saving = createAccount.isPending || updateAccount.isPending

  // An account can't be its own parent -- exclude it when editing.
  const parentOptions = (accounts ?? []).filter((a) => a.id !== account?.id)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      if (account) {
        await updateAccount.mutateAsync({ id: account.id, input: form })
        toast.success('Account updated')
      } else {
        await createAccount.mutateAsync(form)
        toast.success('Account created')
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <Modal title={account ? 'Edit account' : 'New account'} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <Input
          label="Account name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <Select
          label="Type"
          value={form.account_type}
          onChange={(e) => setForm({ ...form, account_type: e.target.value })}
        >
          {ACCOUNT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        <Select
          label="Sub-account of"
          value={form.parent_account_id ?? ''}
          onChange={(e) => setForm({ ...form, parent_account_id: e.target.value || null })}
        >
          <option value="">None</option>
          {parentOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Input
          label="Description"
          value={form.description ?? ''}
          onChange={(e) => setForm({ ...form, description: e.target.value || null })}
        />
        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border"
            checked={form.is_active ?? true}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          />
          Active
        </label>
        {error && <p className="text-sm text-danger-600">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : account ? 'Save changes' : 'Create account'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
