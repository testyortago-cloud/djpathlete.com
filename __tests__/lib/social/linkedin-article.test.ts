import { describe, it, expect, beforeEach, vi } from "vitest"
import { createLinkedInPlugin } from "@/lib/social/plugins/linkedin"

function mockResponse(opts: { status: number; body?: unknown; headers?: Record<string, string>; arrayBuffer?: ArrayBuffer }) {
  return {
    ok: opts.status >= 200 && opts.status < 300,
    status: opts.status,
    text: async () => (opts.body ? JSON.stringify(opts.body) : ""),
    json: async () => opts.body ?? {},
    arrayBuffer: async () => opts.arrayBuffer ?? new ArrayBuffer(4),
    headers: new Headers(opts.headers ?? {}),
  } as Response
}

const LINK = {
  url: "https://www.darrenjpaul.com/blog/acl-return",
  title: "Returning to sport after ACL",
  description: "What the research says.",
  imageUrl: "https://cdn.example.com/cover.jpg",
}

function postBody(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls.find(([u, init]) => u === "https://api.linkedin.com/rest/posts" && init?.method === "POST")
  return JSON.parse(call![1].body as string)
}

describe("LinkedIn article (link card) posts", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("uploads the card image and posts content.article with it as the thumbnail", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === LINK.imageUrl) return mockResponse({ status: 200 })
      if (url.includes("/rest/images?action=initializeUpload"))
        return mockResponse({ status: 200, body: { value: { uploadUrl: "https://upload.test/x", image: "urn:li:image:C1" } } })
      if (url === "https://upload.test/x") return mockResponse({ status: 201 })
      if (url.includes("/rest/images/")) return mockResponse({ status: 200, body: { status: "AVAILABLE" } })
      if (url === "https://api.linkedin.com/rest/posts" && init?.method === "POST")
        return mockResponse({ status: 201, headers: { "x-restli-id": "urn:li:share:1" } })
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123" })
    const res = await plugin.publish({ content: "Read this (really).", mediaUrl: null, scheduledAt: null, link: LINK })

    expect(res).toEqual({ success: true, platform_post_id: "urn:li:share:1" })
    const body = postBody(fetchMock)
    expect(body.commentary).toBe("Read this \\(really\\).")
    expect(body.content).toEqual({
      article: { source: LINK.url, title: LINK.title, description: LINK.description, thumbnail: "urn:li:image:C1" },
    })
  })

  it("still posts the card, without a thumbnail, when the image cannot be fetched", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === LINK.imageUrl) return mockResponse({ status: 404 })
      if (url === "https://api.linkedin.com/rest/posts" && init?.method === "POST")
        return mockResponse({ status: 201, headers: { "x-restli-id": "urn:li:share:2" } })
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123" })
    const res = await plugin.publish({ content: "x", mediaUrl: null, scheduledAt: null, link: LINK })

    expect(res.success).toBe(true)
    expect(postBody(fetchMock).content).toEqual({
      article: { source: LINK.url, title: LINK.title, description: LINK.description },
    })
  })

  it("still posts the card, without a thumbnail, when a thumbnail upload call throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === LINK.imageUrl) return mockResponse({ status: 200 })
      if (url.includes("/rest/images?action=initializeUpload")) throw new TypeError("fetch failed")
      if (url === "https://api.linkedin.com/rest/posts" && init?.method === "POST")
        return mockResponse({ status: 201, headers: { "x-restli-id": "urn:li:share:6" } })
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123" })
    const res = await plugin.publish({ content: "x", mediaUrl: null, scheduledAt: null, link: LINK })

    expect(res.success).toBe(true)
    expect(postBody(fetchMock).content).toEqual({
      article: { source: LINK.url, title: LINK.title, description: LINK.description },
    })
  })

  it("omits description and thumbnail when the link has neither", async () => {
    const fetchMock = vi.fn(async () => mockResponse({ status: 201, headers: { "x-restli-id": "urn:li:share:3" } }))
    vi.stubGlobal("fetch", fetchMock)
    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123" })
    await plugin.publish({ content: "x", mediaUrl: null, scheduledAt: null, link: { ...LINK, description: null, imageUrl: null } })
    expect(postBody(fetchMock).content).toEqual({ article: { source: LINK.url, title: LINK.title } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("lets media win over a link: an image post carries no article", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://cdn.example.com/photo.jpg") return mockResponse({ status: 200 })
      if (url.includes("/rest/images?action=initializeUpload"))
        return mockResponse({ status: 200, body: { value: { uploadUrl: "https://upload.test/p", image: "urn:li:image:P1" } } })
      if (url === "https://upload.test/p") return mockResponse({ status: 201 })
      if (url.includes("/rest/images/")) return mockResponse({ status: 200, body: { status: "AVAILABLE" } })
      if (url === "https://api.linkedin.com/rest/posts" && init?.method === "POST")
        return mockResponse({ status: 201, headers: { "x-restli-id": "urn:li:share:4" } })
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123" })
    await plugin.publish({ content: "x", mediaUrl: "https://cdn.example.com/photo.jpg", scheduledAt: null, link: LINK })
    expect(postBody(fetchMock).content.media.id).toBe("urn:li:image:P1")
    expect(postBody(fetchMock).content.article).toBeUndefined()
  })

  it("escapes the commentary of a plain text post too", async () => {
    const fetchMock = vi.fn(async () => mockResponse({ status: 201, headers: { "x-restli-id": "urn:li:share:5" } }))
    vi.stubGlobal("fetch", fetchMock)
    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123" })
    await plugin.publish({ content: "Squat_depth (tips) #coaching", mediaUrl: null, scheduledAt: null })
    expect(postBody(fetchMock).commentary).toBe("Squat\\_depth \\(tips\\) #coaching")
  })
})
