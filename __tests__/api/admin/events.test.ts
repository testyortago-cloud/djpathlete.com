import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock auth() to return an admin session.
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "admin-1", email: "a@x.com", role: "admin" } })),
}))

describe("POST /api/admin/events", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 400 on invalid body", async () => {
    const { POST } = await import("@/app/api/admin/events/route")
    const req = new Request("http://localhost/api/admin/events", {
      method: "POST",
      body: JSON.stringify({ type: "clinic" }),
      headers: { "content-type": "application/json" },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("returns 403 when not admin", async () => {
    const authMod = await import("@/lib/auth")
    vi.mocked(authMod.auth).mockResolvedValueOnce(null as never)
    const { POST } = await import("@/app/api/admin/events/route")
    const req = new Request("http://localhost/api/admin/events", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })
})
