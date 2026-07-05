import { describe, it, expect, vi, beforeEach } from "vitest"

const flagMock = vi.fn()
const findMock = vi.fn()
const updateMock = vi.fn()

vi.mock("@/lib/packs/flags", () => ({ recurringSessionsEnabled: () => flagMock() }))
vi.mock("@/lib/db/recurring-sessions", () => ({ listActiveRecurringSessions: vi.fn() }))
vi.mock("@/lib/db/scheduled-sessions", () => ({
  upsertScheduledSession: vi.fn(),
  updateScheduledSession: (...a: unknown[]) => updateMock(...a),
  getScheduledById: vi.fn(),
  findScheduledForClientOnDate: (...a: unknown[]) => findMock(...a),
}))
vi.mock("@/lib/services/program-progression", () => ({
  handleAttendanceProgramAdvance: vi.fn(async () => ({ advanced: false })),
}))

import { bridgeCheckinToSchedule } from "@/lib/services/session-schedule"

const NOW = new Date("2026-07-06T06:00:00Z")

beforeEach(() => {
  vi.clearAllMocks()
  flagMock.mockResolvedValue(true)
  updateMock.mockResolvedValue({})
})

describe("bridgeCheckinToSchedule", () => {
  it("no-ops when the flag is off", async () => {
    flagMock.mockResolvedValue(false)
    await bridgeCheckinToSchedule("c1", "chk1", NOW)
    expect(findMock).not.toHaveBeenCalled()
  })

  it("marks today's scheduled session attended with the checkin id", async () => {
    findMock.mockResolvedValue({ id: "occ-1" })
    await bridgeCheckinToSchedule("c1", "chk1", NOW)
    expect(findMock).toHaveBeenCalledWith("c1", "2026-07-06")
    expect(updateMock).toHaveBeenCalledWith("occ-1", expect.objectContaining({ status: "attended", checkin_id: "chk1" }))
  })

  it("no-ops (no throw) when there is no scheduled session today", async () => {
    findMock.mockResolvedValue(null)
    await expect(bridgeCheckinToSchedule("c1", "chk1", NOW)).resolves.toBeUndefined()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("swallows errors so the check-in is never affected", async () => {
    findMock.mockRejectedValue(new Error("db down"))
    await expect(bridgeCheckinToSchedule("c1", "chk1", NOW)).resolves.toBeUndefined()
  })
})
