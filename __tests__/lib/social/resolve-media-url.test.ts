import { describe, it, expect, vi, beforeEach } from "vitest"

const getVideoUploadByIdMock = vi.fn()
const getAdminStorageMock = vi.fn()
const mockGetSignedUrl = vi.fn()

vi.mock("@/lib/db/video-uploads", () => ({
  getVideoUploadById: (id: string) => getVideoUploadByIdMock(id),
}))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminStorage: () => getAdminStorageMock(),
}))

import sharp from "sharp"
import { resolveMediaUrl, resolveCoverUrl } from "@/lib/social/resolve-media-url"

describe("resolveMediaUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSignedUrl.mockResolvedValue(["https://signed.example/read"])
    getAdminStorageMock.mockReturnValue({
      bucket: () => ({
        file: () => ({ getSignedUrl: mockGetSignedUrl }),
      }),
    })
    getVideoUploadByIdMock.mockResolvedValue({ storage_path: "videos/u/1.mp4" })
  })

  it("returns the post.media_url when source_video_id is null", async () => {
    const url = await resolveMediaUrl({
      source_video_id: null,
      media_url: "https://example.com/pic.jpg",
    })
    expect(url).toBe("https://example.com/pic.jpg")
    expect(getVideoUploadByIdMock).not.toHaveBeenCalled()
  })

  it("signs a Firebase Storage URL for the linked video when source_video_id is set", async () => {
    getVideoUploadByIdMock.mockResolvedValue({
      id: "v1",
      storage_path: "videos/admin-1/123-drill.mp4",
    })
    const fileMock = {
      getSignedUrl: vi.fn().mockResolvedValue(["https://storage.googleapis.com/signed-read"]),
    }
    getAdminStorageMock.mockReturnValue({ bucket: () => ({ file: () => fileMock }) })

    const url = await resolveMediaUrl({ source_video_id: "v1", media_url: null })
    expect(url).toBe("https://storage.googleapis.com/signed-read")
    expect(fileMock.getSignedUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "read",
        version: "v4",
      }),
    )
  })

  it("returns null when source_video_id points at a missing row and media_url is null", async () => {
    getVideoUploadByIdMock.mockResolvedValue(null)
    const url = await resolveMediaUrl({ source_video_id: "ghost", media_url: null })
    expect(url).toBeNull()
  })

  it("falls back to media_url if video signing fails", async () => {
    getVideoUploadByIdMock.mockResolvedValue({ id: "v1", storage_path: "videos/broken.mp4" })
    getAdminStorageMock.mockImplementation(() => {
      throw new Error("bucket unreachable")
    })
    const url = await resolveMediaUrl({
      source_video_id: "v1",
      media_url: "https://fallback.example.com/pic.jpg",
    })
    expect(url).toBe("https://fallback.example.com/pic.jpg")
  })

  it("returns null for text-only posts", async () => {
    const url = await resolveMediaUrl({ source_video_id: null, media_url: null })
    expect(url).toBeNull()
  })

  it("returns http media_url unchanged", async () => {
    const url = await resolveMediaUrl({
      source_video_id: null,
      media_url: "https://external.example/img.jpg",
    })
    expect(url).toBe("https://external.example/img.jpg")
  })

  it("signs a Firebase storage path stored in media_url", async () => {
    const url = await resolveMediaUrl({
      source_video_id: null,
      media_url: "images/user-1/1712345678-photo.jpg",
    })
    expect(url).toBe("https://signed.example/read")
    expect(mockGetSignedUrl).toHaveBeenCalledOnce()
  })

  it("prefers source_video_id when both set", async () => {
    const url = await resolveMediaUrl({
      source_video_id: "video-1",
      media_url: "images/whatever.jpg",
    })
    expect(url).toBe("https://signed.example/read")
  })
})

describe("resolveCoverUrl", () => {
  const VIDEO = "videos/u/1-clip.mp4"
  const CUSTOM = `${VIDEO}.thumb-custom-1700.jpg`

  /** In-memory bucket: path → { bytes, contentType }. */
  function fakeBucket(files: Record<string, { bytes: Buffer; contentType: string }>) {
    const saved: Array<{ path: string; bytes: Buffer; contentType?: string }> = []
    const signed: string[] = []
    const downloads: string[] = []
    getAdminStorageMock.mockReturnValue({
      bucket: () => ({
        file: (path: string) => ({
          exists: async () => [path in files],
          getMetadata: async () => {
            if (!(path in files)) throw new Error("No such object")
            return [{ contentType: files[path].contentType, size: String(files[path].bytes.length) }]
          },
          download: async () => {
            downloads.push(path)
            return [files[path].bytes]
          },
          save: async (bytes: Buffer, opts: { contentType?: string }) => {
            saved.push({ path, bytes, contentType: opts?.contentType })
          },
          getSignedUrl: async () => {
            signed.push(path)
            return [`https://signed.example/${path}`]
          },
        }),
      }),
    })
    return { saved, signed, downloads }
  }

  beforeEach(() => vi.clearAllMocks())

  it("returns null for a video with only the auto-captured thumbnail", async () => {
    getVideoUploadByIdMock.mockResolvedValue({ storage_path: VIDEO, thumbnail_path: `${VIDEO}.thumb.jpg` })
    const { signed } = fakeBucket({})
    expect(await resolveCoverUrl("v1")).toBeNull()
    expect(await resolveCoverUrl(null)).toBeNull()
    expect(signed).toEqual([])
  })

  it("signs a custom JPEG thumbnail as it is", async () => {
    getVideoUploadByIdMock.mockResolvedValue({ storage_path: VIDEO, thumbnail_path: CUSTOM })
    const { signed, saved, downloads } = fakeBucket({
      [CUSTOM]: { bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), contentType: "image/jpeg" },
    })
    expect(await resolveCoverUrl("v1")).toBe(`https://signed.example/${CUSTOM}`)
    expect(signed).toEqual([CUSTOM])
    expect(saved).toEqual([])
    expect(downloads).toEqual([])
  })

  // Instagram's cover_url takes JPEG only; an uploaded cover may be PNG under a .jpg name.
  it("converts a PNG custom thumbnail to a JPEG beside it and signs that", async () => {
    getVideoUploadByIdMock.mockResolvedValue({ storage_path: VIDEO, thumbnail_path: CUSTOM })
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#c00" } }).png().toBuffer()
    const { signed, saved } = fakeBucket({ [CUSTOM]: { bytes: png, contentType: "image/png" } })

    expect(await resolveCoverUrl("v1")).toBe(`https://signed.example/${CUSTOM}.cover.jpg`)
    expect(saved).toHaveLength(1)
    expect(saved[0].path).toBe(`${CUSTOM}.cover.jpg`)
    expect(saved[0].contentType).toBe("image/jpeg")
    expect([...saved[0].bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])
    expect(signed).toEqual([`${CUSTOM}.cover.jpg`])
  })

  it("reuses an earlier conversion instead of converting again", async () => {
    getVideoUploadByIdMock.mockResolvedValue({ storage_path: VIDEO, thumbnail_path: CUSTOM })
    const { saved, downloads, signed } = fakeBucket({
      [CUSTOM]: { bytes: Buffer.from("png"), contentType: "image/png" },
      [`${CUSTOM}.cover.jpg`]: { bytes: Buffer.from([0xff, 0xd8, 0xff]), contentType: "image/jpeg" },
    })
    expect(await resolveCoverUrl("v1")).toBe(`https://signed.example/${CUSTOM}.cover.jpg`)
    expect(saved).toEqual([])
    expect(downloads).toEqual([])
    expect(signed).toEqual([`${CUSTOM}.cover.jpg`])
  })

  it("answers null, not a throw, when the thumbnail blob is gone", async () => {
    getVideoUploadByIdMock.mockResolvedValue({ storage_path: VIDEO, thumbnail_path: CUSTOM })
    fakeBucket({})
    expect(await resolveCoverUrl("v1")).toBeNull()
  })
})
