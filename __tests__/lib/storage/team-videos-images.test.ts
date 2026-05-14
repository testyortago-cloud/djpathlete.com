import { describe, expect, it, vi, beforeEach } from "vitest"
import { buildImagePath } from "@/lib/storage/team-videos"

describe("buildImagePath", () => {
  it("prefixes position and sanitizes the filename", () => {
    const path = buildImagePath("sub-1", 2, 3, "My Photo  (final).jpg")
    expect(path).toBe("team-videos/sub-1/v2/3_My_Photo_final_.jpg")
  })

  it("caps the filename at 120 chars", () => {
    const long = "a".repeat(200) + ".jpg"
    const path = buildImagePath("sub-1", 1, 0, long)
    expect(path.startsWith("team-videos/sub-1/v1/0_")).toBe(true)
    expect(path.slice("team-videos/sub-1/v1/".length).length).toBe(2 + 120)
  })

  it("uses position-prefixed filename so order is visible in storage", () => {
    const a = buildImagePath("sub-1", 1, 0, "x.jpg")
    const b = buildImagePath("sub-1", 1, 1, "x.jpg")
    expect(a).toContain("/v1/0_x.jpg")
    expect(b).toContain("/v1/1_x.jpg")
  })
})

vi.mock("@/lib/firebase-admin", () => ({
  getAdminStorage: vi.fn(),
}))

describe("createImageUploadUrls", () => {
  beforeEach(() => vi.resetModules())

  it("returns a signed URL per image", async () => {
    const getSignedUrl = vi.fn().mockResolvedValue(["https://signed.example/upload"])
    const file = vi.fn().mockReturnValue({ getSignedUrl })
    const bucket = vi.fn().mockReturnValue({ file })
    const { getAdminStorage } = await import("@/lib/firebase-admin")
    ;(getAdminStorage as ReturnType<typeof vi.fn>).mockReturnValue({ bucket })

    const { createImageUploadUrls } = await import("@/lib/storage/team-videos")
    const urls = await createImageUploadUrls([
      { storagePath: "p1", contentType: "image/jpeg" },
      { storagePath: "p2", contentType: "image/png" },
    ])

    expect(urls).toHaveLength(2)
    expect(urls[0].uploadUrl).toBe("https://signed.example/upload")
    expect(urls[0].storagePath).toBe("p1")
    expect(urls[0].expiresInSeconds).toBeGreaterThan(0)
  })
})
