import Image from "next/image"
import type { TestReportData } from "@/lib/test-report/data"
import { ReportPage } from "./panels/ReportPage"

function formatDate(iso: string | null): string {
  if (!iso) return ""
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}

/** Page 1 — identity, premise, and the three headline counts. */
export function ReportCover({
  data,
  categoryCount,
  testTypeCount,
}: {
  data: TestReportData
  categoryCount: number
  testTypeCount: number
}) {
  const fullName = `${data.name.first} ${data.name.last}`.trim()
  const subtitle = [data.sport, data.position, data.age ? `Age ${data.age}` : null].filter(Boolean).join(" · ")
  const initials = `${data.name.first.trim().charAt(0)}${data.name.last.trim().charAt(0)}`.toUpperCase() || "DJP"

  // NOT personal bests: `is_pr` is true for every result that beat its priors, so
  // a steadily improving athlete has one per test — "17 tests logged / 17
  // personal bests" reads as a bug, not an achievement. Distinct tests measured
  // says something the first line doesn't.
  // Zero-valued lines are dropped: a "0" on this page reads as a failure state
  // on a document meant to open the conversation.
  const lines: { n: number; text: string }[] = [
    {
      n: data.testCount,
      text: `tests logged across ${categoryCount} testing ${categoryCount === 1 ? "category" : "categories"}`,
    },
    { n: testTypeCount, text: `different ${testTypeCount === 1 ? "test" : "tests"} measured and tracked` },
    { n: data.monthsTracked, text: "months of tracked testing history" },
  ].filter((l) => l.n > 0)

  return (
    <ReportPage
      eyebrow="DJP Athlete · Performance Testing Report"
      footer={
        <div className="flex flex-wrap items-end justify-between gap-2">
          <span>
            Report for: <strong className="text-foreground">{fullName}</strong>
            {data.sport ? `, ${data.sport}` : ""}
            {data.asOf ? ` · ${formatDate(data.asOf)}` : ""}
          </span>
          <span>
            Prepared by <strong className="text-foreground">Darren Paul</strong>, Performance Coach
          </span>
        </div>
      }
    >
      <div className="grid gap-8 md:grid-cols-2 md:items-center">
        <div>
          <h1 className="font-heading text-5xl font-bold leading-tight md:text-6xl">{fullName}</h1>
          {subtitle && <p className="mt-3 font-mono text-xs uppercase tracking-wide text-primary">{subtitle}</p>}
          <p className="mt-6 max-w-md text-sm leading-relaxed text-muted-foreground">
            Every number in this report comes from a logged, dated test — measured the same way each time and tracked
            across the whole training block. No estimates, no self-reported figures.
          </p>
          {lines.length > 0 && (
            <div className="mt-8 space-y-4">
              {lines.map((l) => (
                <div key={l.text} className="flex gap-4 border-l-2 border-primary pl-4">
                  <span className="font-heading text-2xl font-bold">{l.n}</span>
                  <span className="max-w-[16rem] self-center text-xs leading-snug text-muted-foreground">{l.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-border bg-surface">
          {data.avatarUrl ? (
            <Image
              src={data.avatarUrl}
              alt={fullName}
              fill
              sizes="(min-width: 768px) 40vw, 90vw"
              className="object-cover"
            />
          ) : (
            /* No photo: a deliberate monogram panel. The previous version was a
               near-transparent gradient, which on a light background read as a
               failed image load rather than a design choice. */
            <div className="absolute inset-0 flex items-center justify-center bg-primary">
              <div
                aria-hidden
                className="absolute inset-0"
                style={{
                  background:
                    "radial-gradient(ellipse 70% 50% at 75% 8%, color-mix(in oklab, var(--accent) 55%, transparent), transparent 62%)",
                }}
              />
              <span className="relative font-heading text-6xl font-bold tracking-tight text-primary-foreground/90">
                {initials}
              </span>
              <span className="djp-eyebrow absolute bottom-4 left-0 right-0 text-center text-primary-foreground/60">
                DJP Athlete
              </span>
            </div>
          )}
        </div>
      </div>
    </ReportPage>
  )
}
