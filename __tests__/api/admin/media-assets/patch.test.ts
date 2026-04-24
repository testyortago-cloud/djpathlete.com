import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mockAuth = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }))

const mockGetMediaAssetById = vi.fn()
const mockUpdateMediaAsset = vi.fn()
vi.mock("@/lib/db/media-assets", () => ({
  getMediaAssetById: (...args: unknown[]) => mockGetMediaAssetById(...args),
  updateMediaAsset: (...args: unknown[]) => mockUpdateMediaAsset(...args),
}))

describe("PATCH /api/admin/media-assets/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetMediaAssetById.mockResolvedValue({ id: "asset-1", kind: "image" })
    mockUpdateMediaAsset.mockResolvedValue(undefined)
  })

  async function call(id: string, body: unknown, role: "admin" | "client" = "admin") {
    const { PATCH } = await import("@/app/api/admin/media-assets/[id]/route")
    mockAuth.mockResolvedValue({ user: { id: "user-1", role } })
    const req = new NextRequest(`http://localhost/api/admin/media-assets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
    return PATCH(req, { params: Promise.resolve({ id }) })
  }

  it("returns 401 for non-admin", async () => {
    const res = await call("asset-1", { width: 100 }, "client")
    expect(res.status).toBe(401)
  })

  it("returns 400 for invalid payload (negative bytes)", async () => {
    const res = await call("asset-1", { bytes: -1 })
    expect(res.status).toBe(400)
  })

  it("returns 404 when asset not found", async () => {
    mockGetMediaAssetById.mockResolvedValueOnce(null)
    const res = await call("asset-404", { width: 100, height: 100 })
    expect(res.status).toBe(404)
  })

  it("updates dimensions on valid payload", async () => {
    const res = await call("asset-1", { width: 1080, height: 1080, bytes: 54321 })
    expect(res.status).toBe(200)
    expect(mockUpdateMediaAsset).toHaveBeenCalledWith("asset-1", {
      width: 1080,
      height: 1080,
      bytes: 54321,
    })
  })

  it("returns 500 when the DAL throws", async () => {
    mockUpdateMediaAsset.mockRejectedValueOnce(new Error("db dead"))
    const res = await call("asset-1", { width: 100, height: 100 })
    expect(res.status).toBe(500)
  })
})
