import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const ensureSessionMock = vi.fn()
const logProgressMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/workout-sessions", () => ({
  ensureSession: (...a: unknown[]) => ensureSessionMock(...a),
}))
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
vi.mock("@/lib/services/access-guard", () => ({ assertAssignmentPayable: vi.fn().mockResolvedValue({ ok: true }) }))

import { POST } from "@/app/api/client/workouts/log/route"

const EXERCISE = "11111111-1111-1111-8111-111111111111"
const ASSIGNMENT = "22222222-2222-4222-8222-222222222222"

function req(body: Record<string, unknown>) {
  return new Request("http://localhost/api/client/workouts/log", {
    method: "POST",
    body: JSON.stringify({
      exercise_id: EXERCISE,
      assignment_id: ASSIGNMENT,
      sets_completed: 3,
      reps_completed: "10",
      weight_kg: 60,
      set_details: [{ set_number: 1, weight_kg: 60, reps: 10 }],
      ...body,
    }),
  })
}

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ user: { id: "user-1" } })
  ensureSessionMock.mockReset().mockResolvedValue({ id: "ws-1" })
  logProgressMock.mockReset().mockResolvedValue({ id: "prog-1" })
})

describe("POST /api/client/workouts/log — session linkage", () => {
  it("rolls the set up to the day's session and stamps session_id on the log", async () => {
    const res = await POST(req({ week_number: 3, day_of_week: 2, session_date: "2026-08-10" }))
    expect(res.status).toBe(201)

    expect(ensureSessionMock).toHaveBeenCalledWith({
      user_id: "user-1",
      assignment_id: ASSIGNMENT,
      week_number: 3,
      day_of_week: 2,
      session_date: "2026-08-10",
    })
    expect(logProgressMock.mock.calls[0][0]).toMatchObject({ session_id: "ws-1" })
  })

  it("honours the client's local date rather than stamping the session in UTC", async () => {
    // 2026-08-10 23:30 in Tampa is already 2026-08-11 in UTC — an evening workout
    // must not land on tomorrow's date, or the streak reads a day the client didn't train.
    vi.setSystemTime(new Date("2026-08-11T03:30:00Z"))
    try {
      await POST(req({ week_number: 1, day_of_week: 1, session_date: "2026-08-10" }))
      expect(ensureSessionMock).toHaveBeenCalledWith(expect.objectContaining({ session_date: "2026-08-10" }))
    } finally {
      vi.useRealTimers()
    }
  })

  it("still logs (unlinked) when the caller sends no week/day", async () => {
    const res = await POST(req({}))
    expect(res.status).toBe(201)
    expect(ensureSessionMock).not.toHaveBeenCalled()
    expect(logProgressMock.mock.calls[0][0]).toMatchObject({ session_id: null })
  })

  it("logs the set even when the session lookup blows up", async () => {
    ensureSessionMock.mockRejectedValue(new Error("db down"))
    const res = await POST(req({ week_number: 1, day_of_week: 1, session_date: "2026-08-10" }))
    expect(res.status).toBe(201)
    expect(logProgressMock.mock.calls[0][0]).toMatchObject({ session_id: null })
  })
})
