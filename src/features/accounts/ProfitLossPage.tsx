import { useMemo, useState } from 'react'
import { useOrg } from '../../auth/OrgProvider'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '../../components/ui/Card'
import { Table, THead, Th, Td, Tr, EmptyState } from '../../components/ui/Table'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { PageSpinner } from '../../components/ui/Spinner'
import { formatMoney } from '../../lib/currency'
import { useProfitAndLoss } from './api'

const INCOME_TYPES = new Set(['income', 'other_income'])
const COGS_TYPE = 'cost_of_goods_sold'

function toDateInput(d: Date) {
  return d.toISOString().slice(0, 10)
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function startOfYear(d: Date) {
  return new Date(d.getFullYear(), 0, 1)
}

export function ProfitLossPage() {
  const { orgId, currencySymbol } = useOrg()
  const today = new Date()

  const [startDate, setStartDate] = useState(toDateInput(startOfMonth(today)))
  const [endDate, setEndDate] = useState(toDateInput(today))

  const { data: rows, isLoading } = useProfitAndLoss(orgId, startDate, endDate)

  const { income, cogs, operatingExpenses, totalIncome, totalCogs, totalOperatingExpenses, grossProfit, netProfit } =
    useMemo(() => {
      const income = (rows ?? []).filter((r) => INCOME_TYPES.has(r.account_type))
      const cogs = (rows ?? []).filter((r) => r.account_type === COGS_TYPE)
      const operatingExpenses = (rows ?? []).filter(
        (r) => !INCOME_TYPES.has(r.account_type) && r.account_type !== COGS_TYPE,
      )
      const totalIncome = income.reduce((sum, r) => sum + r.amount, 0)
      const totalCogs = cogs.reduce((sum, r) => sum + r.amount, 0)
      const totalOperatingExpenses = operatingExpenses.reduce((sum, r) => sum + r.amount, 0)
      const grossProfit = totalIncome - totalCogs
      return {
        income,
        cogs,
        operatingExpenses,
        totalIncome,
        totalCogs,
        totalOperatingExpenses,
        grossProfit,
        netProfit: grossProfit - totalOperatingExpenses,
      }
    }, [rows])

  function applyPreset(preset: 'this-month' | 'last-month' | 'this-year') {
    const now = new Date()
    if (preset === 'this-month') {
      setStartDate(toDateInput(startOfMonth(now)))
      setEndDate(toDateInput(now))
    } else if (preset === 'last-month') {
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)
      const lastMonthStart = startOfMonth(lastMonthEnd)
      setStartDate(toDateInput(lastMonthStart))
      setEndDate(toDateInput(lastMonthEnd))
    } else {
      setStartDate(toDateInput(startOfYear(now)))
      setEndDate(toDateInput(now))
    }
  }

  return (
    <div>
      <PageHeader title="Profit & Loss" subtitle="Net income for a date range" />

      <Card className="mb-4">
        <CardBody>
          <div className="flex flex-wrap items-end gap-4">
            <Input label="Start date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <Input label="End date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            <div className="flex gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => applyPreset('this-month')}>
                This month
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => applyPreset('last-month')}>
                Last month
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => applyPreset('this-year')}>
                This year
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {isLoading ? (
        <PageSpinner />
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Income" />
            <CardBody className="p-0">
              <Table>
                <THead>
                  <Th>Account</Th>
                  <Th className="text-right">Amount</Th>
                </THead>
                <tbody>
                  {income.length === 0 && <EmptyState message="No income accounts." />}
                  {income.map((r) => (
                    <Tr key={r.account_id}>
                      <Td>{r.account_name}</Td>
                      <Td className="text-right">{formatMoney(r.amount, currencySymbol)}</Td>
                    </Tr>
                  ))}
                  <Tr className="font-semibold">
                    <Td>Total income</Td>
                    <Td className="text-right">{formatMoney(totalIncome, currencySymbol)}</Td>
                  </Tr>
                </tbody>
              </Table>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Cost of Goods Sold" />
            <CardBody className="p-0">
              <Table>
                <THead>
                  <Th>Account</Th>
                  <Th className="text-right">Amount</Th>
                </THead>
                <tbody>
                  {cogs.length === 0 && <EmptyState message="No cost of goods sold in this range." />}
                  {cogs.map((r) => (
                    <Tr key={r.account_id}>
                      <Td>{r.account_name}</Td>
                      <Td className="text-right">{formatMoney(r.amount, currencySymbol)}</Td>
                    </Tr>
                  ))}
                  <Tr className="font-semibold">
                    <Td>Total COGS</Td>
                    <Td className="text-right">{formatMoney(totalCogs, currencySymbol)}</Td>
                  </Tr>
                </tbody>
              </Table>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <div className="flex items-center justify-between">
                <span className="text-base font-semibold text-text">Gross profit</span>
                <span className={`text-lg font-bold ${grossProfit >= 0 ? 'text-success-600' : 'text-danger-600'}`}>
                  {formatMoney(grossProfit, currencySymbol)}
                </span>
              </div>
              <p className="mt-1 text-xs text-text-muted">Total income minus Cost of Goods Sold.</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Operating Expenses" />
            <CardBody className="p-0">
              <Table>
                <THead>
                  <Th>Account</Th>
                  <Th className="text-right">Amount</Th>
                </THead>
                <tbody>
                  {operatingExpenses.length === 0 && <EmptyState message="No operating expense accounts." />}
                  {operatingExpenses.map((r) => (
                    <Tr key={r.account_id}>
                      <Td>{r.account_name}</Td>
                      <Td className="text-right">{formatMoney(r.amount, currencySymbol)}</Td>
                    </Tr>
                  ))}
                  <Tr className="font-semibold">
                    <Td>Total operating expenses</Td>
                    <Td className="text-right">{formatMoney(totalOperatingExpenses, currencySymbol)}</Td>
                  </Tr>
                </tbody>
              </Table>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <div className="flex items-center justify-between">
                <span className="text-base font-semibold text-text">Net profit</span>
                <span
                  className={`text-xl font-bold ${netProfit >= 0 ? 'text-success-600' : 'text-danger-600'}`}
                >
                  {formatMoney(netProfit, currencySymbol)}
                </span>
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  )
}
