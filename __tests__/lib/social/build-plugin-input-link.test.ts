// __tests__/lib/social/build-plugin-input-link.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const getSocialPostWithMediaMock = vi.fn()
const resolveMediaUrlMock = vi.fn()

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
