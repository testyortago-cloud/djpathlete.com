import type { PublicAssessment } from "@/lib/profile-share/data"
import type { ReportScores } from "@/lib/test-report/scoring"
import { num, formatDate } from "@/lib/test-report/format"
import { ReportPage, ReportBand } from "./panels/ReportPage"
import { TestRow } from "./panels/TestRow"

function Battery({ a }: { a: PublicAssessment }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-heading text-sm font-bold">{a.title}</p>
        <p className="font-mono text-[10px] uppercase text-muted-foreground">{formatDate(a.date)}</p>
      </div>
      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        {a.items.map((i) => (
          <div key={i.name} className="flex items-baseline justify-between gap-2 border-b border-border pb-1">
            <dt className="text-xs text-muted-foreground">{i.name}</dt>
            {/* Through num() like every other figure in the report, so 30.00 reads
                30. `value` is nullable, and a null stays blank rather than "NaN". */}
            <dd className="font-mono text-xs">
              {typeof i.value === "number" ? num(i.value) : i.value}
              {i.unit ? ` ${i.unit}` : ""}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/**
 * Page 2 — every test once, on the same scale as page 1.
 *
 * Assessments: the most recent battery is open; older ones collapse behind a native
 * <details>, which is Darren's "maybe this is a drop-down" without any JS. Print CSS
 * forces it open so paper loses nothing.
 */
export function ReportPageTwo({
  scores,
  assessments,
}: {
  scores: ReportScores
  assessments: PublicAssessment[]
}) {
  const { tests, biggestMover } = scores
  // Sort by the date the report DISPLAYS, not the array order. lib/db orders by
  // `created_at` while lib/profile-share surfaces `updated_at`, so a January
  // assessment edited in August arrives behind a June one — and index 0 is what
  // renders expanded. Unsorted, the newest battery hides behind a disclosure
  // labelled "1 earlier assessment", which is a false claim on the page.
  const sorted = [...assessments].sort((a, b) => b.date.localeCompare(a.date))
  const [latest, ...older] = sorted

  return (
    <ReportPage>
      <ReportBand tone="green">
        <p className="djp-eyebrow report-band-quiet opacity-80">The full verdict</p>
        <h2 className="mt-2 font-heading text-2xl font-bold uppercase tracking-wide">Test by test</h2>
        <p className="report-band-quiet mt-2 max-w-[52ch] text-sm opacity-80">
          {tests.length} {tests.length === 1 ? "test" : "tests"}, each measured the same way every time. Every bar
          is one scale — the tick is Trained, the right edge is Elite; the red zone is a priority, the green zone
          a strength.
        </p>
      </ReportBand>

      <ReportBand className="flex-1">
        <div className="flex flex-col">
          {tests.map((t) => (
            <TestRow key={t.key} test={t} highlight={biggestMover?.test.key === t.key} />
          ))}
        </div>
        <p className="mt-4 max-w-[68ch] text-xs text-muted-foreground">
          Elite and Trained are DJP coaching standards for each test — reference points to aim at, not measured
          averages of other athletes.
        </p>
      </ReportBand>

      {assessments.length > 0 && (
        <ReportBand tone="alt">
          <p className="djp-eyebrow text-muted-foreground">Assessment battery</p>
          <div className="mt-4 flex flex-col gap-3">
            <Battery a={latest} />
            {older.length > 0 && (
              <details className="report-earlier">
                <summary className="cursor-pointer font-mono text-xs uppercase tracking-wide text-muted-foreground">
                  {older.length} earlier {older.length === 1 ? "assessment" : "assessments"}
                </summary>
                <div className="mt-3 flex flex-col gap-3">
                  {older.map((a) => (
                    <Battery key={`${a.title}-${a.date}`} a={a} />
                  ))}
                </div>
              </details>
            )}
          </div>
        </ReportBand>
      )}

      <ReportBand tone="green">
        <div className="flex flex-wrap items-end justify-between gap-2 text-xs">
          <span className="report-band-quiet opacity-80">
            Every number here is a logged test — objective, individual, repeatable.
          </span>
          <span className="report-band-quiet opacity-80">
            <strong className="font-semibold opacity-100">Darren Paul</strong> — darren@darrenjpaul.com
          </span>
        </div>
      </ReportBand>
    </ReportPage>
  )
}
