// __tests__/lib/social/tiktok.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createTikTokPlugin } from "@/lib/social/plugins/tiktok"

const BASE_CREDS = {
  access_token: "at",
  refresh_token: "rt",
  client_key: "ck",
  client_secret: "cs",
}

function mockFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  const fetchMock = vi.fn()
  for (const r of responses) {
    fetchMock.mockImplementationOnce(async () =>
      new Response(JSON.stringify(r.body), {
        status: r.status,
        headers: { "content-type": "application/json" },
      }),
    )
  }
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

describe("TikTokPlugin (Content Posting API)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("plugin.name is 'tiktok'", () => {
    const plugin = createTikTokPlugin(BASE_CREDS)
    expect(plugin.name).toBe("tiktok")
  })

  it("publish() sends the init request with PULL_FROM_URL and returns publish_id", async () => {
    const fetchMock = mockFetchSequence([
      { status: 200, body: { data: { publish_id: "pub_abc123" } } },
    ])

    const plugin = createTikTokPlugin(BASE_CREDS)
    const result = await plugin.publish({
      content: "Hook caption",
      mediaUrl: "https://media.example.com/v.mp4",
      scheduledAt: null,
    })

    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("pub_abc123")

    const [initCall] = fetchMock.mock.calls
    const [initUrl, initInit] = initCall as [string, RequestInit]
    expect(initUrl).toBe("https://open.tiktokapis.com/v2/post/publish/video/init/")
    const body = JSON.parse(initInit.body as string) as {
      source_info: { source: string; video_url: string }
      post_info: { privacy_level: string; title: string }
    }
    expect(body.source_info.source).toBe("PULL_FROM_URL")
    expect(body.source_info.video_url).toBe("https://media.example.com/v.mp4")
    expect(body.post_info.privacy_level).toBe("SELF_ONLY")
  })

  it("publish() returns error when mediaUrl is missing", async () => {
    const plugin = createTikTokPlugin(BASE_CREDS)
    const result = await plugin.publish({ content: "caption", mediaUrl: null, scheduledAt: null })
    expect(result.success).toBe(false)
    expect(result.error).toContain("video URL")
  })

  it("publish() refreshes token on 401 and retries", async () => {
    const fetchMock = mockFetchSequence([
      { status: 401, body: { error: { code: "access_token_invalid" } } },
      { status: 200, body: { access_token: "new_at", refresh_token: "new_rt" } },
      { status: 200, body: { data: { publish_id: "pub_xyz" } } },
    ])

    const plugin = createTikTokPlugin(BASE_CREDS)
    const result = await plugin.publish({
      content: "caption",
      mediaUrl: "https://media.example.com/v.mp4",
      scheduledAt: null,
    })

    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("pub_xyz")
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const tokenCall = fetchMock.mock.calls[1]
    expect(tokenCall[0]).toBe("https://open.tiktokapis.com/v2/oauth/token/")
  })

  it("fetchAnalytics() resolves publish_id to video stats", async () => {
    mockFetchSequence([
      // publish status → returns real video id
      {
        status: 200,
        body: { data: { publicaly_available_post_id: ["123456789012345"] } },
      },
      // video query → returns stats
      {
        status: 200,
        body: {
          data: {
            videos: [
              { view_count: 1000, like_count: 50, comment_count: 5, share_count: 2 },
            ],
          },
        },
      },
    ])

    const plugin = createTikTokPlugin(BASE_CREDS)
    const analytics = await plugin.fetchAnalytics("pub_abc")
    expect(analytics).toEqual({ views: 1000, likes: 50, comments: 5, shares: 2 })
  })

  it("connect() returns handle prefixed with @ when username is present", async () => {
    mockFetchSequence([
      // refresh token
      { status: 200, body: { access_token: "new_at" } },
      // user info
      { status: 200, body: { data: { user: { username: "djpathlete" } } } },
    ])

    const plugin = createTikTokPlugin(BASE_CREDS)
    const result = await plugin.connect({})
    expect(result.status).toBe("connected")
    expect(result.account_handle).toBe("@djpathlete")
  })
})
