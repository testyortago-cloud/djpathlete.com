import { describe, it, expect } from "vitest"
import {
  collectReceiptAttachments,
  countUnusableReceiptAttachments,
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

describe("countUnusableReceiptAttachments — mime arm", () => {
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
    expect(countUnusableReceiptAttachments(payload).unsupportedMime).toBe(2)
    expect(countUnusableReceiptAttachments(undefined).unsupportedMime).toBe(0)
  })
})

describe("countUnusableReceiptAttachments", () => {
  // Review finding: the size filter in collectReceiptAttachments drops an
  // oversized image/jpeg, but a mime-only "unsupported" count cannot see it —
  // so a coach who emails one high-res phone photo used to get a run reporting
  // "attachmentless" that then settled the message permanently. Nothing,
  // anywhere, said a receipt had been dropped.
  const payload = {
    mimeType: "multipart/mixed",
    parts: [
      { mimeType: "application/pdf", filename: "invoice.pdf", body: { size: 2048, attachmentId: "a1" } },
      { mimeType: "image/jpeg", filename: "huge.jpg", body: { size: MAX_ATTACHMENT_BYTES + 1, attachmentId: "a2" } },
      { mimeType: "image/png", filename: "also-huge.png", body: { size: MAX_ATTACHMENT_BYTES * 3, attachmentId: "a3" } },
      { mimeType: "image/jpeg", filename: "fine.jpg", body: { size: 2048, attachmentId: "a4" } },
      { mimeType: "text/calendar", filename: "invite.ics", body: { size: MAX_ATTACHMENT_BYTES + 1, attachmentId: "a5" } },
    ],
  }

  it("splits unreadable receipt attachments into unsupported-mime vs oversized", () => {
    expect(countUnusableReceiptAttachments(payload)).toEqual({ unsupportedMime: 1, oversized: 2 })
  })

  it("never double-counts: an oversized PDF is unsupported-mime only", () => {
    expect(
      countUnusableReceiptAttachments({
        mimeType: "multipart/mixed",
        parts: [
          { mimeType: "application/pdf", filename: "big.pdf", body: { size: MAX_ATTACHMENT_BYTES + 1, attachmentId: "a1" } },
        ],
      }),
    ).toEqual({ unsupportedMime: 1, oversized: 0 })
  })

  it("ignores non-receipt parts and inline bodies; undefined payload → zeros", () => {
    expect(countUnusableReceiptAttachments(undefined)).toEqual({ unsupportedMime: 0, oversized: 0 })
    expect(
      countUnusableReceiptAttachments({
        mimeType: "multipart/alternative",
        parts: [{ mimeType: "text/html", body: { size: MAX_ATTACHMENT_BYTES + 1, data: "aGk" } }],
      }),
    ).toEqual({ unsupportedMime: 0, oversized: 0 })
  })

  it("an unreadable-mime part is never also billed as oversized", () => {
    expect(countUnusableReceiptAttachments(payload).unsupportedMime).toBe(1)
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
      // Walk positions: root 0, multipart/alternative 1, its two children 2-3,
      // the pdf 4, this jpeg 5, this png 6.
      { filename: "scan.jpg", mimeType: "image/jpeg", attachmentId: "a1b", size: 2048, refKey: "p5" },
      { filename: "receipt", mimeType: "image/png", attachmentId: "a2", size: 100, refKey: "p6" },
    ])
  })

  it("prefers Gmail's stable partId as the external_ref key", () => {
    expect(
      collectReceiptAttachments({
        partId: "",
        mimeType: "multipart/mixed",
        parts: [
          { partId: "0", mimeType: "text/plain", body: { size: 10, data: "aGk" } },
          { partId: "1.2", mimeType: "image/jpeg", filename: "a.jpg", body: { size: 10, attachmentId: "x" } },
        ],
      }).map((a) => a.refKey),
    ).toEqual(["1.2"])
    // Exotic/absent partIds fall back to the walk position, never to the
    // caller's array index.
    expect(
      collectReceiptAttachments({
        mimeType: "multipart/mixed",
        parts: [
          { partId: "we:rd", mimeType: "image/jpeg", filename: "a.jpg", body: { size: 10, attachmentId: "x" } },
        ],
      }).map((a) => a.refKey),
    ).toEqual(["p1"])
  })

  it("refKey does NOT move when the mime allow-list moves (no re-ingest on widening)", () => {
    // The killer scenario for an array-index key: a mail whose PDF sits ahead
    // of the jpeg. Under an index key the jpeg is 'gmail:m:0' today and would
    // become 'gmail:m:1' the day application/pdf becomes scannable — the
    // already-ingested receipt would no longer match its stored external_ref
    // and would be re-ingested (duplicate document + a second vision spend).
    const parts = [
      { partId: "1", mimeType: "application/pdf", filename: "i.pdf", body: { size: 10, attachmentId: "p" } },
      { partId: "2", mimeType: "image/jpeg", filename: "r.jpg", body: { size: 10, attachmentId: "j" } },
    ]
    const jpegOnly = collectReceiptAttachments({ mimeType: "multipart/mixed", parts })
    expect(jpegOnly.map((a) => a.refKey)).toEqual(["2"])
    // Simulate the widened world by dropping the unreadable part from the tree:
    // the jpeg's key is unchanged either way.
    const bothReadable = collectReceiptAttachments({ mimeType: "multipart/mixed", parts: [parts[1]] })
    expect(bothReadable.map((a) => a.refKey)).toEqual(["2"])
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
