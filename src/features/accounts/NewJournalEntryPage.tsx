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
import { useLedgerAccounts, useCreateJournalEntry, isManuallyPostable, type JournalEntryLinePayload } from './api'

interface DraftLine {
  key: number
  account_id: string
  debit: string
  credit: string
  name: string
  memo: string
}

let nextKey = 1

function blankLine(): DraftLine {
  return { key: nextKey++, account_id: '', debit: '', credit: '', name: '', memo: '' }
}

function today() {
  return new Date().toISOString().slice(0, 10)
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
            <div className="grid grid-cols-2 gap-4">
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
                {lines.map((line) => (
                  <tr key={line.key} className="border-b border-border last:border-0">
                    <Td>
                      <Select
                        value={line.account_id}
                        onChange={(e) => updateLine(line.key, { account_id: e.target.value })}
                      >
                        <option value="">Select an account…</option>
                        {postableAccounts?.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </Select>
                    </Td>
                    <Td>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.debit}
                        onChange={(e) =>
                          updateLine(line.key, { debit: e.target.value, credit: e.target.value ? '' : line.credit })
                        }
                      />
                    </Td>
                    <Td>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.credit}
                        onChange={(e) =>
                          updateLine(line.key, { credit: e.target.value, debit: e.target.value ? '' : line.debit })
                        }
                      />
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
                ))}
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
