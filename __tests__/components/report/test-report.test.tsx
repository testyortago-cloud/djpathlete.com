import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { TestReport } from "@/components/public/report/TestReport"
import { buildReportScores } from "@/lib/test-report/scoring"
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
  it("renders two pages with the athlete identity and the index", () => {
    const { container } = render(<TestReport data={base} />)
    expect(container.querySelectorAll(".report-page")).toHaveLength(2)
    expect(screen.getAllByText(/Marcus Johnson/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Basketball/).length).toBeGreaterThan(0)
    expect(screen.getByText("Athlete Performance Index")).toBeInTheDocument()
    expect(screen.getByText("Test by test")).toBeInTheDocument()
    expect(screen.getAllByText(/Darren Paul/).length).toBeGreaterThan(0)
  })

  it("explains how the index is built, because that was the first thing asked about it", () => {
    render(<TestReport data={base} />)
    expect(screen.getByText(/50 is Trained, 100 is Elite/)).toBeInTheDocument()
  })

  it("does NOT repeat the weakest category all over the report", () => {
    // The regression guard for the whole restructure. The old layout rendered the
    // weakest category SIX times; the budget is the focal-point card plus at most
    // one more mention.
    //
    // Counts literal occurrences in the rendered text rather than using
    // getAllByText, which also matches every ANCESTOR whose text contains the
    // string — that inflates the count unpredictably and would make this guard
    // meaningless. Counting is the whole point here: a presence assertion would
    // pass on the very layout this replaces.
    const { container } = render(<TestReport data={base} />)
    const occurrences = (needle: string) => (container.textContent ?? "").split(needle).length - 1

    const weakest = buildReportScores(base.tests).focalPoints[0]
    expect(weakest, "fixture must produce at least one focal point").toBeDefined()
    const n = occurrences(weakest.category)
    expect(n, `"${weakest.category}" rendered ${n} times`).toBeLessThanOrEqual(2)
  })

  it("shows each test once in the rows, and only the hero twice", () => {
    // The old page 3 drew the top four tests as circles and then ALL of them again
    // as cards. Now a non-hero test appears exactly once. The biggest mover appears
    // twice — once as the hero on page 1, once in its own row — and that is the
    // intended emphasis, not the duplication being fixed.
    const { container } = render(<TestReport data={base} />)
    const occurrences = (needle: string) => (container.textContent ?? "").split(needle).length - 1

    // cmj improves 40 -> 50 (+25%) vs sprint_10m 2.3 -> 2.2 (+4%), so the jump is the hero.
    expect(occurrences("Countermovement Jump")).toBe(2)
    // 10m Sprint is the sole test in the Speed category, so it is also that
    // category's focal-point culprit — FocalPointCard names the culprit by
    // design ("Dragged by 10m Sprint..."). It legitimately appears twice: once
    // in its own row on page 2, once cited as the culprit in the page-1 focal
    // point card. That is a different idiom from the row+card duplication this
    // guard targets (page 2 itself still draws it exactly once, per
    // report-page-two.test.tsx's "renders every test exactly once").
    expect(occurrences("10m Sprint")).toBe(2)
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
})
