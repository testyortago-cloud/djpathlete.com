// __tests__/lib/social/facebook.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createFacebookPlugin } from "@/lib/social/plugins/facebook"

describe("FacebookPlugin", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("publish() posts content to /{page_id}/feed with access_token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: "123_456" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createFacebookPlugin({ access_token: "tok", page_id: "123" })
    const result = await plugin.publish({ content: "hello world", mediaUrl: null, scheduledAt: null })

    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("123_456")

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain("graph.facebook.com")
    expect(url).toContain("/123/feed")
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.message).toBe("hello world")
    expect(body.access_token).toBe("tok")
  })

  it("publish() switches to /photos when mediaUrl ends with image extension", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: "789" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createFacebookPlugin({ access_token: "tok", page_id: "123" })
    await plugin.publish({ content: "caption", mediaUrl: "https://example.com/pic.jpg", scheduledAt: null })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain("/123/photos")
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.url).toBe("https://example.com/pic.jpg")
    expect(body.caption).toBe("caption")
  })

  it("publish() returns success=false with error text on non-2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: { message: "Invalid token" } }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createFacebookPlugin({ access_token: "bad", page_id: "123" })
    const result = await plugin.publish({ content: "x", mediaUrl: null, scheduledAt: null })

    expect(result.success).toBe(false)
    expect(result.error).toContain("Invalid token")
  })

  it("fetchAnalytics() queries insights endpoint with post_impressions and post_engagements", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          data: [
            { name: "post_impressions", values: [{ value: 1234 }] },
            { name: "post_engagements", values: [{ value: 56 }] },
          ],
        }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createFacebookPlugin({ access_token: "tok", page_id: "123" })
    const analytics = await plugin.fetchAnalytics("123_456")

    expect(analytics.impressions).toBe(1234)
    expect(analytics.engagement).toBe(56)

    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain("/123_456/insights")
    expect(url).toContain("metric=post_impressions%2Cpost_engagements")
  })

  it("getSetupInstructions() returns a non-empty guide", async () => {
    const plugin = createFacebookPlugin({ access_token: "tok", page_id: "123" })
    const instructions = await plugin.getSetupInstructions()
    expect(instructions.length).toBeGreaterThan(100)
    expect(instructions).toMatch(/Facebook Page/i)
  })
})
