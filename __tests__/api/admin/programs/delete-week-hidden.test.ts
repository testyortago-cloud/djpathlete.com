// @vitest-environment node
// __tests__/api/admin/programs/delete-week-hidden.test.ts
// Remove Week renumbers every later week down by one, so the program's hidden
// weeks must move with them or the wrong week ends up hidden.
import { describe, it, expect, vi, beforeEach } from "vitest"

const getProgramById = vi.fn()
const updateProgram = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: vi.fn().mockResolvedValue({ user: { id: "admin-1", role: "admin" } }) }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: vi.fn().mockResolvedValue(true) }))
vi.mock("@/lib/db/programs", () => ({
  getProgramById: (...a: unknown[]) => getProgramById(...a),
  updateProgram: (...a: unknown[]) => updateProgram(...a),
}))
vi.mock("@/lib/db/assignments", () => ({
  getActiveAssignmentsForProgram: vi.fn().mockResolvedValue([]),
  updateAssignment: vi.fn(),
}))
vi.mock("@/lib/db/program-exercises", () => ({ deleteWeekExercises: vi.fn() }))
vi.mock("@/lib/db/week-access", () => ({ deleteWeekAccessForWeek: vi.fn(), shiftWeekAccessDown: vi.fn() }))

import { POST } from "@/app/api/admin/programs/[id]/delete-week/route"

const call = (weekNumber: number) =>
  POST(
    new Request("http://localhost/api/admin/programs/p1/delete-week", {
      method: "POST",
      body: JSON.stringify({ weekNumber }),
    }),
    { params: Promise.resolve({ id: "p1" }) },
  )

beforeEach(() => {
  getProgramById.mockReset().mockResolvedValue({ id: "p1", duration_weeks: 6, hidden_weeks: [2, 4, 6] })
  updateProgram.mockReset().mockResolvedValue({})
})

describe("POST delete-week with weeks hidden on the program", () => {
  it("drops the removed week from the hidden list and moves later ones down", async () => {
    const res = await call(4)
    expect(res.status).toBe(200)
    expect(updateProgram).toHaveBeenCalledWith("p1", { duration_weeks: 5, hidden_weeks: [2, 5] })
    expect(await res.json()).toEqual({ new_total_weeks: 5, hidden_weeks: [2, 5] })
  })
})
