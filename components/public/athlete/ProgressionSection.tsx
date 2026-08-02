import { ArrowDownRight, ArrowUpRight } from "lucide-react"
import { FadeIn } from "@/components/shared/FadeIn"
import { SectionHeading } from "./SectionHeading"
import { Sparkline } from "./Sparkline"
import type { TestProgression } from "@/lib/profile-share/progression"

const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })

/**
 * Improvement chip. Positive improvement earns the accent; a decline stays
 * muted (quiet honesty — never red on a marketing surface); unjudgeable
 * series (custom tests) show the raw journey with no verdict.
 */
function TrendChip({ pct, first, latest }: { pct: number | null; first: number; latest: number }) {
  if (pct === null) {
    return (
      <span className="rounded-full bg-border/50 px-2 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
        {first} → {latest}
      </span>
    )
  }
  const improved = pct >= 0
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums ${
        improved ? "bg-accent/15 text-accent" : "bg-border/50 text-muted-foreground"
      }`}
    >
      {improved ? (
        <ArrowUpRight className="size-3" strokeWidth={2.5} />
      ) : (
        <ArrowDownRight className="size-3" strokeWidth={2.5} />
      )}
      {Math.abs(pct)}%
    </span>
  )
}

/**
 * Per-test progression rows — the coaching-results section. Self-hides unless
 * some test type has ≥2 logged results (one point is a record, not progress).
 */
export function ProgressionSection({ progressions }: { progressions: TestProgression[] }) {
  if (progressions.length === 0) return null

  return (
    <FadeIn>
      <section aria-label="Performance progression" className="mt-14">
        <SectionHeading>Performance Progression</SectionHeading>
        <ul className="mt-5 grid gap-3 md:grid-cols-2">
          {progressions.map((p) => (
            <li
              key={p.key}
              className="flex items-center gap-4 rounded-2xl border border-border bg-card/70 px-4 py-3.5 backdrop-blur-sm md:px-5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 truncate text-sm text-foreground/90">{p.label}</span>
                  <TrendChip pct={p.improvementPct} first={p.first} latest={p.latest} />
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-mono text-lg font-semibold tabular-nums text-primary">
                    {p.latest} {p.unit}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {p.points.length} tests · {MONTH_YEAR.format(new Date(p.latestDate))}
                  </span>
                </div>
              </div>
              <div className="text-accent">
                <Sparkline points={p.points} />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </FadeIn>
  )
}
