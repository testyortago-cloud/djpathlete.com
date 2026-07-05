import { describe, it, expect, vi, beforeEach } from "vitest"

const limitMock = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                limit: (...a: unknown[]) => limitMock(...a),
              }),
            }),
          }),
        }),
      }),
    }),
  }),
}))

import { hasCompletedOnDate } from "@/lib/db/workout-sessions"

beforeEach(() => vi.clearAllMocks())

describe("hasCompletedOnDate", () => {
  it("true when a completed session exists for the (user, assignment, date)", async () => {
    limitMock.mockResolvedValue({ data: [{ id: "ws-1" }], error: null })
    await expect(hasCompletedOnDate("u1", "a1", "2026-07-06")).resolves.toBe(true)
  })

  it("false when none exists", async () => {
    limitMock.mockResolvedValue({ data: [], error: null })
    await expect(hasCompletedOnDate("u1", "a1", "2026-07-06")).resolves.toBe(false)
  })

  it("true on a read error (a flaky read may only SKIP an advance, never double it)", async () => {
    limitMock.mockResolvedValue({ data: null, error: { message: "boom" } })
    await expect(hasCompletedOnDate("u1", "a1", "2026-07-06")).resolves.toBe(true)
  })
})
