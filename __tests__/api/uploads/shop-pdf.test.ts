import { describe, expect, it, vi } from "vitest"
import { POST } from "@/app/api/uploads/shop-pdf/route"

vi.mock("@/lib/auth-helpers", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ id: "u1", role: "admin" }),
}))
vi.mock("@/lib/firebase-admin", () => ({
  getPrivateBucket: () => ({
    file: () => ({ save: vi.fn().mockResolvedValue(undefined) }),
  }),
}))

/**
 * Pass a fake request whose formData() returns a controlled file. This unit-tests
 * the route's validation/branching directly and avoids the jsdom-File ↔ undici
 * multipart round-trip (which loses the filename and can't fake a >500MB size).
 */
function reqWithFile(file: {
  name: string
  type: string
  size: number
}): Request {
  const fakeFile = {
    ...file,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
  return {
    formData: async () => ({ get: (k: string) => (k === "file" ? fakeFile : null) }),
  } as unknown as Request
}

describe("POST /api/uploads/shop-pdf", () => {
  it("uploads the file and returns its storage path", async () => {
    const res = await POST(reqWithFile({ name: "workbook.pdf", type: "application/pdf", size: 1000 }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.file_name).toBe("workbook.pdf")
    expect(body.storage_path).toMatch(/^shop-downloads\/.*workbook\.pdf$/)
  })

  it("rejects an oversize file (413)", async () => {
    const res = await POST(reqWithFile({ name: "big.pdf", type: "application/pdf", size: 600 * 1024 * 1024 }))
    expect(res.status).toBe(413)
  })

  it("rejects an unsupported mime type (415)", async () => {
    const res = await POST(reqWithFile({ name: "x.exe", type: "application/x-msdownload", size: 10 }))
    expect(res.status).toBe(415)
  })
})
