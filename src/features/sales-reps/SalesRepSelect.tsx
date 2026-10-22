import { Select } from '../../components/ui/Select'
import { useOrg } from '../../auth/OrgProvider'
import { useSalesReps } from './api'

// Rep picker for documents and customers. Lists active reps, plus the current
// value if it has since been deactivated (so editing never silently drops it).
export function SalesRepSelect({
  value,
  onChange,
  label = 'Sales representative',
  emptyLabel = 'No representative',
}: {
  value: string | null
  onChange: (id: string | null) => void
  label?: string
  emptyLabel?: string
}) {
  const { orgId } = useOrg()
  const { data: reps } = useSalesReps(orgId)
  const options = (reps ?? []).filter((r) => r.is_active || r.id === value)

  return (
    <Select label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{emptyLabel}</option>
      {options.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
          {r.is_active ? '' : ' (inactive)'}
        </option>
      ))}
    </Select>
  )
}
