import { describe, it, expect, beforeEach, vi } from "vitest"
import { createInstagramPlugin } from "@/lib/social/plugins/instagram"

const IG = "https://graph.facebook.com/v22.0"
const NOW = new Date("2026-10-01T10:00:00.000Z")

function jsonResp(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response
}

function mockFetchSequence(responses: Array<() => Response>) {
  let i = 0
  const fetchMock = vi.fn().mockImplementation(async () => {
    if (i >= responses.length) throw new Error("fetch called more times than mocked")
    return responses[i++]()
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

const inProgress = () => jsonResp({ status_code: "IN_PROGRESS" })
const finished = () => jsonResp({ status_code: "FINISHED" })
const plugin = () =>
  createInstagramPlugin({ access_token: "tok", ig_user_id: "ig-1" }, { sleep: async () => {}, now: () => NOW })
const body = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string)

describe("Instagram plugin — video processing", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("a Reel still processing answers pending instead of publishing", async () => {
    const fetchMock = mockFetchSequence([
      () => jsonResp({ id: "reel-c" }),
      inProgress, inProgress, inProgress, inProgress, inProgress,
    ])
    const result = await plugin().publish({ content: "cap", mediaUrl: "https://s.example/r.mp4?sig=1", scheduledAt: null })
    expect(result).toEqual({
      success: true,
      pending: { startedAt: NOW.toISOString(), data: { step: "publish", containerId: "reel-c" } },
    })
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/media_publish"))).toBe(false)
  })

  it("a Reel that finishes within the short window publishes in the same run", async () => {
    const fetchMock = mockFetchSequence([() => jsonResp({ id: "reel-c" }), inProgress, finished, () => jsonResp({ id: "ig-1-media" })])
    const result = await plugin().publish({ content: "cap", mediaUrl: "https://s.example/r.mp4", scheduledAt: null })
    expect(result).toEqual({ success: true, platform_post_id: "ig-1-media" })
    expect(body(fetchMock.mock.calls[3])).toEqual({ creation_id: "reel-c", access_token: "tok" })
  })

  it("resuming a finished container publishes it with one status check", async () => {
    const fetchMock = mockFetchSequence([finished, () => jsonResp({ id: "ig-2-media" })])
    const result = await plugin().publish({
      content: "cap",
      mediaUrl: "https://s.example/r.mp4",
      scheduledAt: null,
      resumeState: { startedAt: "2026-10-01T09:50:00.000Z", data: { step: "publish", containerId: "reel-c" } },
    })
    expect(result).toEqual({ success: true, platform_post_id: "ig-2-media" })
    expect(String(fetchMock.mock.calls[0][0])).toContain(`${IG}/reel-c?fields=status_code`)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("resuming a container still processing keeps the original start time", async () => {
    mockFetchSequence([inProgress])
    const saved = { startedAt: "2026-10-01T09:50:00.000Z", data: { step: "publish", containerId: "reel-c" } }
    const result = await plugin().publish({ content: "c", mediaUrl: "https://s.example/r.mp4", scheduledAt: null, resumeState: saved })
    expect(result).toEqual({ success: true, pending: saved })
  })

  it("resuming a container Instagram rejected fails with Instagram's reason", async () => {
    mockFetchSequence([() => jsonResp({ status_code: "ERROR", status: "Error: unsupported codec" })])
    const result = await plugin().publish({
      content: "c",
      mediaUrl: "https://s.example/r.mp4",
      scheduledAt: null,
      resumeState: { startedAt: NOW.toISOString(), data: { step: "publish", containerId: "reel-c" } },
    })
    expect(result.success).toBe(false)
    expect(result.error).toBe("Instagram could not process the media (ERROR: Error: unsupported codec)")
  })

  it("resuming a container Instagram already published fails without publishing again", async () => {
    const fetchMock = mockFetchSequence([() => jsonResp({ status_code: "PUBLISHED" })])
    const result = await plugin().publish({
      content: "c",
      mediaUrl: "https://s.example/r.mp4",
      scheduledAt: null,
      resumeState: { startedAt: NOW.toISOString(), data: { step: "publish", containerId: "reel-c" } },
    })
    expect(result).toEqual({
      success: false,
      error: "Instagram shows this post as already published — check the account before retrying.",
    })
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/media_publish"))).toBe(false)
  })

  it("a video Story still processing answers pending", async () => {
    mockFetchSequence([() => jsonResp({ id: "story-c" }), inProgress, inProgress, inProgress, inProgress, inProgress])
    const result = await plugin().publish({ content: "", mediaUrl: "https://s.example/s.mp4", postType: "story", scheduledAt: null })
    expect(result.pending?.data).toEqual({ step: "publish", containerId: "story-c" })
  })

  it("a mixed carousel sends the video slide as a VIDEO child and waits on it", async () => {
    const fetchMock = mockFetchSequence([
      () => jsonResp({ id: "c1" }),
      () => jsonResp({ id: "c2" }),
      finished, inProgress, // round 1: c1 done, c2 processing
      finished, inProgress,
      finished, inProgress,
      finished, inProgress,
      finished, inProgress,
    ])
    const result = await plugin().publish({
      content: "Swipe",
      mediaUrl: "https://s.example/a.jpg",
      mediaUrls: ["https://s.example/a.jpg", "https://s.example/b.mp4?sig=2"],
      mediaKinds: ["image", "video"],
      postType: "carousel",
      scheduledAt: null,
    })
    expect(body(fetchMock.mock.calls[0])).toMatchObject({ image_url: "https://s.example/a.jpg", is_carousel_item: true })
    expect(body(fetchMock.mock.calls[0]).media_type).toBeUndefined()
    expect(body(fetchMock.mock.calls[1])).toMatchObject({
      media_type: "VIDEO",
      video_url: "https://s.example/b.mp4?sig=2",
      is_carousel_item: true,
    })
    expect(body(fetchMock.mock.calls[1]).image_url).toBeUndefined()
    expect(result).toEqual({
      success: true,
      pending: { startedAt: NOW.toISOString(), data: { step: "children", childIds: ["c1", "c2"], caption: "Swipe" } },
    })
  })

  it("resuming finished carousel children creates the parent, waits on it, then publishes", async () => {
    const fetchMock = mockFetchSequence([
      finished, finished, // children check
      () => jsonResp({ id: "parent" }),
      finished, // parent (has a video child)
      () => jsonResp({ id: "ig-car" }),
    ])
    const result = await plugin().publish({
      content: "Swipe",
      mediaUrl: null,
      scheduledAt: null,
      postType: "carousel",
      resumeState: { startedAt: NOW.toISOString(), data: { step: "children", childIds: ["c1", "c2"], caption: "Swipe" } },
    })
    expect(result).toEqual({ success: true, platform_post_id: "ig-car" })
    expect(body(fetchMock.mock.calls[2])).toMatchObject({ media_type: "CAROUSEL", children: "c1,c2", caption: "Swipe" })
  })
})
