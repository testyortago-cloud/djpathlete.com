// @vitest-environment node
// __tests__/api/admin/programs/hidden-weeks.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const canAccess = vi.fn()
const getProgramById = vi.fn()
const updateProgram = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: (...a: unknown[]) => canAccess(...a) }))
vi.mock("@/lib/audit/with-audit", () => ({ withAudit: (_o: unknown, h: unknown) => h }))
vi.mock("@/lib/db/programs", () => ({
  getProgramById: (...a: unknown[]) => getProgramById(...a),
  updateProgram: (...a: unknown[]) => updateProgram(...a),
}))

import { POST } from "@/app/api/admin/programs/[id]/hidden-weeks/route"

const call = (body: unknown) =>
  POST(
    new Request("http://localhost/api/admin/programs/p1/hidden-weeks", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "p1" }) },
  )

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  canAccess.mockReset().mockResolvedValue(true)
  getProgramById.mockReset().mockResolvedValue({ id: "p1", duration_weeks: 6, hidden_weeks: [5] })
  updateProgram.mockReset().mockImplementation(async (_id: string, u: { hidden_weeks: number[] }) => ({
    id: "p1",
    hidden_weeks: u.hidden_weeks,
  }))
})

describe("POST /api/admin/programs/[id]/hidden-weeks", () => {
  it("403s without a session and writes nothing", async () => {
    authMock.mockResolvedValue(null)
    expect((await call({ weekNumber: 2, hidden: true })).status).toBe(403)
    expect(updateProgram).not.toHaveBeenCalled()
  })

  it("403s a signed-in user the admin guard refuses, and writes nothing", async () => {
    canAccess.mockResolvedValue(false)
    expect((await call({ weekNumber: 2, hidden: true })).status).toBe(403)
    expect(updateProgram).not.toHaveBeenCalled()
  })

  it("400s a body that is not a week number and a yes/no", async () => {
    expect((await call({ weekNumber: 0, hidden: true })).status).toBe(400)
    expect((await call({ weekNumber: 2 })).status).toBe(400)
    expect((await call({ weekNumber: "2", hidden: true })).status).toBe(400)
    expect(updateProgram).not.toHaveBeenCalled()
  })

  it("400s a week past the end of the program", async () => {
    const res = await call({ weekNumber: 7, hidden: true })
    expect(res.status).toBe(400)
    expect(updateProgram).not.toHaveBeenCalled()
  })

  it("hides a week: keeps the ones already hidden, sorted", async () => {
    const res = await call({ weekNumber: 2, hidden: true })
    expect(res.status).toBe(200)
    expect(updateProgram).toHaveBeenCalledWith("p1", { hidden_weeks: [2, 5] })
    expect(await res.json()).toEqual({ hidden_weeks: [2, 5] })
  })

  it("shows a week again", async () => {
    const res = await call({ weekNumber: 5, hidden: false })
    expect(res.status).toBe(200)
    expect(updateProgram).toHaveBeenCalledWith("p1", { hidden_weeks: [] })
  })

  it("treats a program row from before the column existed as nothing hidden", async () => {
    getProgramById.mockResolvedValue({ id: "p1", duration_weeks: 6 })
    await call({ weekNumber: 1, hidden: true })
    expect(updateProgram).toHaveBeenCalledWith("p1", { hidden_weeks: [1] })
  })
})
