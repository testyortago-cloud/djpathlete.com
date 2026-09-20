// __tests__/lib/social/tiktok.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createTikTokPlugin, planUpload, chunkRange } from "@/lib/social/plugins/tiktok"

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

const MEDIA_URL = "https://media.example.com/v.mp4"
const UPLOAD_URL = "https://upload.tiktokapis.com/upload/abc"
const INIT_URL = "https://open.tiktokapis.com/v2/post/publish/video/init/"
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"
const MB = 1024 * 1024

interface FlowCall {
  url: string
  method: string
  headers: Record<string, string>
  body?: unknown
}

/**
 * Routes by URL rather than by call order, because the FILE_UPLOAD flow is
 * HEAD the media -> POST init -> PUT each chunk, and a positional mock makes
 * the chunk assertions unreadable.
 */
function mockFlow(
  opts: {
    size?: number | null
    initStatus?: number
    initBody?: unknown
    putStatus?: number
    refreshOnFirstInit?: boolean
  } = {},
) {
  const {
    size = 1024,
    initStatus = 200,
    initBody = { data: { publish_id: "pub_abc123", upload_url: UPLOAD_URL } },
    putStatus = 200,
    refreshOnFirstInit = false,
  } = opts
  const calls: FlowCall[] = []
  let initSeen = 0

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = (init.method ?? "GET").toUpperCase()
    const headers: Record<string, string> = {}
    new Headers(init.headers).forEach((v, k) => {
      headers[k] = v
    })
    calls.push({ url, method, headers, body: init.body })

    if (url === MEDIA_URL && method === "HEAD") {
      if (size === null) return new Response(null, { status: 405 })
      return new Response(null, {
        status: 200,
        headers: { "content-length": String(size), "content-type": "video/mp4" },
      })
    }
    if (url === MEDIA_URL) {
      const range = headers["range"]
      const total = size ?? 1024
      let length = total
      if (range) {
        const m = /bytes=(\d+)-(\d+)/.exec(range)
        if (m) length = Number(m[2]) - Number(m[1]) + 1
      }
      return new Response(new Uint8Array(length), {
        status: 200,
        headers: { "content-type": "video/mp4" },
      })
    }
    if (url === TOKEN_URL) return json(200, { access_token: "new_at", refresh_token: "new_rt" })
    if (url === INIT_URL) {
      initSeen++
      if (refreshOnFirstInit && initSeen === 1) {
        return json(401, { error: { code: "access_token_invalid" } })
      }
      return json(initStatus, initBody)
    }
    if (url === UPLOAD_URL) return new Response(null, { status: putStatus })
    throw new Error(`unexpected fetch: ${method} ${url}`)
  })

  globalThis.fetch = fetchMock as unknown as typeof fetch
  return { fetchMock, calls, puts: () => calls.filter((c) => c.url === UPLOAD_URL) }
}

describe("TikTokPlugin (Content Posting API)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("plugin.name is 'tiktok'", () => {
    const plugin = createTikTokPlugin(BASE_CREDS)
    expect(plugin.name).toBe("tiktok")
  })

  // Was: asserted PULL_FROM_URL. TikTok answered 403 url_ownership_unverified on
  // every video, because the URL is a Firebase signed URL on
  // storage.googleapis.com -- a domain we can never verify as ours. FILE_UPLOAD
  // has no domain rule: TikTok hands back an upload_url and we PUT the bytes.
  it("publish() inits with FILE_UPLOAD carrying the real byte size, not a URL", async () => {
    const { calls } = mockFlow({ size: 2 * MB })

    const plugin = createTikTokPlugin(BASE_CREDS)
    const result = await plugin.publish({
      content: "Hook caption",
      mediaUrl: MEDIA_URL,
      scheduledAt: null,
    })

    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("pub_abc123")

    const init = calls.find((c) => c.url === INIT_URL)!
    const body = JSON.parse(init.body as string) as {
      source_info: { source: string; video_size: number; chunk_size: number; total_chunk_count: number; video_url?: string }
      post_info: { privacy_level: string; title: string }
    }
    expect(body.source_info.source).toBe("FILE_UPLOAD")
    expect(body.source_info.video_size).toBe(2 * MB)
    expect(body.source_info.chunk_size).toBe(2 * MB)
    expect(body.source_info.total_chunk_count).toBe(1)
    // The URL must not travel to TikTok at all any more.
    expect(body.source_info.video_url).toBeUndefined()
    expect(init.body as string).not.toContain("PULL_FROM_URL")
    expect(body.post_info.privacy_level).toBe("SELF_ONLY")
    expect(body.post_info.title).toBe("Hook caption")
  })

  it("publish() PUTs the bytes to upload_url with a whole-file Content-Range", async () => {
    const { puts } = mockFlow({ size: 2 * MB })

    const plugin = createTikTokPlugin(BASE_CREDS)
    await plugin.publish({ content: "c", mediaUrl: MEDIA_URL, scheduledAt: null })

    expect(puts()).toHaveLength(1)
    expect(puts()[0].method).toBe("PUT")
    expect(puts()[0].headers["content-range"]).toBe(`bytes 0-${2 * MB - 1}/${2 * MB}`)
  })

  // upload_url is already a pre-signed TikTok URL; sending our bearer token to
  // it would hand the access token to their CDN host for no reason.
  it("publish() does NOT send the access token to upload_url", async () => {
    const { puts } = mockFlow({ size: 1024 })

    const plugin = createTikTokPlugin(BASE_CREDS)
    await plugin.publish({ content: "c", mediaUrl: MEDIA_URL, scheduledAt: null })

    expect(puts()[0].headers["authorization"]).toBeUndefined()
  })

  it("publish() splits a video over 64MB, and the LAST chunk absorbs the remainder", async () => {
    const size = 200 * MB
    const { puts } = mockFlow({ size })

    const plugin = createTikTokPlugin(BASE_CREDS)
    const result = await plugin.publish({ content: "c", mediaUrl: MEDIA_URL, scheduledAt: null })

    expect(result.success).toBe(true)
    const ranges = puts().map((c) => c.headers["content-range"])
    expect(ranges).toEqual([
      `bytes 0-${64 * MB - 1}/${size}`,
      `bytes ${64 * MB}-${128 * MB - 1}/${size}`,
      `bytes ${128 * MB}-${size - 1}/${size}`,
    ])
  })

  it("publish() falls back to downloading once when HEAD gives no length", async () => {
    const { calls, puts } = mockFlow({ size: null })

    const plugin = createTikTokPlugin(BASE_CREDS)
    const result = await plugin.publish({ content: "c", mediaUrl: MEDIA_URL, scheduledAt: null })

    expect(result.success).toBe(true)
    // No Range header on the fallback read -- it fetches the whole file once.
    const mediaGets = calls.filter((c) => c.url === MEDIA_URL && c.method === "GET")
    expect(mediaGets).toHaveLength(1)
    expect(mediaGets[0].headers["range"]).toBeUndefined()
    expect(puts()[0].headers["content-range"]).toBe("bytes 0-1023/1024")
  })

  it("publish() reports a failed chunk upload rather than claiming success", async () => {
    mockFlow({ size: 1024, putStatus: 403 })

    const plugin = createTikTokPlugin(BASE_CREDS)
    const result = await plugin.publish({ content: "c", mediaUrl: MEDIA_URL, scheduledAt: null })

    expect(result.success).toBe(false)
    expect(result.error).toContain("chunk 1/1")
    expect(result.error).toContain("403")
  })

  it("publish() fails when init returns no upload_url", async () => {
    mockFlow({ size: 1024, initBody: { data: { publish_id: "pub_only" } } })

    const plugin = createTikTokPlugin(BASE_CREDS)
    const result = await plugin.publish({ content: "c", mediaUrl: MEDIA_URL, scheduledAt: null })

    expect(result.success).toBe(false)
    expect(result.error).toContain("upload_url")
  })

  it("publish() returns error when mediaUrl is missing", async () => {
    const plugin = createTikTokPlugin(BASE_CREDS)
    const result = await plugin.publish({ content: "caption", mediaUrl: null, scheduledAt: null })
    expect(result.success).toBe(false)
    expect(result.error).toContain("video URL")
  })

  it("publish() refreshes token on 401 and retries the init", async () => {
    const { calls, puts } = mockFlow({ size: 1024, refreshOnFirstInit: true })

    const plugin = createTikTokPlugin(BASE_CREDS)
    const result = await plugin.publish({
      content: "caption",
      mediaUrl: MEDIA_URL,
      scheduledAt: null,
    })

    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("pub_abc123")
    expect(calls.some((c) => c.url === TOKEN_URL)).toBe(true)
    expect(calls.filter((c) => c.url === INIT_URL)).toHaveLength(2)
    // The upload still happens after the retry.
    expect(puts()).toHaveLength(1)
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

// TikTok's rule: chunk_size is 5-64MB, total_chunk_count is FLOOR(size/chunk),
// and the FINAL chunk absorbs the remainder. Getting this wrong either drops
// the tail of the video or sends a range past the end of the file.
describe("planUpload / chunkRange", () => {
  const MB_ = 1024 * 1024

  it("sends a video of 64MB or less as one chunk sized to the file", () => {
    expect(planUpload(2 * MB_)).toEqual({ chunkSize: 2 * MB_, totalChunkCount: 1 })
    expect(planUpload(64 * MB_)).toEqual({ chunkSize: 64 * MB_, totalChunkCount: 1 })
  })

  it("floors the chunk count, so 100MB is a single oversized chunk", () => {
    expect(planUpload(100 * MB_)).toEqual({ chunkSize: 64 * MB_, totalChunkCount: 1 })
  })

  it("floors the chunk count for a large video", () => {
    expect(planUpload(200 * MB_)).toEqual({ chunkSize: 64 * MB_, totalChunkCount: 3 })
  })

  it("covers every byte exactly once, with no gap and no overrun", () => {
    for (const size of [1, 1024, 64 * MB_, 100 * MB_, 200 * MB_, 321 * MB_ + 7]) {
      const plan = planUpload(size)
      const ranges = Array.from({ length: plan.totalChunkCount }, (_, i) =>
        chunkRange(i, plan, size),
      )
      expect(ranges[0].start).toBe(0)
      expect(ranges[ranges.length - 1].end).toBe(size - 1)
      for (let i = 1; i < ranges.length; i++) {
        expect(ranges[i].start).toBe(ranges[i - 1].end + 1)
      }
      const bytes = ranges.reduce((n, r) => n + (r.end - r.start + 1), 0)
      expect(bytes).toBe(size)
    }
  })

  it("keeps every chunk inside TikTok's 128MB ceiling", () => {
    for (const size of [100 * MB_, 200 * MB_, 321 * MB_ + 7, 1000 * MB_]) {
      const plan = planUpload(size)
      for (let i = 0; i < plan.totalChunkCount; i++) {
        const { start, end } = chunkRange(i, plan, size)
        expect(end - start + 1).toBeLessThanOrEqual(128 * MB_)
      }
    }
  })
})
