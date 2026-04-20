// __tests__/lib/social/publish-runner.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const listSocialPostsMock = vi.fn()
const updateSocialPostMock = vi.fn()
const listPlatformConnectionsMock = vi.fn()
const resolveMediaUrlMock = vi.fn()
const registryGetMock = vi.fn()
const registryResetMock = vi.fn()
const registryRegisterMock = vi.fn()

vi.mock("@/lib/db/social-posts", () => ({
  listSocialPosts: (filters?: unknown) => listSocialPostsMock(filters),
  updateSocialPost: (id: string, u: unknown) => updateSocialPostMock(id, u),
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
  bootstrapPlugins: (conns: unknown, opts: unknown) => bootstrapPluginsMock(conns, opts),
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
