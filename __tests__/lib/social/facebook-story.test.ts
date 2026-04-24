import { describe, it, expect, beforeEach, vi } from "vitest"
import { createFacebookPlugin } from "@/lib/social/plugins/facebook"

const FB = "https://graph.facebook.com/v22.0"

describe("Facebook plugin — story", () => {
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

  it("publishes a photo story: uploads unpublished photo, attaches via /photo_stories", async () => {
    const fetchMock = mockFetchSequence([
      () => jsonResp({ id: "photo-xyz" }),
      () => jsonResp({ success: true, post_id: "page-1_story-final" }),
    ])

    const plugin = createFacebookPlugin({ access_token: "tok", page_id: "page-1" })
    const result = await plugin.publish({
      content: "caption that FB will ignore on stories",
      mediaUrl: "https://signed.example/photo.jpg",
      postType: "story",
      scheduledAt: null,
    })

    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("page-1_story-final")

    const calls = fetchMock.mock.calls
    expect(calls).toHaveLength(2)

    // Step 1: /photos with published=false
    expect(calls[0][0]).toBe(`${FB}/page-1/photos`)
    const photoBody = JSON.parse((calls[0][1] as RequestInit).body as string)
    expect(photoBody.url).toBe("https://signed.example/photo.jpg")
    expect(photoBody.published).toBe(false)
    expect(photoBody.access_token).toBe("tok")

    // Step 2: /photo_stories with photo_id
    expect(calls[1][0]).toBe(`${FB}/page-1/photo_stories`)
    const storyBody = JSON.parse((calls[1][1] as RequestInit).body as string)
    expect(storyBody.photo_id).toBe("photo-xyz")
    expect(storyBody.access_token).toBe("tok")
    // No message / caption sent
    expect(storyBody.message).toBeUndefined()
    expect(storyBody.caption).toBeUndefined()
  })

  it("returns failure when the photo upload fails", async () => {
    const fetchMock = mockFetchSequence([
      () => jsonResp({ error: { message: "image too large" } }, 400),
    ])

    const plugin = createFacebookPlugin({ access_token: "tok", page_id: "page-1" })
    const result = await plugin.publish({
      content: "",
      mediaUrl: "https://signed.example/photo.jpg",
      postType: "story",
      scheduledAt: null,
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/image too large|photo/i)
    expect(fetchMock.mock.calls.length).toBe(1)
  })

  it("returns failure when /photo_stories fails", async () => {
    const fetchMock = mockFetchSequence([
      () => jsonResp({ id: "photo-ok" }),
      () => jsonResp({ error: { message: "permission denied" } }, 403),
    ])

    const plugin = createFacebookPlugin({ access_token: "tok", page_id: "page-1" })
    const result = await plugin.publish({
      content: "",
      mediaUrl: "https://signed.example/photo.jpg",
      postType: "story",
      scheduledAt: null,
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/permission denied|story/i)
  })
})
