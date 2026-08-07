import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { ReportPageTwo } from "@/components/public/report/ReportPageTwo"
import type { ReportScores, ScoredTest } from "@/lib/test-report/scoring"
import type { PublicAssessment } from "@/lib/profile-share/data"

/** Non-overlapping literal occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

function scores(tests: ScoredTest[]): ReportScores {
  return {
    athleteScore: null,
    categories: [],
    strongest: null,
    focalPoints: [],
    tests,
    biggestMover: null,
  }
}

const cmj: ScoredTest = {
  key: "cmj",
  testType: "cmj",
  label: "Countermovement Jump",
  latest: 48,
  unit: "cm",
  latestDate: "2026-06-01",
  isPr: true,
  score: 72,
  deltaPct: 8,
  previous: 44,
  targets: null,
  points: [40, 44, 48],
}

const sledPush: ScoredTest = {
  key: "custom:Sled Push",
  testType: "custom",
  label: "Sled Push",
  latest: 12,
  unit: "reps",
  latestDate: "2026-06-01",
  isPr: false,
  score: null,
  deltaPct: null,
  previous: null,
  targets: null,
  points: [10, 12],
}

const sprint: ScoredTest = {
  key: "sprint_40m",
  testType: "sprint_40m",
  label: "40m Sprint",
  latest: 4.9,
  unit: "s",
  latestDate: "2026-05-01",
  isPr: false,
  score: 61,
  deltaPct: -2,
  previous: 5.0,
  targets: null,
  points: [5.1, 5.0, 4.9],
}

const recentAssessment: PublicAssessment = {
  title: "Combine Screen",
  date: "2026-06-01",
  items: [
    { name: "Vertical Jump", value: 30, unit: "in" },
    { name: "Broad Jump", value: 8, unit: "ft" },
  ],
}

const olderAssessment: PublicAssessment = {
  title: "Preseason Screen",
  date: "2026-01-01",
  items: [{ name: "Vertical Jump", value: 27, unit: "in" }],
}

const secondOlderAssessment: PublicAssessment = {
  title: "Offseason Screen",
  date: "2025-09-01",
  items: [{ name: "Vertical Jump", value: 25, unit: "in" }],
}

describe("ReportPageTwo", () => {
  it("renders every test exactly once", () => {
    const { container } = render(<ReportPageTwo scores={scores([cmj, sprint, sledPush])} assessments={[]} />)
    expect(countOccurrences(container.textContent ?? "", "Countermovement Jump")).toBe(1)
    expect(countOccurrences(container.textContent ?? "", "40m Sprint")).toBe(1)
    expect(countOccurrences(container.textContent ?? "", "Sled Push")).toBe(1)
  })

  it("renders an unscorable custom test's value without a score track", () => {
    const { container } = render(<ReportPageTwo scores={scores([sledPush])} assessments={[]} />)
    expect(screen.getByText("12")).toBeInTheDocument()
    expect(screen.getByText("No standard for this test")).toBeInTheDocument()
    expect(container.querySelector(".score-track")).toBeNull()
  })

  it("still draws a score track for a scorable test", () => {
    const { container } = render(<ReportPageTwo scores={scores([cmj])} assessments={[]} />)
    expect(container.querySelectorAll(".score-track")).toHaveLength(1)
  })

  it("with 2+ assessments, the most recent is visible and older ones sit inside <details>", () => {
    const { container } = render(
      <ReportPageTwo scores={scores([cmj])} assessments={[recentAssessment, olderAssessment, secondOlderAssessment]} />,
    )
    const details = container.querySelector("details")
    expect(details).toBeTruthy()

    // The most recent battery renders outside the <details>.
    expect(screen.getByText("Combine Screen")).toBeInTheDocument()
    expect(details?.textContent).not.toContain("Combine Screen")

    // The older two are inside it.
    expect(details?.textContent).toContain("Preseason Screen")
    expect(details?.textContent).toContain("Offseason Screen")
    expect(screen.getByText("2 earlier assessments")).toBeInTheDocument()
  })

  it("with exactly 1 assessment, no <details> renders at all", () => {
    const { container } = render(<ReportPageTwo scores={scores([cmj])} assessments={[recentAssessment]} />)
    expect(screen.getByText("Combine Screen")).toBeInTheDocument()
    expect(container.querySelector("details")).toBeNull()
  })

  it("never says percentile", () => {
    const { container } = render(
      <ReportPageTwo scores={scores([cmj, sprint, sledPush])} assessments={[recentAssessment, olderAssessment]} />,
    )
    expect(container.textContent ?? "").not.toMatch(/percentile/i)
  })
})
