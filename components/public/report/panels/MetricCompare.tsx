import type { ScoredTest } from "@/lib/test-report/scoring"

/** Trims trailing zeros so 45.70 reads 45.7 and 140.00 reads 140. */
function num(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/**
 * One metric, shown the way the second reference does it: two small standard
 * circles on the left, then a large "now" circle carrying the previous value and
 * the direction-aware change.
 *
 * The standards are DJP coaching reference points derived from the same ranges
 * that drive the scores — labelled "Elite" and "Trained", never "professional
 * average" or a percentile, because no population data exists behind them.
 */
export function MetricCompare({ test }: { test: ScoredTest }) {
  const { label, latest, unit, previous, deltaPct, targets, isPr } = test

  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-4">
      <p className="text-center font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>

      <div className="flex items-center gap-3">
        {targets && (
          <div className="flex gap-2">
            <Standard value={num(targets.elite)} unit={unit} caption="Elite" />
            <Standard value={num(targets.trained)} unit={unit} caption="Trained" />
          </div>
        )}

        <div className="relative flex size-[104px] shrink-0 flex-col items-center justify-center rounded-full bg-primary text-primary-foreground">
          {previous !== null && (
            <span className="font-mono text-[9px] uppercase opacity-70">
              Prev {num(previous)}
            </span>
          )}
          <span className="font-heading text-2xl font-bold leading-none">
            {num(latest)}
            <span className="ml-0.5 text-[11px] font-normal">{unit}</span>
          </span>
          <span className="font-mono text-[9px] uppercase opacity-70">Now</span>
          {isPr && (
            <span className="absolute -top-1 right-0 rounded-full bg-accent px-1.5 py-0.5 font-mono text-[9px] font-semibold text-accent-foreground">
              PR
            </span>
          )}
        </div>
      </div>

      {deltaPct !== null && (
        <p
          className={`font-mono text-[11px] ${deltaPct >= 0 ? "text-[var(--success)]" : "text-[var(--error)]"}`}
          data-testid="metric-delta"
        >
          {deltaPct >= 0 ? "↑" : "↓"} {Math.abs(deltaPct)}%
        </p>
      )}
    </div>
  )
}

function Standard({ value, unit, caption }: { value: string; unit: string; caption: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="flex size-[52px] flex-col items-center justify-center rounded-full border border-border">
        <span className="font-heading text-xs font-bold leading-none">{value}</span>
        <span className="font-mono text-[8px] text-muted-foreground">{unit}</span>
      </div>
      <span className="mt-1 font-mono text-[8px] uppercase text-muted-foreground">{caption}</span>
    </div>
  )
}
