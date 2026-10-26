import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardBody } from '../../components/ui/Card'
import { Table, THead, Th, Td } from '../../components/ui/Table'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { useToast } from '../../components/ui/Toast'
import { formatMoney } from '../../lib/currency'
import {
  useLedgerAccounts,
  useCreateJournalEntry,
  isManuallyPostable,
  type JournalEntryLinePayload,
  type LedgerAccountRow,
} from './api'
import { ymd } from '../../lib/dates'

interface DraftLine {
  key: number
  account_id: string
  debit: string
  credit: string
  name: string
  memo: string
  // Filled with its account's whole balance by "Debit all" / "Credit all".
  full?: boolean
  // Filled automatically to balance that line's full-balance transfer.
  autoFor?: number
}

let nextKey = 1

function blankLine(): DraftLine {
  return { key: nextKey++, account_id: '', debit: '', credit: '', name: '', memo: '' }
}

function today() {
  return ymd(new Date())
}

// Balance-sheet types (asset/liability/equity) get a prominent badge --
// these are the "how much do I actually have/owe" accounts a user checks
// before debiting/crediting. Income/expense/COGS accounts stay as plain
// small text, since their running balance is a period total, not a
// spendable amount, and doesn't warrant the same visual weight.
const BALANCE_SHEET_TYPES = new Set([
  'bank',
  'equity',
  'accounts_receivable',
  'accounts_payable',
  'other_current_asset',
  'other_asset',
  'fixed_asset',
  'other_current_liability',
  'long_term_liability',
])
// Of those, only true asset types warrant a "you may be about to overdraw
// this" warning on a zero/negative balance -- a liability or equity
// account sitting at zero isn't inherently a red flag the way an empty
// Cash/Bank account is.
const ASSET_TYPES = new Set(['bank', 'other_current_asset', 'other_asset', 'fixed_asset'])

function AccountBalanceHint({ account, currencySymbol }: { account: LedgerAccountRow; currencySymbol: string }) {
  const isBalanceSheet = BALANCE_SHEET_TYPES.has(account.account_type)
  const isLowAsset = ASSET_TYPES.has(account.account_type) && account.balance <= 0

  if (!isBalanceSheet) {
    return (
      <span className="mt-1 block text-xs text-text-muted">
        Balance: {formatMoney(account.balance, currencySymbol)}
      </span>
    )
  }

  return (
    <div className="mt-1">
      <Badge tone={isLowAsset ? 'warning' : 'accent'}>
        Balance: {formatMoney(account.balance, currencySymbol)}
      </Badge>
    </div>
  )
}

// Balances are shown credit-positive for these types (ledger_account_balances
// flips the sign), so a debit of the full balance brings them to zero.
const CREDIT_NORMAL_TYPES = new Set([
  'income',
  'other_income',
  'equity',
  'accounts_payable',
  'other_current_liability',
  'long_term_liability',
])

type Side = 'debit' | 'credit'

// The side that empties an account: credit for debit-normal accounts with a
// positive balance, debit for credit-normal ones (flipped when negative).
function clearingSide(account: LedgerAccountRow): Side {
  return CREDIT_NORMAL_TYPES.has(account.account_type) === account.balance > 0 ? 'debit' : 'credit'
}

const roundMoney = (n: number) => Math.round(n * 100) / 100
const lineNet = (l: DraftLine) => (Number(l.debit) || 0) - (Number(l.credit) || 0)

const helperSlot = 'flex h-5 justify-end'
const helperText = 'mt-1 px-1 text-xs'

// Faint until the row is hovered or the button focused.
function HelperButton({
  label,
  title,
  strong,
  onClick,
}: {
  label: string
  title: string
  strong?: boolean
  onClick: () => void
}) {
  return (
    <div className={helperSlot}>
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={
          strong
            ? 'mt-1 rounded bg-accent-50 px-1.5 text-xs font-medium text-accent-700 hover:underline'
            : 'mt-1 rounded px-1 text-xs font-medium text-accent-700 opacity-40 transition-opacity hover:underline focus-visible:opacity-100 group-hover:opacity-100'
        }
      >
        {label}
      </button>
    </div>
  )
}

export function NewJournalEntryPage() {
  const { orgId, currencySymbol } = useOrg()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: accounts } = useLedgerAccounts(orgId)
  const postableAccounts = accounts?.filter(isManuallyPostable)
  const createEntry = useCreateJournalEntry(orgId)

  const [entryDate, setEntryDate] = useState(today())
  const [memo, setMemo] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([blankLine(), blankLine()])
  const [error, setError] = useState<string | null>(null)

  function updateLine(key: number, patch: Partial<DraftLine>) {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  // A hand edit to a line's account or amounts: it's no longer a helper-filled
  // line, and any line auto-filled to balance it stops being linked to it.
  function editLine(key: number, patch: Partial<DraftLine>) {
    setLines((current) =>
      current.map((l) =>
        l.key === key
          ? { ...l, ...patch, full: false, autoFor: undefined }
          : l.autoFor === key
            ? { ...l, autoFor: undefined }
            : l,
      ),
    )
  }

  // Choosing an account keeps a transfer's link (picking the destination after
  // "Credit all" is the normal order); a full-balance amount no longer is one.
  function pickAccount(key: number, accountId: string) {
    updateLine(key, { account_id: accountId, full: false })
  }

  // "Credit all" on Cash: Cash is credited with its whole balance, and the
  // destination line (the next line with an account and no amount, else an
  // empty line, else a new one) is filled on the other side so the entry
  // balances.
  function transferAll(key: number, side: Side, amount: number) {
    setLines((current) => {
      let next = current.map((l) =>
        l.key === key
          ? {
              ...l,
              debit: side === 'debit' ? String(amount) : '',
              credit: side === 'credit' ? String(amount) : '',
              full: true,
              autoFor: undefined,
            }
          : l,
      )
      const others = next.filter((l) => l.key !== key)
      const empty = (l: DraftLine) => (!l.debit && !l.credit) || l.autoFor === key
      let target =
        others.find((l) => l.autoFor === key) ??
        others.find((l) => l.account_id && empty(l)) ??
        others.find((l) => !l.account_id && empty(l))
      if (!target) {
        target = blankLine()
        next = [...next, target]
      }
      const targetKey = target.key
      const out = roundMoney(next.filter((l) => l.key !== targetKey).reduce((sum, l) => sum + lineNet(l), 0))
      return next.map((l) =>
        l.key !== targetKey
          ? l
          : out === 0
            ? { ...l, debit: '', credit: '', autoFor: undefined }
            : {
                ...l,
                debit: out < 0 ? String(-out) : '',
                credit: out > 0 ? String(out) : '',
                full: false,
                autoFor: key,
              },
      )
    })
  }

  // What goes under a line's Debit or Credit box.
  function helperFor(line: DraftLine, side: Side, account: LedgerAccountRow | undefined) {
    const other: Side = side === 'debit' ? 'credit' : 'debit'
    if (line[side]) {
      if (line.autoFor != null) {
        const source = lines.find((l) => l.key === line.autoFor)
        const sourceName = accounts?.find((a) => a.id === source?.account_id)?.name
        return (
          <div className={helperSlot}>
            <span className={`${helperText} font-medium text-accent-700`}>
              Balances {sourceName ?? 'the transfer'}
            </span>
          </div>
        )
      }
      if (line.full) {
        return (
          <div className={helperSlot}>
            <span className={`${helperText} text-text-muted`}>Full balance</span>
          </div>
        )
      }
      return <div className="h-5" aria-hidden />
    }
    if (line[other] || !account) return <div className="h-5" aria-hidden />

    // Out of balance: offer only the side that balances it, highlighted.
    if (!balanced) {
      const needed: Side = outBy > 0 ? 'credit' : 'debit'
      if (side !== needed) return <div className="h-5" aria-hidden />
      const amount = Math.abs(outBy)
      return (
        <HelperButton
          strong
          label={`${side === 'debit' ? 'Debit' : 'Credit'} ${formatMoney(amount, currencySymbol)}`}
          title="Fill the amount that balances this entry"
          onClick={() => editLine(line.key, { [side]: String(amount), [other]: '' })}
        />
      )
    }

    // Balanced (or empty): offer moving the account's whole balance out.
    const amount = roundMoney(Math.abs(account.balance))
    if (amount === 0 || side !== clearingSide(account)) return <div className="h-5" aria-hidden />
    const label = side === 'debit' ? 'Debit all' : 'Credit all'
    return (
      <HelperButton
        label={label}
        title={`${label}: ${formatMoney(amount, currencySymbol)}. Brings ${account.name} to zero, and fills the other line to match.`}
        onClick={() => transferAll(line.key, side, amount)}
      />
    )
  }

  function addLine() {
    setLines((current) => [...current, blankLine()])
  }

  function removeLine(key: number) {
    setLines((current) => (current.length <= 2 ? current : current.filter((l) => l.key !== key)))
  }

  const totalDebit = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0)
  const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0)
  const outBy = Math.round((totalDebit - totalCredit) * 100) / 100
  const balanced = Math.abs(outBy) < 0.005

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const payload: JournalEntryLinePayload[] = []
    for (const line of lines) {
      const debit = Number(line.debit) || 0
      const credit = Number(line.credit) || 0
      if (!line.account_id && debit === 0 && credit === 0) continue
      if (!line.account_id) {
        setError('Every line with an amount needs an account.')
        return
      }
      if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
        setError('Every line needs either a debit or a credit amount, not both or neither.')
        return
      }
      payload.push({
        account_id: line.account_id,
        debit,
        credit,
        name: line.name || null,
        memo: line.memo || null,
      })
    }

    if (payload.length < 2) {
      setError('Add at least two account lines.')
      return
    }
    if (!balanced) {
      setError(`Debits and credits must be equal (out by ${formatMoney(Math.abs(outBy), currencySymbol)}).`)
      return
    }

    try {
      await createEntry.mutateAsync({ entryDate, memo: memo || null, lines: payload })
      toast.success('Journal entry posted')
      navigate('/account/fiscal-daybook')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div>
      <PageHeader
        title="New journal entry"
        action={
          <button
            type="button"
            onClick={() => navigate('/account/fiscal-daybook')}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text"
          >
            <ArrowLeft size={16} />
            Back
          </button>
        }
      />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Card>
          <CardBody>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Transaction date"
                type="date"
                required
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
              />
              <Input label="Memo" value={memo} onChange={(e) => setMemo(e.target.value)} />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="p-0">
            <Table>
              <THead>
                <Th>Account</Th>
                <Th className="text-right">Debit</Th>
                <Th className="text-right">Credit</Th>
                <Th>Name</Th>
                <Th>Memo</Th>
                <Th></Th>
              </THead>
              <tbody>
                {lines.map((line) => {
                  const selectedAccount = postableAccounts?.find((a) => a.id === line.account_id)
                  return (
                    <tr key={line.key} className="group border-b border-border last:border-0">
                      <Td>
                        <Select
                          value={line.account_id}
                          onChange={(e) => pickAccount(line.key, e.target.value)}
                        >
                          <option value="">Select an account…</option>
                          {postableAccounts?.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </Select>
                        {selectedAccount && (
                          <AccountBalanceHint account={selectedAccount} currencySymbol={currencySymbol} />
                        )}
                      </Td>
                      <Td>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.debit}
                          onChange={(e) =>
                            editLine(line.key, { debit: e.target.value, credit: e.target.value ? '' : line.credit })
                          }
                        />
                        {helperFor(line, 'debit', selectedAccount)}
                      </Td>
                      <Td>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.credit}
                          onChange={(e) =>
                            editLine(line.key, { credit: e.target.value, debit: e.target.value ? '' : line.debit })
                          }
                        />
                        {helperFor(line, 'credit', selectedAccount)}
                      </Td>
                      <Td>
                        <Input value={line.name} onChange={(e) => updateLine(line.key, { name: e.target.value })} />
                      </Td>
                      <Td>
                        <Input value={line.memo} onChange={(e) => updateLine(line.key, { memo: e.target.value })} />
                      </Td>
                      <Td>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeLine(line.key)}
                          disabled={lines.length === 1}
                        >
                          <Trash2 size={16} />
                        </Button>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
            <div className="flex items-center justify-between border-t border-border p-4">
              <Button type="button" variant="secondary" size="sm" onClick={addLine}>
                <Plus size={14} />
                Add line
              </Button>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-text-muted">
                  Debit {formatMoney(totalDebit, currencySymbol)} · Credit {formatMoney(totalCredit, currencySymbol)}
                </span>
                <Badge tone={balanced ? 'success' : 'danger'}>
                  {balanced ? 'Balanced' : `Out by ${formatMoney(Math.abs(outBy), currencySymbol)}`}
                </Badge>
              </div>
            </div>
          </CardBody>
        </Card>

        <p className="text-xs text-text-muted">
          Undeposited Funds, Accounts Receivable, and Accounts Payable aren't listed here — they're kept in
          sync automatically. Use Receive Payment, Pay Bills, or Record Deposit to clear those instead.
        </p>

        {error && <p className="text-sm text-danger-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate('/account/fiscal-daybook')}>
            Cancel
          </Button>
          <Button type="submit" disabled={createEntry.isPending}>
            {createEntry.isPending ? 'Posting…' : 'Post entry'}
          </Button>
        </div>
      </form>
    </div>
  )
}
