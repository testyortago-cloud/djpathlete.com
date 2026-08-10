import type { ScoredTest } from "@/lib/test-report/scoring"
import { bandFor } from "@/lib/test-report/scoring"
import { num, formatDate } from "@/lib/test-report/format"
import { ScoreTrack } from "./ScoreTrack"
import { BandPill } from "./BandPill"

/**
 * One test, once. The old page rendered the top four as circles and then ALL of
 * them again as cards; this is the single row that replaced both.
 *
 * No sparkline. It was tried as "the one deliberate second idiom" and cut on
 * coach feedback (2026-08-10): at row scale a 3-point series reads as one bare
 * diagonal slash — another meaningless line — and the 96px SVG overflowed its
 * column. History is carried by the dated delta instead.
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

  return (
    <div className="test-row grid grid-cols-2 items-center gap-x-4 gap-y-2 border-b border-border py-3 last:border-b-0 md:grid-cols-[13rem_7rem_1fr_7rem]">
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
              // flex-wrap + a nowrap caption: at print width (~280px) the caption used
              // to wrap word-by-word into a skinny column beside the pill. Now it either
              // shares the line with the pill pushed to the far edge (ml-auto), or wraps
              // whole onto its own line with the pill still right-aligned below it.
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="whitespace-nowrap font-mono text-[10px] tracking-wide text-muted-foreground">
                  Trained {num(test.targets.trained)} {test.unit} · Elite {num(test.targets.elite)} {test.unit}
                </p>
                <span className="ml-auto">
                  <BandPill band={bandFor(test.score)} />
                </span>
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
          <p className="mt-0.5 whitespace-nowrap font-mono text-[9px] text-muted-foreground">
            since {formatDate(test.previousDate)}
          </p>
        )}
      </div>
    </div>
  )
}
