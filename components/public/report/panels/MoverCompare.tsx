import type { BiggestMover } from "@/lib/test-report/scoring"
import { num } from "@/lib/test-report/format"

/**
 * The comparison moment, used exactly once — page 1's biggest mover.
 *
 * "Where you are vs where you were vs the standards" is a different kind of
 * information than "position on a scale", so it earns a second idiom the way the
 * sparkline does. Everything is border-drawn: the original MetricCompare filled
 * the Now circle with bg-primary, which Chrome's backgrounds-off print erased
 * along with the value inside it.
 *
 * Labels are Trained/Elite, never "professional average", never a percentile —
 * DJP coaching reference points, not population data.
 */
// "up from"/"down from"/"level with" reads off `mover.direction`, not a raw
// latest-vs-previous comparison — for a lower-is-better test like a sprint a
// smaller raw number IS the improvement, so comparing the numbers directly
// would call a faster time "down from" the slower one and lie about direction.
const COMPARE_WORD: Record<BiggestMover["direction"], string> = {
  improved: "up from",
  declined: "down from",
  flat: "level with",
}

export function MoverCompare({ mover }: { mover: BiggestMover }) {
  const { test, direction } = mover
  const label =
    `Now ${num(test.latest)} ${test.unit}, ${COMPARE_WORD[direction]} ${num(test.previous)}.` +
    (test.targets ? ` Trained standard ${num(test.targets.trained)}, Elite ${num(test.targets.elite)}.` : "")
  return (
    <div className="flex items-center gap-5" role="img" aria-label={label}>
      <div
        className="mover-now relative flex size-[104px] shrink-0 flex-col items-center justify-center rounded-full border-[3px] border-accent bg-card"
        aria-hidden
      >
        <span className="font-mono text-[9px] uppercase text-muted-foreground">Prev {num(test.previous)}</span>
        <span className="font-heading text-2xl font-bold leading-none">
          {num(test.latest)}
          <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">{test.unit}</span>
        </span>
        <span className="font-mono text-[9px] uppercase text-muted-foreground">Now</span>
        {test.isPr && (
          <span className="absolute -top-1 right-0 rounded-full border border-accent bg-card px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-accent">
            PR
          </span>
        )}
      </div>
      {test.targets && (
        <div className="flex gap-3" aria-hidden>
          <Standard value={num(test.targets.trained)} unit={test.unit} caption="Trained" />
          <Standard value={num(test.targets.elite)} unit={test.unit} caption="Elite" />
        </div>
      )}
    </div>
  )
}

function Standard({ value, unit, caption }: { value: string; unit: string; caption: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="mover-standard flex size-[56px] flex-col items-center justify-center rounded-full border border-border">
        <span className="font-heading text-sm font-bold leading-none">{value}</span>
        <span className="mt-0.5 font-mono text-[8px] text-muted-foreground">{unit}</span>
      </div>
      <span className="mt-1 font-mono text-[8px] uppercase tracking-wide text-muted-foreground">{caption}</span>
    </div>
  )
}
