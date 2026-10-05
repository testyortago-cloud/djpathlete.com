// @vitest-environment node
// __tests__/api/client/workouts-week-gate.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const guardMock = vi.fn()
const ensureSessionMock = vi.fn()
const logProgressMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/services/access-guard", () => ({ assertAssignmentPayable: (...a: unknown[]) => guardMock(...a) }))
vi.mock("@/lib/db/workout-sessions", () => ({
  ensureSession: (...a: unknown[]) => ensureSessionMock(...a),
  setPrs: vi.fn(),
  finishSession: vi.fn(),
}))
vi.mock("@/lib/db/training-sessions", () => ({ upsert: vi.fn() }))
vi.mock("@/lib/db/progress", () => ({
  logProgress: (...a: unknown[]) => logProgressMock(...a),
  getProgress: vi.fn().mockResolvedValue([]),
  getWorkoutStreak: vi.fn().mockResolvedValue(0),
}))
vi.mock("@/lib/db/achievements", () => ({ createAchievement: vi.fn() }))
vi.mock("@/lib/db/exercises", () => ({ getExerciseById: vi.fn().mockResolvedValue({ name: "Squat" }) }))
vi.mock("@/lib/pr-detection", () => ({
  detectPRs: vi.fn().mockResolvedValue([]),
  checkStreakMilestones: vi.fn().mockResolvedValue(null),
  checkWorkoutMilestones: vi.fn().mockResolvedValue(null),
}))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: vi.fn() }))

import { POST as sessionPOST } from "@/app/api/client/workouts/session/route"
import { POST as logPOST } from "@/app/api/client/workouts/log/route"

const ASSIGNMENT = "22222222-2222-4222-8222-222222222222"
const EXERCISE = "11111111-1111-1111-8111-111111111111"

function sessionReq(week_number: number) {
  return new Request("http://localhost/api/client/workouts/session", {
    method: "POST",
    body: JSON.stringify({ assignment_id: ASSIGNMENT, week_number, day_of_week: 1, session_date: "2026-10-05" }),
  })
}
function logReq(week_number: number) {
  return new Request("http://localhost/api/client/workouts/log", {
    method: "POST",
    body: JSON.stringify({
      exercise_id: EXERCISE,
      assignment_id: ASSIGNMENT,
      sets_completed: 3,
      reps_completed: "10",
      weight_kg: 60,
      set_details: [{ set_number: 1, weight_kg: 60, reps: 10 }],
      week_number,
      day_of_week: 1,
      session_date: "2026-10-05",
    }),
  })
}

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ user: { id: "user-1" } })
  guardMock.mockReset()
  ensureSessionMock.mockReset().mockResolvedValue({ id: "ws-1", prs: null })
  logProgressMock.mockReset().mockResolvedValue({ id: "prog-1" })
})

describe("workout routes refuse a week the client cannot see", () => {
  it("session: 403 for an unreleased week, and nothing is created", async () => {
    guardMock.mockResolvedValue({ ok: false, reason: "not_released" })
    const res = await sessionPOST(sessionReq(4))
    expect(res.status).toBe(403)
    expect(guardMock).toHaveBeenCalledWith(ASSIGNMENT, 4)
    expect(ensureSessionMock).not.toHaveBeenCalled()
  })

  it("session: 200 for a visible week (presence control)", async () => {
    guardMock.mockResolvedValue({ ok: true })
    expect((await sessionPOST(sessionReq(1))).status).toBe(200)
  })

  it("session: payment still answers 402", async () => {
    guardMock.mockResolvedValue({ ok: false, reason: "payment" })
    expect((await sessionPOST(sessionReq(1))).status).toBe(402)
  })

  it("log: 403 for an unreleased week, and nothing is logged", async () => {
    guardMock.mockResolvedValue({ ok: false, reason: "not_released" })
    const res = await logPOST(logReq(4))
    expect(res.status).toBe(403)
    expect(guardMock).toHaveBeenCalledWith(ASSIGNMENT, 4)
    expect(logProgressMock).not.toHaveBeenCalled()
  })

  it("log: 201 for a visible week (presence control)", async () => {
    guardMock.mockResolvedValue({ ok: true })
    expect((await logPOST(logReq(1))).status).toBe(201)
  })
})
