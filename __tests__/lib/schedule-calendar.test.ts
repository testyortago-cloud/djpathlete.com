import { describe, it, expect } from "vitest"
import {
  addDaysISO,
  shiftMonthISO,
  weekStartOf,
  weekDays,
  monthGrid,
  calendarRange,
  timeToMinutes,
  hourRange,
  assignLanes,
} from "@/lib/schedule-calendar"

// Reference: 2026-07-05 is a Sunday; July 2026 starts on a Wednesday.

describe("addDaysISO", () => {
  it("adds days across month boundaries", () => {
    expect(addDaysISO("2026-07-05", 7)).toBe("2026-07-12")
    expect(addDaysISO("2026-07-30", 3)).toBe("2026-08-02")
  })

  it("subtracts days with a negative delta", () => {
    expect(addDaysISO("2026-07-01", -1)).toBe("2026-06-30")
  })
})

describe("shiftMonthISO", () => {
  it("shifts forward and backward a month", () => {
    expect(shiftMonthISO("2026-07-15", 1)).toBe("2026-08-15")
    expect(shiftMonthISO("2026-07-15", -1)).toBe("2026-06-15")
  })

  it("clamps to the last day of a shorter target month", () => {
    expect(shiftMonthISO("2026-01-31", 1)).toBe("2026-02-28")
    expect(shiftMonthISO("2026-03-31", -1)).toBe("2026-02-28")
  })

  it("crosses year boundaries", () => {
    expect(shiftMonthISO("2026-12-10", 1)).toBe("2027-01-10")
    expect(shiftMonthISO("2026-01-10", -1)).toBe("2025-12-10")
  })
})

describe("weekStartOf", () => {
  it("returns the Sunday of the containing week", () => {
    expect(weekStartOf("2026-07-08")).toBe("2026-07-05") // Wednesday → Sunday
    expect(weekStartOf("2026-07-11")).toBe("2026-07-05") // Saturday → Sunday
  })

  it("is a fixed point on a Sunday", () => {
    expect(weekStartOf("2026-07-05")).toBe("2026-07-05")
  })
})

describe("weekDays", () => {
  it("returns the 7 dates of the containing week, Sunday first", () => {
    const days = weekDays("2026-07-08")
    expect(days).toHaveLength(7)
    expect(days[0]).toBe("2026-07-05")
    expect(days[6]).toBe("2026-07-11")
  })
})

describe("monthGrid", () => {
  it("returns padded full weeks covering the anchor month", () => {
    const grid = monthGrid("2026-07-15")
    expect(grid).toHaveLength(5) // Jun 28 → Aug 1
    expect(grid[0][0]).toEqual({ date: "2026-06-28", inMonth: false })
    expect(grid[0][3]).toEqual({ date: "2026-07-01", inMonth: true })
    expect(grid[4][6]).toEqual({ date: "2026-08-01", inMonth: false })
    for (const week of grid) expect(week).toHaveLength(7)
  })

  it("flags only anchor-month days as inMonth", () => {
    const grid = monthGrid("2026-07-15")
    const inMonth = grid.flat().filter((c) => c.inMonth)
    expect(inMonth).toHaveLength(31)
    expect(inMonth[0].date).toBe("2026-07-01")
    expect(inMonth[30].date).toBe("2026-07-31")
  })
})

describe("calendarRange", () => {
  it("week view spans Sunday..Saturday of the anchor week", () => {
    expect(calendarRange("week", "2026-07-08")).toEqual({ from: "2026-07-05", to: "2026-07-11" })
  })

  it("month view spans the padded month grid", () => {
    expect(calendarRange("month", "2026-07-15")).toEqual({ from: "2026-06-28", to: "2026-08-01" })
  })

  it("list view spans 14 days from the anchor", () => {
    expect(calendarRange("list", "2026-07-05")).toEqual({ from: "2026-07-05", to: "2026-07-18" })
  })
})

describe("timeToMinutes", () => {
  it("converts HH:MM:SS to minutes since midnight", () => {
    expect(timeToMinutes("05:45:00")).toBe(345)
    expect(timeToMinutes("00:00:00")).toBe(0)
    expect(timeToMinutes("13:30")).toBe(810)
  })
})

describe("hourRange", () => {
  it("defaults to 6..19 with no sessions", () => {
    expect(hourRange([])).toEqual({ startHour: 6, endHour: 19 })
  })

  it("expands to include an early session", () => {
    expect(hourRange([{ start_time: "05:45:00", duration_minutes: 60 }])).toEqual({ startHour: 5, endHour: 19 })
  })

  it("expands to include a late-running session", () => {
    expect(hourRange([{ start_time: "19:30:00", duration_minutes: 60 }])).toEqual({ startHour: 6, endHour: 21 })
  })
})

describe("assignLanes", () => {
  it("puts non-overlapping sessions in a single lane", () => {
    const lanes = assignLanes([
      { id: "a", start_time: "05:45:00", duration_minutes: 60 },
      { id: "b", start_time: "08:00:00", duration_minutes: 60 },
    ])
    expect(lanes.get("a")).toEqual({ lane: 0, lanes: 1 })
    expect(lanes.get("b")).toEqual({ lane: 0, lanes: 1 })
  })

  it("gives same-slot sessions side-by-side lanes", () => {
    const lanes = assignLanes([
      { id: "a", start_time: "05:45:00", duration_minutes: 60 },
      { id: "b", start_time: "05:45:00", duration_minutes: 60 },
    ])
    expect(lanes.get("a")).toEqual({ lane: 0, lanes: 2 })
    expect(lanes.get("b")).toEqual({ lane: 1, lanes: 2 })
  })

  it("handles partial overlaps as one cluster", () => {
    const lanes = assignLanes([
      { id: "a", start_time: "05:45:00", duration_minutes: 60 }, // 5:45–6:45
      { id: "b", start_time: "06:00:00", duration_minutes: 60 }, // 6:00–7:00 overlaps a
      { id: "c", start_time: "06:50:00", duration_minutes: 30 }, // 6:50–7:20 overlaps b only
    ])
    expect(lanes.get("a")?.lanes).toBe(2)
    expect(lanes.get("b")?.lanes).toBe(2)
    expect(lanes.get("c")?.lanes).toBe(2)
    expect(lanes.get("b")?.lane).not.toBe(lanes.get("a")?.lane)
    expect(lanes.get("c")?.lane).toBe(lanes.get("a")?.lane) // reuses the freed lane
  })

  it("returns lane 0 of 1 for an out-of-order input (sorts internally)", () => {
    const lanes = assignLanes([
      { id: "late", start_time: "10:00:00", duration_minutes: 60 },
      { id: "early", start_time: "06:00:00", duration_minutes: 60 },
    ])
    expect(lanes.get("early")).toEqual({ lane: 0, lanes: 1 })
    expect(lanes.get("late")).toEqual({ lane: 0, lanes: 1 })
  })
})
