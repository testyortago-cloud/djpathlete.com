import type { ScoredTest } from "@/lib/test-report/scoring"
import { bandFor } from "@/lib/test-report/scoring"
import { num, formatDate } from "@/lib/test-report/format"
import { ScoreTrack } from "./ScoreTrack"
import { BandPill } from "./BandPill"
import { Sparkline } from "@/components/shared/Sparkline"

/**
 * One test, once. The old page rendered the top four as circles and then ALL of
 * them again as cards; this is the single row that replaced both.
 *
 * The sparkline is the one deliberate second idiom in the report: a trend encodes
 * history, which the score track cannot show. It only renders when there IS a
 * trend — three or more results that actually moved. A flat line dressed up as
 * signal is exactly what the coach asked to remove.
 */
export function TestRow({ test, highlight = false }: { test: ScoredTest; highlight?: boolean }) {
  // Three-way on the SIGN, not `>= 0`. A test that did not move is not an
  // improvement: `deltaPct === 0` was rendering "↑ 0%" in success green here while
  // page 1 correctly called the same number "held steady".
  const delta = test.deltaPct
  const deltaTone =
    delta === null || delta === 0
      ? "text-muted-foreground"
      : delta > 0
        ? "text-[var(--success)]"
        : "text-[var(--error)]"
  // Zero movement is a word, not an arrow — "steady" matches page 1's phrasing.
  const deltaText = delta === null ? "—" : delta === 0 ? "steady" : `${delta > 0 ? "↑" : "↓"} ${Math.abs(delta)}%`
  const showSparkline = test.points.length >= 3 && Math.min(...test.points) !== Math.max(...test.points)

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
          <>
            <ScoreTrack score={test.score} tone={highlight ? "accent" : "primary"} />
            {test.targets && (
              // NOT uppercase: "cm" and "kg" are units, and "CM" is a different claim.
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <p className="font-mono text-[10px] tracking-wide text-muted-foreground">
                  Trained {num(test.targets.trained)} {test.unit} · Elite {num(test.targets.elite)} {test.unit}
                </p>
                <BandPill band={bandFor(test.score)} />
              </div>
            )}
          </>
        ) : (
          <p className="font-mono text-[10px] uppercase text-muted-foreground">No standard for this test</p>
        )}
      </div>

      <div className="text-right">
        <p className={`font-mono text-xs ${deltaTone}`}>{deltaText}</p>
        {delta !== null && test.previousDate && (
          <p className="mt-0.5 font-mono text-[9px] text-muted-foreground">since {formatDate(test.previousDate)}</p>
        )}
      </div>

      <div className="justify-self-end text-primary">{showSparkline && <Sparkline points={test.points} />}</div>
    </div>
  )
}
