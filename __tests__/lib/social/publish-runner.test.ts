// __tests__/lib/social/publish-runner.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const listSocialPostsMock = vi.fn()
const updateSocialPostMock = vi.fn()
const listPlatformConnectionsMock = vi.fn()
const resolveMediaUrlMock = vi.fn()
const resolveCoverUrlMock = vi.fn()
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
  resolveCoverUrl: (id: unknown) => resolveCoverUrlMock(id),
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

beforeEach(() => resolveCoverUrlMock.mockResolvedValue(null))

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
      post_type: "video",
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
    resolveCoverUrlMock.mockResolvedValue("https://signed.example.com/v1-cover.jpg")
    const publishPluginMock = vi.fn().mockResolvedValue({ success: true, platform_post_id: "IG_123" })
    registryGetMock.mockReturnValue({
      publish: publishPluginMock,
    })

    const result = await runScheduledPublish({ now })
    expect(result).toEqual({ considered: 1, published: 1, failed: 0 })

    expect(updateSocialPostMock).toHaveBeenCalledWith("p1", expect.objectContaining({
      approval_status: "published",
      platform_post_id: "IG_123",
    }))
    expect(publishPluginMock).toHaveBeenCalledOnce()
    expect(publishPluginMock.mock.calls[0][0].postType).toBe("video")
    expect(resolveCoverUrlMock).toHaveBeenCalledWith("v1")
    expect(publishPluginMock.mock.calls[0][0].coverUrl).toBe("https://signed.example.com/v1-cover.jpg")
  })

  it("publishes the attached captioned cut (edited), not the original source video", async () => {
    const now = new Date("2026-05-01T12:00:00Z")
    const duePost = {
      id: "p-cut",
      platform: "instagram",
      content: "caption text",
      media_url: null,
      source_video_id: "v-original",
      post_type: "video",
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
    // The rendered cut is attached via social_post_media.
    getSocialPostWithMediaMock.mockResolvedValue({
      ...duePost,
      media: [
        {
          media_asset_id: "cut1",
          position: 0,
          overlay_text: null,
          overlay_metadata: null,
          asset: {
            id: "cut1",
            kind: "video",
            public_url: "videos/u/captioned-cut.mp4",
            storage_path: "videos/u/captioned-cut.mp4",
            mime_type: "video/mp4",
            width: 1080,
            height: 1920,
            duration_ms: 30000,
          },
        },
      ],
    })
    resolveMediaUrlMock.mockImplementation(async (input: { source_video_id: string | null; media_url: string | null }) => {
      if (input.media_url === "videos/u/captioned-cut.mp4") return "https://signed.example/cut.mp4"
      if (input.source_video_id === "v-original") return "https://signed.example/original.mp4"
      return null
    })
    const publishPluginMock = vi.fn().mockResolvedValue({ success: true, platform_post_id: "IG_1" })
    registryGetMock.mockReturnValue({ publish: publishPluginMock })

    const result = await runScheduledPublish({ now })
    expect(result.published).toBe(1)
    // The edited cut, not the original source video, is what gets posted.
    expect(publishPluginMock.mock.calls[0][0].mediaUrl).toBe("https://signed.example/cut.mp4")
  })

  it("falls back to the original source video when no edit is attached", async () => {
    const now = new Date("2026-05-01T12:00:00Z")
    const duePost = {
      id: "p-raw",
      platform: "instagram",
      content: "caption text",
      media_url: null,
      source_video_id: "v-original",
      post_type: "video",
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
    getSocialPostWithMediaMock.mockResolvedValue({ ...duePost, media: [] })
    resolveMediaUrlMock.mockImplementation(async (input: { source_video_id: string | null }) => {
      if (input.source_video_id === "v-original") return "https://signed.example/original.mp4"
      return null
    })
    const publishPluginMock = vi.fn().mockResolvedValue({ success: true, platform_post_id: "IG_2" })
    registryGetMock.mockReturnValue({ publish: publishPluginMock })

    const result = await runScheduledPublish({ now })
    expect(result.published).toBe(1)
    expect(publishPluginMock.mock.calls[0][0].mediaUrl).toBe("https://signed.example/original.mp4")
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

  it("skips scheduled posts that already have a platform_post_id (delegated to platform)", async () => {
    const now = new Date("2026-05-01T12:00:00Z")
    listSocialPostsMock.mockResolvedValue([
      {
        id: "fb-native-1",
        platform: "facebook",
        content: "x",
        media_url: null,
        source_video_id: null,
        approval_status: "scheduled",
        scheduled_at: "2026-05-01T11:55:00Z",
        published_at: null,
        rejection_notes: null,
        platform_post_id: "FB_999",
        created_by: null,
        created_at: "",
        updated_at: "",
      },
    ])
    listPlatformConnectionsMock.mockResolvedValue([])
    const publishPluginMock = vi.fn()
    registryGetMock.mockReturnValue({ publish: publishPluginMock })

    const result = await runScheduledPublish({ now })
    expect(result).toEqual({ considered: 1, published: 0, failed: 0 })
    expect(publishPluginMock).not.toHaveBeenCalled()
    expect(updateSocialPostMock).not.toHaveBeenCalled()
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

describe("runScheduledPublish — platform still processing", () => {
  beforeEach(() => vi.clearAllMocks())

  const base = {
    id: "p9",
    platform: "instagram",
    content: "reel",
    media_url: null,
    source_video_id: "v9",
    post_type: "video",
    approval_status: "scheduled",
    scheduled_at: "2026-10-01T10:00:00.000Z",
    published_at: null,
    rejection_notes: null,
    platform_post_id: null,
    created_by: null,
    created_at: "",
    updated_at: "",
  }

  function setup(post: Record<string, unknown>, answer: unknown) {
    listSocialPostsMock.mockResolvedValue([post])
    listPlatformConnectionsMock.mockResolvedValue([])
    getSocialPostWithMediaMock.mockResolvedValue({ ...post, media: [] })
    resolveMediaUrlMock.mockResolvedValue("https://signed.example/v9.mp4")
    const publish = vi.fn().mockResolvedValue(answer)
    registryGetMock.mockReturnValue({ publish, displayName: "Instagram" })
    return publish
  }

  it("saves a pending answer and leaves the post scheduled", async () => {
    const pending = { startedAt: "2026-10-01T10:05:00.000Z", data: { step: "publish", containerId: "c" } }
    setup(base, { success: true, pending })
    const result = await runScheduledPublish({ now: new Date("2026-10-01T10:05:00.000Z") })
    expect(result).toEqual({ considered: 1, published: 0, failed: 0 })
    expect(updateSocialPostMock).toHaveBeenCalledWith("p9", {
      platform_publish_state: { ...pending, scheduledFor: "2026-10-01T10:00:00.000Z" },
    })
  })

  it("hands the saved state back on the next run and publishes, clearing it", async () => {
    const saved = { startedAt: "2026-10-01T10:05:00.000Z", scheduledFor: "2026-10-01T10:00:00.000Z", data: { step: "publish", containerId: "c" } }
    const publish = setup({ ...base, platform_publish_state: saved }, { success: true, platform_post_id: "IG_9" })
    await runScheduledPublish({ now: new Date("2026-10-01T10:10:00.000Z") })
    expect(publish.mock.calls[0][0].resumeState).toEqual({ startedAt: saved.startedAt, data: saved.data })
    expect(updateSocialPostMock).toHaveBeenCalledWith("p9", expect.objectContaining({
      approval_status: "published",
      platform_post_id: "IG_9",
      platform_publish_state: null,
    }))
  })

  it("ignores saved state from an earlier schedule (rescheduled or Publish now)", async () => {
    const saved = { startedAt: "2026-10-01T09:00:00.000Z", scheduledFor: "2026-10-01T08:55:00.000Z", data: { step: "publish", containerId: "old" } }
    const publish = setup({ ...base, platform_publish_state: saved }, { success: true, platform_post_id: "IG_10" })
    await runScheduledPublish({ now: new Date("2026-10-01T10:10:00.000Z") })
    expect(publish.mock.calls[0][0].resumeState).toBeUndefined()
  })

  it("fails the post after 30 minutes of processing, clearing the state", async () => {
    const pending = { startedAt: "2026-10-01T10:00:00.000Z", data: { step: "publish", containerId: "c" } }
    setup({ ...base, platform_publish_state: { ...pending, scheduledFor: base.scheduled_at } }, { success: true, pending })
    const result = await runScheduledPublish({ now: new Date("2026-10-01T10:30:01.000Z") })
    expect(result).toEqual({ considered: 1, published: 0, failed: 1 })
    expect(updateSocialPostMock).toHaveBeenCalledWith("p9", {
      approval_status: "failed",
      rejection_notes: "Instagram is still processing the media after 30 minutes.",
      platform_publish_state: null,
    })
  })

  it("a platform failure clears saved state so a retry starts fresh", async () => {
    const saved = { startedAt: "2026-10-01T10:05:00.000Z", scheduledFor: base.scheduled_at, data: { step: "publish", containerId: "c" } }
    setup({ ...base, platform_publish_state: saved }, { success: false, error: "Instagram could not process the media (ERROR)" })
    await runScheduledPublish({ now: new Date("2026-10-01T10:10:00.000Z") })
    expect(updateSocialPostMock).toHaveBeenCalledWith("p9", {
      approval_status: "failed",
      rejection_notes: "Instagram could not process the media (ERROR)",
      platform_publish_state: null,
    })
  })

  it("a post whose publish throws is left as is and the others still publish", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const second = { ...base, id: "p10" }
    listSocialPostsMock.mockResolvedValue([base, second])
    listPlatformConnectionsMock.mockResolvedValue([])
    getSocialPostWithMediaMock.mockImplementation(async (id: string) => ({ ...(id === "p9" ? base : second), media: [] }))
    resolveMediaUrlMock.mockResolvedValue("https://signed.example/v9.mp4")
    const publish = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ success: true, platform_post_id: "IG_2" })
    registryGetMock.mockReturnValue({ publish, displayName: "Instagram" })
    try {
      const result = await runScheduledPublish({ now: new Date("2026-10-01T10:05:00.000Z") })
      expect(result).toEqual({ considered: 2, published: 1, failed: 0 })
      expect(updateSocialPostMock).toHaveBeenCalledWith("p10", expect.objectContaining({
        approval_status: "published",
        platform_post_id: "IG_2",
      }))
      expect(updateSocialPostMock.mock.calls.some((c) => c[0] === "p9")).toBe(false)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it("tells the plugin which carousel slides are videos", async () => {
    const post = { ...base, post_type: "carousel", source_video_id: null }
    const publish = setup(post, { success: true, platform_post_id: "IG_C" })
    getSocialPostWithMediaMock.mockResolvedValue({
      ...post,
      media: [
        { position: 0, asset: { kind: "image", public_url: "images/u/a.jpg" } },
        { position: 1, asset: { kind: "video", public_url: "media-videos/u/b.mp4" } },
      ],
    })
    await runScheduledPublish({ now: new Date("2026-10-01T10:10:00.000Z") })
    expect(publish.mock.calls[0][0].mediaKinds).toEqual(["image", "video"])
  })
})
