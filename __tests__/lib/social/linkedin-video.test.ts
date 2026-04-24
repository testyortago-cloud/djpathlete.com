import { describe, it, expect, beforeEach, vi } from "vitest"
import { createLinkedInPlugin } from "@/lib/social/plugins/linkedin"

const POSTS_URL = "https://api.linkedin.com/rest/posts"
const VIDEOS_URL = "https://api.linkedin.com/rest/videos"

function jsonResp(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
    headers: new Headers(headers ?? {}),
  } as unknown as Response
}

function binaryResp(bytes: number[]): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
    headers: new Headers(),
  } as unknown as Response
}

describe("LinkedIn plugin — video publish", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("publishes a small video via single-chunk upload, finalize, poll, post", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      // Step 0: download video bytes from signed URL
      if (typeof url === "string" && url === "https://signed.example/clip.mp4") {
        return binaryResp(new Array(1024).fill(1)) // 1 KB buffer
      }
      // Step 1: initializeUpload
      if (typeof url === "string" && url === `${VIDEOS_URL}?action=initializeUpload`) {
        return jsonResp({
          value: {
            video: "urn:li:video:VID1",
            uploadToken: "",
            uploadInstructions: [
              { firstByte: 0, lastByte: 1023, uploadUrl: "https://upload.linkedin.example/chunk1" },
            ],
          },
        })
      }
      // Step 2: PUT chunk
      if (typeof url === "string" && url.startsWith("https://upload.linkedin.example/")) {
        return {
          ok: true,
          status: 200,
          text: async () => "",
          headers: new Headers({ etag: '"etag-chunk1"' }),
        } as unknown as Response
      }
      // Step 3: finalizeUpload
      if (typeof url === "string" && url === `${VIDEOS_URL}?action=finalizeUpload`) {
        return jsonResp({}, 200)
      }
      // Step 4: GET /rest/videos/{urn} → AVAILABLE
      if (typeof url === "string" && url.startsWith(`${VIDEOS_URL}/`)) {
        return jsonResp({ status: "AVAILABLE" })
      }
      // Step 5: POST /rest/posts
      if (typeof url === "string" && url === POSTS_URL) {
        return jsonResp({}, 201, { "x-restli-id": "urn:li:share:VIDEO-OK" })
      }
      throw new Error(`Unexpected fetch to ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123456" })
    const result = await plugin.publish({
      content: "Here's a video about training methodology.",
      mediaUrl: "https://signed.example/clip.mp4",
      scheduledAt: null,
    })

    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("urn:li:share:VIDEO-OK")

    // Init body includes owner + fileSizeBytes
    const initCall = fetchMock.mock.calls.find(([u]) => u === `${VIDEOS_URL}?action=initializeUpload`)
    const initBody = JSON.parse((initCall![1] as RequestInit).body as string)
    expect(initBody.initializeUploadRequest.owner).toBe("urn:li:organization:123456")
    expect(initBody.initializeUploadRequest.fileSizeBytes).toBe(1024)

    // PUT chunk has no Authorization header (pre-signed URL)
    const putCall = fetchMock.mock.calls.find(([u]) => typeof u === "string" && u.startsWith("https://upload.linkedin.example/"))
    const putInit = putCall![1] as RequestInit
    const putHeaders = (putInit.headers ?? {}) as Record<string, string>
    expect(putHeaders.Authorization).toBeUndefined()
    expect(putHeaders["Content-Type"]).toBe("application/octet-stream")

    // Finalize body lists one uploadedPartId (etag stripped of surrounding quotes)
    const finalizeCall = fetchMock.mock.calls.find(([u]) => u === `${VIDEOS_URL}?action=finalizeUpload`)
    const finBody = JSON.parse((finalizeCall![1] as RequestInit).body as string)
    expect(finBody.finalizeUploadRequest.video).toBe("urn:li:video:VID1")
    expect(finBody.finalizeUploadRequest.uploadedPartIds).toEqual(["etag-chunk1"])

    // Final post body references video URN in content.media.id
    const postCall = fetchMock.mock.calls.find(([u]) => u === POSTS_URL)
    const postBody = JSON.parse((postCall![1] as RequestInit).body as string)
    expect(postBody.content.media.id).toBe("urn:li:video:VID1")
  })

  it("publishes a larger video via multi-chunk upload (two chunks, two ETags in order)", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === "string" && url === "https://signed.example/big.mp4") {
        // 6 KB buffer to simulate a "large" file (actual chunking is driven by uploadInstructions, not by real size)
        return binaryResp(new Array(6 * 1024).fill(2))
      }
      if (typeof url === "string" && url === `${VIDEOS_URL}?action=initializeUpload`) {
        return jsonResp({
          value: {
            video: "urn:li:video:BIG",
            uploadToken: "",
            uploadInstructions: [
              { firstByte: 0, lastByte: 4095, uploadUrl: "https://upload.linkedin.example/chunk1" },
              { firstByte: 4096, lastByte: 6143, uploadUrl: "https://upload.linkedin.example/chunk2" },
            ],
          },
        })
      }
      if (typeof url === "string" && url === "https://upload.linkedin.example/chunk1") {
        return {
          ok: true,
          status: 200,
          text: async () => "",
          headers: new Headers({ etag: '"part-1"' }),
        } as unknown as Response
      }
      if (typeof url === "string" && url === "https://upload.linkedin.example/chunk2") {
        return {
          ok: true,
          status: 200,
          text: async () => "",
          headers: new Headers({ etag: '"part-2"' }),
        } as unknown as Response
      }
      if (typeof url === "string" && url === `${VIDEOS_URL}?action=finalizeUpload`) {
        return jsonResp({}, 200)
      }
      if (typeof url === "string" && url.startsWith(`${VIDEOS_URL}/`)) {
        return jsonResp({ status: "AVAILABLE" })
      }
      if (typeof url === "string" && url === POSTS_URL) {
        return jsonResp({}, 201, { "x-restli-id": "urn:li:share:BIG-OK" })
      }
      throw new Error(`Unexpected fetch to ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123456" })
    const result = await plugin.publish({
      content: "Big clip",
      mediaUrl: "https://signed.example/big.mp4",
      scheduledAt: null,
    })

    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("urn:li:share:BIG-OK")

    const finalizeCall = fetchMock.mock.calls.find(([u]) => u === `${VIDEOS_URL}?action=finalizeUpload`)
    const finBody = JSON.parse((finalizeCall![1] as RequestInit).body as string)
    expect(finBody.finalizeUploadRequest.uploadedPartIds).toEqual(["part-1", "part-2"])
  })

  it("returns failure when initializeUpload fails", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === "string" && url === "https://signed.example/clip.mp4") {
        return binaryResp([1])
      }
      if (typeof url === "string" && url.includes("initializeUpload")) {
        return jsonResp({ message: "file too large" }, 413)
      }
      throw new Error(`Unexpected fetch to ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123456" })
    const result = await plugin.publish({
      content: "x",
      mediaUrl: "https://signed.example/clip.mp4",
      scheduledAt: null,
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/file too large|413|init/)
  })

  it("returns failure when polling reports PROCESSING_FAILED", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === "string" && url === "https://signed.example/clip.mp4") {
        return binaryResp([1])
      }
      if (typeof url === "string" && url === `${VIDEOS_URL}?action=initializeUpload`) {
        return jsonResp({
          value: {
            video: "urn:li:video:FAIL",
            uploadToken: "",
            uploadInstructions: [
              { firstByte: 0, lastByte: 0, uploadUrl: "https://upload.linkedin.example/c1" },
            ],
          },
        })
      }
      if (typeof url === "string" && url.startsWith("https://upload.linkedin.example/")) {
        return {
          ok: true,
          status: 200,
          text: async () => "",
          headers: new Headers({ etag: '"et"' }),
        } as unknown as Response
      }
      if (typeof url === "string" && url === `${VIDEOS_URL}?action=finalizeUpload`) {
        return jsonResp({}, 200)
      }
      if (typeof url === "string" && url.startsWith(`${VIDEOS_URL}/`)) {
        return jsonResp({ status: "PROCESSING_FAILED", processingFailureReason: "corrupted" })
      }
      throw new Error(`Unexpected fetch to ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123456" })
    const result = await plugin.publish({
      content: "x",
      mediaUrl: "https://signed.example/clip.mp4",
      scheduledAt: null,
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/PROCESSING_FAILED|corrupted/i)
  })
})
