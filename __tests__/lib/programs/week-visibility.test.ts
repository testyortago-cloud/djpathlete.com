import { describe, it, expect } from "vitest"
import {
  releasedThroughWeek,
  weekState,
  unlockDate,
  buildWeekGate,
  formatUnlockDate,
  releaseAnchorFor,
} from "@/lib/programs/week-visibility"

const DAY = 24 * 60 * 60 * 1000
const anchor = new Date("2026-10-05T10:00:00Z") // a Monday
const at = (days: number) => new Date(anchor.getTime() + days * DAY)
const sched = { release_base_week: 1, release_anchor_at: anchor.toISOString() }
const noSched = { release_base_week: null, release_anchor_at: null }

type Row = {
  week_number: number
  access_type: "included" | "paid"
  payment_status: "not_required" | "pending" | "paid"
  price_cents: number | null
  visibility?: "auto" | "shown" | "hidden"
}
const row = (week_number: number, extra: Partial<Row> = {}): Row => ({
  week_number,
  access_type: "included",
  payment_status: "not_required",
  price_cents: null,
  visibility: "auto",
  ...extra,
})

describe("releasedThroughWeek", () => {
  it("is null without a schedule — every assignment made before 00289", () => {
    expect(releasedThroughWeek(noSched, at(100))).toBeNull()
  })
  it("releases one more week on each 7th day after the anchor, not before", () => {
    expect(releasedThroughWeek(sched, at(0))).toBe(1)
    expect(releasedThroughWeek(sched, at(6.99))).toBe(1)
    expect(releasedThroughWeek(sched, at(7))).toBe(2)
    expect(releasedThroughWeek(sched, at(21))).toBe(4)
  })
  it("starts from the base the coach chose", () => {
    expect(releasedThroughWeek({ ...sched, release_base_week: 3 }, at(7))).toBe(4)
  })
  it("never drops below base while the anchor is in the future (a later start date)", () => {
    expect(releasedThroughWeek({ release_base_week: 2, release_anchor_at: at(3).toISOString() }, at(0))).toBe(2)
  })
  it("holds at base while paused (no anchor), however long", () => {
    expect(releasedThroughWeek({ release_base_week: 2, release_anchor_at: null }, at(365))).toBe(2)
  })
})

describe("weekState", () => {
  it("hidden always wins, even for a released week and with no schedule", () => {
    expect(weekState(1, sched, "hidden", at(30))).toBe("hidden")
    expect(weekState(1, noSched, "hidden", at(0))).toBe("hidden")
  })
  it("shown opens a week the schedule has not reached", () => {
    expect(weekState(5, sched, "shown", at(0))).toBe("visible")
  })
  it("auto (or missing) follows the schedule", () => {
    expect(weekState(1, sched, "auto", at(0))).toBe("visible")
    expect(weekState(2, sched, "auto", at(0))).toBe("scheduled")
    expect(weekState(2, sched, undefined, at(7))).toBe("visible")
  })
  it("auto with no schedule is visible (today's behaviour)", () => {
    expect(weekState(12, noSched, "auto", at(0))).toBe("visible")
  })
})

describe("unlockDate", () => {
  it("is the anchor plus (week - base) weeks", () => {
    expect(unlockDate(3, sched)?.toISOString()).toBe(at(14).toISOString())
  })
  it("is null when paused or unscheduled", () => {
    expect(unlockDate(3, { release_base_week: 1, release_anchor_at: null })).toBeNull()
    expect(unlockDate(3, noSched)).toBeNull()
  })
  it("agrees with releasedThroughWeek at the boundary", () => {
    const d = unlockDate(4, sched)!
    expect(releasedThroughWeek(sched, new Date(d.getTime() - 1))).toBe(3)
    expect(releasedThroughWeek(sched, d)).toBe(4)
  })
})

describe("buildWeekGate", () => {
  it("opens released weeks, dates scheduled ones, and gives a hidden one no date", () => {
    const gate = buildWeekGate(sched, [row(1), row(2), row(3, { visibility: "hidden" })], 4, at(0))
    expect([...gate.open]).toEqual([1])
    expect(gate.unavailable[2]).toEqual({ unlocksOn: at(7).toISOString() })
    expect(gate.unavailable[3]).toEqual({ unlocksOn: null })
    expect(gate.unavailable[4]).toEqual({ unlocksOn: at(21).toISOString() })
    expect(gate.locked).toEqual({})
  })
  it("locks a visible paid week without opening it", () => {
    const gate = buildWeekGate(
      noSched,
      [row(1), row(2, { access_type: "paid", payment_status: "pending", price_cents: 4000 })],
      2,
      at(0),
    )
    expect([...gate.open]).toEqual([1])
    expect(gate.locked).toEqual({ 2: { priceCents: 4000 } })
  })
  it("a scheduled paid week is unavailable, not locked — no price before it is out", () => {
    const gate = buildWeekGate(
      sched,
      [row(2, { access_type: "paid", payment_status: "pending", price_cents: 4000 })],
      2,
      at(0),
    )
    expect(gate.locked).toEqual({})
    expect(gate.unavailable[2]).toEqual({ unlocksOn: at(7).toISOString() })
  })
  it("a paused schedule gives scheduled weeks no date", () => {
    const gate = buildWeekGate({ release_base_week: 1, release_anchor_at: null }, [], 2, at(0))
    expect(gate.unavailable[2]).toEqual({ unlocksOn: null })
  })
  it("treats a week with no access row as included and auto", () => {
    expect([...buildWeekGate(noSched, [], 3, at(0)).open]).toEqual([1, 2, 3])
  })
})

describe("formatUnlockDate", () => {
  it("names the day in UTC so the server and the browser agree", () => {
    expect(formatUnlockDate("2026-10-19T23:30:00Z")).toBe("Monday, October 19")
  })
})

describe("releaseAnchorFor", () => {
  it("is the start date's midnight UTC when that is later than now", () => {
    expect(releaseAnchorFor("2026-10-12", at(0))).toBe("2026-10-12T00:00:00.000Z")
  })
  it("is now when the start date has passed", () => {
    expect(releaseAnchorFor("2026-10-01", at(0))).toBe(at(0).toISOString())
  })
})
