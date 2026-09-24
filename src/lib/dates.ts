// Local-calendar date helpers. Never use `date.toISOString().slice(0, 10)` for
// a calendar date: toISOString is UTC, so for part of every day (after local
// midnight east of UTC, before it west of UTC) it yields the wrong day.

// 'YYYY-MM-DD' for the given moment, in the browser's local timezone.
export function ymd(d: Date) {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function todayYmd() {
  return ymd(new Date())
}

// Today plus/minus n calendar days, locally ('YYYY-MM-DD').
export function addDaysYmd(days: number) {
  const now = new Date()
  return ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days))
}

// The browser's IANA timezone (e.g. 'Europe/London'), passed to database
// functions so they group records by the viewer's local day. The database
// falls back to UTC if the name is ever unrecognised.
export function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}
