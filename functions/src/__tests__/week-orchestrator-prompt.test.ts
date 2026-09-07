import { describe, it, expect } from "vitest"
import { buildArchitectPrompt, buildDesignDirective } from "../ai/week-orchestrator.js"

/**
 * Regression cover for the 2026-09-07 report: a coach edited the Full Body Day
 * template from "1 <pattern>" to "3 <pattern>" on Week 5 / Friday and got 7
 * exercises back — the count prior Fridays held. The day prompt asked for the
 * exercise count to come from prior weeks in TWO places, and carried none of
 * the override clause week mode had, so the model obeyed history over the coach.
 */

const BASE = {
  isSingleDay: true,
  targetDayName: "Friday",
  newWeekNumber: 5,
  targetDayOfWeek: 5,
  splitType: "custom",
  periodization: "none",
}

describe("day design directive", () => {
  it("does not source the exercise count from prior weeks when the coach gave instructions", () => {
    const directive = buildDesignDirective({ ...BASE, hasCoachInstructions: true })

    // The whole defect: this phrase competing with the coach's own count.
    expect(directive).not.toMatch(/exercise count, and session structure/)
    expect(directive).toMatch(/prior weeks to determine the appropriate focus and session structure/)
    // And it must say so positively, not merely omit it.
    expect(directive).toMatch(/Coach Instructions above set the exercise count/)
    expect(directive).toMatch(/Do NOT fall back to the prior-week count/)
  })

  it("still sources the count from prior weeks when the coach gave none", () => {
    const directive = buildDesignDirective({ ...BASE, hasCoachInstructions: false })

    expect(directive).toMatch(/focus, exercise count, and session structure/)
    expect(directive).not.toMatch(/Do NOT fall back to the prior-week count/)
  })

  it("pins the day identity the directive is built for", () => {
    // An absence assertion above passes just as well against an empty string,
    // so hold the parts that must survive any rewording of the count clause.
    const directive = buildDesignDirective({ ...BASE, hasCoachInstructions: true })
    expect(directive).toContain("Design Friday for Week 5")
    expect(directive).toContain("day_of_week=5")
    expect(directive).toContain("split (custom)")
    expect(directive).toContain("periodization (none)")
  })

  it("leaves week mode alone — it has no per-day count clause to override", () => {
    const directive = buildDesignDirective({
      ...BASE,
      isSingleDay: false,
      hasCoachInstructions: true,
    })
    expect(directive).toContain("Design Week 5 for this program")
    expect(directive).not.toMatch(/prior-week count/)
  })
})

describe("day architect system prompt", () => {
  const day = buildArchitectPrompt("day")
  const week = buildArchitectPrompt("week")

  it("marks the prior-week exercise count as a default the coach can override", () => {
    expect(day).toMatch(/prior-week exercise count is only a DEFAULT/)
  })

  it("carries the override clause week mode already had", () => {
    // Week mode has always said the coach's counts beat the time budget; day
    // mode said only "create EXACTLY that many slots" and lost the tie.
    expect(week).toMatch(/overrides the default time-budget caps/i)
    expect(day).toMatch(/OVERRIDES the prior-week exercise count in rule 2/)
  })

  it("tells the model a per-pattern list is summed, not read as sets", () => {
    expect(day).toMatch(/sum the lines and build that many slots/)
    expect(day).toMatch(/count of EXERCISES, never of sets/)
  })
})
