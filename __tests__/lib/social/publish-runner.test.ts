// __tests__/lib/social/publish-runner.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const listSocialPostsMock = vi.fn()
const updateSocialPostMock = vi.fn()
const listPlatformConnectionsMock = vi.fn()
const resolveMediaUrlMock = vi.fn()
const registryGetMock = vi.fn()
const registryResetMock = vi.fn()
const registryRegisterMock = vi.fn()
const getSocialPostWithMediaMock = vi.fn()

vi.mock("@/lib/db/social-posts", () => ({
  listSocialPosts: (filters?: unknown) => listSocialPostsMock(filters),
  updateSocialPost: (id: string, u: unknown) => updateSocialPostMock(id, u),
  getSocialPostWithMedia: (id: string) => getSocialPostWithMediaMock(id),
}))
vi.mock("@/lib/db/platform-connections", () => ({
  listPlatformConnections: () => listPlatformConnectionsMock(),
}))
vi.mock("@/lib/social/resolve-media-url", () => ({
  resolveMediaUrl: (x: unknown) => resolveMediaUrlMock(x),
}))
vi.mock("@/lib/social/registry", () => ({
  pluginRegistry: {
    get: (name: string) => registryGetMock(name),
    reset: () => registryResetMock(),
    register: (plugin: unknown) => registryRegisterMock(plugin),
    list: () => [],
    all: () => [],
  },
}))

const bootstrapPluginsMock = vi.fn()
vi.mock("@/lib/social/bootstrap", () => ({
  bootstrapPlugins: (conns: unknown) => bootstrapPluginsMock(conns),
}))

import { runScheduledPublish } from "@/lib/social/publish-runner"

describe("runScheduledPublish", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("skips when no scheduled posts are due", async () => {
    listSocialPostsMock.mockResolvedValue([])
    const result = await runScheduledPublish({ now: new Date() })
    expect(result).toEqual({ considered: 0, published: 0, failed: 0 })
    expect(bootstrapPluginsMock).not.toHaveBeenCalled()
  })

  it("publishes a due scheduled post via the registered plugin and marks it published", async () => {
    const now = new Date("2026-05-01T12:00:00Z")
    const duePost = {
      id: "p1",
      platform: "instagram",
      content: "hello",
      media_url: null,
      source_video_id: "v1",
      approval_status: "scheduled",
      scheduled_at: "2026-05-01T11:55:00Z",
      published_at: null,
      rejection_notes: null,
      platform_post_id: null,
      created_by: null,
      created_at: "",
      updated_at: "",
    }
    listSocialPostsMock.mockResolvedValue([duePost])
    listPlatformConnectionsMock.mockResolvedValue([])
    resolveMediaUrlMock.mockResolvedValue("https://signed.example.com/v1.mp4")
    registryGetMock.mockReturnValue({
      publish: vi.fn().mockResolvedValue({ success: true, platform_post_id: "IG_123" }),
    })

    const result = await runScheduledPublish({ now })
    expect(result).toEqual({ considered: 1, published: 1, failed: 0 })

    expect(updateSocialPostMock).toHaveBeenCalledWith("p1", expect.objectContaining({
      approval_status: "published",
      platform_post_id: "IG_123",
    }))
  })

  it("marks a post failed when no plugin is registered for its platform", async () => {
    const now = new Date("2026-05-01T12:00:00Z")
    const duePost = {
      id: "p2",
      platform: "linkedin",
      content: "hello",
      media_url: null,
      source_video_id: null,
      approval_status: "scheduled",
      scheduled_at: "2026-05-01T11:55:00Z",
      published_at: null,
      rejection_notes: null,
      platform_post_id: null,
      created_by: null,
      created_at: "",
      updated_at: "",
    }
    listSocialPostsMock.mockResolvedValue([duePost])
    listPlatformConnectionsMock.mockResolvedValue([])
    resolveMediaUrlMock.mockResolvedValue(null)
    registryGetMock.mockReturnValue(undefined)

    const result = await runScheduledPublish({ now })
    expect(result).toEqual({ considered: 1, published: 0, failed: 1 })
    expect(updateSocialPostMock).toHaveBeenCalledWith("p2", expect.objectContaining({
      approval_status: "failed",
      rejection_notes: expect.stringContaining("plugin"),
    }))
  })

  it("marks failed when plugin.publish returns success=false", async () => {
    const now = new Date("2026-05-01T12:00:00Z")
    listSocialPostsMock.mockResolvedValue([
      {
        id: "p3",
        platform: "facebook",
        content: "x",
        media_url: null,
        source_video_id: null,
        approval_status: "scheduled",
        scheduled_at: "2026-05-01T11:55:00Z",
        published_at: null,
        rejection_notes: null,
        platform_post_id: null,
        created_by: null,
        created_at: "",
        updated_at: "",
      },
    ])
    listPlatformConnectionsMock.mockResolvedValue([])
    resolveMediaUrlMock.mockResolvedValue(null)
    registryGetMock.mockReturnValue({
      publish: vi.fn().mockResolvedValue({ success: false, error: "Invalid token" }),
    })

    const result = await runScheduledPublish({ now })
    expect(result).toEqual({ considered: 1, published: 0, failed: 1 })
    expect(updateSocialPostMock).toHaveBeenCalledWith("p3", expect.objectContaining({
      approval_status: "failed",
      rejection_notes: "Invalid token",
    }))
  })

  it("resolves each slide URL for a carousel post and passes mediaUrls to the plugin", async () => {
    const now = new Date("2026-05-01T12:00:00Z")
    const duePost = {
      id: "carousel-1",
      platform: "instagram",
      content: "Swipe for 3 ideas",
      media_url: "images/u/1-a.jpg",
      source_video_id: null,
      approval_status: "scheduled",
      scheduled_at: "2026-05-01T11:55:00Z",
      post_type: "carousel",
    }

    listSocialPostsMock.mockResolvedValue([duePost])
    listPlatformConnectionsMock.mockResolvedValue([])
    getSocialPostWithMediaMock.mockResolvedValue({
      ...duePost,
      media: [
        { media_asset_id: "a1", position: 0, overlay_text: null, overlay_metadata: null,
          asset: { id: "a1", kind: "image", public_url: "images/u/1-a.jpg",
                   storage_path: "images/u/1-a.jpg", mime_type: "image/jpeg",
                   width: null, height: null, duration_ms: null } },
        { media_asset_id: "a2", position: 1, overlay_text: null, overlay_metadata: null,
          asset: { id: "a2", kind: "image", public_url: "images/u/1-b.jpg",
                   storage_path: "images/u/1-b.jpg", mime_type: "image/jpeg",
                   width: null, height: null, duration_ms: null } },
        { media_asset_id: "a3", position: 2, overlay_text: null, overlay_metadata: null,
          asset: { id: "a3", kind: "image", public_url: "images/u/1-c.jpg",
                   storage_path: "images/u/1-c.jpg", mime_type: "image/jpeg",
                   width: null, height: null, duration_ms: null } },
      ],
    })

    // resolveMediaUrl returns a signed URL containing the path — map path → signed.
    resolveMediaUrlMock.mockImplementation(async (input: { media_url: string | null }) => {
      if (!input.media_url) return null
      return `https://signed.example/${input.media_url.split("/").pop()}`
    })

    const publishPluginMock = vi.fn().mockResolvedValue({ success: true, platform_post_id: "ig-post-1" })
    registryGetMock.mockReturnValue({
      name: "instagram",
      publish: publishPluginMock,
    })

    const result = await runScheduledPublish({ now })
    expect(result).toEqual({ considered: 1, published: 1, failed: 0 })

    // Plugin was called once with mediaUrls containing 3 signed URLs in order
    expect(publishPluginMock).toHaveBeenCalledOnce()
    const publishInput = publishPluginMock.mock.calls[0][0]
    expect(publishInput.content).toBe("Swipe for 3 ideas")
    expect(publishInput.mediaUrls).toEqual([
      "https://signed.example/1-a.jpg",
      "https://signed.example/1-b.jpg",
      "https://signed.example/1-c.jpg",
    ])
    // mediaUrl (singular) should still be populated to slide 0 for plugin backcompat
    expect(publishInput.mediaUrl).toBe("https://signed.example/1-a.jpg")
  })

  it("marks the carousel post as failed when getSocialPostWithMedia returns null", async () => {
    const now = new Date("2026-05-01T12:00:00Z")
    const duePost = {
      id: "carousel-missing",
      platform: "instagram",
      content: "x",
      media_url: "images/u/gone.jpg",
      source_video_id: null,
      approval_status: "scheduled",
      scheduled_at: "2026-05-01T11:55:00Z",
      post_type: "carousel",
    }
    listSocialPostsMock.mockResolvedValue([duePost])
    listPlatformConnectionsMock.mockResolvedValue([])
    getSocialPostWithMediaMock.mockResolvedValue(null)

    const publishPluginMock = vi.fn()
    registryGetMock.mockReturnValue({
      name: "instagram",
      publish: publishPluginMock,
    })

    const result = await runScheduledPublish({ now })
    expect(result.failed).toBe(1)
    expect(publishPluginMock).not.toHaveBeenCalled()
    expect(updateSocialPostMock).toHaveBeenCalledWith(
      "carousel-missing",
      expect.objectContaining({ approval_status: "failed" }),
    )
  })

  it("skips scheduled posts whose scheduled_at is still in the future", async () => {
    const now = new Date("2026-05-01T12:00:00Z")
    listSocialPostsMock.mockResolvedValue([
      {
        id: "future-1",
        platform: "instagram",
        content: "x",
        media_url: null,
        source_video_id: null,
        approval_status: "scheduled",
        scheduled_at: "2026-05-01T12:05:00Z",
        published_at: null,
        rejection_notes: null,
        platform_post_id: null,
        created_by: null,
        created_at: "",
        updated_at: "",
      },
    ])
    listPlatformConnectionsMock.mockResolvedValue([])
    registryGetMock.mockReturnValue({
      publish: vi.fn().mockResolvedValue({ success: true, platform_post_id: "x" }),
    })

    const result = await runScheduledPublish({ now })
    expect(result).toEqual({ considered: 1, published: 0, failed: 0 })
    expect(updateSocialPostMock).not.toHaveBeenCalled()
  })
})
