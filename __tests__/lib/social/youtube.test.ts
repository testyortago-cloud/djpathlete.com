// __tests__/lib/social/youtube.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createYouTubePlugin } from "@/lib/social/plugins/youtube"

describe("YouTubePlugin", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("publish() uploads the video with the correct multipart metadata", async () => {
    const videoBytes = new Uint8Array([1, 2, 3])

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => videoBytes.buffer,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: "vid_xyz", status: { uploadStatus: "uploaded" } }),
      })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createYouTubePlugin({
      access_token: "tok",
      refresh_token: "refresh",
      client_id: "id",
      client_secret: "secret",
    })

    const result = await plugin.publish({
      content: "Rotational power drill — breakdown and cues\n\nExplanation here.",
      mediaUrl: "https://example.com/video.mp4",
      scheduledAt: null,
    })

    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("vid_xyz")

    const [uploadUrl, uploadInit] = fetchMock.mock.calls[1]
    expect(uploadUrl).toContain("youtube/v3/videos")
    expect(uploadUrl).toContain("uploadType=multipart")
    expect((uploadInit as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok",
    })
  })

  it("publish() refreshes the token on 401 then retries once", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([9]).buffer,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: "new_tok", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: "vid_after_refresh" }),
      })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createYouTubePlugin({
      access_token: "expired",
      refresh_token: "refresh",
      client_id: "id",
      client_secret: "secret",
    })

    const result = await plugin.publish({
      content: "title\n\ndescription",
      mediaUrl: "https://example.com/v.mp4",
      scheduledAt: null,
    })

    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("vid_after_refresh")

    const [refreshUrl, refreshInit] = fetchMock.mock.calls[2]
    expect(refreshUrl).toContain("oauth2.googleapis.com/token")
    expect((refreshInit as RequestInit).body as string).toContain("grant_type=refresh_token")

    const [, retryInit] = fetchMock.mock.calls[3]
    expect((retryInit as RequestInit).headers).toMatchObject({
      Authorization: "Bearer new_tok",
    })
  })

  it("publish() splits content by first double-newline into title (line 1) + description (rest)", async () => {
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
        text: async () => JSON.stringify({ id: "v1" }),
      })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createYouTubePlugin({
      access_token: "tok",
      refresh_token: "r",
      client_id: "id",
      client_secret: "secret",
    })

    await plugin.publish({
      content: "My Video Title\n\nLine 1 of description.\nLine 2.",
      mediaUrl: "https://example.com/v.mp4",
      scheduledAt: null,
    })

    const uploadInit = fetchMock.mock.calls[1][1] as RequestInit
    // Body is a Uint8Array (multipart binary). Decode to text to check metadata.
    const bodyBytes = uploadInit.body as Uint8Array
    const bodyStr = new TextDecoder().decode(bodyBytes)
    expect(bodyStr).toContain('"title":"My Video Title"')
    expect(bodyStr).toContain('"description":"Line 1 of description.\\nLine 2."')
  })

  it("getSetupInstructions() mentions YouTube channel + Google Cloud Console", async () => {
    const plugin = createYouTubePlugin({
      access_token: "tok",
      refresh_token: "r",
      client_id: "id",
      client_secret: "secret",
    })
    const instructions = await plugin.getSetupInstructions()
    expect(instructions).toMatch(/YouTube channel/i)
    expect(instructions).toMatch(/Google Cloud/i)
  })
})
