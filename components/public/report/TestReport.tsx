import type { TestReportData } from "@/lib/test-report/data"
import { buildReportScores } from "@/lib/test-report/scoring"
import { ReportPageOne } from "./ReportPageOne"
import { ReportPageTwo } from "./ReportPageTwo"
import { ReportShell, type ReportTheme } from "./ReportShell"

export type { ReportTheme }

/**
 * The public athlete test report — two pages.
 *
 * LIGHT is the default because this is a print-first document: a full-bleed dark
 * page is heavy on ink and `print-color-adjust: exact` is only a request, which
 * "save ink" settings and many home printers ignore. Dark stays available as a
 * screen-only deck treatment, via `?theme=dark` or the in-page toggle.
 *
 * With no logged tests the report renders page 1 alone rather than an empty second
 * sheet — a blank page reads as broken, not premium.
 */
export function TestReport({ data, theme = "light" }: { data: TestReportData; theme?: ReportTheme }) {
  const scores = buildReportScores(data.tests)
  const hasTests = data.tests.length > 0

  return (
    <ReportShell initialTheme={theme}>
      <ReportPageOne data={data} scores={scores} />
      {hasTests && <ReportPageTwo scores={scores} assessments={data.assessments} />}
    </ReportShell>
  )
}
