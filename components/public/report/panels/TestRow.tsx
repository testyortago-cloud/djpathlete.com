import type { ScoredTest } from "@/lib/test-report/scoring"
import { num, formatDate } from "@/lib/test-report/format"
import { ScoreTrack } from "./ScoreTrack"
import { Sparkline } from "@/components/shared/Sparkline"

/**
 * One test, once. The old page rendered the top four as circles and then ALL of
 * them again as cards; this is the single row that replaced both.
 *
 * The sparkline is the one deliberate second idiom in the report: a trend encodes
 * history, which the score track cannot show.
 */
export function TestRow({ test, highlight = false }: { test: ScoredTest; highlight?: boolean }) {
  return (
    <div className="grid grid-cols-2 items-center gap-x-4 gap-y-2 border-b border-border py-3 last:border-b-0 md:grid-cols-[13rem_7rem_1fr_5rem_4rem]">
      <div>
        <p className="font-heading text-sm font-bold">
          {test.label}
          {test.isPr && (
            <span className="ml-2 rounded-full border border-accent px-1.5 py-0.5 align-[0.15em] font-mono text-[9px] uppercase tracking-wider text-accent">
              PR
            </span>
          )}
        </p>
        <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {formatDate(test.latestDate)}
        </p>
      </div>

      <p className="font-heading text-lg font-bold">
        {num(test.latest)}
        <span className="ml-1 text-xs font-normal text-muted-foreground">{test.unit}</span>
      </p>

      <div className="col-span-2 md:col-span-1">
        {test.score !== null ? (
          <ScoreTrack score={test.score} tone={highlight ? "accent" : "primary"} />
        ) : (
          <p className="font-mono text-[10px] uppercase text-muted-foreground">No standard for this test</p>
        )}
      </div>

      <p
        className={`text-right font-mono text-xs ${
          test.deltaPct === null
            ? "text-muted-foreground"
            : test.deltaPct >= 0
              ? "text-[var(--success)]"
              : "text-[var(--error)]"
        }`}
      >
        {test.deltaPct === null ? "—" : `${test.deltaPct >= 0 ? "↑" : "↓"} ${Math.abs(test.deltaPct)}%`}
      </p>

      <div className="justify-self-end text-primary">
        <Sparkline points={test.points} />
      </div>
    </div>
  )
}
