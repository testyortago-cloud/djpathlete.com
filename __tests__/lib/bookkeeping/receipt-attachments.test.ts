import { describe, it, expect } from "vitest"
import {
  collectReceiptAttachments,
  isReceiptMime,
  MAX_ATTACHMENT_BYTES,
} from "@/lib/bookkeeping/receipt-attachments"

describe("isReceiptMime", () => {
  it("accepts image/* and application/pdf only", () => {
    expect(isReceiptMime("image/jpeg")).toBe(true)
    expect(isReceiptMime("image/png")).toBe(true)
    expect(isReceiptMime("application/pdf")).toBe(true)
    expect(isReceiptMime("text/calendar")).toBe(false)
    expect(isReceiptMime("application/octet-stream")).toBe(false)
  })
})

describe("collectReceiptAttachments", () => {
  it("walks nested multipart parts, keeps receipt mimes with attachmentIds, skips inline bodies", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/plain", body: { size: 10, data: "aGk" } },
            { mimeType: "text/html", body: { size: 20, data: "aGk" } },
          ],
        },
        { mimeType: "application/pdf", filename: "invoice.pdf", body: { size: 2048, attachmentId: "a1" } },
        { mimeType: "image/png", filename: "", body: { size: 100, attachmentId: "a2" } },
        { mimeType: "text/calendar", filename: "invite.ics", body: { size: 100, attachmentId: "a3" } },
      ],
    }
    expect(collectReceiptAttachments(payload)).toEqual([
      { filename: "invoice.pdf", mimeType: "application/pdf", attachmentId: "a1", size: 2048 },
      { filename: "receipt", mimeType: "image/png", attachmentId: "a2", size: 100 },
    ])
  })

  it("drops oversized (>10MB) and zero-size attachments; undefined payload → []", () => {
    expect(
      collectReceiptAttachments({
        mimeType: "multipart/mixed",
        parts: [
          {
            mimeType: "application/pdf",
            filename: "huge.pdf",
            body: { size: MAX_ATTACHMENT_BYTES + 1, attachmentId: "big" },
          },
          { mimeType: "image/jpeg", filename: "empty.jpg", body: { size: 0, attachmentId: "zero" } },
        ],
      }),
    ).toEqual([])
    expect(collectReceiptAttachments(undefined)).toEqual([])
  })
})
