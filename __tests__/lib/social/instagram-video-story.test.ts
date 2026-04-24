import { describe, it, expect, beforeEach, vi } from "vitest"
import { createInstagramPlugin } from "@/lib/social/plugins/instagram"

const IG = "https://graph.facebook.com/v22.0"

function jsonResp(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response
}

describe("Instagram plugin — video Story", () => {
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

  it("publishes a video story: container with video_url + media_type=STORIES, polls, publishes", async () => {
    const fetchMock = mockFetchSequence([
      () => jsonResp({ id: "video-story-container" }),
      () => jsonResp({ status_code: "FINISHED" }),
      () => jsonResp({ id: "ig-video-story-final" }),
    ])

    const plugin = createInstagramPlugin({ access_token: "tok", ig_user_id: "ig-user-1" })
    const result = await plugin.publish({
      content: "caption ignored on stories",
      mediaUrl: "https://signed.example/story-clip.mp4",
      postType: "story",
      scheduledAt: null,
    })

    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("ig-video-story-final")

    // Step 1: container uses video_url (not image_url) and media_type=STORIES
    const containerBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(containerBody.video_url).toBe("https://signed.example/story-clip.mp4")
    expect(containerBody.media_type).toBe("STORIES")
    expect(containerBody.image_url).toBeUndefined()
    expect(containerBody.caption).toBeUndefined()
  })

  it("publishes an image story with the same postType=story branch (image path unchanged)", async () => {
    const fetchMock = mockFetchSequence([
      () => jsonResp({ id: "image-story-container" }),
      () => jsonResp({ status_code: "FINISHED" }),
      () => jsonResp({ id: "ig-image-story-final" }),
    ])

    const plugin = createInstagramPlugin({ access_token: "tok", ig_user_id: "ig-user-1" })
    const result = await plugin.publish({
      content: "",
      mediaUrl: "https://signed.example/photo.jpg",
      postType: "story",
      scheduledAt: null,
    })
    expect(result.success).toBe(true)

    const containerBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(containerBody.image_url).toBe("https://signed.example/photo.jpg")
    expect(containerBody.media_type).toBe("STORIES")
    expect(containerBody.video_url).toBeUndefined()
  })
})
