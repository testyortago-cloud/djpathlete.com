import { BAND_DEVELOPING_MIN, BAND_STRENGTH_MIN } from "@/lib/test-report/scoring"

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n))
}

/**
 * Where a result sits inside its reference range, 0-100, with the band zones
 * marked. Deliberately NOT called a percentile: the app has no population data,
 * and borrowing the reference report's percentile language would present an
 * invented statistic as a measurement.
 *
 * `left`/`right` are the phase-2 bilateral path — supplying them plots two
 * markers and an asymmetry pill instead of one marker.
 */
export function RangeBar({ score, left, right }: { score: number; left?: number; right?: number }) {
  const bilateral = typeof left === "number" && typeof right === "number"
  const markers = bilateral ? [clamp(left), clamp(right)] : [clamp(score)]
  const heavier = bilateral ? Math.max(left, right) : 0
  const asymmetryPct = bilateral && heavier > 0 ? Math.round((Math.abs(left - right) / heavier) * 100) : null
  const heavierSide = bilateral ? (left >= right ? "left" : "right") : null

  return (
    <div className="mt-2">
      <div className="relative h-1.5 rounded-full bg-surface">
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 rounded-l-full bg-[var(--error)]/25"
          style={{ width: `${BAND_DEVELOPING_MIN}%` }}
        />
        <div
          aria-hidden
          className="absolute inset-y-0 rounded-r-full bg-[var(--success)]/25"
          style={{ left: `${BAND_STRENGTH_MIN}%`, right: 0 }}
        />
        {markers.map((m, i) => (
          <span
            key={i}
            data-testid="range-marker"
            className={`absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${
              bilateral && i === 1 ? "bg-accent" : "bg-primary"
            }`}
            style={{ left: `${m}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between font-mono text-[10px] uppercase text-muted-foreground">
        <span>Reference range</span>
        {asymmetryPct !== null && <span>{`Asymmetry: ${asymmetryPct}% (${heavierSide})`}</span>}
      </div>
    </div>
  )
}
