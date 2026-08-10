import { describe, it, expect, vi, beforeEach } from "vitest"

const getSlotMock = vi.fn()
const getAssignmentMock = vi.fn()
const hasCompletedMock = vi.fn()
const getDaySlotsMock = vi.fn()
const listCompletedKeysMock = vi.fn()
const ensureSessionMock = vi.fn()
const completeForCheckinMock = vi.fn()
const updateAssignmentMock = vi.fn()
const updateScheduledMock = vi.fn()

vi.mock("@/lib/db/recurring-sessions", () => ({ getRecurringSessionById: (...a: unknown[]) => getSlotMock(...a) }))
vi.mock("@/lib/db/assignments", () => ({
  getAssignmentById: (...a: unknown[]) => getAssignmentMock(...a),
  updateAssignment: (...a: unknown[]) => updateAssignmentMock(...a),
}))
vi.mock("@/lib/db/workout-sessions", () => ({
  hasCompletedOnDate: (...a: unknown[]) => hasCompletedMock(...a),
  ensureSession: (...a: unknown[]) => ensureSessionMock(...a),
  completeForCheckin: (...a: unknown[]) => completeForCheckinMock(...a),
  reopenForVoid: vi.fn(),
  listCompletedDayKeys: (...a: unknown[]) => listCompletedKeysMock(...a),
}))
vi.mock("@/lib/db/program-exercises", () => ({ getProgramDaySlots: (...a: unknown[]) => getDaySlotsMock(...a) }))
vi.mock("@/lib/db/scheduled-sessions", () => ({ updateScheduledSession: (...a: unknown[]) => updateScheduledMock(...a) }))
vi.mock("@/lib/db/session-checkins", () => ({ setWorkoutSession: vi.fn() }))
vi.mock("@/lib/db/programs", () => ({ getProgramById: vi.fn(async () => ({ id: "p1", name: "Comeback Code" })) }))
vi.mock("@/lib/db/users", () => ({ getUserById: vi.fn(async () => null) }))
vi.mock("@/lib/db/notifications", () => ({ createNotification: vi.fn(async () => ({})) }))
vi.mock("@/lib/email", () => ({
  sendCoachProgramCompletedNotification: vi.fn(async () => undefined),
  sendReassessmentReminderEmail: vi.fn(async () => undefined),
}))

import { handleAttendanceProgramAdvance } from "@/lib/services/program-progression"

const occurrence = {
  id: "occ-1",
  client_user_id: "c1",
  recurring_session_id: "slot-1",
  session_date: "2026-07-06",
}

beforeEach(() => {
  vi.clearAllMocks()
  getSlotMock.mockResolvedValue({ id: "slot-1", client_user_id: "c1", assignment_id: "asg-1" })
  getAssignmentMock.mockResolvedValue({ id: "asg-1", user_id: "c1", program_id: "p1", status: "active", current_week: 1 })
  hasCompletedMock.mockResolvedValue(false)
  getDaySlotsMock.mockResolvedValue([
    { week_number: 1, day_of_week: 1 },
    { week_number: 1, day_of_week: 3 },
  ])
  listCompletedKeysMock.mockResolvedValue([])
  ensureSessionMock.mockResolvedValue({ id: "ws-1" })
  completeForCheckinMock.mockResolvedValue(undefined)
  updateAssignmentMock.mockResolvedValue({})
  updateScheduledMock.mockResolvedValue({})
})

describe("handleAttendanceProgramAdvance", () => {
  it("no-ops for an ad-hoc occurrence (no slot)", async () => {
    const r = await handleAttendanceProgramAdvance({ ...occurrence, recurring_session_id: null })
    expect(r.advanced).toBe(false)
    expect(getSlotMock).not.toHaveBeenCalled()
    expect(ensureSessionMock).not.toHaveBeenCalled()
  })

  it("no-ops when the slot has no linked assignment", async () => {
    getSlotMock.mockResolvedValue({ id: "slot-1", client_user_id: "c1", assignment_id: null })
    const r = await handleAttendanceProgramAdvance(occurrence)
    expect(r.advanced).toBe(false)
    expect(getAssignmentMock).not.toHaveBeenCalled()
  })

  it("no-ops when the assignment is missing or inactive", async () => {
    getAssignmentMock.mockResolvedValue({ id: "asg-1", user_id: "c1", program_id: "p1", status: "completed" })
    const r = await handleAttendanceProgramAdvance(occurrence)
    expect(r.advanced).toBe(false)
    expect(ensureSessionMock).not.toHaveBeenCalled()
  })

  it("no-ops for a reassigned occurrence (someone else attended this slot)", async () => {
    const r = await handleAttendanceProgramAdvance({ ...occurrence, client_user_id: "other-client" })
    expect(r.advanced).toBe(false)
    expect(ensureSessionMock).not.toHaveBeenCalled()
  })

  it("no-ops when a completed workout already exists for the date (day guard)", async () => {
    hasCompletedMock.mockResolvedValue(true)
    const r = await handleAttendanceProgramAdvance(occurrence)
    expect(r.advanced).toBe(false)
    expect(ensureSessionMock).not.toHaveBeenCalled()
  })

  it("advances the next incomplete day and stamps workout_session_id on the occurrence", async () => {
    const r = await handleAttendanceProgramAdvance(occurrence)
    expect(r.advanced).toBe(true)
    expect(ensureSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "c1", assignment_id: "asg-1", week_number: 1, day_of_week: 1, session_date: "2026-07-06" }),
    )
    expect(completeForCheckinMock).toHaveBeenCalledWith("ws-1", expect.any(String), "2026-07-06")
    expect(updateScheduledMock).toHaveBeenCalledWith("occ-1", { workout_session_id: "ws-1" })
    expect(updateAssignmentMock).toHaveBeenCalledWith("asg-1", { current_week: 1 })
  })

  it("marks the program completed when the last day is done", async () => {
    listCompletedKeysMock.mockResolvedValue(["1-1"]) // only 1-3 remains
    const r = await handleAttendanceProgramAdvance(occurrence)
    expect(r.advanced).toBe(true)
    expect(updateAssignmentMock).toHaveBeenCalledWith("asg-1", { status: "completed", current_week: 1 })
  })
})
