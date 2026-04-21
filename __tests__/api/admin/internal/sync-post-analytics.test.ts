// __tests__/api/admin/internal/sync-post-analytics.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const getSocialPostByIdMock = vi.fn()
const listPlatformConnectionsMock = vi.fn()
const bootstrapPluginsMock = vi.fn()
const registryGetMock = vi.fn()

vi.mock("@/lib/db/social-posts", () => ({
  getSocialPostById: (x: string) => getSocialPostByIdMock(x),
}))
vi.mock("@/lib/db/platform-connections", () => ({
  listPlatformConnections: () => listPlatformConnectionsMock(),
}))
vi.mock("@/lib/social/bootstrap", () => ({
  bootstrapPlugins: (conns: unknown, opts: unknown) => bootstrapPluginsMock(conns, opts),
}))
vi.mock("@/lib/social/registry", () => ({
  pluginRegistry: {
    get: (name: string) => registryGetMock(name),
  },
}))

import { POST } from "@/app/api/admin/internal/sync-post-analytics/route"

const TOKEN = "test-token-xyz"
const AUTH = `Bearer ${TOKEN}`
const VALID_ID = "550e8400-e29b-41d4-a716-446655440000"

function makeRequest(body: unknown, authHeader = AUTH): Request {
  return new Request("http://localhost/api/admin/internal/sync-post-analytics", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: authHeader },
    body: JSON.stringify(body),
  })
}

describe("POST /api/admin/internal/sync-post-analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.INTERNAL_CRON_TOKEN = TOKEN
    listPlatformConnectionsMock.mockResolvedValue([])
  })

  it("returns 401 when the bearer token is missing", async () => {
    const res = await POST(makeRequest({ socialPostId: VALID_ID }, ""))
    expect(res.status).toBe(401)
  })

  it("returns 401 when the bearer token is wrong", async () => {
    const res = await POST(makeRequest({ socialPostId: VALID_ID }, "Bearer nope"))
    expect(res.status).toBe(401)
  })

  it("returns 400 when socialPostId is missing or not a uuid", async () => {
    const res = await POST(makeRequest({ socialPostId: "not-a-uuid" }))
    expect(res.status).toBe(400)
  })

  it("returns 404 when the post doesn't exist", async () => {
    getSocialPostByIdMock.mockResolvedValue(null)
    const res = await POST(makeRequest({ socialPostId: VALID_ID }))
    expect(res.status).toBe(404)
  })

  it("returns 409 when the post isn't published", async () => {
    getSocialPostByIdMock.mockResolvedValue({
      id: VALID_ID,
      platform: "instagram",
      approval_status: "draft",
      platform_post_id: "ig_1",
    })
    const res = await POST(makeRequest({ socialPostId: VALID_ID }))
    expect(res.status).toBe(409)
  })

  it("returns 409 when the post has no platform_post_id", async () => {
    getSocialPostByIdMock.mockResolvedValue({
      id: VALID_ID,
      platform: "instagram",
      approval_status: "published",
      platform_post_id: null,
    })
    const res = await POST(makeRequest({ socialPostId: VALID_ID }))
    expect(res.status).toBe(409)
  })

  it("returns 200 with metrics: null when the platform plugin isn't registered", async () => {
    getSocialPostByIdMock.mockResolvedValue({
      id: VALID_ID,
      platform: "tiktok",
      approval_status: "published",
      platform_post_id: "tt_1",
    })
    registryGetMock.mockReturnValue(undefined)
    const res = await POST(makeRequest({ socialPostId: VALID_ID }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.metrics).toBeNull()
    expect(body.reason).toBe("plugin_not_connected")
  })

  it("returns 200 with metrics: null when the plugin returns an empty object", async () => {
    getSocialPostByIdMock.mockResolvedValue({
      id: VALID_ID,
      platform: "linkedin",
      approval_status: "published",
      platform_post_id: "li_1",
    })
    const fetchAnalytics = vi.fn().mockResolvedValue({})
    registryGetMock.mockReturnValue({ fetchAnalytics })
    const res = await POST(makeRequest({ socialPostId: VALID_ID }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.metrics).toBeNull()
    expect(fetchAnalytics).toHaveBeenCalledWith("li_1")
  })

  it("returns 200 with the plugin's metrics on the happy path", async () => {
    getSocialPostByIdMock.mockResolvedValue({
      id: VALID_ID,
      platform: "facebook",
      approval_status: "published",
      platform_post_id: "fb_1",
    })
    const fetchAnalytics = vi.fn().mockResolvedValue({ impressions: 500, engagement: 25 })
    registryGetMock.mockReturnValue({ fetchAnalytics })
    const res = await POST(makeRequest({ socialPostId: VALID_ID }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.metrics).toEqual({ impressions: 500, engagement: 25 })
    expect(body.platformPostId).toBe("fb_1")
  })

  it("returns 502 when the plugin throws", async () => {
    getSocialPostByIdMock.mockResolvedValue({
      id: VALID_ID,
      platform: "youtube",
      approval_status: "published",
      platform_post_id: "yt_1",
    })
    registryGetMock.mockReturnValue({
      fetchAnalytics: vi.fn().mockRejectedValue(new Error("rate limited")),
    })
    const res = await POST(makeRequest({ socialPostId: VALID_ID }))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toContain("rate limited")
  })
})
