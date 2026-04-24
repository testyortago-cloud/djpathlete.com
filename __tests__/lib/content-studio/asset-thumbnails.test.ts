import { describe, it, expect, vi, beforeEach } from "vitest"

const mockGetSignedUrl = vi.fn()
vi.mock("@/lib/firebase-admin", () => ({
  getAdminStorage: () => ({
    bucket: () => ({
      file: () => ({ getSignedUrl: mockGetSignedUrl }),
    }),
  }),
}))

import type { AssetWithPostCount } from "@/lib/db/media-assets"

function makeAsset(overrides: Partial<AssetWithPostCount> = {}): AssetWithPostCount {
  return {
    id: overrides.id ?? "asset-x",
    kind: "image",
    storage_path: "images/u/photo.jpg",
    public_url: "images/u/photo.jpg",
    mime_type: "image/jpeg",
    width: null,
    height: null,
    duration_ms: null,
    bytes: 0,
    derived_from_video_id: null,
    ai_alt_text: null,
    ai_analysis: null,
    created_by: null,
    created_at: "2026-03-01T10:00:00Z",
    updated_at: "2026-03-01T10:00:00Z",
    post_count: 0,
    ...overrides,
  }
}

describe("signImageAssetThumbnails", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSignedUrl.mockResolvedValue(["https://signed.example/read"])
  })

  it("returns signed URLs keyed by asset id, only for image assets", async () => {
    const { signImageAssetThumbnails } = await import("@/lib/content-studio/asset-thumbnails")
    const urls = await signImageAssetThumbnails([
      makeAsset({ id: "a-1", kind: "image" }),
      makeAsset({ id: "a-2", kind: "video" }),
      makeAsset({ id: "a-3", kind: "image" }),
    ])
    expect(Object.keys(urls).sort()).toEqual(["a-1", "a-3"])
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(2)
  })

  it("skips assets whose file lookup throws", async () => {
    mockGetSignedUrl.mockImplementation(async () => {
      throw new Error("file missing")
    })
    const { signImageAssetThumbnails } = await import("@/lib/content-studio/asset-thumbnails")
    const urls = await signImageAssetThumbnails([makeAsset({ id: "a-1" })])
    expect(urls).toEqual({})
  })

  it("caps at MAX_SIGNED to avoid hammering storage on huge libraries", async () => {
    const many = Array.from({ length: 250 }, (_, i) => makeAsset({ id: `a-${i}`, kind: "image" }))
    const { signImageAssetThumbnails } = await import("@/lib/content-studio/asset-thumbnails")
    await signImageAssetThumbnails(many)
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(200)
  })
})
