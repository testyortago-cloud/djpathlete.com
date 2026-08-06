import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { TestReport } from "@/components/public/report/TestReport"
import type { TestReportData } from "@/lib/test-report/data"

const base: TestReportData = {
  name: { first: "Marcus", last: "Johnson" },
  avatarUrl: null,
  sport: "Basketball",
  position: "Point Guard",
  age: 24,
  asOf: "2026-07-01",
  testCount: 4,
  prCount: 2,
  monthsTracked: 6,
  tests: [
    { testType: "cmj", resultValue: 40, resultUnit: "cm", customName: null, bodyWeightKg: 84, testDate: "2026-01-01", isPr: false },
    { testType: "cmj", resultValue: 50, resultUnit: "cm", customName: null, bodyWeightKg: 84, testDate: "2026-07-01", isPr: true },
    { testType: "sprint_10m", resultValue: 2.3, resultUnit: "s", customName: null, bodyWeightKg: null, testDate: "2026-01-01", isPr: false },
    { testType: "sprint_10m", resultValue: 2.2, resultUnit: "s", customName: null, bodyWeightKg: null, testDate: "2026-06-01", isPr: true },
  ],
  assessments: [
    { title: "Mid-Season Testing", date: "2026-07-10T00:00:00Z", items: [{ name: "Back Squat", value: 140, unit: "kg" }] },
  ],
}

describe("TestReport", () => {
  it("renders three pages with the athlete identity and headline scores", () => {
    const { container } = render(<TestReport data={base} />)
    expect(container.querySelectorAll(".report-page")).toHaveLength(3)
    // Name appears in the cover h1 AND the "Report for:" footer line.
    expect(screen.getAllByText(/Marcus Johnson/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Basketball/).length).toBeGreaterThan(0)
    expect(screen.getByText("The Headline Numbers")).toBeInTheDocument()
    expect(screen.getByText("The Full Verdict")).toBeInTheDocument()
    expect(screen.getAllByText(/Darren Paul/).length).toBeGreaterThan(0)
  })

  it("shows testing content and NONE of the program/exercise content", () => {
    render(<TestReport data={base} />)
    expect(screen.getAllByText(/Countermovement Jump/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Mid-Season Testing/)).toBeInTheDocument()
    // The whole point of this report: no program, no badges, no volume, no streak.
    expect(screen.queryByText(/Current Program/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Training Load/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/streak/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Achievements/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Total Volume/i)).not.toBeInTheDocument()
  })

  it("renders a coaching cue drawn from the weakest category", () => {
    render(<TestReport data={base} />)
    expect(screen.getByText(/Generated from this athlete/i)).toBeInTheDocument()
  })

  it("renders the no-tests state instead of three empty pages", () => {
    const { container } = render(
      <TestReport data={{ ...base, tests: [], assessments: [], testCount: 0, prCount: 0, monthsTracked: 0, asOf: null }} />,
    )
    // Name appears in the cover h1 AND the "Report for:" footer line.
    expect(screen.getAllByText(/Marcus Johnson/).length).toBeGreaterThan(0)
    expect(screen.getByText(/No tests logged yet/i)).toBeInTheDocument()
    expect(container.querySelectorAll(".report-page")).toHaveLength(1)
    expect(screen.queryByText("The Headline Numbers")).not.toBeInTheDocument()
  })

  it("drops the category comparison when only one category is scorable", () => {
    render(
      <TestReport
        data={{
          ...base,
          tests: [
            { testType: "cmj", resultValue: 50, resultUnit: "cm", customName: null, bodyWeightKg: 84, testDate: "2026-07-01", isPr: true },
          ],
        }}
      />,
    )
    expect(screen.queryByText(/Where you're strong/i)).not.toBeInTheDocument()
    expect(screen.getByText("The Headline Numbers")).toBeInTheDocument()
    // One category means strongest === focus: the Focus tile must not duplicate it.
    expect(screen.queryByText(/Focus —/)).not.toBeInTheDocument()
    expect(screen.getByText(/Strongest — Power/)).toBeInTheDocument()
  })

  it("lists an unscorable custom test without inventing a score for it", () => {
    const { container } = render(
      <TestReport
        data={{
          ...base,
          tests: [
            { testType: "custom", resultValue: 6.1, resultUnit: "s", customName: "Sled Push 20m", bodyWeightKg: null, testDate: "2026-07-01", isPr: false },
          ],
        }}
      />,
    )
    expect(screen.getAllByText(/Sled Push 20m/).length).toBeGreaterThan(0)
    // No reference range exists for a custom test, so no range bar is drawn.
    expect(container.querySelectorAll("[data-testid='range-marker']")).toHaveLength(0)
  })

  it("renders the range bar for scorable tests", () => {
    const { container } = render(<TestReport data={base} />)
    expect(container.querySelectorAll("[data-testid='range-marker']").length).toBeGreaterThan(0)
  })
})
