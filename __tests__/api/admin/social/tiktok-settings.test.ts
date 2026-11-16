import { describe, it, expect, vi, beforeEach } from "vitest"
import { creatorInfoRefusal } from "@/lib/social/tiktok-post-rules"

const authMock = vi.fn()
const getSocialPostByIdMock = vi.fn()
const updateSocialPostMock = vi.fn()
const listPlatformConnectionsMock = vi.fn()
const resolveMediaUrlMock = vi.fn()
const getSocialPostWithMediaMock = vi.fn()
const bootstrapPluginsMock = vi.fn()
const registryGetMock = vi.fn()
const creatorInfoMock = vi.fn()

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
// The route runs the REAL buildPluginInput, so the preview is checked against the
// publisher's own choice of file (attached cut first, then the source video).
vi.mock("@/lib/social/story-media", () => ({ resolveStoryMedia: vi.fn() }))
vi.mock("@/lib/social/bootstrap", () => ({
  bootstrapPlugins: (c: unknown) => bootstrapPluginsMock(c),
}))
vi.mock("@/lib/social/registry", () => ({
  pluginRegistry: { get: (name: string) => registryGetMock(name) },
}))

import { GET, PUT } from "@/app/api/admin/social/posts/[id]/tiktok/route"

const creator = {
  avatarUrl: null,
  username: "djp",
  nickname: "DJP",
  privacyLevelOptions: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
  commentDisabled: false,
  duetDisabled: false,
  stitchDisabled: false,
  maxVideoPostDurationSec: 600,
}

const settings = {
  privacy_level: "PUBLIC_TO_EVERYONE",
  allow_comment: true,
  allow_duet: false,
  allow_stitch: false,
  disclose: false,
  your_brand: false,
  branded_content: false,
}

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

async function callGet(id = "p1") {
  const req = new Request(`http://localhost/api/admin/social/posts/${id}/tiktok`)
  return GET(req as never, { params: Promise.resolve({ id }) })
}

async function callPut(body: unknown, id = "p1") {
  const req = new Request(`http://localhost/api/admin/social/posts/${id}/tiktok`, {
    method: "PUT",
    body: JSON.stringify(body),
  })
  return PUT(req as never, { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "a", role: "admin" } })
  listPlatformConnectionsMock.mockResolvedValue([])
  registryGetMock.mockReturnValue({ creatorInfo: creatorInfoMock })
  resolveMediaUrlMock.mockResolvedValue("https://signed.example/video.mp4")
  getSocialPostWithMediaMock.mockResolvedValue({ media: [] })
  creatorInfoMock.mockResolvedValue({ ok: true, creator })
})

describe("GET /api/admin/social/posts/:id/tiktok", () => {
  it("401 when not admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "c", role: "client" } })
    const res = await callGet()
    expect(res.status).toBe(401)
  })

  it("404 when the post is missing", async () => {
    getSocialPostByIdMock.mockResolvedValue(null)
    const res = await callGet("nope")
    expect(res.status).toBe(404)
  })

  it("404 when the post is not a TikTok post", async () => {
    getSocialPostByIdMock.mockResolvedValue(post({ platform: "instagram" }))
    const res = await callGet()
    expect(res.status).toBe(404)
    expect(creatorInfoMock).not.toHaveBeenCalled()
  })

  it("409 when TikTok is not connected", async () => {
    getSocialPostByIdMock.mockResolvedValue(post())
    registryGetMock.mockReturnValue(undefined)
    const res = await callGet()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "Connect TikTok on the Connections page first." })
    expect(registryGetMock).toHaveBeenCalledWith("tiktok")
  })

  it("409 when the post has no video to send", async () => {
    getSocialPostByIdMock.mockResolvedValue(post())
    resolveMediaUrlMock.mockResolvedValue(null)
    const res = await callGet()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "This post has no video to send." })
    expect(resolveMediaUrlMock).toHaveBeenCalledWith({ source_video_id: "v1", media_url: null })
    // The preview is resolved before creator info, so a post with no video never asks TikTok.
    expect(creatorInfoMock).not.toHaveBeenCalled()
  })

  it("previews the attached cut, not the raw source video, when the post has one", async () => {
    getSocialPostByIdMock.mockResolvedValue(post())
    getSocialPostWithMediaMock.mockResolvedValue({ media: [{ asset: { public_url: "cuts/p1-captioned.mp4" } }] })
    resolveMediaUrlMock.mockImplementation(async ({ media_url }: { media_url: string | null }) =>
      media_url === "cuts/p1-captioned.mp4" ? "https://signed.example/cut.mp4" : "https://signed.example/video.mp4",
    )
    const res = await callGet()
    expect(res.status).toBe(200)
    expect((await res.json()).previewUrl).toBe("https://signed.example/cut.mp4")
    expect(getSocialPostWithMediaMock).toHaveBeenCalledWith("p1")
  })

  it("409 with the plain-words refusal when TikTok refuses creator info", async () => {
    getSocialPostByIdMock.mockResolvedValue(post())
    creatorInfoMock.mockResolvedValue({
      ok: false,
      code: "spam_risk_too_many_posts",
      message: "too many",
    })
    const res = await callGet()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: creatorInfoRefusal("spam_risk_too_many_posts", "too many"),
    })
  })

  it("502 with a retry message when TikTok cannot be reached", async () => {
    getSocialPostByIdMock.mockResolvedValue(post())
    creatorInfoMock.mockResolvedValue({ ok: false, code: "network_error", message: "fetch failed" })
    const res = await callGet()
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: "Couldn't reach TikTok. Try again." })
  })

  it("200 with creator, preview URL and the settings saved earlier", async () => {
    getSocialPostByIdMock.mockResolvedValue(post({ tiktok_settings: settings }))
    const res = await callGet()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      creator,
      previewUrl: "https://signed.example/video.mp4",
      saved: settings,
    })
  })

  it("200 with saved null when nothing was saved", async () => {
    getSocialPostByIdMock.mockResolvedValue(post({ tiktok_settings: undefined }))
    const res = await callGet()
    expect(res.status).toBe(200)
    expect((await res.json()).saved).toBeNull()
  })
})

describe("PUT /api/admin/social/posts/:id/tiktok", () => {
  it("401 when not admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "c", role: "client" } })
    const res = await callPut({ settings })
    expect(res.status).toBe(401)
  })

  it("404 when the post is missing", async () => {
    getSocialPostByIdMock.mockResolvedValue(null)
    const res = await callPut({ settings }, "nope")
    expect(res.status).toBe(404)
  })

  it("404 when the post is not a TikTok post", async () => {
    getSocialPostByIdMock.mockResolvedValue(post({ platform: "instagram" }))
    const res = await callPut({ settings })
    expect(res.status).toBe(404)
    expect(updateSocialPostMock).not.toHaveBeenCalled()
  })

  it.each(["published", "rejected"])("409 when the post is %s", async (approval_status) => {
    getSocialPostByIdMock.mockResolvedValue(post({ approval_status }))
    const res = await callPut({ settings })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: `Cannot change a ${approval_status} post` })
    expect(updateSocialPostMock).not.toHaveBeenCalled()
  })

  it("400 with the first issue's message when settings fail the schema", async () => {
    getSocialPostByIdMock.mockResolvedValue(post())
    const res = await callPut({ settings: { ...settings, disclose: true } })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: "Indicate if your content promotes yourself, a third party, or both.",
    })
    expect(updateSocialPostMock).not.toHaveBeenCalled()
  })

  it("400 when the body is missing settings", async () => {
    getSocialPostByIdMock.mockResolvedValue(post())
    const res = await callPut({})
    expect(res.status).toBe(400)
    expect(updateSocialPostMock).not.toHaveBeenCalled()
  })

  it("200 and writes only tiktok_settings", async () => {
    getSocialPostByIdMock.mockResolvedValue(post())
    updateSocialPostMock.mockResolvedValue({ id: "p1", tiktok_settings: settings })
    const res = await callPut({ settings })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tiktok_settings: settings })
    expect(updateSocialPostMock).toHaveBeenCalledTimes(1)
    expect(updateSocialPostMock).toHaveBeenCalledWith("p1", { tiktok_settings: settings })
  })
})
