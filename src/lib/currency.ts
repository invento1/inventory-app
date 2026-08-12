export function formatMoney(value: number, symbol = '$'): string {
  const cents = Math.round(value * 100)
  const hasFraction = cents % 100 !== 0
  const formatted = (cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })
  return `${symbol}${formatted}`
}
