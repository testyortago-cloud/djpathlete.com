import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const flagMock = vi.fn()
const createSlotMock = vi.fn()
const ensureMock = vi.fn()
const listRangeMock = vi.fn()
const markAttendedMock = vi.fn()
const markNoShowMock = vi.fn()
const cancelMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/packs/flags", () => ({ recurringSessionsEnabled: () => flagMock() }))
vi.mock("@/lib/db/recurring-sessions", () => ({ createRecurringSession: (...a: unknown[]) => createSlotMock(...a) }))
vi.mock("@/lib/db/scheduled-sessions", () => ({ listScheduledInRange: (...a: unknown[]) => listRangeMock(...a) }))
vi.mock("@/lib/services/session-schedule", () => ({
  ensureUpcomingSessions: (...a: unknown[]) => ensureMock(...a),
  markAttended: (...a: unknown[]) => markAttendedMock(...a),
  markNoShow: (...a: unknown[]) => markNoShowMock(...a),
  cancelSession: (...a: unknown[]) => cancelMock(...a),
  rescheduleSession: vi.fn(),
  reassignSession: vi.fn(),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { POST as createSlot, GET as getRange } from "@/app/api/admin/sessions/route"
import { PATCH as occurrence } from "@/app/api/admin/sessions/occurrence/[id]/route"

const CLIENT = "11111111-1111-4111-8111-111111111111"
const post = (url: string, b: Record<string, unknown>) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) })
const patch = (url: string, b: Record<string, unknown>) =>
  new Request(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(b) })

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "coach-1", role: "admin" } })
  flagMock.mockResolvedValue(true)
  createSlotMock.mockImplementation(async (s) => ({ id: "slot-1", ...s }))
  listRangeMock.mockResolvedValue([])
})

describe("POST /api/admin/sessions (create slot)", () => {
  it("rejects non-admins", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await createSlot(post("http://x/api/admin/sessions", { clientUserId: CLIENT, dayOfWeek: 1, startTime: "05:45" }))).status).toBe(403)
  })

  it("403 when the flag is off", async () => {
    flagMock.mockResolvedValue(false)
    expect((await createSlot(post("http://x/api/admin/sessions", { clientUserId: CLIENT, dayOfWeek: 1, startTime: "05:45" }))).status).toBe(403)
  })

  it("creates a standing slot", async () => {
    const res = await createSlot(post("http://x/api/admin/sessions", { clientUserId: CLIENT, dayOfWeek: 1, startTime: "05:45", durationMinutes: 60 }))
    expect(res.status).toBe(201)
    expect(createSlotMock).toHaveBeenCalledWith(
      expect.objectContaining({ client_user_id: CLIENT, day_of_week: 1, start_time: "05:45", status: "active" }),
    )
  })
})

describe("GET /api/admin/sessions (range)", () => {
  it("generates upcoming then returns the range", async () => {
    const res = await getRange(new Request("http://x/api/admin/sessions?from=2026-07-06&to=2026-07-20"))
    expect(res.status).toBe(200)
    expect(ensureMock).toHaveBeenCalled()
    expect(listRangeMock).toHaveBeenCalledWith("2026-07-06", "2026-07-20")
  })
})

describe("PATCH /api/admin/sessions/occurrence/[id]", () => {
  const ctx = { params: Promise.resolve({ id: "occ-1" }) }

  it("marks attended", async () => {
    const res = await occurrence(patch("http://x/api/admin/sessions/occurrence/occ-1", { action: "attended" }), ctx)
    expect(res.status).toBe(200)
    expect(markAttendedMock).toHaveBeenCalledWith("occ-1", expect.objectContaining({ by: "coach-1" }))
  })

  it("marks no_show", async () => {
    await occurrence(patch("http://x/api/admin/sessions/occurrence/occ-1", { action: "no_show" }), ctx)
    expect(markNoShowMock).toHaveBeenCalledWith("occ-1", "coach-1")
  })

  it("cancels with a reason", async () => {
    await occurrence(patch("http://x/api/admin/sessions/occurrence/occ-1", { action: "cancel", reason: "sick" }), ctx)
    expect(cancelMock).toHaveBeenCalledWith("occ-1", expect.objectContaining({ reason: "sick" }))
  })

  it("403 for non-admins", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await occurrence(patch("http://x/api/admin/sessions/occurrence/occ-1", { action: "attended" }), ctx)).status).toBe(403)
  })
})
