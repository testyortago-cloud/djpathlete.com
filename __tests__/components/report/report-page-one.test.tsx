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

  it("announces the mover's DIRECTION in text, not via aria-label on a paragraph", () => {
    // ARIA 1.2 prohibits naming role="paragraph", so an aria-label there is dropped
    // by assistive tech and flagged by validators — a screen-reader user on a
    // declined report heard a bare "14 percent", the most consequential fact on
    // the page missing its sign.
    const declined: TestReportData = {
      ...base,
      tests: [
        { testType: "cmj", resultValue: 50, resultUnit: "cm", customName: null, bodyWeightKg: 78, testDate: "2026-01-01", isPr: false },
        { testType: "cmj", resultValue: 40, resultUnit: "cm", customName: null, bodyWeightKg: 78, testDate: "2026-06-01", isPr: false },
        { testType: "sit_reach", resultValue: 12, resultUnit: "cm", customName: null, bodyWeightKg: null, testDate: "2026-06-01", isPr: false },
      ],
    }
    const scores = buildReportScores(declined.tests)
    expect(scores.biggestMover?.direction, "fixture must produce a decline").toBe("declined")

    const { container } = render(<ReportPageOne data={declined} scores={scores} />)
    // No <p> may carry the direction as an aria-label. (ScoreTrack's aria-label is
    // legitimate — it sits on role="img", which ARIA does allow to be named.)
    expect(
      [...container.querySelectorAll("p[aria-label]")],
      "the direction is back on an aria-label that ARIA tells AT to ignore",
    ).toHaveLength(0)
    const hidden = container.querySelector(".sr-only")
    expect(hidden, "no visually-hidden direction word rendered").toBeTruthy()
    expect(hidden!.textContent).toMatch(/declined/i)
  })

  it("says '1 test' on a first report, not '1 tests'", () => {
    render(<ReportPageOne data={{ ...base, testCount: 1, monthsTracked: 1, tests: [] }} scores={buildReportScores([])} />)
    expect(screen.getByText(/1 test over 1 month\b/)).toBeInTheDocument()
  })

  it("puts the coaching cue on its own line, not run-on with its label", () => {
    // `.djp-eyebrow` is display:inline-flex in globals.css and beats Tailwind's
    // `block`, so a label nested inside the cue paragraph shares its line box.
    // Asserting on separate elements is what catches the regression — the text
    // content is identical either way, so a text assertion cannot see it.
    const rich: TestReportData = {
      ...base,
      tests: [
        { testType: "cmj", resultValue: 40, resultUnit: "cm", customName: null, bodyWeightKg: 78, testDate: "2026-01-01", isPr: false },
        { testType: "cmj", resultValue: 48, resultUnit: "cm", customName: null, bodyWeightKg: 78, testDate: "2026-06-01", isPr: true },
        { testType: "sit_reach", resultValue: 12, resultUnit: "cm", customName: null, bodyWeightKg: null, testDate: "2026-06-01", isPr: false },
      ],
    }
    const { container } = render(<ReportPageOne data={rich} scores={buildReportScores(rich.tests)} />)
    const label = [...container.querySelectorAll(".djp-eyebrow")].find((n) => /what moves it/i.test(n.textContent ?? ""))
    expect(label, "no 'What moves it' label rendered").toBeTruthy()
    // The label must NOT be a child of the element holding the cue text.
    //
    // NOTE: `textContent` was tried here first and rejected — it concatenates
    // every descendant text node regardless of element boundaries, so
    // `label.parentElement.textContent` reads "What moves it" + the cue with no
    // separator whether the two are one run-on <p> OR two sibling <p>s. Proved
    // unfalsifiable: it failed identically against the broken markup and the
    // fixed markup. The actual DOM signal of "run-on" is a raw Text node sitting
    // directly on the label's own parent (the broken markup puts the cue string
    // straight inside the same <p> as the label span); the fix moves the cue
    // into its own sibling <p>, leaving no direct text-node child on the parent.
    const directText = [...label!.parentElement!.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? "")
      .join("")
      .trim()
    expect(directText, "the label's parent directly holds raw cue text — still one run-on paragraph").toBe("")
    expect(label!.nextElementSibling, "cue is not a sibling element — it is inline with the label").toBeTruthy()
  })

  it("draws the mover as a Now-vs-standards circle group, not a bar", () => {
    const rich: TestReportData = {
      ...base,
      tests: [
        { testType: "cmj", resultValue: 40, resultUnit: "cm", customName: null, bodyWeightKg: 78, testDate: "2026-01-01", isPr: false },
        { testType: "cmj", resultValue: 48, resultUnit: "cm", customName: null, bodyWeightKg: 78, testDate: "2026-06-01", isPr: true },
        { testType: "sit_reach", resultValue: 12, resultUnit: "cm", customName: null, bodyWeightKg: null, testDate: "2026-06-01", isPr: false },
      ],
    }
    const scores = buildReportScores(rich.tests)
    expect(scores.biggestMover?.test.key, "fixture must make cmj the mover").toBe("cmj")

    const { container } = render(<ReportPageOne data={rich} scores={scores} />)
    // The circle: now, prev, and both standards in the test's own units.
    expect(screen.getByText("Now")).toBeInTheDocument()
    expect(screen.getByText(/Prev 40/)).toBeInTheDocument()
    expect(screen.getByText("Trained")).toBeInTheDocument()
    expect(screen.getByText("Elite")).toBeInTheDocument()
    expect(screen.getByText("45")).toBeInTheDocument() // cmj trained standard
    expect(screen.getByText("65")).toBeInTheDocument() // cmj elite standard
    // The time period, on the hero itself.
    expect(screen.getByText(/1 Jan 2026 → 1 Jun 2026/)).toBeInTheDocument()
    // The old raw-values line is gone (the circle carries both numbers now)…
    expect(screen.queryByText(/40 → 48/)).not.toBeInTheDocument()
    // …and no track in the mover panel: every remaining track is primary-toned.
    for (const t of container.querySelectorAll(".score-track")) {
      expect(t.getAttribute("data-tone")).not.toBe("accent")
    }
  })

  it("renders the mover circle without satellites when targets are unknowable", () => {
    // A 1RM with no body weight: delta exists (raw kg), targets do not.
    const noBw: TestReportData = {
      ...base,
      tests: [
        { testType: "back_squat_1rm", resultValue: 100, resultUnit: "kg", customName: null, bodyWeightKg: null, testDate: "2026-01-01", isPr: false },
        { testType: "back_squat_1rm", resultValue: 120, resultUnit: "kg", customName: null, bodyWeightKg: null, testDate: "2026-06-01", isPr: false },
      ],
    }
    const scores = buildReportScores(noBw.tests)
    expect(scores.biggestMover, "fixture must still produce a mover").not.toBeNull()
    expect(scores.biggestMover!.test.targets).toBeNull()

    render(<ReportPageOne data={noBw} scores={scores} />)
    expect(screen.getByText("Now")).toBeInTheDocument()
    expect(screen.queryByText("Trained")).not.toBeInTheDocument()
    expect(screen.queryByText("Elite")).not.toBeInTheDocument()
  })
})
