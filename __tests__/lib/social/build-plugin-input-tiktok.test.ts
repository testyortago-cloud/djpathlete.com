// __tests__/lib/social/build-plugin-input-tiktok.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const getSocialPostWithMediaMock = vi.fn()
const resolveMediaUrlMock = vi.fn()
const resolveCoverUrlMock = vi.fn()

vi.mock("@/lib/db/social-posts", () => ({
  listSocialPosts: vi.fn(),
  updateSocialPost: vi.fn(),
  getSocialPostWithMedia: (id: string) => getSocialPostWithMediaMock(id),
}))
vi.mock("@/lib/db/platform-connections", () => ({
  listPlatformConnections: vi.fn(),
}))
vi.mock("@/lib/social/resolve-media-url", () => ({
  resolveMediaUrl: (x: unknown) => resolveMediaUrlMock(x),
  resolveCoverUrl: (id: unknown) => resolveCoverUrlMock(id),
}))
vi.mock("@/lib/social/story-media", () => ({
  resolveStoryMedia: async () => ({ url: "https://signed.example/story.mp4" }),
}))
vi.mock("@/lib/social/registry", () => ({
  pluginRegistry: { get: vi.fn(), reset: vi.fn(), register: vi.fn(), list: () => [], all: () => [] },
}))
vi.mock("@/lib/social/bootstrap", () => ({ bootstrapPlugins: vi.fn() }))

import { buildPluginInput } from "@/lib/social/publish-runner"
import type { SocialPost } from "@/types/database"
import type { TikTokPostSettings } from "@/lib/validators/tiktok-post-settings"

const SETTINGS: TikTokPostSettings = {
  privacy_level: "FOLLOWER_OF_CREATOR",
  allow_comment: true,
  allow_duet: false,
  allow_stitch: false,
  disclose: false,
  your_brand: false,
  branded_content: false,
}

function post(overrides: Partial<SocialPost>): SocialPost {
  return {
    id: "p1",
    platform: "tiktok",
    post_type: "video",
    content: "hi",
    media_url: null,
    source_video_id: "v1",
    ...overrides,
  } as SocialPost
}

describe("buildPluginInput tiktok settings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSocialPostWithMediaMock.mockResolvedValue({ media: [] })
    resolveMediaUrlMock.mockResolvedValue("https://signed.example/v.mp4")
    resolveCoverUrlMock.mockResolvedValue(null)
  })

  it("passes tiktok_settings through for a TikTok post", async () => {
    const built = await buildPluginInput(post({ tiktok_settings: SETTINGS }))
    expect("input" in built && built.input.tiktokSettings).toEqual(SETTINGS)
  })

  it("passes null when the TikTok post has none", async () => {
    const built = await buildPluginInput(post({ tiktok_settings: null }))
    expect("input" in built && built.input.tiktokSettings).toBeNull()
  })

  it("omits tiktokSettings for other platforms", async () => {
    const built = await buildPluginInput(post({ platform: "instagram", tiktok_settings: SETTINGS }))
    expect("input" in built && "tiktokSettings" in built.input).toBe(false)
  })
})
