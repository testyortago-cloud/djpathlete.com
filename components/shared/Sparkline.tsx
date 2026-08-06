/**
 * Tiny server-rendered sparkline — pure SVG, no charting lib, so it costs
 * nothing on the client and prints in the PDF. Stroke inherits currentColor.
 */
export function Sparkline({ points, width = 96, height = 28 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return null
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min
  const pad = 3
  const coords = points.map((v, i) => {
    const x = pad + (i / (points.length - 1)) * (width - pad * 2)
    // Flat series draws a midline rather than dividing by zero.
    const y = span === 0 ? height / 2 : pad + (1 - (v - min) / span) * (height - pad * 2)
    return [x, y] as const
  })
  const path = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ")
  const [endX, endY] = coords[coords.length - 1]

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden
      className="shrink-0 overflow-visible"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={endX} cy={endY} r={2.5} fill="currentColor" />
    </svg>
  )
}
