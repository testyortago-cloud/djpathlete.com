// @vitest-environment node
// __tests__/api/client/complete-week-shown-week.test.ts
//
// Workouts opens on the week after the last one the client trained (resumeWeek), which
// can be ahead of program_assignments.current_week. "Complete week" must act on that
// shown week: checking and advancing the stored week instead refused a client whose
// stored week was hidden, and moved current_week to a week behind the one on screen.
import { describe, it, expect, vi, beforeEach } from "vitest"

const getAssignmentById = vi.fn()
const advanceWeek = vi.fn()
const guard = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: vi.fn().mockResolvedValue({ user: { id: "u1" } }) }))
vi.mock("@/lib/db/assignments", () => ({
  getAssignmentById: (...a: unknown[]) => getAssignmentById(...a),
  advanceWeek: (...a: unknown[]) => advanceWeek(...a),
}))
vi.mock("@/lib/services/access-guard", () => ({ assertAssignmentPayable: (...a: unknown[]) => guard(...a) }))
vi.mock("@/lib/db/programs", () => ({ getProgramById: vi.fn() }))
vi.mock("@/lib/db/users", () => ({ getUserById: vi.fn() }))
vi.mock("@/lib/db/notifications", () => ({ createNotification: vi.fn() }))
vi.mock("@/lib/email", () => ({
  sendCoachProgramCompletedNotification: vi.fn(),
  sendReassessmentReminderEmail: vi.fn(),
}))

import { POST } from "@/app/api/client/workouts/complete-week/route"

const A = "00000000-0000-4000-8000-000000000001"
const call = (body: Record<string, unknown>) =>
  POST(
    new Request("http://localhost/api/client/workouts/complete-week", { method: "POST", body: JSON.stringify(body) }),
  )

beforeEach(() => {
  getAssignmentById
    .mockReset()
    .mockResolvedValue({ user_id: "u1", status: "active", current_week: 1, program_id: "p1" })
  advanceWeek.mockReset().mockResolvedValue({ program_completed: false })
  guard.mockReset().mockResolvedValue({ ok: true })
})

describe("POST /api/client/workouts/complete-week", () => {
  it("checks and advances the week the client was shown when it is ahead of current_week", async () => {
    const res = await call({ assignmentId: A, weekNumber: 3 })
    expect(res.status).toBe(200)
    expect(guard).toHaveBeenCalledWith(A, 3)
    expect(advanceWeek).toHaveBeenCalledWith(A, 3)
  })

  it("never goes behind current_week (a stale page sending an older week)", async () => {
    getAssignmentById.mockResolvedValue({ user_id: "u1", status: "active", current_week: 4, program_id: "p1" })
    await call({ assignmentId: A, weekNumber: 2 })
    expect(guard).toHaveBeenCalledWith(A, 4)
    expect(advanceWeek).toHaveBeenCalledWith(A, 4)
  })

  it("falls back to current_week when an older page sends no week", async () => {
    await call({ assignmentId: A })
    expect(guard).toHaveBeenCalledWith(A, 1)
    expect(advanceWeek).toHaveBeenCalledWith(A, 1)
  })

  it("refuses a shown week the client cannot see, and advances nothing", async () => {
    guard.mockResolvedValue({ ok: false, reason: "not_released" })
    const res = await call({ assignmentId: A, weekNumber: 3 })
    expect(res.status).toBe(403)
    expect(advanceWeek).not.toHaveBeenCalled()
  })

  it("400s a week that is not a positive whole number", async () => {
    expect((await call({ assignmentId: A, weekNumber: 0 })).status).toBe(400)
    expect(advanceWeek).not.toHaveBeenCalled()
  })
})
