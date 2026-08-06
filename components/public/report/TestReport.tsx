import type { TestReportData } from "@/lib/test-report/data"
import { buildReportScores } from "@/lib/test-report/scoring"
import { ReportCover } from "./ReportCover"
import { ReportHeadline } from "./ReportHeadline"
import { ReportVerdict } from "./ReportVerdict"
import { ReportShell, type ReportTheme } from "./ReportShell"

export type { ReportTheme }

/**
 * The public athlete test report.
 *
 * LIGHT is the default because this is a print-first document: a full-bleed dark
 * page is heavy on ink and `print-color-adjust: exact` is only a request, which
 * "save ink" settings and many home printers ignore. Dark stays available as a
 * screen-only deck treatment, via `?theme=dark` or the in-page toggle.
 *
 * With no logged tests the report renders ONE honest page rather than three
 * skeletal ones — an empty premium document reads as broken, not premium.
 */
export function TestReport({ data, theme = "light" }: { data: TestReportData; theme?: ReportTheme }) {
  const scores = buildReportScores(data.tests)
  const fullName = `${data.name.first} ${data.name.last}`.trim()
  const hasTests = data.tests.length > 0

  return (
    <ReportShell initialTheme={theme}>
      <ReportCover data={data} categoryCount={scores.categories.length} testTypeCount={scores.tests.length} />
      {hasTests ? (
        <>
          <ReportHeadline scores={scores} firstName={data.name.first} />
          <ReportVerdict scores={scores} assessments={data.assessments} />
        </>
      ) : (
        <div className="mx-auto max-w-2xl px-6 pb-16 text-center">
          <p className="font-heading text-lg font-bold">No tests logged yet</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {fullName}&apos;s testing report fills in as results are recorded. Check back after the next testing
            session.
          </p>
        </div>
      )}
    </ReportShell>
  )
}
