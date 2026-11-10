import { describe, it, expect, vi, beforeEach } from "vitest"

const getSocialPostWithMediaMock = vi.fn()
const resolveMediaUrlMock = vi.fn()
const resolveStoryMediaMock = vi.fn()

vi.mock("@/lib/db/social-posts", () => ({
  listSocialPosts: vi.fn(),
  updateSocialPost: vi.fn(),
  getSocialPostWithMedia: (id: string) => getSocialPostWithMediaMock(id),
}))
vi.mock("@/lib/db/platform-connections", () => ({ listPlatformConnections: vi.fn() }))
vi.mock("@/lib/social/resolve-media-url", () => ({
  resolveMediaUrl: (x: unknown) => resolveMediaUrlMock(x),
  resolveCoverUrl: vi.fn(),
}))
vi.mock("@/lib/social/story-media", () => ({
  resolveStoryMedia: (p: unknown) => resolveStoryMediaMock(p),
}))
vi.mock("@/lib/social/registry", () => ({
  pluginRegistry: { get: vi.fn(), reset: vi.fn(), register: vi.fn(), list: () => [], all: () => [] },
}))
vi.mock("@/lib/social/bootstrap", () => ({ bootstrapPlugins: vi.fn() }))

import { buildPluginInput } from "@/lib/social/publish-runner"
import type { SocialPost } from "@/types/database"

const story = {
  id: "s1",
  platform: "instagram",
  post_type: "story",
  content: "ignored on stories",
  media_url: null,
  source_video_id: "v1",
} as SocialPost

beforeEach(() => vi.clearAllMocks())

describe("buildPluginInput for a story", () => {
  it("posts what the story resolver picked, with no caption", async () => {
    resolveStoryMediaMock.mockResolvedValue({ url: "https://signed/cuts/reel.mp4" })
    const built = await buildPluginInput(story)
    expect(built).toEqual({
      input: { content: "", mediaUrl: "https://signed/cuts/reel.mp4", postType: "story", scheduledAt: null },
    })
    expect(resolveStoryMediaMock).toHaveBeenCalledWith(story)
    // The raw-video fallback the other post types use must not run for a story.
    expect(resolveMediaUrlMock).not.toHaveBeenCalled()
  })

  it("leaves a Facebook story on the general path (Instagram's rules are not Facebook's)", async () => {
    getSocialPostWithMediaMock.mockResolvedValue({ media: [] })
    resolveMediaUrlMock.mockResolvedValue("https://signed/raw.mp4")
    const built = await buildPluginInput({ ...story, platform: "facebook" } as SocialPost)
    expect(resolveStoryMediaMock).not.toHaveBeenCalled()
    expect(built).toEqual({ input: expect.objectContaining({ mediaUrl: "https://signed/raw.mp4", postType: "story" }) })
  })

  it("passes the resolver's plain-words refusal through as the error", async () => {
    resolveStoryMediaMock.mockResolvedValue({ error: "This video is 2:14 long." })
    expect(await buildPluginInput(story)).toEqual({ error: "This video is 2:14 long." })
  })
})
