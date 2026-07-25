import { describe, it, expect } from "vitest"
import {
  collectReceiptAttachments,
  countUnsupportedReceiptAttachments,
  isReceiptMime,
  MAX_ATTACHMENT_BYTES,
} from "@/lib/bookkeeping/receipt-attachments"

describe("isReceiptMime", () => {
  it("accepts only the mimes the vision path can actually decode", () => {
    expect(isReceiptMime("image/jpeg")).toBe(true)
    expect(isReceiptMime("image/png")).toBe(true)
    expect(isReceiptMime("image/webp")).toBe(true)
    expect(isReceiptMime("text/calendar")).toBe(false)
    expect(isReceiptMime("application/octet-stream")).toBe(false)
  })

  it("rejects application/pdf and image/heic — sharp 0.33.5 cannot decode either", () => {
    // functions/src/receipt-scan.ts pipes every ingested buffer through
    // sharp(buffer); sharp reports format.pdf.input all-false and heif
    // fileSuffix ['.avif'] only. Ingesting these would guarantee a failed
    // receipt_scan job + a blank review row with no explanation.
    expect(isReceiptMime("application/pdf")).toBe(false)
    expect(isReceiptMime("image/heic")).toBe(false)
    expect(isReceiptMime("image/heif")).toBe(false)
  })
})

describe("countUnsupportedReceiptAttachments", () => {
  it("counts receipt-shaped attachments the scanner cannot read, ignoring non-receipt parts", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/plain", body: { size: 10, data: "aGk" } },
        { mimeType: "application/pdf", filename: "invoice.pdf", body: { size: 2048, attachmentId: "a1" } },
        { mimeType: "image/heic", filename: "IMG_1.heic", body: { size: 2048, attachmentId: "a2" } },
        { mimeType: "image/jpeg", filename: "ok.jpg", body: { size: 2048, attachmentId: "a3" } },
        // .ics invites are not receipt-shaped at all — must NOT inflate the count
        { mimeType: "text/calendar", filename: "invite.ics", body: { size: 512, attachmentId: "a4" } },
      ],
    }
    expect(countUnsupportedReceiptAttachments(payload)).toBe(2)
    expect(countUnsupportedReceiptAttachments(undefined)).toBe(0)
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
        { mimeType: "image/jpeg", filename: "scan.jpg", body: { size: 2048, attachmentId: "a1b" } },
        { mimeType: "image/png", filename: "", body: { size: 100, attachmentId: "a2" } },
        { mimeType: "text/calendar", filename: "invite.ics", body: { size: 100, attachmentId: "a3" } },
      ],
    }
    // The PDF sits ahead of the jpeg on purpose: it must NOT occupy index 0 of
    // the returned array (external_ref index) now that it is unscannable.
    expect(collectReceiptAttachments(payload)).toEqual([
      { filename: "scan.jpg", mimeType: "image/jpeg", attachmentId: "a1b", size: 2048 },
      { filename: "receipt", mimeType: "image/png", attachmentId: "a2", size: 100 },
    ])
  })

  it("drops oversized (>10MB) and zero-size attachments; undefined payload → []", () => {
    expect(
      collectReceiptAttachments({
        mimeType: "multipart/mixed",
        parts: [
          {
            mimeType: "image/png",
            filename: "huge.png",
            body: { size: MAX_ATTACHMENT_BYTES + 1, attachmentId: "big" },
          },
          { mimeType: "image/jpeg", filename: "empty.jpg", body: { size: 0, attachmentId: "zero" } },
        ],
      }),
    ).toEqual([])
    expect(collectReceiptAttachments(undefined)).toEqual([])
  })
})
