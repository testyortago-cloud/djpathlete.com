import type { TestReportData } from "@/lib/test-report/data"
import { buildReportScores } from "@/lib/test-report/scoring"
import { ReportCover } from "./ReportCover"
import { ReportHeadline } from "./ReportHeadline"
import { ReportVerdict } from "./ReportVerdict"
import { ProfilePrintButton } from "@/components/shared/ProfilePrintButton"

/**
 * The public athlete test report. `.athlete-arena` supplies the DJP dark
 * document palette (defined once in globals.css and shared with the admin Arena
 * card); `.test-report` adds the paged-print rules; `.print-document` strips app
 * chrome from the printed output.
 *
 * With no logged tests the report renders ONE honest page rather than three
 * skeletal ones — an empty premium document reads as broken, not premium.
 */
export function TestReport({ data }: { data: TestReportData }) {
  const scores = buildReportScores(data.tests)
  const fullName = `${data.name.first} ${data.name.last}`.trim()
  const hasTests = data.tests.length > 0

  return (
    <main className="athlete-arena test-report print-document min-h-screen bg-background font-body text-foreground">
      <ProfilePrintButton />
      <ReportCover data={data} categoryCount={scores.categories.length} />
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
    </main>
  )
}
