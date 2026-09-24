import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import {
  AS_OF_PRESETS,
  RANGE_PRESETS,
  type AsOfPreset,
  type AsOfState,
  type DateRangeState,
  type RangePreset,
} from './dates'

export function DateRangeControls({ state }: { state: DateRangeState }) {
  return (
    <>
      <div className="w-full sm:w-48">
        <Select
          label="Dates"
          value={state.preset}
          onChange={(e) => state.setPreset(e.target.value as RangePreset)}
        >
          {RANGE_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-full sm:w-44">
        <Input label="From" type="date" value={state.start} onChange={(e) => state.setStart(e.target.value)} />
      </div>
      <div className="w-full sm:w-44">
        <Input
          label="To"
          type="date"
          value={state.end}
          onChange={(e) => state.setEnd(e.target.value)}
          error={state.start && state.end && state.start > state.end ? 'Must be after From' : undefined}
        />
      </div>
    </>
  )
}

export function AsOfControls({ state }: { state: AsOfState }) {
  return (
    <>
      <div className="w-full sm:w-48">
        <Select
          label="As of"
          value={state.preset}
          onChange={(e) => state.setPreset(e.target.value as AsOfPreset)}
        >
          {AS_OF_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-full sm:w-44">
        <Input label="Date" type="date" value={state.asOf} onChange={(e) => state.setAsOf(e.target.value)} />
      </div>
    </>
  )
}

export function CheckboxControl({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex h-10 items-center gap-2 text-sm text-text">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-border accent-accent-600"
      />
      {label}
    </label>
  )
}

// A filter <Select> sized to sit in the controls row next to the date inputs.
export function FilterSelect({
  label,
  value,
  onChange,
  allLabel,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  allLabel: string
  options: { value: string; label: string }[]
}) {
  return (
    <div className="w-full sm:w-56">
      <Select label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  )
}
