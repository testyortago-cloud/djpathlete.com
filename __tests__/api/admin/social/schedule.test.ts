import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getSocialPostByIdMock = vi.fn()
const updateSocialPostMock = vi.fn()
const listPlatformConnectionsMock = vi.fn()
const bootstrapPluginsMock = vi.fn()
const registryGetMock = vi.fn()
const buildPluginInputMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/social-posts", () => ({
  getSocialPostById: (id: string) => getSocialPostByIdMock(id),
  updateSocialPost: (id: string, updates: unknown) => updateSocialPostMock(id, updates),
}))
vi.mock("@/lib/db/platform-connections", () => ({
  listPlatformConnections: () => listPlatformConnectionsMock(),
}))
vi.mock("@/lib/social/bootstrap", () => ({
  bootstrapPlugins: (conns: unknown) => bootstrapPluginsMock(conns),
}))
vi.mock("@/lib/social/registry", () => ({
  pluginRegistry: { get: (name: string) => registryGetMock(name) },
}))
vi.mock("@/lib/social/publish-runner", () => ({
  buildPluginInput: (post: unknown) => buildPluginInputMock(post),
}))

import { POST } from "@/app/api/admin/social/posts/[id]/schedule/route"

async function callSchedule(id: string, body: unknown) {
  const req = new Request(`http://localhost/api/admin/social/posts/${id}/schedule`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return POST(req, { params: Promise.resolve({ id }) })
}

function withConnected(platforms: string[]) {
  listPlatformConnectionsMock.mockResolvedValue(
    platforms.map((p) => ({ plugin_name: p, status: "connected" })),
  )
}

function futureIso(minutesFromNow: number): string {
  return new Date(Date.now() + minutesFromNow * 60_000).toISOString()
}

describe("POST /api/admin/social/posts/:id/schedule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    withConnected(["instagram", "facebook", "linkedin"])
    // Default: no plugin registered → falls through to DB-cron path
    registryGetMock.mockReturnValue(undefined)
    buildPluginInputMock.mockResolvedValue({
      input: { content: "x", mediaUrl: null, mediaUrls: undefined, postType: "video", scheduledAt: null },
    })
  })

  it("returns 401 when not admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "c", role: "client" } })
    const res = await callSchedule("p1", { scheduled_at: futureIso(60) })
    expect(res.status).toBe(401)
  })

  it("returns 400 when scheduled_at is missing", async () => {
    const res = await callSchedule("p1", {})
    expect(res.status).toBe(400)
  })

  it("returns 400 when scheduled_at is in the past", async () => {
    getSocialPostByIdMock.mockResolvedValue({ id: "p1", approval_status: "approved", platform: "instagram" })
    const res = await callSchedule("p1", { scheduled_at: new Date(Date.now() - 60_000).toISOString() })
    expect(res.status).toBe(400)
    expect(await res.text()).toContain("future")
  })

  it("returns 404 when the post is missing", async () => {
    getSocialPostByIdMock.mockResolvedValue(null)
    const res = await callSchedule("nope", { scheduled_at: futureIso(60) })
    expect(res.status).toBe(404)
  })

  it("returns 409 when the post is already published", async () => {
    getSocialPostByIdMock.mockResolvedValue({ id: "p1", approval_status: "published", platform: "instagram" })
    const res = await callSchedule("p1", { scheduled_at: futureIso(60) })
    expect(res.status).toBe(409)
  })

  it("returns 409 with a connect-platform message when the platform isn't connected", async () => {
    withConnected([])
    getSocialPostByIdMock.mockResolvedValue({ id: "p1", approval_status: "draft", platform: "instagram" })
    const res = await callSchedule("p1", { scheduled_at: futureIso(60) })
    expect(res.status).toBe(409)
    expect(await res.text()).toMatch(/connect.+instagram/i)
  })

  it("DB-cron path: instagram (no scheduleOnPlatform) updates DB only", async () => {
    const future = futureIso(60)
    getSocialPostByIdMock.mockResolvedValue({ id: "p1", approval_status: "draft", platform: "instagram" })
    updateSocialPostMock.mockResolvedValue({ id: "p1", approval_status: "scheduled", scheduled_at: future })
    // plugin exists but doesn't implement scheduleOnPlatform
    registryGetMock.mockReturnValue({ name: "instagram", publish: vi.fn() })

    const res = await callSchedule("p1", { scheduled_at: future })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.delivery).toBe("cron")
    expect(updateSocialPostMock).toHaveBeenCalledWith("p1", {
      approval_status: "scheduled",
      scheduled_at: future,
    })
  })

  it("native path: facebook scheduleOnPlatform success stores platform_post_id and reports delivery=platform_native", async () => {
    const future = futureIso(60)
    getSocialPostByIdMock.mockResolvedValue({
      id: "p1",
      approval_status: "draft",
      platform: "facebook",
      post_type: "video",
      content: "x",
      media_url: null,
      source_video_id: null,
      platform_post_id: null,
    })
    const scheduleOnPlatform = vi.fn().mockResolvedValue({
      supported: true,
      success: true,
      platform_post_id: "FB_999",
    })
    registryGetMock.mockReturnValue({ name: "facebook", publish: vi.fn(), scheduleOnPlatform })
    updateSocialPostMock.mockResolvedValue({
      id: "p1",
      approval_status: "scheduled",
      scheduled_at: future,
      platform_post_id: "FB_999",
    })

    const res = await callSchedule("p1", { scheduled_at: future })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.delivery).toBe("platform_native")
    expect(json.platform_post_id).toBe("FB_999")
    expect(scheduleOnPlatform).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledAt: future }),
    )
    expect(updateSocialPostMock).toHaveBeenCalledWith("p1", {
      approval_status: "scheduled",
      scheduled_at: future,
      platform_post_id: "FB_999",
    })
  })

  it("native path: returns 502 when the platform rejects the schedule call", async () => {
    const future = futureIso(60)
    getSocialPostByIdMock.mockResolvedValue({
      id: "p1",
      approval_status: "draft",
      platform: "facebook",
      post_type: "video",
      content: "x",
      media_url: null,
      source_video_id: null,
      platform_post_id: null,
    })
    registryGetMock.mockReturnValue({
      name: "facebook",
      publish: vi.fn(),
      scheduleOnPlatform: vi.fn().mockResolvedValue({
        supported: true,
        success: false,
        error: "Page token expired",
      }),
    })

    const res = await callSchedule("p1", { scheduled_at: future })
    expect(res.status).toBe(502)
    expect(await res.text()).toContain("Page token expired")
    expect(updateSocialPostMock).not.toHaveBeenCalled()
  })

  it("native path: falls back to cron when plugin reports unsupported (e.g. FB stories)", async () => {
    const future = futureIso(60)
    getSocialPostByIdMock.mockResolvedValue({
      id: "p1",
      approval_status: "draft",
      platform: "facebook",
      post_type: "story",
      content: "x",
      media_url: null,
      source_video_id: null,
      platform_post_id: null,
    })
    registryGetMock.mockReturnValue({
      name: "facebook",
      publish: vi.fn(),
      scheduleOnPlatform: vi.fn().mockResolvedValue({
        supported: false,
        reason: "Stories cannot be scheduled natively",
      }),
    })
    updateSocialPostMock.mockResolvedValue({
      id: "p1",
      approval_status: "scheduled",
      scheduled_at: future,
    })

    const res = await callSchedule("p1", { scheduled_at: future })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.delivery).toBe("cron")
    expect(updateSocialPostMock).toHaveBeenCalledWith("p1", {
      approval_status: "scheduled",
      scheduled_at: future,
    })
  })

  it("native path: rejects scheduled times less than 15 min in the future", async () => {
    const tooSoon = futureIso(5)
    getSocialPostByIdMock.mockResolvedValue({
      id: "p1",
      approval_status: "draft",
      platform: "facebook",
      post_type: "video",
    })
    registryGetMock.mockReturnValue({
      name: "facebook",
      publish: vi.fn(),
      scheduleOnPlatform: vi.fn(),
    })

    const res = await callSchedule("p1", { scheduled_at: tooSoon })
    expect(res.status).toBe(400)
    expect(await res.text()).toMatch(/15 min/i)
  })

  it("native path: when rescheduling, cancels the previous platform schedule first", async () => {
    const future = futureIso(60)
    getSocialPostByIdMock.mockResolvedValue({
      id: "p1",
      approval_status: "scheduled",
      platform: "facebook",
      post_type: "video",
      content: "x",
      media_url: null,
      source_video_id: null,
      platform_post_id: "FB_OLD",
    })
    const unscheduleOnPlatform = vi.fn().mockResolvedValue({ success: true })
    registryGetMock.mockReturnValue({
      name: "facebook",
      publish: vi.fn(),
      scheduleOnPlatform: vi.fn().mockResolvedValue({
        supported: true,
        success: true,
        platform_post_id: "FB_NEW",
      }),
      unscheduleOnPlatform,
    })
    updateSocialPostMock.mockResolvedValue({
      id: "p1",
      approval_status: "scheduled",
      scheduled_at: future,
      platform_post_id: "FB_NEW",
    })

    const res = await callSchedule("p1", { scheduled_at: future })
    expect(res.status).toBe(200)
    expect(unscheduleOnPlatform).toHaveBeenCalledWith("FB_OLD")
  })
})
