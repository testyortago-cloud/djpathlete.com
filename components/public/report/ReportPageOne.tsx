import Image from "next/image"
import type { TestReportData } from "@/lib/test-report/data"
import type { ReportScores } from "@/lib/test-report/scoring"
import { num, formatDate } from "@/lib/test-report/format"
import { ReportPage, ReportBand } from "./panels/ReportPage"
import { ScoreTrack } from "./panels/ScoreTrack"
import { FocalPointCard } from "./panels/FocalPointCard"

/**
 * Page 1 — who, how they're doing overall, what moved, and what to train next.
 *
 * The cover page this replaces gave a full sheet to a portrait and three counts.
 * The counts now sit on one line and the portrait is a thumbnail, which is what
 * "maybe we can make that much smaller" actually called for.
 */
export function ReportPageOne({ data, scores }: { data: TestReportData; scores: ReportScores }) {
  const fullName = `${data.name.first} ${data.name.last}`.trim()
  const initials =
    `${data.name.first.trim().charAt(0)}${data.name.last.trim().charAt(0)}`.toUpperCase() || "DJP"
  const subtitle = [data.sport, data.position, data.age ? `Age ${data.age}` : null].filter(Boolean).join(" · ")
  const history = [
    data.testCount > 0 ? `${data.testCount} tests` : null,
    data.monthsTracked > 0 ? `over ${data.monthsTracked} months` : null,
  ]
    .filter(Boolean)
    .join(" ")
  const { athleteScore, strongest, biggestMover, focalPoints } = scores

  return (
    <ReportPage>
      <ReportBand tone="green">
        <div className="flex items-center gap-6">
          <div className="min-w-0 flex-1">
            <p className="djp-eyebrow report-band-quiet opacity-80">DJP Athlete · Performance Testing Report</p>
            <h1 className="mt-2 font-heading text-4xl font-bold uppercase leading-none tracking-wide md:text-5xl">
              {fullName}
            </h1>
            <p className="report-band-quiet mt-3 text-sm opacity-80">
              {[subtitle, data.asOf ? `Tested ${formatDate(data.asOf)}` : null, history]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="relative hidden h-[108px] w-[84px] shrink-0 overflow-hidden rounded border border-primary-foreground/20 bg-primary-foreground/10 sm:block">
            {data.avatarUrl ? (
              <Image src={data.avatarUrl} alt={fullName} fill sizes="84px" className="object-cover" />
            ) : (
              <span className="absolute inset-0 flex items-center justify-center font-heading text-2xl font-bold opacity-70">
                {initials}
              </span>
            )}
          </div>
        </div>
      </ReportBand>

      {(athleteScore !== null || biggestMover) && (
        <ReportBand>
          <div className="grid gap-8 md:grid-cols-2 md:items-start">
            {athleteScore !== null && (
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-heading text-sm font-bold uppercase tracking-wide">
                    Athlete Performance Index
                  </span>
                  <span className="rounded-full border border-border px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-muted-foreground">
                    API
                  </span>
                </div>
                <p className="mt-2 font-heading text-6xl font-bold leading-none">
                  {athleteScore}
                  <span className="ml-1 text-xl font-normal text-muted-foreground">/100</span>
                </p>
                <div className="mt-4">
                  <ScoreTrack score={athleteScore} />
                </div>
                <p className="mt-3 max-w-[32ch] text-sm text-muted-foreground">
                  The average of your category scores. Every test is scored 0–100 against DJP&apos;s coaching
                  standards — 50 is Trained, 100 is Elite.
                </p>
                {strongest && (
                  <p className="mt-2 text-sm">
                    <span className="text-muted-foreground">Strongest:</span>{" "}
                    <strong className="font-semibold">
                      {strongest.category} {strongest.score}
                    </strong>
                  </p>
                )}
              </div>
            )}

            {biggestMover && (
              <div className="border-l-2 border-accent pl-5">
                <p className="djp-eyebrow text-muted-foreground">
                  {biggestMover.direction === "declined"
                    ? "Biggest change since last test"
                    : biggestMover.direction === "flat"
                      ? "Since last test"
                      : "Biggest improvement since last test"}
                </p>
                <p
                  className="mt-2 font-heading text-5xl font-bold leading-none text-accent"
                  aria-label={`${biggestMover.direction === "declined" ? "Declined" : biggestMover.direction === "flat" ? "No change," : "Improved"} ${Math.abs(biggestMover.test.deltaPct)} percent`}
                >
                  {biggestMover.test.deltaPct > 0 ? "↑" : biggestMover.test.deltaPct < 0 ? "↓" : "="}{" "}
                  {Math.abs(biggestMover.test.deltaPct)}%
                </p>
                <p className="mt-3 font-heading text-base font-bold">{biggestMover.test.label}</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {num(biggestMover.test.previous)} → {num(biggestMover.test.latest)} {biggestMover.test.unit}
                </p>
                {biggestMover.test.score !== null && (
                  <div className="mt-4">
                    <ScoreTrack score={biggestMover.test.score} tone="accent" />
                  </div>
                )}
                <p className="mt-3 max-w-[34ch] text-sm text-muted-foreground">
                  {biggestMover.direction === "declined"
                    ? "Nothing improved between your last two tests. Worth checking recovery and testing conditions before reading too much into it."
                    : biggestMover.direction === "flat"
                      ? "Every test held steady since your last round — no measurable change either way."
                      : "The largest move of any test on file."}
                </p>
              </div>
            )}
          </div>
        </ReportBand>
      )}

      {focalPoints.length > 0 && (
        <ReportBand tone="alt">
          <p className="djp-eyebrow text-muted-foreground">Focal points — where the next block goes</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {focalPoints.map((fp) => (
              <FocalPointCard key={fp.category} fp={fp} />
            ))}
          </div>
        </ReportBand>
      )}

      {/* Guarded on data.tests.length, NOT just the scores-derived fields: an
          all-custom-test client also has a null athleteScore, no biggestMover
          and no focalPoints, but they DO have logged tests (visible on page 2)
          — "No tests logged yet" would be false for them. This band is only
          for the genuinely empty report. */}
      {data.tests.length === 0 && athleteScore === null && !biggestMover && focalPoints.length === 0 && (
        <ReportBand>
          <p className="font-heading text-lg font-bold">No tests logged yet</p>
          <p className="mt-2 max-w-[48ch] text-sm text-muted-foreground">
            {data.name.first}&apos;s report fills in as results are recorded — every number on it
            comes from a logged, dated test. Check back after the next testing session.
          </p>
        </ReportBand>
      )}

      {/* Spec B inserts the coach's-note band here. It is deliberately absent rather
          than empty: a band renders padding and a rule, so an "empty" one is visible
          dead space, not nothing. */}

      {/* Always rendered, so the footer band anchors to the page edge even when
          every optional band above it is absent (all-custom-test clients have no
          scorable categories at all). */}
      <div className="flex-1" />

      <ReportBand tone="green">
        <div className="flex flex-wrap items-end justify-between gap-2 text-xs">
          <span className="report-band-quiet opacity-80">
            {fullName}
            {data.sport ? `, ${data.sport}` : ""}
            {data.asOf ? ` · ${formatDate(data.asOf)}` : ""}
          </span>
          <span className="report-band-quiet opacity-80">
            Prepared by <strong className="font-semibold opacity-100">Darren Paul</strong>, Performance Coach
          </span>
        </div>
      </ReportBand>
    </ReportPage>
  )
}
