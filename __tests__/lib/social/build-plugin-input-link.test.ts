// __tests__/lib/social/build-plugin-input-link.test.ts
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
vi.mock("@/lib/social/registry", () => ({
  pluginRegistry: { get: vi.fn(), reset: vi.fn(), register: vi.fn(), list: () => [], all: () => [] },
}))
vi.mock("@/lib/social/bootstrap", () => ({ bootstrapPlugins: vi.fn() }))

import { buildPluginInput } from "@/lib/social/publish-runner"
import type { SocialPost } from "@/types/database"

function post(overrides: Partial<SocialPost>): SocialPost {
  return {
    id: "p1",
    platform: "linkedin",
    post_type: "text",
    content: "hi",
    media_url: null,
    source_video_id: null,
    ...overrides,
  } as SocialPost
}

describe("buildPluginInput link card", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSocialPostWithMediaMock.mockResolvedValue({ media: [] })
    resolveMediaUrlMock.mockResolvedValue(null)
  })

  it("hands the plugin the post's link card", async () => {
    const built = await buildPluginInput(
      post({
        link_url: "https://www.darrenjpaul.com/blog/acl",
        link_title: "ACL return",
        link_description: "What the research says.",
        link_image_url: "https://cdn.example.com/c.jpg",
      }),
    )
    expect("input" in built && built.input.link).toEqual({
      url: "https://www.darrenjpaul.com/blog/acl",
      title: "ACL return",
      description: "What the research says.",
      imageUrl: "https://cdn.example.com/c.jpg",
    })
  })

  it("sends no link for a post without one", async () => {
    const built = await buildPluginInput(post({}))
    expect("input" in built && "link" in built.input).toBe(false)
  })

  it("sends no link when the url is set but the title is missing (a card needs both)", async () => {
    const built = await buildPluginInput(post({ link_url: "https://www.darrenjpaul.com/x", link_title: null }))
    expect("input" in built && "link" in built.input).toBe(false)
  })
})

describe("buildPluginInput cover", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSocialPostWithMediaMock.mockResolvedValue({ media: [] })
    resolveMediaUrlMock.mockResolvedValue("https://signed.example/v.mp4")
    resolveCoverUrlMock.mockResolvedValue("https://signed.example/cover.jpg")
  })

  // 2026-10-07: Aarav's Reel went out without the thumbnail the operator had set.
  it("hands an Instagram video post the source video's cover", async () => {
    const built = await buildPluginInput(post({ platform: "instagram", post_type: "video", source_video_id: "v1" }))
    expect(resolveCoverUrlMock).toHaveBeenCalledWith("v1")
    expect("input" in built && built.input.coverUrl).toBe("https://signed.example/cover.jpg")
  })

  it("resolves no cover for platforms or post types that do not send one", async () => {
    for (const p of [
      post({ platform: "facebook", post_type: "video", source_video_id: "v1" }),
      post({ platform: "instagram", post_type: "story", source_video_id: "v1" }),
    ]) {
      const built = await buildPluginInput(p)
      expect("input" in built && "coverUrl" in built.input).toBe(false)
    }
    expect(resolveCoverUrlMock).not.toHaveBeenCalled()
  })
})
