import { describe, it, expect, beforeEach, vi } from "vitest"
import { createInstagramPlugin } from "@/lib/social/plugins/instagram"

const IG = "https://graph.facebook.com/v22.0"

describe("Instagram plugin — story", () => {
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

  it("publishes a story: creates container with media_type=STORIES, polls, publishes", async () => {
    const fetchMock = mockFetchSequence([
      () => jsonResp({ id: "story-container-1" }),
      () => jsonResp({ status_code: "FINISHED" }),
      () => jsonResp({ id: "ig-story-final" }),
    ])

    const plugin = createInstagramPlugin({ access_token: "tok", ig_user_id: "ig-user-1" })
    const result = await plugin.publish({
      content: "caption that should be ignored on stories",
      mediaUrl: "https://signed.example/photo.jpg",
      postType: "story",
      scheduledAt: null,
    })

    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("ig-story-final")

    const calls = fetchMock.mock.calls
    expect(calls).toHaveLength(3)

    // Step 1: create container with media_type=STORIES, NO caption field
    expect(calls[0][0]).toBe(`${IG}/ig-user-1/media`)
    const containerBody = JSON.parse((calls[0][1] as RequestInit).body as string)
    expect(containerBody.image_url).toBe("https://signed.example/photo.jpg")
    expect(containerBody.media_type).toBe("STORIES")
    expect(containerBody.access_token).toBe("tok")
    expect(containerBody.caption).toBeUndefined()

    // Step 2: status poll
    expect((calls[1][0] as string)).toContain("story-container-1")
    expect((calls[1][0] as string)).toContain("fields=status_code")

    // Step 3: publish
    expect(calls[2][0]).toBe(`${IG}/ig-user-1/media_publish`)
    const publishBody = JSON.parse((calls[2][1] as RequestInit).body as string)
    expect(publishBody.creation_id).toBe("story-container-1")
  })

  it("returns failure when container creation fails", async () => {
    const fetchMock = mockFetchSequence([
      () => jsonResp({ error: { message: "MEDIA_URL_INVALID" } }, 400),
    ])

    const plugin = createInstagramPlugin({ access_token: "tok", ig_user_id: "ig-user-1" })
    const result = await plugin.publish({
      content: "",
      mediaUrl: "https://signed.example/photo.jpg",
      postType: "story",
      scheduledAt: null,
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/MEDIA_URL_INVALID|media_url|story/i)
    expect(fetchMock.mock.calls.length).toBe(1)
  })

  it("returns failure when container status returns ERROR", async () => {
    const fetchMock = mockFetchSequence([
      () => jsonResp({ id: "story-1" }),
      () => jsonResp({ status_code: "ERROR", status: "processing failed" }),
    ])

    const plugin = createInstagramPlugin({ access_token: "tok", ig_user_id: "ig-user-1" })
    const result = await plugin.publish({
      content: "",
      mediaUrl: "https://signed.example/photo.jpg",
      postType: "story",
      scheduledAt: null,
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/ERROR|processing failed/i)
  })

  it("returns failure when the final publish step fails", async () => {
    const fetchMock = mockFetchSequence([
      () => jsonResp({ id: "story-1" }),
      () => jsonResp({ status_code: "FINISHED" }),
      () => jsonResp({ error: { message: "rate limit" } }, 429),
    ])

    const plugin = createInstagramPlugin({ access_token: "tok", ig_user_id: "ig-user-1" })
    const result = await plugin.publish({
      content: "",
      mediaUrl: "https://signed.example/photo.jpg",
      postType: "story",
      scheduledAt: null,
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/rate limit/i)
  })
})
