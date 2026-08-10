import { describe, it, expect, vi, beforeEach } from "vitest"

const updateSpy = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        updateSpy(payload)
        return {
          // completeForCheckin awaits this object directly; finishSession chains on.
          error: null,
          eq: () => ({
            error: null,
            select: () => ({ single: async () => ({ data: { id: "ws-1", ...payload }, error: null }) }),
          }),
        }
      },
    }),
  }),
}))

import { finishSession, completeForCheckin } from "@/lib/db/workout-sessions"

beforeEach(() => updateSpy.mockReset())

/**
 * A row is unique per (user, assignment, week, day) — repeating a week finishes the
 * SAME row. If the finish doesn't re-stamp session_date, the streak (which reads
 * session_date) sees a months-old date for a workout done today.
 */
describe("workout session completion re-stamps the date", () => {
  it("writes the supplied session_date when finishing", async () => {
    await finishSession("ws-1", {
      session_rpe: 8,
      volume_load_kg: 1200,
      duration_seconds: null,
      session_date: "2026-08-10",
    })
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ session_date: "2026-08-10", status: "completed", session_rpe: 8 }),
    )
  })

  it("leaves session_date untouched when the caller doesn't supply one", async () => {
    await finishSession("ws-1", { session_rpe: 8, volume_load_kg: null, duration_seconds: null })
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy.mock.calls[0][0]).not.toHaveProperty("session_date")
  })

  it("stamps the check-in's date when completing from an in-person check-in", async () => {
    await completeForCheckin("ws-1", "Checked in", "2026-08-10")
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ session_date: "2026-08-10", status: "completed", notes: "Checked in" }),
    )
  })

  it("leaves session_date untouched for a check-in with no date", async () => {
    await completeForCheckin("ws-1", "Checked in")
    expect(updateSpy.mock.calls[0][0]).not.toHaveProperty("session_date")
  })
})
