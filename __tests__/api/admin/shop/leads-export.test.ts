import { describe, expect, it, vi } from "vitest"
import { GET } from "@/app/api/admin/shop/leads/export/route"

vi.mock("@/lib/auth-helpers", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ id: "u1", role: "admin" }),
}))

describe("GET /api/admin/shop/leads/export", () => {
  it("returns CSV with header row", async () => {
    const req = new Request("http://x/api/admin/shop/leads/export")
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/csv")
    const text = await res.text()
    expect(text.split("\n")[0]).toBe(
      "email,product_id,resend_sync_status,created_at",
    )
  })
})
