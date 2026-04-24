import { describe, it, expect, beforeEach, vi } from "vitest"
import { createLinkedInPlugin } from "@/lib/social/plugins/linkedin"

const POSTS_URL = "https://api.linkedin.com/rest/posts"
const IMAGES_URL = "https://api.linkedin.com/rest/images"

function jsonResp(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    headers: new Headers(headers ?? {}),
  } as unknown as Response
}

describe("LinkedIn plugin — multi-image carousel", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("publishes a 3-slide carousel by uploading each image then posting with content.multiImage", async () => {
    const urns = ["urn:li:image:A", "urn:li:image:B", "urn:li:image:C"]
    const urls = [
      "https://signed.example/a.jpg",
      "https://signed.example/b.jpg",
      "https://signed.example/c.jpg",
    ]
    let uploadIdx = 0
    let downloadIdx = 0

    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      // Download image bytes from the signed URLs (3 calls, in order)
      if (typeof url === "string" && urls.includes(url)) {
        expect(url).toBe(urls[downloadIdx])
        downloadIdx += 1
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new Uint8Array([downloadIdx]).buffer,
        } as unknown as Response
      }
      // Initialize upload
      if (typeof url === "string" && url.startsWith(`${IMAGES_URL}?action=initializeUpload`)) {
        const urn = urns[uploadIdx]
        uploadIdx += 1
        return jsonResp({
          value: { uploadUrl: `https://upload.linkedin.example/${uploadIdx}`, image: urn },
        })
      }
      // PUT to upload URL
      if (typeof url === "string" && url.startsWith("https://upload.linkedin.example/")) {
        return jsonResp({}, 201)
      }
      // GET /rest/images/{urn} polling
      if (typeof url === "string" && url.startsWith(`${IMAGES_URL}/urn:li:image:`)) {
        return jsonResp({ status: "AVAILABLE" })
      }
      // Final POST /rest/posts
      if (typeof url === "string" && url === POSTS_URL) {
        return jsonResp({}, 201, { "x-restli-id": "urn:li:share:MULTI-OK" })
      }
      throw new Error(`Unexpected fetch to ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123456" })
    const result = await plugin.publish({
      content: "Swipe through our 3 insights",
      mediaUrl: urls[0],
      mediaUrls: urls,
      scheduledAt: null,
    })

    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("urn:li:share:MULTI-OK")

    // Verify the final /rest/posts body used content.multiImage with all 3 URNs in order
    const postCall = fetchMock.mock.calls.find(([u]) => u === POSTS_URL)
    expect(postCall).toBeDefined()
    const body = JSON.parse((postCall![1] as RequestInit).body as string)
    expect(body.content.multiImage).toBeDefined()
    expect(body.content.multiImage.images).toHaveLength(3)
    expect(body.content.multiImage.images.map((i: { id: string }) => i.id)).toEqual(urns)
    // content.media should not be set — MultiImage is mutually exclusive
    expect(body.content.media).toBeUndefined()
  })

  it("returns failure when one image upload fails during initializeUpload", async () => {
    let initIdx = 0
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === "string" && url === "https://signed.example/a.jpg") {
        return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1]).buffer } as unknown as Response
      }
      if (typeof url === "string" && url === "https://signed.example/b.jpg") {
        return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([2]).buffer } as unknown as Response
      }
      if (typeof url === "string" && url.includes("initializeUpload")) {
        initIdx += 1
        if (initIdx === 1) {
          return jsonResp({ value: { uploadUrl: "https://upload.linkedin.example/1", image: "urn:li:image:A" } })
        }
        return jsonResp({ message: "UNAUTHORIZED" }, 401)
      }
      if (typeof url === "string" && url.startsWith("https://upload.linkedin.example/")) {
        return jsonResp({}, 201)
      }
      if (typeof url === "string" && url.startsWith(`${IMAGES_URL}/`)) {
        return jsonResp({ status: "AVAILABLE" })
      }
      throw new Error(`Unexpected fetch to ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123456" })
    const result = await plugin.publish({
      content: "x",
      mediaUrl: "https://signed.example/a.jpg",
      mediaUrls: ["https://signed.example/a.jpg", "https://signed.example/b.jpg"],
      scheduledAt: null,
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/UNAUTHORIZED|401/)
  })
})
