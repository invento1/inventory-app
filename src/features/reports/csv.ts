export type CsvCell = string | number | null | undefined
export type CsvRow = CsvCell[]

function escapeCell(cell: CsvCell) {
  if (cell === null || cell === undefined) return ''
  const text = typeof cell === 'number' ? String(Math.round(cell * 100) / 100) : cell
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

// Money goes out as plain numbers (no currency symbol, no thousands
// separators) so the file opens as real numeric columns in Excel/Sheets.
export function downloadCsv(filename: string, rows: CsvRow[]) {
  const body = rows.map((row) => row.map(escapeCell).join(',')).join('\r\n')
  // Leading BOM so Excel reads the file as UTF-8 (names with accents, "–", etc.).
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
