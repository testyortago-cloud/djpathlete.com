// @vitest-environment jsdom
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

  /**
   * Hero selection (biggest improver) and culprit selection (lowest scorer in a
   * weak category) are independent, so one test can win both — the LIKELY case,
   * not an edge case, because the weakest area is what the coach has been
   * training. Mobility 4 -> 8 (score 20, +100%) beside Power 58 -> 60 (score 88,
   * +3%) makes Sit & Reach the hero AND the sole Mobility culprit.
   */
  function collisionFixture(mobility: [number, number], power: [number, number]): TestReportData {
    return {
      ...base,
      tests: [
        { testType: "sit_reach", resultValue: mobility[0], resultUnit: "cm", customName: null, bodyWeightKg: null, testDate: "2026-01-01", isPr: false },
        { testType: "sit_reach", resultValue: mobility[1], resultUnit: "cm", customName: null, bodyWeightKg: null, testDate: "2026-07-01", isPr: false },
        { testType: "cmj", resultValue: power[0], resultUnit: "cm", customName: null, bodyWeightKg: 84, testDate: "2026-01-01", isPr: false },
        { testType: "cmj", resultValue: power[1], resultUnit: "cm", customName: null, bodyWeightKg: 84, testDate: "2026-07-01", isPr: false },
      ],
      assessments: [],
    }
  }

  it("names the collision when one test is both hero and culprit, instead of reading as a bug", () => {
    // Unfixed this printed "Biggest improvement — Sit & Reach", then one band below
    // a flat "Dragged by Sit & Reach, the lowest score in this category", ~200px
    // apart in the same PDF — the same test as triumph and as shortfall with no
    // acknowledgement. The data is not changed (the overlap is a real coaching
    // insight); the copy owns it.
    const collide = collisionFixture([4, 8], [58, 60])
    // Assert the collision the fixture is FOR, so a scoring change that quietly
    // removes it turns this into a failure rather than a vacuous pass.
    const s = buildReportScores(collide.tests)
    expect(s.biggestMover?.test.key, "fixture must make Sit & Reach the hero").toBe("sit_reach")
    expect(s.biggestMover?.direction, "fixture must make that hero an IMPROVEMENT").toBe("improved")
    expect(s.focalPoints[0]?.culprit.key, "fixture must make Sit & Reach the culprit too").toBe("sit_reach")

    const { container } = render(<TestReport data={collide} />)
    expect(screen.getByText(/despite being your biggest gain/i)).toBeInTheDocument()
    // Hero + culprit + page-2 row, and no more. An EXACT count, not `<= n`: the
    // third mention is deliberate here, so an upper bound alone would silently
    // accept a fourth, and a lower bound alone would accept the unframed copy.
    const occurrences = (needle: string) => (container.textContent ?? "").split(needle).length - 1
    const n = occurrences("Sit & Reach")
    expect(n, `"Sit & Reach" rendered ${n} times — expected hero + culprit + row`).toBe(3)
  })

  it("does not claim a 'biggest gain' on a report where the hero DECLINED", () => {
    // The mover falls back to the largest decline when nothing improved. The
    // collision copy is direction-aware for exactly this: "despite being your
    // biggest gain" printed over a -50% result is a false statement about the
    // athlete's own data, and it is reachable with the same shape of fixture.
    const collide = collisionFixture([8, 4], [60, 58])
    const s = buildReportScores(collide.tests)
    expect(s.biggestMover?.test.key, "fixture must make Sit & Reach the hero").toBe("sit_reach")
    expect(s.biggestMover?.direction, "fixture must make that hero a DECLINE").toBe("declined")
    expect(s.focalPoints[0]?.culprit.key, "fixture must make Sit & Reach the culprit too").toBe("sit_reach")

    render(<TestReport data={collide} />)
    expect(screen.queryByText(/biggest gain/i), "a decline was called a gain").not.toBeInTheDocument()
    expect(screen.getByText(/the change called out above/i)).toBeInTheDocument()
  })

  it("gives every section a real heading, at a level that does not skip", () => {
    // `panels/SectionHeading` was deleted in the restructure and its job — letting
    // a screen-reader user jump section to section — went with it: the whole
    // two-page document was left with an <h1> and one <h2>. These are the same
    // labels that were already on the page, promoted from <p>/<span>; the visual
    // styling is unchanged, only the element name.
    const { container } = render(<TestReport data={base} />)
    const levels = [...container.querySelectorAll("h1,h2,h3,h4,h5,h6")]
    const text = (n: Element) => (n.textContent ?? "").trim()

    expect(levels.filter((n) => n.tagName === "H1").map(text), "exactly one h1: the athlete").toEqual([
      "Marcus Johnson",
    ])
    const h2 = levels.filter((n) => n.tagName === "H2").map(text)
    expect(h2).toContain("Athlete Performance Index")
    expect(h2).toContain("Focal points — where the next block goes")
    expect(h2).toContain("Test by test")

    // Each focal category is an h3 UNDER the "Focal points" h2 — a category is a
    // subsection of that band, not a peer of it.
    const focal = buildReportScores(base.tests).focalPoints
    expect(focal.length, "fixture must produce at least one focal point").toBeGreaterThan(0)
    const h3 = levels.filter((n) => n.tagName === "H3").map(text)
    for (const fp of focal) expect(h3, `${fp.category} is not an h3`).toContain(fp.category)

    // No skipped level anywhere in document order (h1 -> h3 with no h2 between is
    // the failure this catches, and it is what "promote to the right level" means).
    const order = levels.map((n) => Number(n.tagName.slice(1)))
    for (let i = 1; i < order.length; i++) {
      expect(order[i] - order[i - 1], `heading level jumped from h${order[i - 1]} to h${order[i]}`).toBeLessThanOrEqual(1)
    }
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

  it("renders one honest page, not a blank one, when nothing has been logged", () => {
    // A coach shares this link before the first testing session. The old layout's
    // failure mode was empty sheets; the new one's would be a masthead and a
    // footer with nothing between them — which reads as broken, not as "no data".
    const { container } = render(<TestReport data={{ ...base, tests: [], assessments: [], testCount: 0 }} />)
    expect(container.querySelectorAll(".report-page")).toHaveLength(1)
    expect(screen.getByText(/No tests logged yet/i)).toBeInTheDocument()
    // "Marcus" is not unique: it's in the masthead h1 ("Marcus Johnson"), the
    // footer ("Marcus Johnson, Basketball · ..."), AND now the empty-state
    // copy itself — same reason every other test in this file uses
    // getAllByText for the name instead of getByText.
    expect(screen.getAllByText(/Marcus/).length).toBeGreaterThan(0)
    // Page 2 content must not leak onto page 1.
    expect(screen.queryByText("Test by test")).not.toBeInTheDocument()
  })
})
