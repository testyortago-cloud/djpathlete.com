// __tests__/lib/social/instagram.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createInstagramPlugin } from "@/lib/social/plugins/instagram"

describe("InstagramPlugin", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("publish() creates a media container, waits for FINISHED, then publishes it", async () => {
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
        text: async () => JSON.stringify({ status_code: "FINISHED" }),
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
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(String(fetchMock.mock.calls[1][0])).toContain("container_111?fields=status_code")

    const [createUrl, createInit] = fetchMock.mock.calls[0]
    expect(createUrl).toContain("/ig123/media")
    const createBody = JSON.parse((createInit as RequestInit).body as string)
    expect(createBody.image_url).toBe("https://example.com/pic.jpg")
    expect(createBody.caption).toBe("first post")

    const [publishUrl, publishInit] = fetchMock.mock.calls[2]
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
        text: async () => JSON.stringify({ status_code: "FINISHED" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: "media_reel" }),
      })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createInstagramPlugin({ access_token: "tok", ig_user_id: "ig123" }, { sleep: async () => {} })
    await plugin.publish({ content: "caption", mediaUrl: "https://example.com/vid.mp4", scheduledAt: null })

    expect(String(fetchMock.mock.calls[1][0])).toContain("?fields=status_code")

    const createBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(createBody.video_url).toBe("https://example.com/vid.mp4")
    expect(createBody.media_type).toBe("REELS")
    expect(createBody).not.toHaveProperty("cover_url")
  })

  // 2026-10-07: a PNG testimonial failed with "Media ID is not available" — media_publish
  // was called before Instagram had finished the image container.
  it("publish() answers pending, without calling media_publish, while an image container is processing", async () => {
    const NOW = new Date("2026-10-07T21:00:00.000Z")
    const fetchMock = vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify(String(url).endsWith("/ig123/media") ? { id: "container_img" } : { status_code: "IN_PROGRESS" }),
    }))
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createInstagramPlugin(
      { access_token: "tok", ig_user_id: "ig123" },
      { sleep: async () => {}, now: () => NOW },
    )
    const result = await plugin.publish({ content: "x", mediaUrl: "https://example.com/big.png", scheduledAt: null })

    expect(result).toEqual({
      success: true,
      pending: { startedAt: NOW.toISOString(), data: { step: "publish", containerId: "container_img" } },
    })
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("media_publish"))).toBe(false)
  })

  it("publish() sends the custom thumbnail as cover_url on a Reel, and never on an image", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify(
          String(url).endsWith("/media") ? { id: "c1" } : String(url).endsWith("/media_publish") ? { id: "m1" } : { status_code: "FINISHED" },
        ),
    }))
    vi.stubGlobal("fetch", fetchMock)
    const plugin = createInstagramPlugin({ access_token: "tok", ig_user_id: "ig123" }, { sleep: async () => {} })

    await plugin.publish({
      content: "reel",
      mediaUrl: "https://example.com/vid.mp4",
      coverUrl: "https://signed.example/cover.jpg",
      scheduledAt: null,
    })
    const reelBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(reelBody.cover_url).toBe("https://signed.example/cover.jpg")

    fetchMock.mockClear()
    await plugin.publish({
      content: "photo",
      mediaUrl: "https://example.com/pic.jpg",
      coverUrl: "https://signed.example/cover.jpg",
      scheduledAt: null,
    })
    const imageBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(imageBody).not.toHaveProperty("cover_url")
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
