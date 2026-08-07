import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { ReportPageOne } from "@/components/public/report/ReportPageOne"
import { buildReportScores } from "@/lib/test-report/scoring"
import type { TestReportData } from "@/lib/test-report/data"

const base: TestReportData = {
  name: { first: "Sean", last: "Murphy" },
  avatarUrl: null,
  sport: "Rugby",
  position: "Fly-half",
  age: 17,
  asOf: "2026-08-04",
  testCount: 2,
  prCount: 0,
  monthsTracked: 6,
  tests: [],
  assessments: [],
}

/** A client whose every test is `custom`: no test is scorable, so there are no
    categories, no focal points, no index and no mover. Durably reachable. */
const allCustom: TestReportData = {
  ...base,
  tests: [
    { testType: "custom", resultValue: 10, resultUnit: "reps", customName: "Sled Push", bodyWeightKg: null, testDate: "2026-01-01", isPr: false },
    { testType: "custom", resultValue: 12, resultUnit: "reps", customName: "Sled Push", bodyWeightKg: null, testDate: "2026-06-01", isPr: false },
  ],
}

describe("ReportPageOne", () => {
  it("still renders identity and anchors the footer when nothing is scorable", () => {
    const scores = buildReportScores(allCustom.tests)
    expect(scores.athleteScore, "fixture must produce a null index").toBeNull()
    expect(scores.focalPoints, "fixture must produce no focal points").toEqual([])

    const { container } = render(<ReportPageOne data={allCustom} scores={scores} />)
    expect(screen.getByText("Sean Murphy")).toBeInTheDocument()
    // The spacer is what pins the footer to the page edge. Without it the footer
    // rides up under the masthead on any report with no scorable category.
    //
    // NOTE: deliberately `.report-page > .flex-1` (direct-child combinator), NOT
    // the bare `.flex-1` originally specified. The masthead's name/subtitle
    // wrapper (ReportPageOne.tsx:33) is `className="min-w-0 flex-1"`, nested
    // several levels inside the masthead band — a bare `.flex-1` class selector
    // matches that unconditionally-rendered div regardless of whether the
    // footer-anchor spacer exists, so the assertion could never fail. Verified:
    // with the spacer deleted, `container.querySelector(".flex-1")` still
    // returned the masthead div and this assertion stayed green. Scoping to a
    // direct child of `.report-page` isolates the spacer, which is the only
    // `.flex-1` rendered as a direct child of the page section.
    expect(
      container.querySelector(".report-page > .flex-1"),
      "no flex-1 spacer — footer will not anchor",
    ).toBeTruthy()
    // No empty ruled band where the index/mover would have been.
    expect(container.querySelectorAll(".report-band")).toHaveLength(2)
  })

  it("renders the index, the mover and the focal points when data supports them", () => {
    const rich: TestReportData = {
      ...base,
      tests: [
        { testType: "cmj", resultValue: 40, resultUnit: "cm", customName: null, bodyWeightKg: 78, testDate: "2026-01-01", isPr: false },
        { testType: "cmj", resultValue: 48, resultUnit: "cm", customName: null, bodyWeightKg: 78, testDate: "2026-06-01", isPr: true },
        { testType: "sit_reach", resultValue: 12, resultUnit: "cm", customName: null, bodyWeightKg: null, testDate: "2026-06-01", isPr: false },
      ],
    }
    render(<ReportPageOne data={rich} scores={buildReportScores(rich.tests)} />)
    expect(screen.getByText("Athlete Performance Index")).toBeInTheDocument()
    expect(screen.getByText(/50 is Trained, 100 is Elite/)).toBeInTheDocument()
    expect(screen.getByText("Countermovement Jump")).toBeInTheDocument()
    expect(screen.queryByText(/percentile/i)).not.toBeInTheDocument()
  })
})
