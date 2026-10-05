// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const duplicateWeekExercises = vi.fn()
const auth = vi.fn()
const canAccessAdminPath = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: (...a: unknown[]) => auth(...a) }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: (...a: unknown[]) => canAccessAdminPath(...a) }))
vi.mock("@/lib/db/program-exercises", () => ({
  duplicateWeekExercises: (...a: unknown[]) => duplicateWeekExercises(...a),
}))

import { POST } from "@/app/api/admin/programs/[id]/duplicate-week/route"

const call = () =>
  POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ sourceWeek: 1, targetWeek: 2 }) }), {
    params: Promise.resolve({ id: "p1" }),
  })

beforeEach(() => {
  duplicateWeekExercises.mockReset().mockResolvedValue([{ id: "pe1" }])
  auth.mockReset()
  canAccessAdminPath.mockReset()
})

describe("duplicate-week auth", () => {
  it("403s no session", async () => {
    auth.mockResolvedValue(null)
    expect((await call()).status).toBe(403)
    expect(duplicateWeekExercises).not.toHaveBeenCalled()
  })

  it("403s a non-admin", async () => {
    auth.mockResolvedValue({ user: { id: "c1", role: "client" } })
    canAccessAdminPath.mockResolvedValue(false)
    expect((await call()).status).toBe(403)
    expect(duplicateWeekExercises).not.toHaveBeenCalled()
  })

  it("lets an admin through", async () => {
    auth.mockResolvedValue({ user: { id: "a1", role: "admin" } })
    canAccessAdminPath.mockResolvedValue(true)
    expect((await call()).status).toBe(201)
    expect(duplicateWeekExercises).toHaveBeenCalledWith("p1", 1, 2)
  })
})
