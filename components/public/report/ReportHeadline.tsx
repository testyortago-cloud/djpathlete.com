import type { CategoryScore, ReportScores } from "@/lib/test-report/scoring"
import { selectCue } from "@/lib/test-report/cues"
import { ReportPage } from "./panels/ReportPage"
import { KpiTile } from "./panels/KpiTile"
import { BandPill } from "./panels/BandPill"
import { ScoreBar } from "./panels/ScoreBar"
import { CueBlock } from "./panels/CueBlock"
import { CategoryChips } from "./panels/CategoryChips"
import { SectionHeading } from "./panels/SectionHeading"

/** Page 2 — the athlete's scores, where the gap is, and what to do about it. */
export function ReportHeadline({ scores, firstName }: { scores: ReportScores; firstName: string }) {
  const { athleteScore, categories, strongest, focus, biggestMover } = scores
  const cue = selectCue(focus)
  // With one category there is nothing to compare, and strongest === focus.
  const showComparison = categories.length > 1
  // Strongest, weakest, next-weakest — de-duplicated, so two categories give two
  // cards and one gives one, rather than the same card repeated.
  const breakdown: CategoryScore[] = [
    ...new Set([strongest, focus, categories[categories.length - 2] ?? null].filter((c): c is CategoryScore => c !== null)),
  ].slice(0, 3)

  return (
    <ReportPage
      eyebrow={`${firstName} · Testing Snapshot`}
      title="The Headline Numbers"
      pageNumber="02"
      footer="DJP Athlete · Performance Testing Report · 02"
    >
      <div className="space-y-8">
        <div className="grid gap-3 sm:grid-cols-3">
          {athleteScore !== null && <KpiTile value={String(athleteScore)} unit="/100" label="Athlete Score" />}
          {strongest && (
            <KpiTile value={String(strongest.score)} unit="/100" label={`Strongest — ${strongest.category}`} />
          )}
          {showComparison && focus && (
            <KpiTile value={String(focus.score)} unit="/100" label={`Focus — ${focus.category}`} />
          )}
        </div>

        {showComparison && (
          <section className="space-y-3">
            <SectionHeading>Where you&apos;re strong and where you&apos;re not</SectionHeading>
            <div className="space-y-2 rounded-xl border border-border bg-card p-4">
              {categories.map((c) => (
                <ScoreBar key={c.category} label={c.category} score={c.score} />
              ))}
              {strongest && focus && (
                <p className="pt-2 text-xs leading-relaxed text-muted-foreground">
                  {strongest.category} leads at {strongest.score}/100 while {focus.category} sits at {focus.score}/100 —
                  a {strongest.score - focus.score}-point spread. The lower of the two is where training time buys the
                  most.
                </p>
              )}
            </div>
          </section>
        )}

        {breakdown.length > 0 && (
          <section className="space-y-3">
            <SectionHeading>Category breakdown</SectionHeading>
            <div className="grid gap-3 sm:grid-cols-3">
              {breakdown.map((c) => (
                <div key={c.category} className="rounded-xl border border-border border-t-2 border-t-primary bg-card p-4">
                  <p className="djp-eyebrow text-muted-foreground">{c.category}</p>
                  <p className="mt-1 font-heading text-3xl font-bold">{c.score}</p>
                  <div className="mt-2">
                    <BandPill band={c.band} />
                  </div>
                  <p className="mt-2 text-xs leading-snug text-muted-foreground">From {c.testLabels.join(", ")}.</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {biggestMover && (
          <section className="space-y-3">
            <SectionHeading>Movement since last test</SectionHeading>
            <div
              className={`flex items-center gap-5 rounded-xl border p-5 ${
                biggestMover.deltaPct >= 0
                  ? "border-accent/40 bg-accent/5"
                  : "border-[var(--error)]/40 bg-[var(--error)]/5"
              }`}
            >
              <span className="font-heading text-4xl font-bold">
                {biggestMover.deltaPct >= 0 ? "+" : ""}
                {biggestMover.deltaPct}%
              </span>
              <div>
                <p className="font-mono text-xs uppercase tracking-wide">{biggestMover.label}</p>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">
                  {biggestMover.deltaPct >= 0
                    ? "Biggest improvement between your last two tests of the same type."
                    : "Biggest drop between your last two tests of the same type — worth checking recovery and testing conditions before reading too much into it."}
                </p>
              </div>
            </div>
          </section>
        )}

        <section className="space-y-3">
          <SectionHeading>Testing categories covered</SectionHeading>
          <CategoryChips active={categories.map((c) => c.category)} />
        </section>

        {cue && <CueBlock cue={cue} />}
      </div>
    </ReportPage>
  )
}
