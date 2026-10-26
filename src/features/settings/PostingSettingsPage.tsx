import { useState } from 'react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardBody } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Select'
import { Modal } from '../../components/ui/Modal'
import { PageSpinner } from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/Toast'
import { formatMoney } from '../../lib/currency'
import { useLedgerAccounts, type LedgerAccountRow } from '../accounts/api'
import {
  POSTING_ROLES,
  currentPostingAccount,
  usePostingAccounts,
  useSetPostingAccount,
  type PostingRole,
} from '../accounts/postingAccounts'

export function PostingSettingsPage() {
  const { orgId, currencySymbol, can } = useOrg()
  const { data: accounts, isLoading } = useLedgerAccounts(orgId)
  const { data: mapped, isLoading: mappedLoading } = usePostingAccounts(orgId)
  const [editing, setEditing] = useState<PostingRole | null>(null)
  const canEdit = can('accounts.manage')

  return (
    <div>
      <PageHeader
        title="Posting Settings"
        subtitle="Which account each automatic posting goes to. Invoices, receipts, payments and bills follow these from now on."
      />

      <Card>
        {isLoading || mappedLoading ? (
          <PageSpinner />
        ) : (
          <Table>
            <THead>
              <Th>Posting</Th>
              <Th>Used for</Th>
              <Th>Account</Th>
              <Th className="text-right">Balance</Th>
              <Th />
            </THead>
            <tbody>
              {POSTING_ROLES.map((role) => {
                const { account, isDefault } = currentPostingAccount(role, mapped, accounts)
                return (
                  <Tr key={role.key}>
                    <Td className="whitespace-nowrap font-medium">{role.label}</Td>
                    <Td className="text-sm text-text-muted">{role.usedFor}</Td>
                    <Td className="whitespace-nowrap">
                      {account ? account.name : <span className="text-text-muted">{role.defaultName} (created on first use)</span>}
                      {isDefault && account && (
                        <span className="ml-2">
                          <Badge tone="neutral">Default</Badge>
                        </span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-right tabular-nums">
                      {account ? formatMoney(account.balance, currencySymbol) : '—'}
                    </Td>
                    <Td className="text-right">
                      {canEdit && (
                        <Button variant="secondary" size="sm" onClick={() => setEditing(role)}>
                          Change
                        </Button>
                      )}
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="mt-4">
        <CardBody className="text-sm text-text-muted">
          <p>
            Changing <strong className="text-text">Cash, Bank, Sales Income or Cost of Goods Sold</strong> only affects
            new postings; what's already been recorded stays in the old account.
          </p>
          <p className="mt-2">
            Changing <strong className="text-text">Undeposited Funds, Accounts Receivable, Inventory or Accounts Payable</strong>{' '}
            also moves the old account's balance to the new one, in one dated entry. Those balances must always match the
            payments, invoices, stock and bills behind them.
          </p>
        </CardBody>
      </Card>

      {editing && accounts && (
        <ChangeAccountModal
          orgId={orgId}
          role={editing}
          accounts={accounts}
          current={currentPostingAccount(editing, mapped, accounts).account}
          symbol={currencySymbol}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function ChangeAccountModal({
  orgId,
  role,
  accounts,
  current,
  symbol,
  onClose,
}: {
  orgId: string
  role: PostingRole
  accounts: LedgerAccountRow[]
  current: LedgerAccountRow | undefined
  symbol: string
  onClose: () => void
}) {
  const toast = useToast()
  const setAccount = useSetPostingAccount(orgId)
  const [accountId, setAccountId] = useState(current?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const options = accounts.filter((a) => a.is_active && role.types.includes(a.account_type))
  const moving = role.controlled && current && accountId && accountId !== current.id && current.balance !== 0

  async function save() {
    setError(null)
    if (!accountId || accountId === current?.id) {
      onClose()
      return
    }
    try {
      await setAccount.mutateAsync({ key: role.key, accountId })
      toast.success(`${role.label} account updated`)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <Modal title={`${role.label} account`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-muted">{role.usedFor}.</p>
        <Select label="Account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {!current && <option value="">Choose an account…</option>}
          {options.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.id === current?.id ? ' (current)' : ''}
            </option>
          ))}
        </Select>
        {options.length <= 1 && (
          <p className="text-xs text-text-muted">
            Only accounts of the right type are listed. Add another in Account → Capital Matrix first if the one you want
            isn't here.
          </p>
        )}
        {moving && (
          <p className="rounded-lg border border-warning-600/30 bg-warning-50 px-3 py-2 text-sm text-text">
            The current balance of <strong>{formatMoney(current.balance, symbol)}</strong> will be moved from "{current.name}"
            to the new account, dated today.
          </p>
        )}
        {error && <p className="text-sm text-danger-600">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={setAccount.isPending}>
            {setAccount.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
