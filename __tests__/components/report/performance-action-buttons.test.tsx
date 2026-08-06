import { render, screen } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { PerformanceActionButtons } from "@/components/admin/performance/performance-action-buttons"

// The dialogs pull in forms with their own data deps; this suite only cares
// about the header links, so stub the heavy triggers.
vi.mock("@/components/client/performance/report-injury-form", () => ({
  ReportInjuryForm: () => null,
}))
vi.mock("@/components/client/coach-intel/log-training-session-form", () => ({
  LogTrainingSessionForm: () => null,
}))
vi.mock("@/components/client/performance/log-test-dialog", () => ({
  LogTestDialog: ({ trigger }: { trigger: React.ReactNode }) => <>{trigger}</>,
}))

const URL = "https://www.darrenjpaul.com/athlete/tok123"

describe("PerformanceActionButtons", () => {
  it("offers the test report from the header, reachable from every tab", () => {
    render(<PerformanceActionButtons clientUserId="c1" reportUrl={URL} />)
    const link = screen.getByRole("link", { name: /test report/i })
    expect(link).toHaveAttribute("href", URL)
    expect(link).toHaveAttribute("target", "_blank")
    expect(link.getAttribute("rel")).toContain("noopener")
  })

  it("omits the button when the client has no public report", () => {
    render(<PerformanceActionButtons clientUserId="c1" reportUrl={null} />)
    expect(screen.queryByRole("link", { name: /test report/i })).not.toBeInTheDocument()
    // The rest of the header still renders.
    expect(screen.getByRole("link", { name: /print result page/i })).toBeInTheDocument()
  })

  it("keeps the report link distinct from the internal print result page", () => {
    render(<PerformanceActionButtons clientUserId="c1" reportUrl={URL} />)
    const report = screen.getByRole("link", { name: /test report/i })
    const print = screen.getByRole("link", { name: /print result page/i })
    expect(report.getAttribute("href")).not.toBe(print.getAttribute("href"))
    expect(print.getAttribute("href")).toContain("/admin/clients/c1/performance/print")
  })
})
