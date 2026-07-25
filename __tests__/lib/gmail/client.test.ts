import { describe, it, expect, vi, beforeEach } from "vitest"

// client.ts imports these at module top — stub so importing it is side-effect free.
vi.mock("@/lib/db/platform-connections", () => ({
  getPlatformConnection: vi.fn(),
  connectPlatform: vi.fn(),
  setConnectionError: vi.fn(),
}))
vi.mock("@/lib/gmail/oauth", () => ({ refreshAccessToken: vi.fn() }))

import { listLabels, listMessages, getMessage, getAttachment } from "@/lib/gmail/client"

const fetchMock = vi.fn()
vi.stubGlobal("fetch", fetchMock)

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) }
}

beforeEach(() => fetchMock.mockReset())

describe("listLabels", () => {
  it("GETs /labels and returns the labels array ([] when absent)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ labels: [{ id: "L1", name: "DJP Receipts" }] }))
    expect(await listLabels("tok")).toEqual([{ id: "L1", name: "DJP Receipts" }])
    expect(fetchMock.mock.calls[0][0]).toBe("https://gmail.googleapis.com/gmail/v1/users/me/labels")
    fetchMock.mockResolvedValue(jsonResponse({}))
    expect(await listLabels("tok")).toEqual([])
  })
  it("throws with status on a non-ok response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "x" }, false, 500))
    await expect(listLabels("tok")).rejects.toThrow(/listLabels failed: HTTP 500/)
  })
})

describe("listMessages", () => {
  it("builds labelIds + pageToken params on /messages", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ messages: [{ id: "m1", threadId: "t1" }], nextPageToken: "p2" }),
    )
    const out = await listMessages("tok", { labelIds: ["L1"], pageToken: "abc" })
    expect(out.messages).toEqual([{ id: "m1", threadId: "t1" }])
    expect(out.nextPageToken).toBe("p2")
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain("/messages?")
    expect(url).toContain("labelIds=L1")
    expect(url).toContain("pageToken=abc")
  })
})

describe("getMessage", () => {
  it("fetches format=full so payload parts / attachment ids are present", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "m1", threadId: "t1", payload: { mimeType: "multipart/mixed" } }),
    )
    const msg = await getMessage("tok", "m1")
    expect(msg.payload?.mimeType).toBe("multipart/mixed")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/m1?format=full",
    )
  })
})

describe("getAttachment", () => {
  it("decodes base64url (unpadded, -/_ alphabet) to the original bytes", async () => {
    const bytes = Buffer.from([0xfb, 0xff, 0xef, 0x01, 0x3e])
    const b64url = bytes
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "")
    fetchMock.mockResolvedValue(jsonResponse({ size: bytes.length, data: b64url }))
    const out = await getAttachment("tok", "m1", "att1")
    expect(out.equals(bytes)).toBe(true)
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/attachments/att1",
    )
  })
  it("throws with status on a non-ok response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 404))
    await expect(getAttachment("tok", "m1", "att1")).rejects.toThrow(/getAttachment failed: HTTP 404/)
  })
})
