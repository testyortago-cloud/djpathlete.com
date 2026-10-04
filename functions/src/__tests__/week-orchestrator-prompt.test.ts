import { describe, it, expect } from "vitest"
import { buildArchitectPrompt, buildDesignDirective, describeDaySize } from "../ai/week-orchestrator.js"
import { PRIORITY_LADDER } from "../ai/prompts.js"

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
  it("does not source the exercise count from prior weeks when the coach STATED a count", () => {
    const directive = buildDesignDirective({ ...BASE, coachStatesCount: true })

    // The whole defect: this phrase competing with the coach's own count.
    expect(directive).not.toMatch(/exercise count, and session structure/)
    expect(directive).toMatch(/other weeks to determine the appropriate focus and session structure/)
    // And it must say so positively, not merely omit it.
    expect(directive).toMatch(/Coach Instructions above set the exercise count/)
    expect(directive).toMatch(/Do NOT fall back to the prior-week count/)
  })

  it("still sources the count from history when the coach gave no instructions", () => {
    const directive = buildDesignDirective({ ...BASE, coachStatesCount: false })

    expect(directive).toMatch(/focus, exercise count, and session structure/)
    expect(directive).not.toMatch(/Do NOT fall back to the prior-week count/)
  })

  it("pins the day identity the directive is built for", () => {
    // An absence assertion above passes just as well against an empty string,
    // so hold the parts that must survive any rewording of the count clause.
    const directive = buildDesignDirective({ ...BASE, coachStatesCount: true })
    expect(directive).toContain("Design Friday for Week 5")
    expect(directive).toContain("day_of_week=5")
    expect(directive).toContain("split (custom)")
    expect(directive).toContain("periodization (none)")
  })

  it("leaves week mode alone — it has no per-day count clause to override", () => {
    const directive = buildDesignDirective({
      ...BASE,
      isSingleDay: false,
      coachStatesCount: true,
    })
    expect(directive).toContain("Design Week 5 for this program")
    expect(directive).not.toMatch(/prior-week count/)
  })
})

/**
 * 2026-10-01, Chris H: instructions with no count ("using the exercise pool / 2-4 sets / …")
 * still got the "Coach Instructions above set the exercise count … Do NOT fall back" clause,
 * and the model built 2 slots out of "2-4 sets". Filling Week 1 also gave it no history at
 * all, because only EARLIER weeks were shown, while weeks 2-8 held 5-7 exercise Mondays.
 */
describe("day directive when instructions state no count", () => {
  const history = describeDaySize(
    [
      ...Array.from({ length: 6 }, () => ({ week_number: 2, day_of_week: 1 })),
      ...Array.from({ length: 7 }, () => ({ week_number: 3, day_of_week: 1 })),
      ...Array.from({ length: 6 }, () => ({ week_number: 4, day_of_week: 1 })),
      ...Array.from({ length: 11 }, () => ({ week_number: 1, day_of_week: 2 })),
    ],
    { targetWeek: 1, targetDayOfWeek: 1, targetDayName: "Monday" },
  )

  it("tells the architect the count is NOT set by the instructions", () => {
    const directive = buildDesignDirective({ ...BASE, coachStatesCount: false, daySize: history })
    expect(directive).not.toMatch(/Coach Instructions above set the exercise count/)
    expect(directive).toMatch(/do not state an exercise count/i)
    expect(directive).toMatch(/never derive it from set, rep, rest or tempo numbers/i)
  })

  it("carries the program's own size for that day, from LATER weeks too", () => {
    expect(history).toContain("Monday in other weeks of this program: Week 2: 6, Week 3: 7, Week 4: 6")
    expect(history).toContain("build 6 slots")
    const directive = buildDesignDirective({ ...BASE, coachStatesCount: false, daySize: history })
    expect(directive).toContain(history!)
  })

  it("falls back to the program's typical day when this weekday has never been built", () => {
    const h = describeDaySize(
      [
        ...Array.from({ length: 9 }, () => ({ week_number: 1, day_of_week: 2 })),
        ...Array.from({ length: 5 }, () => ({ week_number: 1, day_of_week: 4 })),
        ...Array.from({ length: 7 }, () => ({ week_number: 2, day_of_week: 2 })),
      ],
      { targetWeek: 1, targetDayOfWeek: 1, targetDayName: "Monday" },
    )
    expect(h).toContain("Monday has not been built in any other week")
    expect(h).toContain("build 7 slots")
  })

  it("never counts the target day itself", () => {
    const h = describeDaySize(
      [
        ...Array.from({ length: 2 }, () => ({ week_number: 1, day_of_week: 1 })),
        ...Array.from({ length: 6 }, () => ({ week_number: 2, day_of_week: 1 })),
      ],
      { targetWeek: 1, targetDayOfWeek: 1, targetDayName: "Monday" },
    )
    expect(h).toContain("Week 2: 6")
    expect(h).not.toContain("Week 1:")
  })

  it("says nothing for an empty program", () => {
    expect(describeDaySize([], { targetWeek: 1, targetDayOfWeek: 1, targetDayName: "Monday" })).toBeNull()
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

describe("week/day architect strict prompt (2026-10-04)", () => {
  for (const mode of ["week", "day"] as const) {
    it(`${mode}: carries the ladder and drops the compound-continuity goal`, () => {
      const p = buildArchitectPrompt(mode)
      expect(p).toContain(PRIORITY_LADDER)
      expect(p).not.toMatch(/continuity for compound lifts/)
      expect(p).not.toMatch(/3% repetition/)
      expect(p).toContain("Muscle names")
    })
  }
  it("day: overlap is about heavy loading, not shared patterns", () => {
    const p = buildArchitectPrompt("day")
    expect(p).toMatch(/within 48 hours/)
    expect(p).not.toMatch(/avoid duplicating the same muscle groups or movement patterns/)
  })
})
