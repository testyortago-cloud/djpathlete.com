import { describe, it, expect } from "vitest"
import { datesForSlot, scanNoShows } from "@/lib/services/session-schedule"

describe("datesForSlot", () => {
  it("returns only the matching weekday's dates within the inclusive range", () => {
    // Mondays (day_of_week 1) between Sun 2026-07-05 and Sun 2026-07-19.
    const dates = datesForSlot({ day_of_week: 1 }, new Date("2026-07-05T00:00:00Z"), new Date("2026-07-19T00:00:00Z"))
    expect(dates).toEqual(["2026-07-06", "2026-07-13"])
  })

  it("returns empty when no matching weekday falls in the range", () => {
    // No Sunday (0) between Mon and Fri.
    const dates = datesForSlot({ day_of_week: 0 }, new Date("2026-07-06T00:00:00Z"), new Date("2026-07-10T00:00:00Z"))
    expect(dates).toEqual([])
  })

  it("includes the endpoints when they match", () => {
    const dates = datesForSlot({ day_of_week: 1 }, new Date("2026-07-06T00:00:00Z"), new Date("2026-07-06T00:00:00Z"))
    expect(dates).toEqual(["2026-07-06"])
  })
})

describe("scanNoShows", () => {
  const now = new Date("2026-07-03T00:00:00Z")
  const base = { duration_minutes: 60 }

  it("flags a past scheduled session beyond the buffer", () => {
    const ids = scanNoShows(
      [{ id: "past", session_date: "2026-07-02", start_time: "05:45:00", status: "scheduled", ...base }],
      now,
      60,
    )
    expect(ids).toEqual(["past"])
  })

  it("excludes attended, cancelled, future, and within-buffer sessions", () => {
    const ids = scanNoShows(
      [
        { id: "attended", session_date: "2026-07-02", start_time: "05:45:00", status: "attended", ...base },
        { id: "cancelled", session_date: "2026-07-02", start_time: "05:45:00", status: "cancelled", ...base },
        { id: "future", session_date: "2026-07-03", start_time: "23:00:00", status: "scheduled", ...base },
        // ends 00:30 on 07-03; +60min buffer = 01:30 > now 00:00 → not yet past
        { id: "within_buffer", session_date: "2026-07-02", start_time: "23:30:00", status: "scheduled", ...base },
      ],
      now,
      60,
    )
    expect(ids).toEqual([])
  })
})
