// Shared look for every text-like form control (Input, Select, and the few
// hand-rolled <input>/<textarea> elements on pages), so they all get the same
// border, inset shadow, placeholder colour, and soft indigo focus ring.
export const fieldBase =
  'rounded-lg border border-border-strong bg-surface text-sm text-text shadow-control ' +
  'placeholder:text-text-subtle transition-[border-color,box-shadow] duration-150 ' +
  'focus:outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 ' +
  'disabled:bg-surface-muted disabled:text-text-muted'

export const fieldError = 'border-danger-600 focus:border-danger-600 focus:ring-danger-600/20'
