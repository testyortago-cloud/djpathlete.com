// decodeMessage: largest-part body selection + attachment collection. The
// forward fixture mirrors the real 2026-08-03 failure shape: the forwarder's
// own empty compose part sits FIRST in the MIME tree, the real body (and the
// attachment) sit inside the nested forwarded message.
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/db/platform-connections", () => ({
  getPlatformConnection: vi.fn(),
  connectPlatform: vi.fn(),
  setConnectionError: vi.fn(),
  clearConnectionError: vi.fn(),
}))
vi.mock("@/lib/gmail/oauth", () => ({ refreshAccessToken: vi.fn() }))

import { decodeMessage, type GmailMessage } from "@/lib/gmail/client"

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url")

function forwardedMessage(): GmailMessage {
  return {
    id: "m1",
    threadId: "t1",
    labelIds: ["INBOX"],
    snippet: "snippet",
    internalDate: "1754200000000",
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "From", value: "darren paul <daz@example.com>" },
        { name: "To", value: "darren@darrenjpaul.com" },
        { name: "Subject", value: "Fw: Statement" },
      ],
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            // The forwarder's own empty compose div — FIRST in the tree.
            { mimeType: "text/html", body: { data: b64url("<div></div>") } },
            { mimeType: "text/plain", body: { data: b64url("") } },
          ],
        },
        {
          mimeType: "message/rfc822",
          parts: [
            {
              mimeType: "text/html",
              body: { data: b64url("<html><body>Please find your statement attached.</body></html>") },
            },
            {
              mimeType: "application/pdf",
              filename: "statement.pdf",
              body: { attachmentId: "att-123", size: 52480 },
            },
          ],
        },
      ],
    },
  }
}

describe("decodeMessage", () => {
  it("picks the LARGEST html part, not the forwarder's empty compose div", () => {
    const decoded = decodeMessage(forwardedMessage())
    expect(decoded.bodyHtml).toContain("statement attached")
    expect(decoded.bodyHtml).not.toBe("<div></div>")
  })

  it("collects nested attachments with id, filename, mime and size", () => {
    const decoded = decodeMessage(forwardedMessage())
    expect(decoded.attachments).toEqual([
      { attachmentId: "att-123", filename: "statement.pdf", mimeType: "application/pdf", sizeBytes: 52480 },
    ])
  })

  it("returns no attachments for a plain single-part message", () => {
    const decoded = decodeMessage({
      id: "m2",
      threadId: "t1",
      payload: { mimeType: "text/plain", body: { data: b64url("hi") }, headers: [] },
    })
    expect(decoded.attachments).toEqual([])
    expect(decoded.bodyText).toBe("hi")
  })
})
