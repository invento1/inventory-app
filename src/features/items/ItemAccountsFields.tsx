import { Select } from '../../components/ui/Select'
import { useOrg } from '../../auth/OrgProvider'
import { formatMoney } from '../../lib/currency'
import { useLedgerAccounts } from '../accounts/api'
import { POSTING_ROLES, currentPostingAccount, usePostingAccounts, type PostingKey } from '../accounts/postingAccounts'

export interface ItemAccounts {
  income_account_id: string | null
  cogs_account_id: string | null
  inventory_account_id: string | null
}

const FIELDS: { field: keyof ItemAccounts; label: string; role: PostingKey; types: string[] }[] = [
  { field: 'income_account_id', label: 'Income account', role: 'sales_income', types: ['income', 'other_income'] },
  { field: 'cogs_account_id', label: 'Cost of goods sold account', role: 'cost_of_goods_sold', types: ['cost_of_goods_sold'] },
  { field: 'inventory_account_id', label: 'Inventory account', role: 'inventory', types: ['other_current_asset'] },
]

// The item's own ledger accounts. Each one is optional: "Default" follows
// Posting Settings. Only shown to people who can manage accounts (the
// database enforces the same).
export function ItemAccountsFields({
  orgId,
  value,
  onChange,
  saved,
  stockValue,
}: {
  orgId: string
  value: ItemAccounts
  onChange: (next: ItemAccounts) => void
  // The item as saved, when editing: used to warn that its stock value moves.
  saved?: ItemAccounts
  stockValue?: number
}) {
  const { can, currencySymbol } = useOrg()
  const { data: accounts } = useLedgerAccounts(orgId)
  const { data: mapped } = usePostingAccounts(orgId)
  if (!can('accounts.manage')) return null

  const undeposited = currentPostingAccount(POSTING_ROLES.find((r) => r.key === 'undeposited_funds')!, mapped, accounts).account
  const nameOf = (id: string | null, fallback: string) => (id ? accounts?.find((a) => a.id === id)?.name : null) ?? fallback

  const defaultInventory = currentPostingAccount(POSTING_ROLES.find((r) => r.key === 'inventory')!, mapped, accounts).account
  const inventoryMoves =
    saved !== undefined &&
    (saved.inventory_account_id ?? null) !== (value.inventory_account_id ?? null) &&
    (stockValue ?? 0) !== 0

  const custom = FIELDS.filter((f) => value[f.field]).length

  return (
    <details className="rounded-lg border border-border px-4 py-3" open={custom > 0}>
      <summary className="cursor-pointer text-sm font-medium text-text">
        Accounts{' '}
        <span className="font-normal text-text-muted">
          {custom > 0 ? `(${custom} set for this item)` : '(optional: uses Posting Settings)'}
        </span>
      </summary>
      <div className="mt-3 flex flex-col gap-4">
        {FIELDS.map((f) => {
          const role = POSTING_ROLES.find((r) => r.key === f.role)!
          const def = currentPostingAccount(role, mapped, accounts).account
          const options = (accounts ?? []).filter(
            (a) =>
              f.types.includes(a.account_type) &&
              a.id !== def?.id &&
              (a.is_active || a.id === value[f.field]) &&
              !(f.field === 'inventory_account_id' && a.id === undeposited?.id),
          )
          return (
            <Select
              key={f.field}
              label={f.label}
              value={value[f.field] ?? ''}
              onChange={(e) => onChange({ ...value, [f.field]: e.target.value || null })}
            >
              <option value="">Default ({def?.name ?? role.defaultName})</option>
              {options.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )
        })}
      </div>
      <p className="mt-3 text-xs text-text-muted">
        Sales of this item post to its income and cost accounts, and its stock is valued in its inventory account. Add
        accounts in Account → Capital Matrix.
      </p>
      {inventoryMoves && (
        <p className="mt-3 rounded-lg border border-warning-600/30 bg-warning-50 px-3 py-2 text-sm text-text">
          Its stock value of <strong>{formatMoney(stockValue ?? 0, currencySymbol)}</strong> will move from "
          {nameOf(saved?.inventory_account_id ?? null, defaultInventory?.name ?? 'Inventory')}" to "
          {nameOf(value.inventory_account_id, defaultInventory?.name ?? 'Inventory')}", dated today.
        </p>
      )}
    </details>
  )
}
