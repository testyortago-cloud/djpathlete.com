// __tests__/lib/social/youtube-shorts.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createYouTubeShortsPlugin } from "@/lib/social/plugins/youtube-shorts"

describe("YouTubeShortsPlugin", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("publish() injects #Shorts tag + appends to description when missing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([1]).buffer,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: "short_abc" }),
      })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createYouTubeShortsPlugin({
      access_token: "tok",
      refresh_token: "r",
      client_id: "id",
      client_secret: "secret",
    })

    await plugin.publish({
      content: "Ground reaction drill\n\nShort demo of a key cue.",
      mediaUrl: "https://example.com/short.mp4",
      scheduledAt: null,
    })

    const uploadInit = fetchMock.mock.calls[1][1] as RequestInit
    const bodyBytes = uploadInit.body as Uint8Array
    const body = new TextDecoder().decode(bodyBytes)
    expect(body).toContain("#Shorts")
  })

  it("publish() does not duplicate #Shorts if already present in content", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([1]).buffer,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: "s2" }),
      })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createYouTubeShortsPlugin({
      access_token: "tok",
      refresh_token: "r",
      client_id: "id",
      client_secret: "secret",
    })
    await plugin.publish({
      content: "Drill #Shorts\n\nExplanation #Shorts",
      mediaUrl: "https://example.com/short.mp4",
      scheduledAt: null,
    })

    const uploadInit = fetchMock.mock.calls[1][1] as RequestInit
    const bodyBytes = uploadInit.body as Uint8Array
    const body = new TextDecoder().decode(bodyBytes)
    const matches = body.match(/#Shorts/g) ?? []
    expect(matches.length).toBe(2) // two existing tags, nothing added
  })

  it("plugin.name is 'youtube_shorts'", () => {
    const plugin = createYouTubeShortsPlugin({
      access_token: "tok",
      refresh_token: "r",
      client_id: "id",
      client_secret: "secret",
    })
    expect(plugin.name).toBe("youtube_shorts")
    expect(plugin.displayName).toBe("YouTube Shorts")
  })
})
