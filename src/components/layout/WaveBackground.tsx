// Ambient, slowly drifting sea waves pinned to the bottom of the viewport,
// behind every page (AppLayout stacks the sidebar and content above it with
// relative z-10). Purely decorative: aria-hidden, pointer-events-none, hidden
// in print, and frozen for prefers-reduced-motion (see .hub-wave in
// index.css, which also holds the keyframes and per-layer timings).
//
// Design reference: public/refernce image made by chatgpt.png (local only,
// gitignored -- see CLAUDE.md).

// SVG coordinate space: 2880 wide = two copies of a 1440-wide pattern, so the
// -50% drift in floatWave lands exactly on the start of the second copy.
const WIDTH = 2880
const HEIGHT = 320

// A smooth sine-like wave: one quadratic crest, then T commands, which mirror
// the previous control point so every following half-period stays smooth.
// `period` must divide 1440 so the pattern repeats cleanly across the seam.
function wavePath(period: number, amplitude: number, baseline: number) {
  const half = period / 2
  let d = `M0 ${baseline} Q${half / 2} ${baseline - amplitude} ${half} ${baseline}`
  for (let x = period; x <= WIDTH; x += half) d += ` T${x} ${baseline}`
  return `${d} L${WIDTH} ${HEIGHT} L0 ${HEIGHT} Z`
}

const LAYERS = [
  { name: 'back', color: 'var(--color-wave-back)', path: wavePath(1440, 46, 120) },
  { name: 'middle', color: 'var(--color-wave-middle)', path: wavePath(720, 30, 175) },
  { name: 'front', color: 'var(--color-wave-front)', path: wavePath(480, 20, 225) },
] as const

export function WaveBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed bottom-0 left-0 z-0 h-[34vh] max-h-[380px] min-h-[200px] w-full overflow-hidden print:hidden"
      // Strongest at the bottom-left (behind the sidebar, as in the design
      // reference), easing off toward the right so it never competes with data.
      style={{
        maskImage: 'linear-gradient(to right, #000 0%, #000 30%, rgb(0 0 0 / 0.45) 75%, rgb(0 0 0 / 0.3) 100%)',
        WebkitMaskImage:
          'linear-gradient(to right, #000 0%, #000 30%, rgb(0 0 0 / 0.45) 75%, rgb(0 0 0 / 0.3) 100%)',
      }}
    >
      {LAYERS.map((layer) => (
        <div key={layer.name} className={`hub-wave hub-wave--${layer.name}`}>
          <svg
            className="hub-wave__track"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="none"
            focusable="false"
          >
            <defs>
              <linearGradient id={`hub-wave-${layer.name}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={layer.color} />
                <stop offset="100%" stopColor={layer.color} stopOpacity="0.55" />
              </linearGradient>
            </defs>
            <path d={layer.path} fill={`url(#hub-wave-${layer.name})`} />
          </svg>
        </div>
      ))}
    </div>
  )
}
