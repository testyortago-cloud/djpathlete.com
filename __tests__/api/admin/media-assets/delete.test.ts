import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mockAuth = vi.fn()
const mockDeleteMediaAsset = vi.fn()
const mockGetMediaAssetById = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }))
vi.mock("@/lib/db/media-assets", () => ({
  deleteMediaAsset: (...args: unknown[]) => mockDeleteMediaAsset(...args),
  getMediaAssetById: (...args: unknown[]) => mockGetMediaAssetById(...args),
  // Satisfy the PATCH handler's updateMediaAsset import if shared module scope picks it up
  updateMediaAsset: vi.fn(),
}))

describe("DELETE /api/admin/media-assets/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    mockGetMediaAssetById.mockResolvedValue({ id: "asset-1", kind: "image" })
    mockDeleteMediaAsset.mockResolvedValue(undefined)
  })

  async function call(id: string, role: "admin" | "client" = "admin") {
    const { DELETE } = await import("@/app/api/admin/media-assets/[id]/route")
    mockAuth.mockResolvedValue({ user: { id: "user-1", role } })
    const req = new NextRequest(`http://localhost/api/admin/media-assets/${id}`, { method: "DELETE" })
    return DELETE(req, { params: Promise.resolve({ id }) })
  }

  it("returns 401 for non-admin", async () => {
    const res = await call("asset-1", "client")
    expect(res.status).toBe(401)
    expect(mockDeleteMediaAsset).not.toHaveBeenCalled()
  })

  it("returns 404 when asset does not exist", async () => {
    mockGetMediaAssetById.mockResolvedValueOnce(null)
    const res = await call("asset-missing")
    expect(res.status).toBe(404)
    expect(mockDeleteMediaAsset).not.toHaveBeenCalled()
  })

  it("returns 200 and deletes an unreferenced asset", async () => {
    const res = await call("asset-1")
    expect(res.status).toBe(200)
    expect(mockDeleteMediaAsset).toHaveBeenCalledWith("asset-1")
  })

  it("returns 409 when the asset is referenced by social_post_media (FK violation)", async () => {
    mockDeleteMediaAsset.mockRejectedValueOnce(
      new Error("violates foreign key constraint on social_post_media"),
    )
    const res = await call("asset-referenced")
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/in use|referenced/i)
  })

  it("returns 500 for unexpected errors", async () => {
    mockDeleteMediaAsset.mockRejectedValueOnce(new Error("db exploded"))
    const res = await call("asset-1")
    expect(res.status).toBe(500)
  })
})
