import { useOrg } from '../../auth/OrgProvider'
import { Select } from '../../components/ui/Select'
import { useCustomers } from '../customers/api'

export function CustomerPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (customerId: string) => void
}) {
  const { orgId } = useOrg()
  const { data: customers } = useCustomers(orgId)

  return (
    <Select label="Customer" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Walk-in (no customer)</option>
      {customers?.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </Select>
  )
}
