import { describe, expect, it, vi } from "vitest"
import { POST } from "@/app/api/uploads/shop-pdf/route"

vi.mock("@/lib/auth-helpers", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ id: "u1", role: "admin" }),
}))
vi.mock("@/lib/shop/downloads", () => ({
  generateSignedUploadUrl: vi
    .fn()
    .mockResolvedValue("https://signed-upload.example/pdf?exp=1"),
}))

describe("POST /api/uploads/shop-pdf", () => {
  it("returns signed upload URL + storage path", async () => {
    const req = new Request("http://x/api/uploads/shop-pdf", {
      method: "POST",
      body: JSON.stringify({
        file_name: "workbook.pdf",
        content_type: "application/pdf",
        file_size_bytes: 500000,
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.upload_url).toContain("signed-upload.example")
    expect(body.storage_path).toMatch(/^shop-downloads\/.*workbook\.pdf$/)
  })

  it("rejects oversize file", async () => {
    const req = new Request("http://x/api/uploads/shop-pdf", {
      method: "POST",
      body: JSON.stringify({
        file_name: "big.pdf",
        content_type: "application/pdf",
        file_size_bytes: 600 * 1024 * 1024,
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("rejects bad mime", async () => {
    const req = new Request("http://x/api/uploads/shop-pdf", {
      method: "POST",
      body: JSON.stringify({
        file_name: "x.exe",
        content_type: "application/x-msdownload",
        file_size_bytes: 1000,
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
