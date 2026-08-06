import type { ReportScores } from "@/lib/test-report/scoring"
import type { PublicAssessment } from "@/lib/profile-share/data"
import { ReportPage } from "./panels/ReportPage"
import { KpiTile } from "./panels/KpiTile"
import { RangeBar } from "./panels/RangeBar"
import { SectionHeading } from "./panels/SectionHeading"
import { Sparkline } from "@/components/shared/Sparkline"

function formatDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}

/** Page 3 — every test, its trend, and the closing read. */
export function ReportVerdict({ scores, assessments }: { scores: ReportScores; assessments: PublicAssessment[] }) {
  const { tests, focus } = scores
  const headline = tests.slice(0, 4)

  return (
    <ReportPage
      eyebrow={`Performance Tests · ${tests.length} measured`}
      title="The Full Verdict"
      pageNumber="03"
      footer={
        <div className="flex flex-wrap items-end justify-between gap-2">
          <span>Every number here is a logged test — objective, individual, and repeatable.</span>
          <span>
            <strong className="text-foreground">Darren Paul</strong> — Performance Coach · darren@darrenjpaul.com
          </span>
        </div>
      }
    >
      <div className="space-y-8">
        {headline.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {headline.map((t) => (
              <KpiTile
                key={t.key}
                value={String(t.latest)}
                unit={t.unit}
                label={t.label}
                caption={t.score !== null ? `${t.score}/100 · ${formatDate(t.latestDate)}` : formatDate(t.latestDate)}
                isPr={t.isPr}
              />
            ))}
          </div>
        )}

        <section className="space-y-3">
          <SectionHeading>Test by test</SectionHeading>
          <div className="grid gap-3 sm:grid-cols-2">
            {tests.map((t) => (
              <div key={t.key} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">{t.label}</p>
                    <p className="mt-1 font-heading text-2xl font-bold">
                      {t.latest}
                      <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">{t.unit}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    {t.deltaPct !== null && (
                      <p
                        className={`font-mono text-xs ${
                          t.deltaPct >= 0 ? "text-[var(--success)]" : "text-[var(--error)]"
                        }`}
                      >
                        {t.deltaPct >= 0 ? "↑" : "↓"} {Math.abs(t.deltaPct)}%
                      </p>
                    )}
                    <div className="mt-1 text-primary">
                      <Sparkline points={t.points} />
                    </div>
                  </div>
                </div>
                {t.score !== null && <RangeBar score={t.score} />}
                <p className="mt-2 font-mono text-[10px] uppercase text-muted-foreground">
                  Last tested {formatDate(t.latestDate)}
                  {t.isPr ? " · Personal best" : ""}
                </p>
              </div>
            ))}
          </div>
        </section>

        {assessments.length > 0 && (
          <section className="space-y-3">
            <SectionHeading>Assessment batteries</SectionHeading>
            <div className="space-y-3">
              {assessments.map((a) => (
                <div key={`${a.title}-${a.date}`} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-heading text-sm font-bold">{a.title}</p>
                    <p className="font-mono text-[10px] uppercase text-muted-foreground">{formatDate(a.date)}</p>
                  </div>
                  <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                    {a.items.map((i) => (
                      <div key={i.name} className="flex items-baseline justify-between gap-2 border-b border-border pb-1">
                        <dt className="text-xs text-muted-foreground">{i.name}</dt>
                        <dd className="font-mono text-xs">
                          {i.value}
                          {i.unit ? ` ${i.unit}` : ""}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </section>
        )}

        {focus && (
          <div className="rounded-xl border border-primary/40 bg-card p-5">
            <p className="font-heading text-sm font-bold">
              One signal across your testing — <span className="text-primary">{focus.category.toLowerCase()}</span>
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {focus.category} scores {focus.score}/100 across {focus.testLabels.join(", ")}, the lowest of the
              categories tested. That is where the next block of training will show up fastest in these numbers —
              everything else is already carrying its weight.
            </p>
          </div>
        )}
      </div>
    </ReportPage>
  )
}
