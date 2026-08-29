import { describe, it, expect } from "vitest"
import { monthBounds, monthOf, rollUpAttendance } from "@/lib/services/attendance-view"
import type { SessionCheckin } from "@/types/database"
import type { ArrangementWithUser } from "@/lib/db/attendance-arrangements"

function arrangement(id: string, first: string, over: Partial<ArrangementWithUser> = {}): ArrangementWithUser {
  return {
    id,
    client_user_id: `u-${id}`,
    label: "Riverside Tennis Club",
    session_type: "in_person",
    status: "active",
    started_on: "2026-08-01",
    ended_on: null,
    notes: null,
    created_by: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    users: { id: `u-${id}`, first_name: first, last_name: "Smith", email: `${first}@example.com` },
    ...over,
  }
}

function checkin(arrangementId: string | null, over: Partial<SessionCheckin> = {}): SessionCheckin {
  return {
    id: `ck-${Math.random()}`,
    client_package_id: null,
    arrangement_id: arrangementId,
    client_user_id: "u-1",
    checked_in_at: "2026-08-10T15:00:00Z",
    session_date: "2026-08-10",
    method: "coach_tap",
    credit_delta: 0,
    voided: false,
    voided_reason: null,
    voided_by: null,
    voided_at: null,
    calendar_event_id: null,
    workout_session_id: null,
    created_by: "coach",
    notes: null,
    created_at: "2026-08-10T15:00:00Z",
    ...over,
  }
}

describe("monthBounds", () => {
  it("spans a 31-day month", () => {
    expect(monthBounds("2026-08")).toEqual({ from: "2026-08-01", to: "2026-08-31" })
  })

  it("spans a 30-day month", () => {
    expect(monthBounds("2026-09")).toEqual({ from: "2026-09-01", to: "2026-09-30" })
  })

  it("gets February right in a non-leap year", () => {
    expect(monthBounds("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" })
  })

  it("gets February right in a leap year", () => {
    expect(monthBounds("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" })
  })

  it("spans December without rolling into the next year", () => {
    expect(monthBounds("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" })
  })

  it("rejects a malformed month", () => {
    expect(() => monthBounds("2026-8")).toThrow()
    expect(() => monthBounds("not-a-month")).toThrow()
    expect(() => monthBounds("2026-13")).toThrow()
    expect(() => monthBounds("2026-00")).toThrow()
  })
})

describe("monthOf", () => {
  it("reads the month off a date-only string", () => {
    expect(monthOf("2026-08-10")).toBe("2026-08")
  })

  it("reads the month off a Date", () => {
    expect(monthOf(new Date("2026-08-10T23:00:00Z"))).toBe("2026-08")
  })
})

describe("rollUpAttendance", () => {
  it("counts each check-in separately when one client has several", () => {
    // Guards the dedupe trap: two sessions on ONE arrangement is 2, not 1.
    const a = arrangement("a1", "Ana")
    const view = rollUpAttendance([a], [checkin("a1"), checkin("a1"), checkin("a1")])
    expect(view.rows).toHaveLength(1)
    expect(view.rows[0].sessions).toBe(3)
    expect(view.total).toBe(3)
  })

  it("keeps two clients' counts apart", () => {
    const view = rollUpAttendance(
      [arrangement("a1", "Ana"), arrangement("a2", "Ben")],
      [checkin("a1"), checkin("a1"), checkin("a2")],
    )
    expect(view.rows.find((r) => r.name === "Ana Smith")?.sessions).toBe(2)
    expect(view.rows.find((r) => r.name === "Ben Smith")?.sessions).toBe(1)
    expect(view.total).toBe(3)
  })

  it("gives a client with no sessions a row at zero rather than dropping them", () => {
    const view = rollUpAttendance([arrangement("a1", "Ana"), arrangement("a2", "Ben")], [checkin("a1")])
    // Presence control: the list is 2 long, so "Ben is 0" is a real assertion
    // and not just an empty render passing.
    expect(view.rows).toHaveLength(2)
    expect(view.rows.find((r) => r.name === "Ben Smith")?.sessions).toBe(0)
    expect(view.total).toBe(1)
  })

  it("excludes a voided check-in from the count", () => {
    const view = rollUpAttendance([arrangement("a1", "Ana")], [checkin("a1"), checkin("a1", { voided: true })])
    expect(view.rows[0].sessions).toBe(1)
    expect(view.total).toBe(1)
  })

  it("ignores a pack check-in that carries no arrangement", () => {
    const view = rollUpAttendance(
      [arrangement("a1", "Ana")],
      [checkin("a1"), checkin(null, { client_package_id: "p1", credit_delta: -1 })],
    )
    expect(view.rows[0].sessions).toBe(1)
    expect(view.total).toBe(1)
  })

  it("still counts an arrangement that has since ended", () => {
    // It was ended mid-month, but the facility still owes for what it recorded.
    const ended = arrangement("a2", "Ben", { status: "ended", ended_on: "2026-08-20" })
    const view = rollUpAttendance([arrangement("a1", "Ana"), ended], [checkin("a1"), checkin("a2"), checkin("a2")])
    expect(view.rows.find((r) => r.name === "Ben Smith")?.sessions).toBe(2)
    expect(view.rows.find((r) => r.name === "Ben Smith")?.status).toBe("ended")
    expect(view.total).toBe(3)
  })

  it("totals what the rows show, ignoring an orphaned check-in", () => {
    // A check-in whose arrangement isn't supplied must not inflate a total that
    // nothing on screen accounts for.
    const view = rollUpAttendance([arrangement("a1", "Ana")], [checkin("a1"), checkin("ghost")])
    expect(view.total).toBe(1)
    expect(view.rows.reduce((n, r) => n + r.sessions, 0)).toBe(view.total)
  })

  it("sorts busiest first, then by name", () => {
    const view = rollUpAttendance(
      [arrangement("a1", "Zoe"), arrangement("a2", "Ana"), arrangement("a3", "Ben")],
      [checkin("a3"), checkin("a3")],
    )
    expect(view.rows.map((r) => r.name)).toEqual(["Ben Smith", "Ana Smith", "Zoe Smith"])
  })
})
