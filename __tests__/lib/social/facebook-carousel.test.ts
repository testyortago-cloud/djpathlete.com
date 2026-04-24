import { describe, it, expect, beforeEach, vi } from "vitest"
import { createFacebookPlugin } from "@/lib/social/plugins/facebook"

const FB = "https://graph.facebook.com/v22.0"

describe("Facebook plugin — carousel", () => {
  beforeEach(() => vi.restoreAllMocks())

  function mockFetchSequence(responses: Array<() => Response | Promise<Response>>) {
    let i = 0
    const fetchMock = vi.fn().mockImplementation(async () => {
      if (i >= responses.length) throw new Error("fetch called more times than mocked")
      const fn = responses[i]
      i += 1
      return fn()
    })
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
  }

  function jsonResp(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
      json: async () => body,
    } as unknown as Response
  }

  it("publishes a 3-photo carousel — uploads unpublished then creates feed post with attached_media", async () => {
    const fetchMock = mockFetchSequence([
      () => jsonResp({ id: "photo-1", post_id: "page_photo-1" }),
      () => jsonResp({ id: "photo-2", post_id: "page_photo-2" }),
      () => jsonResp({ id: "photo-3", post_id: "page_photo-3" }),
      () => jsonResp({ id: "page-1_final-post" }),
    ])

    const plugin = createFacebookPlugin({ access_token: "tok", page_id: "page-1" })
    const result = await plugin.publish({
      content: "Swipe through our 3 tips",
      mediaUrl: "https://signed.example/a.jpg",
      mediaUrls: [
        "https://signed.example/a.jpg",
        "https://signed.example/b.jpg",
        "https://signed.example/c.jpg",
      ],
      scheduledAt: null,
    })

    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("page-1_final-post")

    const calls = fetchMock.mock.calls
    expect(calls).toHaveLength(4)

    // Photo uploads: POST /page-1/photos with url + published=false
    for (let i = 0; i < 3; i += 1) {
      expect(calls[i][0]).toBe(`${FB}/page-1/photos`)
      expect((calls[i][1] as RequestInit).method).toBe("POST")
      const body = JSON.parse((calls[i][1] as RequestInit).body as string)
      expect(body.url).toBe(
        ["https://signed.example/a.jpg", "https://signed.example/b.jpg", "https://signed.example/c.jpg"][i],
      )
      expect(body.published).toBe(false)
      expect(body.access_token).toBe("tok")
    }

    // Feed post: POST /page-1/feed with message + attached_media array in order
    expect(calls[3][0]).toBe(`${FB}/page-1/feed`)
    const feedBody = JSON.parse((calls[3][1] as RequestInit).body as string)
    expect(feedBody.message).toBe("Swipe through our 3 tips")
    expect(feedBody.attached_media).toEqual([
      { media_fbid: "photo-1" },
      { media_fbid: "photo-2" },
      { media_fbid: "photo-3" },
    ])
  })

  it("returns failure when a photo upload fails", async () => {
    const fetchMock = mockFetchSequence([
      () => jsonResp({ id: "photo-1" }),
      () => jsonResp({ error: { message: "image too large" } }, 400),
    ])

    const plugin = createFacebookPlugin({ access_token: "tok", page_id: "page-1" })
    const result = await plugin.publish({
      content: "x",
      mediaUrl: "https://signed.example/a.jpg",
      mediaUrls: [
        "https://signed.example/a.jpg",
        "https://signed.example/b.jpg",
      ],
      scheduledAt: null,
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/image too large|photo/i)
    // Should not proceed to /feed
    expect(fetchMock.mock.calls.length).toBe(2)
  })

  it("returns failure when the final /feed post fails", async () => {
    const fetchMock = mockFetchSequence([
      () => jsonResp({ id: "photo-1" }),
      () => jsonResp({ id: "photo-2" }),
      () => jsonResp({ error: { message: "page permission denied" } }, 403),
    ])

    const plugin = createFacebookPlugin({ access_token: "tok", page_id: "page-1" })
    const result = await plugin.publish({
      content: "x",
      mediaUrl: "https://signed.example/a.jpg",
      mediaUrls: [
        "https://signed.example/a.jpg",
        "https://signed.example/b.jpg",
      ],
      scheduledAt: null,
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/permission denied|feed/i)
  })

  it("passes scheduledAt through as scheduled_publish_time on the /feed post", async () => {
    const fetchMock = mockFetchSequence([
      () => jsonResp({ id: "photo-1" }),
      () => jsonResp({ id: "photo-2" }),
      () => jsonResp({ id: "page-1_scheduled" }),
    ])

    const plugin = createFacebookPlugin({ access_token: "tok", page_id: "page-1" })
    const future = "2026-08-15T14:00:00Z"
    await plugin.publish({
      content: "scheduled",
      mediaUrl: "https://signed.example/a.jpg",
      mediaUrls: [
        "https://signed.example/a.jpg",
        "https://signed.example/b.jpg",
      ],
      scheduledAt: future,
    })

    const feedBody = JSON.parse((fetchMock.mock.calls[2][1] as RequestInit).body as string)
    expect(feedBody.published).toBe(false)
    expect(feedBody.scheduled_publish_time).toBe(Math.floor(new Date(future).getTime() / 1000))
  })
})
