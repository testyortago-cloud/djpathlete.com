import { describe, it, expect, vi, beforeEach } from "vitest"

const listActiveMock = vi.fn()
const upsertMock = vi.fn()
const updateMock = vi.fn()
const getByIdMock = vi.fn()

vi.mock("@/lib/db/recurring-sessions", () => ({
  listActiveRecurringSessions: (...a: unknown[]) => listActiveMock(...a),
}))
vi.mock("@/lib/db/scheduled-sessions", () => ({
  upsertScheduledSession: (...a: unknown[]) => upsertMock(...a),
  updateScheduledSession: (...a: unknown[]) => updateMock(...a),
  getScheduledById: (...a: unknown[]) => getByIdMock(...a),
}))
vi.mock("@/lib/services/session-fees", () => ({ chargeLateCancelFee: vi.fn(), chargeNoShowFee: vi.fn() }))
vi.mock("@/lib/packs/flags", () => ({ recurringSessionsEnabled: vi.fn(async () => true) }))
const advanceMock = vi.fn(async (..._args: unknown[]) => ({ advanced: false }))
vi.mock("@/lib/services/program-progression", () => ({
  handleAttendanceProgramAdvance: (...a: unknown[]) => advanceMock(...a),
}))

import {
  ensureUpcomingSessions,
  markAttended,
  markNoShow,
  cancelSession,
  rescheduleSession,
  reassignSession,
  addAdhocSession,
} from "@/lib/services/session-schedule"

beforeEach(() => {
  vi.clearAllMocks()
  upsertMock.mockResolvedValue({ id: "new" })
  updateMock.mockImplementation(async (id: string, patch: Record<string, unknown>) => ({ id, ...patch }))
})

describe("ensureUpcomingSessions", () => {
  it("generates one scheduled session per matching weekday in the horizon (idempotent upsert)", async () => {
    listActiveMock.mockResolvedValue([
      { id: "slot1", client_user_id: "c1", day_of_week: 1, start_time: "05:45:00", duration_minutes: 60 },
    ])
    // Sun 2026-07-05 + 14 days → Mondays 07-06 and 07-13
    await ensureUpcomingSessions(new Date("2026-07-05T00:00:00Z"), 14)
    const dates = upsertMock.mock.calls.map((c) => c[0].session_date)
    expect(dates).toEqual(["2026-07-06", "2026-07-13"])
    expect(upsertMock.mock.calls[0][0]).toMatchObject({
      client_user_id: "c1",
      recurring_session_id: "slot1",
      start_time: "05:45:00",
      status: "scheduled",
    })
  })
})

describe("attendance transitions", () => {
  it("markAttended sets status attended + links the checkin", async () => {
    await markAttended("s1", { by: "coach", checkinId: "chk1" })
    expect(updateMock).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ status: "attended", checkin_id: "chk1" }),
    )
  })

  it("markAttended advances the slot-linked program with the updated row", async () => {
    await markAttended("s1", { by: "coach" })
    expect(advanceMock).toHaveBeenCalledWith(expect.objectContaining({ id: "s1", status: "attended" }))
  })

  it("markAttended still resolves when the program advance throws (swallowed)", async () => {
    advanceMock.mockRejectedValueOnce(new Error("progression down"))
    await expect(markAttended("s1", { by: "coach" })).resolves.toMatchObject({ status: "attended" })
  })

  it("markNoShow sets status no_show", async () => {
    await markNoShow("s1", "coach")
    expect(updateMock).toHaveBeenCalledWith("s1", expect.objectContaining({ status: "no_show" }))
  })

  it("cancelSession sets status cancelled + reason", async () => {
    getByIdMock.mockResolvedValue({ id: "s1", session_date: "2026-07-06", start_time: "05:45:00" })
    await cancelSession("s1", { by: "coach", reason: "sick", now: new Date("2026-07-05T00:00:00Z") })
    expect(updateMock).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ status: "cancelled", cancel_reason: "sick" }),
    )
  })

  it("rescheduleSession moves date + time", async () => {
    await rescheduleSession("s1", { date: "2026-07-08", time: "06:00:00" })
    expect(updateMock).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ session_date: "2026-07-08", start_time: "06:00:00" }),
    )
  })

  it("reassignSession moves the occurrence to another client", async () => {
    await reassignSession("s1", "c2")
    expect(updateMock).toHaveBeenCalledWith("s1", expect.objectContaining({ client_user_id: "c2" }))
  })

  it("addAdhocSession upserts an unlinked scheduled occurrence", async () => {
    await addAdhocSession({
      client_user_id: "c1",
      session_date: "2026-07-07",
      start_time: "07:00:00",
      duration_minutes: 45,
      created_by: "coach",
    })
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ client_user_id: "c1", recurring_session_id: null, status: "scheduled" }),
    )
  })
})
