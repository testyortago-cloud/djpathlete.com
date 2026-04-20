// __tests__/lib/social/instagram.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createInstagramPlugin } from "@/lib/social/plugins/instagram"

describe("InstagramPlugin", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("publish() creates a media container then publishes it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: "container_111" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: "media_222" }),
      })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createInstagramPlugin({ access_token: "tok", ig_user_id: "ig123" })
    const result = await plugin.publish({
      content: "first post",
      mediaUrl: "https://example.com/pic.jpg",
      scheduledAt: null,
    })

    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("media_222")
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const [createUrl, createInit] = fetchMock.mock.calls[0]
    expect(createUrl).toContain("/ig123/media")
    const createBody = JSON.parse((createInit as RequestInit).body as string)
    expect(createBody.image_url).toBe("https://example.com/pic.jpg")
    expect(createBody.caption).toBe("first post")

    const [publishUrl, publishInit] = fetchMock.mock.calls[1]
    expect(publishUrl).toContain("/ig123/media_publish")
    const publishBody = JSON.parse((publishInit as RequestInit).body as string)
    expect(publishBody.creation_id).toBe("container_111")
  })

  it("publish() uses video_url + media_type=REELS when mediaUrl is a video", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: "container_reel" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: "media_reel" }),
      })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createInstagramPlugin({ access_token: "tok", ig_user_id: "ig123" })
    await plugin.publish({ content: "caption", mediaUrl: "https://example.com/vid.mp4", scheduledAt: null })

    const createBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(createBody.video_url).toBe("https://example.com/vid.mp4")
    expect(createBody.media_type).toBe("REELS")
  })

  it("publish() returns failure if the container creation fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: { message: "Invalid image URL" } }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createInstagramPlugin({ access_token: "tok", ig_user_id: "ig123" })
    const result = await plugin.publish({
      content: "x",
      mediaUrl: "https://example.com/broken.jpg",
      scheduledAt: null,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain("Invalid image URL")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("getSetupInstructions() mentions Business or Creator account", async () => {
    const plugin = createInstagramPlugin({ access_token: "tok", ig_user_id: "ig123" })
    const instructions = await plugin.getSetupInstructions()
    expect(instructions).toMatch(/Business|Creator/i)
  })
})
