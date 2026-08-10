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
  previousDate: "2026-03-01",
  targets: { elite: 65, trained: 45, relativeToBodyWeight: false, direction: "higher" },
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
  previousDate: null,
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
  previousDate: "2026-04-01",
  targets: { elite: 4.5, trained: 5.75, relativeToBodyWeight: false, direction: "lower" },
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

/** deltaPct exactly 0 — the test that neither improved nor declined. */
const flat: ScoredTest = {
  key: "beep_test",
  testType: "beep_test",
  label: "Beep Test",
  latest: 11,
  unit: "level",
  latestDate: "2026-06-01",
  isPr: false,
  score: 67,
  deltaPct: 0,
  previous: 11,
  previousDate: "2026-05-01",
  targets: { elite: 14, trained: 9.5, relativeToBodyWeight: false, direction: "higher" },
  points: [11, 11, 11],
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

  it("never calls a flat test an improvement, the way page 1 already doesn't", () => {
    // deltaPct === 0 was hitting the `>= 0` arm: "↑ 0%" in success green, while
    // page 1 rendered the same number as "= 0%" and "held steady". Task 2 replaced
    // the boolean with a three-state direction for exactly this reason; the fix
    // landed on one page only.
    const { container } = render(<ReportPageTwo scores={scores([flat])} assessments={[]} />)
    const delta = [...container.querySelectorAll("p")].find((p) => /0%/.test(p.textContent ?? ""))
    expect(delta, "no delta cell rendered").toBeTruthy()
    expect(delta!.textContent).toContain("=")
    expect(delta!.textContent, "a flat test must not read as an increase").not.toContain("↑")
    expect(delta!.className, "a flat test must not be coloured as a success").not.toContain("--success")
    expect(delta!.className).toContain("text-muted-foreground")
  })

  it("opens the NEWEST assessment even when the array order disagrees with the dates", () => {
    // lib/db/performance-assessments orders by `created_at`, lib/profile-share
    // DISPLAYS `updated_at`. A January assessment edited in August therefore
    // arrives behind a June one, and `[latest, ...older] = assessments` would put
    // the newest behind a disclosure captioned "1 earlier assessment" — a claim
    // the printed page states as fact and gets wrong.
    const outOfOrder: PublicAssessment[] = [
      { title: "June Screen", date: "2026-06-01", items: [{ name: "Vertical Jump", value: 28, unit: "in" }] },
      { title: "August Screen", date: "2026-08-01", items: [{ name: "Vertical Jump", value: 31, unit: "in" }] },
    ]
    const { container } = render(<ReportPageTwo scores={scores([cmj])} assessments={outOfOrder} />)
    const details = container.querySelector("details")
    expect(details, "two assessments must still collapse the older one").toBeTruthy()
    // The August battery is the expanded one; June is the one inside <details>.
    expect(details?.textContent, "the NEWEST assessment is hidden behind the disclosure").not.toContain(
      "August Screen",
    )
    expect(details?.textContent).toContain("June Screen")
    expect(screen.getByText("August Screen")).toBeInTheDocument()
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
