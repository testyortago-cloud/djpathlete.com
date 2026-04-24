// __tests__/lib/social/linkedin.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createLinkedInPlugin } from "@/lib/social/plugins/linkedin"

const POSTS_URL = "https://api.linkedin.com/rest/posts"
const IMAGES_URL = "https://api.linkedin.com/rest/images"

function mockResponse(opts: {
  status: number
  body?: unknown
  headers?: Record<string, string>
  ok?: boolean
}) {
  return {
    ok: opts.ok ?? (opts.status >= 200 && opts.status < 300),
    status: opts.status,
    text: async () => (opts.body ? JSON.stringify(opts.body) : ""),
    json: async () => opts.body ?? {},
    headers: new Headers(opts.headers ?? {}),
  } as Response
}

describe("LinkedInPlugin — versioned API", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("publish() without media creates a text-only post via /rest/posts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({
        status: 201,
        body: {},
        headers: { "x-restli-id": "urn:li:share:ABC" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123456" })
    const result = await plugin.publish({
      content: "A coaching insight for the DJP audience.",
      mediaUrl: null,
      scheduledAt: null,
    })

    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("urn:li:share:ABC")

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(POSTS_URL)
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe("Bearer tok")
    expect(headers["LinkedIn-Version"]).toBe("202604")
    expect(headers["X-Restli-Protocol-Version"]).toBe("2.0.0")
    expect(headers["Content-Type"]).toBe("application/json")

    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toMatchObject({
      author: "urn:li:organization:123456",
      commentary: "A coaching insight for the DJP audience.",
      visibility: "PUBLIC",
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    })
    expect(body.distribution.feedDistribution).toBe("MAIN_FEED")
    expect(body.content).toBeUndefined()
  })

  it("publish() with image URL runs the 3-step image flow", async () => {
    const imageUrn = "urn:li:image:C4E10AQFoyy"
    let postBodyHeaders: Record<string, string> | undefined

    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.startsWith(`${IMAGES_URL}?action=initializeUpload`)) {
        return mockResponse({
          status: 200,
          body: { value: { uploadUrl: "https://upload.linkedin.example/1", image: imageUrn } },
        })
      }
      if (typeof url === "string" && url === "https://external.example/photo.jpg") {
        // Our internal fetchBinary pulls the bytes from the signed URL.
        return mockResponse({ status: 200, body: undefined }) as Response
      }
      if (typeof url === "string" && url.startsWith("https://upload.linkedin.example/")) {
        return mockResponse({ status: 201 })
      }
      if (typeof url === "string" && url.startsWith(`${IMAGES_URL}/`)) {
        return mockResponse({ status: 200, body: { status: "AVAILABLE" } })
      }
      if (typeof url === "string" && url === POSTS_URL) {
        postBodyHeaders = init?.headers as Record<string, string>
        return mockResponse({
          status: 201,
          body: {},
          headers: { "x-restli-id": "urn:li:share:IMG-OK" },
        })
      }
      throw new Error(`Unexpected fetch to ${url}`)
    })

    // Handle the ArrayBuffer body expectation: fetchBinary will call response.arrayBuffer().
    // Override the "download image" branch to provide that.
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url === "https://external.example/photo.jpg") {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        } as unknown as Response
      }
      if (typeof url === "string" && url.startsWith(`${IMAGES_URL}?action=initializeUpload`)) {
        return mockResponse({
          status: 200,
          body: { value: { uploadUrl: "https://upload.linkedin.example/1", image: imageUrn } },
        })
      }
      if (typeof url === "string" && url.startsWith("https://upload.linkedin.example/")) {
        return mockResponse({ status: 201 })
      }
      if (typeof url === "string" && url.startsWith(`${IMAGES_URL}/urn:li:image:`)) {
        return mockResponse({ status: 200, body: { status: "AVAILABLE" } })
      }
      if (typeof url === "string" && url === POSTS_URL) {
        postBodyHeaders = init?.headers as Record<string, string>
        return mockResponse({
          status: 201,
          body: {},
          headers: { "x-restli-id": "urn:li:share:IMG-OK" },
        })
      }
      throw new Error(`Unexpected fetch to ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123456" })
    const result = await plugin.publish({
      content: "Photo caption",
      mediaUrl: "https://external.example/photo.jpg",
      scheduledAt: null,
    })
    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("urn:li:share:IMG-OK")

    // Verify the 5 fetch calls (initializeUpload, download bytes, PUT, GET status, POST).
    const urls = fetchMock.mock.calls.map((c) => c[0])
    expect(urls[0]).toBe("https://external.example/photo.jpg")  // download bytes
    expect(urls[1]).toContain("/rest/images?action=initializeUpload")
    expect(urls[2]).toBe("https://upload.linkedin.example/1")
    expect(urls.some((u) => typeof u === "string" && u.startsWith(`${IMAGES_URL}/urn:li:image:`))).toBe(true)
    expect(urls[urls.length - 1]).toBe(POSTS_URL)

    // Verify the final /rest/posts body references the image URN.
    const postCall = fetchMock.mock.calls.find(([u]) => u === POSTS_URL)
    const body = JSON.parse((postCall![1] as RequestInit).body as string)
    expect(body.content.media.id).toBe(imageUrn)
    expect(body.content.media.altText).toBeDefined()
    expect(postBodyHeaders?.["LinkedIn-Version"]).toBe("202604")
  })

  it("publish() image returns error when initializeUpload fails", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === "string" && url === "https://external.example/photo.jpg") {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new Uint8Array([1]).buffer,
        } as unknown as Response
      }
      if (typeof url === "string" && url.includes("initializeUpload")) {
        return mockResponse({ status: 403, body: { message: "ACCESS_DENIED" } })
      }
      throw new Error(`Unexpected fetch to ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123456" })
    const result = await plugin.publish({
      content: "x",
      mediaUrl: "https://external.example/photo.jpg",
      scheduledAt: null,
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/ACCESS_DENIED|403/)
  })

  it("publish() image returns error when PUT fails", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === "string" && url === "https://external.example/photo.jpg") {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new Uint8Array([1]).buffer,
        } as unknown as Response
      }
      if (typeof url === "string" && url.includes("initializeUpload")) {
        return mockResponse({
          status: 200,
          body: { value: { uploadUrl: "https://upload.linkedin.example/1", image: "urn:li:image:X" } },
        })
      }
      if (typeof url === "string" && url.startsWith("https://upload.linkedin.example/")) {
        return mockResponse({ status: 500, body: { message: "upstream error" } })
      }
      throw new Error(`Unexpected fetch to ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123456" })
    const result = await plugin.publish({
      content: "x",
      mediaUrl: "https://external.example/photo.jpg",
      scheduledAt: null,
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/upload|PUT|500/i)
  })

  it("publish() returns failure text on 401 for text post", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({
        status: 401,
        body: { message: "Token expired" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createLinkedInPlugin({ access_token: "bad", organization_id: "123456" })
    const result = await plugin.publish({ content: "x", mediaUrl: null, scheduledAt: null })
    expect(result.success).toBe(false)
    expect(result.error).toContain("Token expired")
  })

  it("getSetupInstructions() mentions Company Page + Marketing Developer Platform", async () => {
    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123456" })
    const instructions = await plugin.getSetupInstructions()
    expect(instructions).toMatch(/Company Page/i)
    expect(instructions).toMatch(/Marketing Developer Platform/i)
  })
})
