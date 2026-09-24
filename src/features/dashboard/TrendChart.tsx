import { useEffect, useId, useRef, useState } from 'react'
import { Card, CardHeader } from '../../components/ui/Card'
import { PageSpinner } from '../../components/ui/Spinner'
import { formatMoney } from '../../lib/currency'
import { formatDate } from '../reports/dates'

export interface ChartSeries {
  name: string
  // A CSS colour, normally a theme token: 'var(--color-accent-600)'.
  color: string
  values: number[]
}

const HEIGHT = 220
const PAD = { left: 56, right: 12, top: 14, bottom: 26 }

// Round tick values (1 / 2 / 2.5 / 5 x 10^n) spanning [min, max].
function niceTicks(min: number, max: number, count = 4) {
  const span = max - min || 1
  const rough = span / count
  const pow = 10 ** Math.floor(Math.log10(rough))
  const f = rough / pow
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow
  const start = Math.floor(min / step) * step
  const end = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v / step) * step)
  return ticks
}

function compactMoney(value: number, symbol: string) {
  const text = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    Math.abs(value),
  )
  return `${value < 0 ? '-' : ''}${symbol}${text}`
}

function shortDate(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

// Lightweight two-series line/area chart, hand-drawn SVG (no chart library).
// Renders at the container's real pixel width (ResizeObserver) so text stays
// crisp at every size, with a hover crosshair + tooltip.
export function TrendChart({
  title,
  subtitle,
  days,
  series,
  symbol,
  isLoading,
}: {
  title: string
  subtitle?: string
  days: string[]
  series: ChartSeries[]
  symbol: string
  isLoading?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState<number | null>(null)
  const gradientBase = useId()

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const n = days.length
  const all = series.flatMap((s) => s.values)
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all, 1))
  const yMin = ticks[0]
  const yMax = ticks[ticks.length - 1]
  const plotW = width - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1))
  const y = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH
  const baseline = y(Math.min(Math.max(0, yMin), yMax))

  // Date labels spaced by real pixels (~72px apart), and none crowding the
  // always-shown last label, so they never collide on a narrow phone.
  const MIN_LABEL_GAP = 72
  const labelStep = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / MIN_LABEL_GAP))))
  const xLabels = days
    .map((d, i) => ({ d, i }))
    .filter(({ i }) => i === n - 1 || (i % labelStep === 0 && x(n - 1) - x(i) >= MIN_LABEL_GAP))

  const isEmpty = all.every((v) => v === 0)

  function onPointerMove(e: React.PointerEvent<SVGRectElement>) {
    if (n === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const i = n <= 1 ? 0 : Math.round((px / rect.width) * (n - 1))
    setHover(Math.min(n - 1, Math.max(0, i)))
  }

  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={subtitle}
        action={
          <div className="flex flex-wrap justify-end gap-x-4 gap-y-1">
            {series.map((s) => (
              <span key={s.name} className="inline-flex items-center gap-1.5 text-xs text-text-muted">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.name}
                <span className="font-semibold tabular-nums text-text">
                  {formatMoney(
                    s.values.reduce((a, b) => a + b, 0),
                    symbol,
                  )}
                </span>
              </span>
            ))}
          </div>
        }
      />
      <div ref={containerRef} className="relative px-2 pb-3 pt-2">
        {isLoading ? (
          <PageSpinner />
        ) : (
          <>
            <svg
              width={width}
              height={HEIGHT}
              className="block max-w-full"
              role="img"
              aria-label={`${title}: ${series
                .map((s) => `${s.name} ${formatMoney(s.values.reduce((a, b) => a + b, 0), symbol)}`)
                .join(', ')}`}
            >
              <defs>
                {series.map((s, si) => (
                  <linearGradient key={s.name} id={`${gradientBase}-${si}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={si === 0 ? 0.18 : 0.08} />
                    <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                  </linearGradient>
                ))}
              </defs>

              {ticks.map((t) => (
                <g key={t}>
                  <line
                    x1={PAD.left}
                    x2={width - PAD.right}
                    y1={y(t)}
                    y2={y(t)}
                    stroke={t === 0 && yMin < 0 ? 'var(--color-border-strong)' : 'var(--color-divider)'}
                  />
                  <text
                    x={PAD.left - 8}
                    y={y(t)}
                    dy="0.32em"
                    textAnchor="end"
                    className="fill-text-subtle text-[11px] tabular-nums"
                  >
                    {compactMoney(t, symbol)}
                  </text>
                </g>
              ))}

              {xLabels.map(({ d, i }) => (
                <text
                  key={d}
                  x={x(i)}
                  y={HEIGHT - 6}
                  textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                  className="fill-text-subtle text-[11px]"
                >
                  {shortDate(d)}
                </text>
              ))}

              {n > 0 &&
                series.map((s, si) => {
                  const points = s.values.map((v, i) => `${x(i)},${y(v)}`)
                  const line = `M${points.join(' L')}`
                  const area = `${line} L${x(n - 1)},${baseline} L${x(0)},${baseline} Z`
                  return (
                    <g key={s.name}>
                      <path d={area} fill={`url(#${gradientBase}-${si})`} />
                      <path
                        d={line}
                        fill="none"
                        stroke={s.color}
                        strokeWidth={2}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    </g>
                  )
                })}

              {hover !== null && (
                <g pointerEvents="none">
                  <line
                    x1={x(hover)}
                    x2={x(hover)}
                    y1={PAD.top}
                    y2={PAD.top + plotH}
                    stroke="var(--color-border-strong)"
                    strokeDasharray="3 3"
                  />
                  {series.map((s) => (
                    <circle
                      key={s.name}
                      cx={x(hover)}
                      cy={y(s.values[hover])}
                      r={4}
                      fill="var(--color-surface)"
                      stroke={s.color}
                      strokeWidth={2}
                    />
                  ))}
                </g>
              )}

              <rect
                x={PAD.left}
                y={PAD.top}
                width={Math.max(0, plotW)}
                height={plotH}
                fill="transparent"
                onPointerMove={onPointerMove}
                onPointerLeave={() => setHover(null)}
              />
            </svg>

            {isEmpty && (
              <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-text-muted">
                No activity in this period yet.
              </p>
            )}

            {hover !== null && (
              <div
                className="pointer-events-none absolute top-3 z-10 min-w-40 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-card-hover"
                style={{
                  left: Math.min(Math.max(x(hover) + 8, 8), width - 176),
                }}
              >
                <p className="mb-1 font-semibold text-text">{formatDate(days[hover])}</p>
                {series.map((s) => (
                  <p key={s.name} className="flex items-center justify-between gap-4 text-text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                      {s.name}
                    </span>
                    <span className="font-medium tabular-nums text-text">{formatMoney(s.values[hover], symbol)}</span>
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  )
}
