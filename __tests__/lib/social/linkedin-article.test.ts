import { describe, it, expect, beforeEach, vi } from "vitest"
import sharp from "sharp"
import { createLinkedInPlugin } from "@/lib/social/plugins/linkedin"

// The smallest byte runs that pass the magic-byte sniff. Only the leading bytes matter
// for a pass-through: the plugin never decodes an image LinkedIn already accepts.
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

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
      if (url === LINK.imageUrl) return mockResponse({ status: 200, arrayBuffer: toArrayBuffer(JPEG_BYTES) })
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

  // LinkedIn's Images API takes JPG, GIF and PNG only, and every AI-generated blog cover is WebP.
  describe("card image format", () => {
    function cardFetch(imageBytes: ArrayBuffer, imageStatus = "AVAILABLE") {
      return vi.fn(async (url: string, init?: RequestInit) => {
        if (url === LINK.imageUrl) return mockResponse({ status: 200, arrayBuffer: imageBytes })
        if (url.includes("/rest/images?action=initializeUpload"))
          return mockResponse({ status: 200, body: { value: { uploadUrl: "https://upload.test/w", image: "urn:li:image:W1" } } })
        if (url === "https://upload.test/w") return mockResponse({ status: 201 })
        if (url.includes("/rest/images/")) return mockResponse({ status: 200, body: { status: imageStatus } })
        if (url === "https://api.linkedin.com/rest/posts" && init?.method === "POST")
          return mockResponse({ status: 201, headers: { "x-restli-id": "urn:li:share:7" } })
        throw new Error(`unexpected ${url}`)
      })
    }

    function uploadedBytes(fetchMock: ReturnType<typeof vi.fn>): Uint8Array {
      const call = fetchMock.mock.calls.find(([u]) => u === "https://upload.test/w")
      expect(call, "the card image was never PUT to LinkedIn").toBeDefined()
      const body = call![1].body as ArrayBuffer | Uint8Array
      return body instanceof Uint8Array ? body : new Uint8Array(body)
    }

    it("converts a WebP cover to JPEG before uploading it", async () => {
      const webp = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#000" } }).webp().toBuffer()
      // A control on the fixture itself: RIFF....WEBP, the header the pipeline writes.
      expect([...webp.subarray(0, 4)]).toEqual([0x52, 0x49, 0x46, 0x46])
      expect([...webp.subarray(8, 12)]).toEqual([0x57, 0x45, 0x42, 0x50])
      const fetchMock = cardFetch(toArrayBuffer(new Uint8Array(webp)))
      vi.stubGlobal("fetch", fetchMock)

      const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123" })
      const res = await plugin.publish({ content: "x", mediaUrl: null, scheduledAt: null, link: LINK })

      expect(res.success).toBe(true)
      expect([...uploadedBytes(fetchMock).subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])
      expect(postBody(fetchMock).content.article.thumbnail).toBe("urn:li:image:W1")
    })

    it("uploads a JPEG cover byte-for-byte, without re-encoding it", async () => {
      const fetchMock = cardFetch(toArrayBuffer(JPEG_BYTES))
      vi.stubGlobal("fetch", fetchMock)

      const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123" })
      await plugin.publish({ content: "x", mediaUrl: null, scheduledAt: null, link: LINK })

      expect([...uploadedBytes(fetchMock)]).toEqual([...JPEG_BYTES])
    })

    it("posts the card without a thumbnail when the cover is neither accepted nor decodable", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const fetchMock = cardFetch(toArrayBuffer(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07])))
      vi.stubGlobal("fetch", fetchMock)

      const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123" })
      const res = await plugin.publish({ content: "x", mediaUrl: null, scheduledAt: null, link: LINK })

      expect(res.success).toBe(true)
      expect(postBody(fetchMock).content).toEqual({
        article: { source: LINK.url, title: LINK.title, description: LINK.description },
      })
      expect(fetchMock.mock.calls.some(([u]) => u === "https://upload.test/w")).toBe(false)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("card image"))
    })

    it("stops polling after one GET when LinkedIn reports PROCESSING_FAILED", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {})
      const fetchMock = cardFetch(toArrayBuffer(JPEG_BYTES), "PROCESSING_FAILED")
      vi.stubGlobal("fetch", fetchMock)

      const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123" })
      const res = await plugin.publish({ content: "x", mediaUrl: null, scheduledAt: null, link: LINK })

      expect(res.success).toBe(true)
      const imageGets = fetchMock.mock.calls.filter(([u, init]) => String(u).includes("/rest/images/") && init?.method === "GET")
      expect(imageGets).toHaveLength(1)
      expect(postBody(fetchMock).content.article.thumbnail).toBeUndefined()
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
      if (url === LINK.imageUrl) return mockResponse({ status: 200, arrayBuffer: toArrayBuffer(JPEG_BYTES) })
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
