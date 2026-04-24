import { describe, it, expect, beforeEach, vi } from "vitest"
import { createInstagramPlugin } from "@/lib/social/plugins/instagram"

const IG = "https://graph.facebook.com/v22.0"

describe("Instagram plugin — carousel", () => {
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

  it("publishes a 3-image carousel by creating children, polling, parent, then publish", async () => {
    // Sequence: 3 child creates → 3 child status GETs (all FINISHED) → 1 parent create → 1 publish
    const fetchMock = mockFetchSequence([
      () => jsonResp({ id: "child-1" }),
      () => jsonResp({ id: "child-2" }),
      () => jsonResp({ id: "child-3" }),
      () => jsonResp({ status_code: "FINISHED" }),
      () => jsonResp({ status_code: "FINISHED" }),
      () => jsonResp({ status_code: "FINISHED" }),
      () => jsonResp({ id: "parent-1" }),
      () => jsonResp({ id: "ig-media-final" }),
    ])

    const plugin = createInstagramPlugin({ access_token: "tok", ig_user_id: "ig-user-1" })
    const result = await plugin.publish({
      content: "Swipe for 3 ideas",
      mediaUrl: "https://signed.example/1-a.jpg",
      mediaUrls: [
        "https://signed.example/1-a.jpg",
        "https://signed.example/1-b.jpg",
        "https://signed.example/1-c.jpg",
      ],
      scheduledAt: null,
    })

    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("ig-media-final")

    // Verify ordered fetches — only spot-check critical shapes
    const calls = fetchMock.mock.calls
    expect(calls).toHaveLength(8)

    // Child creates: POST /ig-user-1/media with image_url + is_carousel_item
    const firstChild = calls[0]
    expect(firstChild[0]).toBe(`${IG}/ig-user-1/media`)
    expect((firstChild[1] as RequestInit).method).toBe("POST")
    const firstChildBody = JSON.parse((firstChild[1] as RequestInit).body as string)
    expect(firstChildBody.image_url).toBe("https://signed.example/1-a.jpg")
    expect(firstChildBody.is_carousel_item).toBe(true)

    // Child polls: GET ...?fields=status_code — check one of them
    const firstPoll = calls[3]
    expect((firstPoll[0] as string)).toContain("child-1")
    expect((firstPoll[0] as string)).toContain("fields=status_code")

    // Parent create: children=child-1,child-2,child-3, media_type=CAROUSEL, caption=...
    const parentCreate = calls[6]
    const parentBody = JSON.parse((parentCreate[1] as RequestInit).body as string)
    expect(parentBody.media_type).toBe("CAROUSEL")
    expect(parentBody.children).toBe("child-1,child-2,child-3")
    expect(parentBody.caption).toBe("Swipe for 3 ideas")

    // Final publish: creation_id=parent-1
    const publishCall = calls[7]
    expect(publishCall[0]).toBe(`${IG}/ig-user-1/media_publish`)
    const publishBody = JSON.parse((publishCall[1] as RequestInit).body as string)
    expect(publishBody.creation_id).toBe("parent-1")
  })

  it("returns failure when a child container creation fails", async () => {
    const fetchMock = mockFetchSequence([
      () => jsonResp({ id: "child-1" }),
      () => jsonResp({ error: { message: "URL_TIMEOUT" } }, 400),
    ])

    const plugin = createInstagramPlugin({ access_token: "tok", ig_user_id: "ig-user-1" })
    const result = await plugin.publish({
      content: "x",
      mediaUrl: "https://signed.example/1-a.jpg",
      mediaUrls: [
        "https://signed.example/1-a.jpg",
        "https://signed.example/1-b.jpg",
      ],
      scheduledAt: null,
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/URL_TIMEOUT|child|container/i)
    // No parent create, no publish
    expect(fetchMock.mock.calls.length).toBe(2)
  })

  it("returns failure when a child never reaches FINISHED (poll timeout)", async () => {
    // 2 children created, then both poll forever in PROCESSING. We expect the
    // implementation to bail after the poll-budget (5 attempts with backoff).
    // Since each poll attempt hits the same child, we need enough mocked responses.
    // Poll budget: 5 attempts per child, then stops. For 2 children sequentially:
    // child-1 polled 5× (all PROCESSING), returns error before moving on.
    const fetchMock = mockFetchSequence([
      () => jsonResp({ id: "child-1" }),
      () => jsonResp({ id: "child-2" }),
      () => jsonResp({ status_code: "IN_PROGRESS" }),
      () => jsonResp({ status_code: "IN_PROGRESS" }),
      () => jsonResp({ status_code: "IN_PROGRESS" }),
      () => jsonResp({ status_code: "IN_PROGRESS" }),
      () => jsonResp({ status_code: "IN_PROGRESS" }),
    ])

    const plugin = createInstagramPlugin({ access_token: "tok", ig_user_id: "ig-user-1" })
    const result = await plugin.publish({
      content: "x",
      mediaUrl: "https://signed.example/1-a.jpg",
      mediaUrls: [
        "https://signed.example/1-a.jpg",
        "https://signed.example/1-b.jpg",
      ],
      scheduledAt: null,
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not ready|timeout|FINISHED/i)
  }, 30000)

  it("returns failure when a child status returns ERROR", async () => {
    const fetchMock = mockFetchSequence([
      () => jsonResp({ id: "child-1" }),
      () => jsonResp({ id: "child-2" }),
      () => jsonResp({ status_code: "ERROR", status: "Failed to process" }),
    ])

    const plugin = createInstagramPlugin({ access_token: "tok", ig_user_id: "ig-user-1" })
    const result = await plugin.publish({
      content: "x",
      mediaUrl: "https://signed.example/1-a.jpg",
      mediaUrls: [
        "https://signed.example/1-a.jpg",
        "https://signed.example/1-b.jpg",
      ],
      scheduledAt: null,
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/ERROR|Failed to process/i)
    // fetchMock is referenced for assertion clarity
    expect(fetchMock.mock.calls.length).toBe(3)
  })
})
