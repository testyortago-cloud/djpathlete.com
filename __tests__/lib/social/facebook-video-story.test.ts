import { describe, it, expect, beforeEach, vi } from "vitest"
import { createFacebookPlugin } from "@/lib/social/plugins/facebook"

const FB = "https://graph.facebook.com/v22.0"

function jsonResp(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response
}

describe("Facebook plugin — video Story", () => {
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

  it("publishes a video story via 3-phase /video_stories (start → upload → finish)", async () => {
    const fetchMock = mockFetchSequence([
      () => jsonResp({ video_id: "fb-video-1", upload_url: "https://upload.fb.example/abc" }),
      () => jsonResp({ success: true }, 200),
      () => jsonResp({ success: true, post_id: "page-1_final-vstory" }),
    ])

    const plugin = createFacebookPlugin({ access_token: "tok", page_id: "page-1" })
    const result = await plugin.publish({
      content: "caption ignored on stories",
      mediaUrl: "https://signed.example/clip.mp4",
      postType: "story",
      scheduledAt: null,
    })

    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("page-1_final-vstory")

    const calls = fetchMock.mock.calls
    expect(calls).toHaveLength(3)

    // Step 1: POST /video_stories with upload_phase=start
    expect(calls[0][0]).toBe(`${FB}/page-1/video_stories`)
    const startBody = JSON.parse((calls[0][1] as RequestInit).body as string)
    expect(startBody.upload_phase).toBe("start")
    expect(startBody.access_token).toBe("tok")

    // Step 2: POST to upload_url with file_url header (and OAuth Authorization)
    expect(calls[1][0]).toBe("https://upload.fb.example/abc")
    const uploadInit = calls[1][1] as RequestInit
    expect(uploadInit.method).toBe("POST")
    const uploadHeaders = (uploadInit.headers ?? {}) as Record<string, string>
    expect(uploadHeaders["file_url"]).toBe("https://signed.example/clip.mp4")
    expect(uploadHeaders.Authorization).toBe("OAuth tok")

    // Step 3: POST /video_stories with upload_phase=finish + video_id
    expect(calls[2][0]).toBe(`${FB}/page-1/video_stories`)
    const finishBody = JSON.parse((calls[2][1] as RequestInit).body as string)
    expect(finishBody.upload_phase).toBe("finish")
    expect(finishBody.video_id).toBe("fb-video-1")
  })

  it("publishes a photo story when mediaUrl is an image (existing path unchanged)", async () => {
    const fetchMock = mockFetchSequence([
      () => jsonResp({ id: "photo-xyz" }),
      () => jsonResp({ success: true, post_id: "page-1_photo-story" }),
    ])

    const plugin = createFacebookPlugin({ access_token: "tok", page_id: "page-1" })
    const result = await plugin.publish({
      content: "",
      mediaUrl: "https://signed.example/photo.jpg",
      postType: "story",
      scheduledAt: null,
    })

    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("page-1_photo-story")

    // First call is /photos (not /video_stories)
    expect(fetchMock.mock.calls[0][0]).toBe(`${FB}/page-1/photos`)
    expect(fetchMock.mock.calls[1][0]).toBe(`${FB}/page-1/photo_stories`)
  })

  it("returns failure when upload_phase=start fails", async () => {
    const fetchMock = mockFetchSequence([
      () => jsonResp({ error: { message: "permission denied" } }, 403),
    ])

    const plugin = createFacebookPlugin({ access_token: "tok", page_id: "page-1" })
    const result = await plugin.publish({
      content: "",
      mediaUrl: "https://signed.example/clip.mp4",
      postType: "story",
      scheduledAt: null,
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/permission denied/)
    expect(fetchMock.mock.calls.length).toBe(1)
  })
})
