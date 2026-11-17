import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getSocialPostByIdMock = vi.fn()
const updateSocialPostMock = vi.fn()
const listPlatformConnectionsMock = vi.fn()
const resolveMediaUrlMock = vi.fn()
const getSocialPostWithMediaMock = vi.fn()
const bootstrapPluginsMock = vi.fn()
const registryGetMock = vi.fn()
const uploadDraftMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/permissions/guard", () => ({
  canAccessAdminPath: async (user: { role?: string }) => user.role === "admin",
}))
vi.mock("@/lib/db/social-posts", () => ({
  getSocialPostById: (id: string) => getSocialPostByIdMock(id),
  updateSocialPost: (id: string, u: unknown) => updateSocialPostMock(id, u),
  getSocialPostWithMedia: (id: string) => getSocialPostWithMediaMock(id),
  listSocialPosts: vi.fn(),
}))
vi.mock("@/lib/db/platform-connections", () => ({
  listPlatformConnections: () => listPlatformConnectionsMock(),
}))
vi.mock("@/lib/social/resolve-media-url", () => ({
  resolveMediaUrl: (i: unknown) => resolveMediaUrlMock(i),
  resolveCoverUrl: vi.fn(),
}))
// The route runs the REAL buildPluginInput: the draft carries the file the publisher would send.
vi.mock("@/lib/social/story-media", () => ({ resolveStoryMedia: vi.fn() }))
vi.mock("@/lib/social/bootstrap", () => ({
  bootstrapPlugins: (c: unknown) => bootstrapPluginsMock(c),
}))
vi.mock("@/lib/social/registry", () => ({
  pluginRegistry: { get: (name: string) => registryGetMock(name) },
}))

import { POST } from "@/app/api/admin/social/posts/[id]/tiktok/draft/route"

function post(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    platform: "tiktok",
    post_type: "video",
    content: "caption",
    approval_status: "draft",
    source_video_id: "v1",
    media_url: null,
    tiktok_settings: null,
    ...over,
  }
}

async function callPost(id = "p1") {
  const req = new Request(`http://localhost/api/admin/social/posts/${id}/tiktok/draft`, { method: "POST" })
  return POST(req as never, { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "a", role: "admin" } })
  getSocialPostByIdMock.mockResolvedValue(post())
  listPlatformConnectionsMock.mockResolvedValue([])
  registryGetMock.mockReturnValue({ uploadDraft: uploadDraftMock })
  resolveMediaUrlMock.mockResolvedValue("https://signed.example/video.mp4")
  getSocialPostWithMediaMock.mockResolvedValue({ media: [] })
  uploadDraftMock.mockResolvedValue({ success: true, platform_post_id: "pub_1" })
})

describe("POST /api/admin/social/posts/:id/tiktok/draft", () => {
  it("401 when not admin, and nothing is sent", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "c", role: "client" } })
    const res = await callPost()
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "Unauthorized" })
    expect(uploadDraftMock).not.toHaveBeenCalled()
  })

  it("404 when the post is missing", async () => {
    getSocialPostByIdMock.mockResolvedValue(null)
    const res = await callPost("nope")
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "Social post not found" })
  })

  it("404 when the post is not a TikTok post", async () => {
    getSocialPostByIdMock.mockResolvedValue(post({ platform: "instagram" }))
    const res = await callPost()
    expect(res.status).toBe(404)
    expect(uploadDraftMock).not.toHaveBeenCalled()
  })

  it.each(["published", "rejected"])("409 when the post is %s", async (approval_status) => {
    getSocialPostByIdMock.mockResolvedValue(post({ approval_status }))
    const res = await callPost()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: `Cannot change a ${approval_status} post` })
    expect(uploadDraftMock).not.toHaveBeenCalled()
  })

  it("409 when TikTok is not connected", async () => {
    registryGetMock.mockReturnValue(undefined)
    const res = await callPost()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "Connect TikTok on the Connections page first." })
    expect(registryGetMock).toHaveBeenCalledWith("tiktok")
  })

  it("409 when the post has no video to send", async () => {
    resolveMediaUrlMock.mockResolvedValue(null)
    const res = await callPost()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "This post has no video to send." })
    expect(uploadDraftMock).not.toHaveBeenCalled()
  })

  it("502 with TikTok's own error when the upload fails", async () => {
    uploadDraftMock.mockResolvedValue({ success: false, error: "TikTok draft init failed (403): scope_not_authorized" })
    const res = await callPost()
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: "TikTok draft init failed (403): scope_not_authorized" })
  })

  it("200 with the publish_id, sending the file the publisher would send", async () => {
    getSocialPostWithMediaMock.mockResolvedValue({ media: [{ asset: { public_url: "cuts/p1-captioned.mp4" } }] })
    resolveMediaUrlMock.mockImplementation(async ({ media_url }: { media_url: string | null }) =>
      media_url === "cuts/p1-captioned.mp4" ? "https://signed.example/cut.mp4" : "https://signed.example/video.mp4",
    )
    const res = await callPost()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ publish_id: "pub_1" })
    expect(uploadDraftMock).toHaveBeenCalledTimes(1)
    expect(uploadDraftMock).toHaveBeenCalledWith({ mediaUrl: "https://signed.example/cut.mp4" })
  })

  it.each(["draft", "approved", "scheduled", "failed"])(
    "writes nothing to the database for a %s post",
    async (approval_status) => {
      getSocialPostByIdMock.mockResolvedValue(post({ approval_status }))
      const res = await callPost()
      expect(res.status).toBe(200)
      expect(updateSocialPostMock).not.toHaveBeenCalled()
    },
  )
})
