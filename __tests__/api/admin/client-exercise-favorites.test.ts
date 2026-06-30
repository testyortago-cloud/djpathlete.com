import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const addFavorite = vi.fn()
const removeFavorite = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/exercise-favorites", () => ({
  addFavorite: (...a: unknown[]) => addFavorite(...a),
  removeFavorite: (...a: unknown[]) => removeFavorite(...a),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { POST, DELETE } from "@/app/api/admin/clients/[id]/exercise-favorites/route"

const UUID = "11111111-1111-1111-8111-111111111111"
const params = Promise.resolve({ id: "client-9" })
function req(body: unknown, method = "POST") {
  return new Request("http://localhost/x", { method, body: JSON.stringify(body) })
}

beforeEach(() => {
  authMock.mockReset()
  addFavorite.mockReset()
  removeFavorite.mockReset()
})

describe("admin exercise-favorites route", () => {
  it("403s for non-admins on POST", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await POST(req({ exerciseId: UUID }), { params })
    expect(res.status).toBe(403)
  })

  it("adds on behalf with source=admin and createdBy=admin", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    const res = await POST(req({ exerciseId: UUID }), { params })
    expect(res.status).toBe(200)
    expect(addFavorite).toHaveBeenCalledWith("client-9", UUID, { createdBy: "admin-1", source: "admin" })
  })

  it("removes on behalf", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    const res = await DELETE(req({ exerciseId: UUID }, "DELETE"), { params })
    expect(res.status).toBe(200)
    expect(removeFavorite).toHaveBeenCalledWith("client-9", UUID)
  })

  it("403s for non-admins on DELETE", async () => {
    authMock.mockResolvedValue(null)
    const res = await DELETE(req({ exerciseId: UUID }, "DELETE"), { params })
    expect(res.status).toBe(403)
  })
})
