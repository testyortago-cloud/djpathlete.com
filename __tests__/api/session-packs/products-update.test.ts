import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const updateMock = vi.fn()
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/session-pack-products", () => ({ updateProduct: (...a: unknown[]) => updateMock(...a) }))

import { PATCH } from "@/app/api/admin/session-packs/products/[id]/route"

const ctx = { params: Promise.resolve({ id: "prod-1" }) }
const req = (b: Record<string, unknown>) =>
  new Request("http://localhost/api/admin/session-packs/products/prod-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(b),
  })

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "a1", role: "admin" } })
  updateMock.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({ id: "prod-1", ...patch }))
})

describe("PATCH /api/admin/session-packs/products/[id]", () => {
  it("rejects non-admins", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await PATCH(req({ isActive: false }), ctx)).status).toBe(403)
  })

  it("updates is_active", async () => {
    const res = await PATCH(req({ isActive: false }), ctx)
    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith("prod-1", expect.objectContaining({ is_active: false }))
  })
})
