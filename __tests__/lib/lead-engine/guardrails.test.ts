// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  resolveTimezone,
  quietHoursDefer,
  localDayBounds,
  dailyCapDefer,
  siblingRunDefer,
} from "@/lib/lead-engine/guardrails"

const QUIET = { startHour: 8, endHour: 21 }

describe("resolveTimezone", () => {
  it("prefers the contact's timezone", () => {
    expect(resolveTimezone("Europe/London", "America/New_York")).toBe("Europe/London")
  })
  it("falls back to the business timezone when the contact has none", () => {
    expect(resolveTimezone(null, "America/New_York")).toBe("America/New_York")
    expect(resolveTimezone(undefined, "America/New_York")).toBe("America/New_York")
    expect(resolveTimezone("", "America/New_York")).toBe("America/New_York")
  })
})

describe("quietHoursDefer", () => {
  it("allows a send in the middle of the local window", () => {
    // 15:00 UTC = 11:00 America/New_York (EDT, UTC-4 in August).
    expect(quietHoursDefer(new Date("2026-08-18T15:00:00Z"), "America/New_York", QUIET)).toBeNull()
  })

  it("blocks a send before the window opens and defers to the opening instant", () => {
    // 09:00 UTC = 05:00 America/New_York — before 08:00 local.
    const defer = quietHoursDefer(new Date("2026-08-18T09:00:00Z"), "America/New_York", QUIET)
    expect(defer).not.toBeNull()
    // 08:00 America/New_York on the same local day = 12:00 UTC.
    expect(defer!.toISOString()).toBe("2026-08-18T12:00:00.000Z")
  })

  it("blocks a send after the window closes and defers to tomorrow's opening", () => {
    // 02:00 UTC on the 19th = 22:00 on the 18th in New York — after 21:00.
    const defer = quietHoursDefer(new Date("2026-08-19T02:00:00Z"), "America/New_York", QUIET)
    expect(defer!.toISOString()).toBe("2026-08-19T12:00:00.000Z")
  })

  it("is timezone-sensitive: the same instant is allowed in one zone and blocked in another", () => {
    const instant = new Date("2026-08-18T05:00:00Z") // 06:00 London, 01:00 New York
    expect(quietHoursDefer(instant, "Europe/London", QUIET)).not.toBeNull() // 06:00 < 08:00
    expect(quietHoursDefer(instant, "Asia/Tokyo", QUIET)).toBeNull() // 14:00 — fine
  })

  it("handles a window that wraps midnight", () => {
    // Allowed 21:00 → 08:00. 23:00 local is inside it.
    const wrap = { startHour: 21, endHour: 8 }
    expect(quietHoursDefer(new Date("2026-08-19T03:00:00Z"), "America/New_York", wrap)).toBeNull()
  })

  it("blocks a daytime send under a wrapping window and defers to tonight's opening", () => {
    // Allowed 21:00 → 08:00, so 14:00 local is blocked (inside the gap).
    const wrap = { startHour: 21, endHour: 8 }
    // 18:00 UTC = 14:00 America/New_York (EDT, UTC-4).
    const defer = quietHoursDefer(new Date("2026-08-18T18:00:00Z"), "America/New_York", wrap)
    expect(defer).not.toBeNull()
    // 21:00 America/New_York on the same local day = 01:00 UTC the next day.
    expect(defer!.toISOString()).toBe("2026-08-19T01:00:00.000Z")
  })
})

describe("localDayBounds", () => {
  it("returns the UTC instants bracketing the contact's local calendar day", () => {
    // 2026-08-18T18:00:00Z is 14:00 on the 18th in New York (EDT, UTC-4).
    const bounds = localDayBounds(new Date("2026-08-18T18:00:00Z"), "America/New_York")
    // Local midnight opening the 18th = 04:00 UTC on the 18th.
    expect(bounds.start.toISOString()).toBe("2026-08-18T04:00:00.000Z")
    // Local midnight opening the 19th = 04:00 UTC on the 19th.
    expect(bounds.end.toISOString()).toBe("2026-08-19T04:00:00.000Z")
  })
})

describe("dailyCapDefer", () => {
  const tz = "America/New_York"
  const now = new Date("2026-08-18T18:00:00Z") // 14:00 local

  it("allows the first message of the local day", () => {
    expect(dailyCapDefer(now, tz, 1, [])).toBeNull()
  })

  it("blocks once the cap is reached today and defers to next local midnight", () => {
    const defer = dailyCapDefer(now, tz, 1, ["2026-08-18T13:00:00Z"]) // 09:00 local, same day
    expect(defer).not.toBeNull()
    expect(defer!.toISOString()).toBe("2026-08-19T04:00:00.000Z") // 00:00 local on the 19th
  })

  it("counts the LOCAL day, not the UTC day", () => {
    // 2026-08-18T02:00Z is 22:00 on the 17th in New York — a different local
    // day, so it must not count against the 18th's cap.
    expect(dailyCapDefer(now, tz, 1, ["2026-08-18T02:00:00Z"])).toBeNull()
  })

  it("honours a cap above one", () => {
    const two = ["2026-08-18T13:00:00Z", "2026-08-18T14:00:00Z"]
    expect(dailyCapDefer(now, tz, 3, two)).toBeNull()
    expect(dailyCapDefer(now, tz, 2, two)).not.toBeNull()
  })
})

describe("siblingRunDefer", () => {
  const now = new Date("2026-08-18T18:00:00Z")
  const mine = { id: "b", enrolled_at: "2026-08-10T00:00:00Z" }

  it("allows the oldest active run to send", () => {
    expect(siblingRunDefer(mine, [{ id: "c", enrolled_at: "2026-08-12T00:00:00Z" }], now)).toBeNull()
  })

  it("defers when an older sibling is active", () => {
    const defer = siblingRunDefer(mine, [{ id: "a", enrolled_at: "2026-08-01T00:00:00Z" }], now)
    expect(defer!.toISOString()).toBe("2026-08-18T18:05:00.000Z")
  })

  it("breaks an enrolled_at tie by id so the winner is stable", () => {
    const tie = { id: "a", enrolled_at: "2026-08-10T00:00:00Z" }
    expect(siblingRunDefer(mine, [tie], now)).not.toBeNull() // "a" < "b", so "a" wins
    expect(siblingRunDefer(tie, [mine], now)).toBeNull()
  })

  it("allows a run with no siblings", () => {
    expect(siblingRunDefer(mine, [], now)).toBeNull()
  })
})

// Local wall-clock reader for a Date, independent of guardrails.ts's private
// partsIn — used only to assert what an instant reads back as in a zone.
function localHM(instant: Date, tz: string): { day: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
  const p: Record<string, string> = {}
  for (const { type, value } of fmt.formatToParts(instant)) p[type] = value
  return { day: +p.day, hour: +p.hour, minute: +p.minute }
}

describe("utcForLocal DST edge cases (exercised via quietHoursDefer)", () => {
  it("snaps forward across a DST spring-forward gap instead of landing an hour early", () => {
    // 2026-03-08 America/New_York: clocks jump 02:00 -> 03:00 EDT, so no
    // instant reads back as 02:xx local that day. Ask for a window that
    // opens at 02:00 on that date and confirm the defer instant does not
    // silently land an hour early (01:00, the naive two-pass convergence
    // result) but snaps forward to the first valid local time at or after
    // 02:00 — 03:00 EDT, the moment the clocks jump.
    const nowUtc = new Date("2026-03-08T05:00:00Z") // 00:00 EST local — before the window opens
    const defer = quietHoursDefer(nowUtc, "America/New_York", { startHour: 2, endHour: 21 })
    expect(defer).not.toBeNull()
    const local = localHM(defer!, "America/New_York")
    expect(local).toEqual({ day: 8, hour: 3, minute: 0 })
    expect(defer!.toISOString()).toBe("2026-03-08T07:00:00.000Z")
  })

  it("pins a stable choice for an ambiguous (repeated) local hour on fall-back", () => {
    // 2026-11-01 America/New_York: clocks fall back 02:00 -> 01:00, so
    // 01:00 local occurs twice — once in EDT (UTC-4), once in EST (UTC-5).
    // Either choice is defensible; pin this implementation's actual choice
    // (the earlier, EDT occurrence, since the two-pass convergence's
    // UTC-anchored initial guess resolves within the pre-transition
    // instant for this case) so the behaviour is documented rather than
    // accidental.
    const nowUtc = new Date("2026-11-01T04:00:00Z") // 00:00 EDT local — before the window opens
    const defer = quietHoursDefer(nowUtc, "America/New_York", { startHour: 1, endHour: 21 })
    expect(defer).not.toBeNull()
    const local = localHM(defer!, "America/New_York")
    expect(local).toEqual({ day: 1, hour: 1, minute: 0 })
    expect(defer!.toISOString()).toBe("2026-11-01T05:00:00.000Z")
  })
})
