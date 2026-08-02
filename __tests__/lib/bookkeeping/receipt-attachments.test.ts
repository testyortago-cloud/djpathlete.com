import { describe, it, expect } from "vitest"
import {
  collectReceiptAttachments,
  countUnusableReceiptAttachments,
  decodeBodyData,
  findReceiptBody,
  isReceiptMime,
  MAX_ATTACHMENT_BYTES,
  MAX_BODY_BYTES,
  messageSubject,
} from "@/lib/bookkeeping/receipt-attachments"

describe("isReceiptMime", () => {
  it("accepts only the mimes the vision path can actually decode", () => {
    expect(isReceiptMime("image/jpeg")).toBe(true)
    expect(isReceiptMime("image/png")).toBe(true)
    expect(isReceiptMime("image/webp")).toBe(true)
    expect(isReceiptMime("text/calendar")).toBe(false)
    expect(isReceiptMime("application/octet-stream")).toBe(false)
  })

  it("accepts application/pdf now that the vision path branches on mime", () => {
    // functions/src/receipt-scan.ts:buildReceiptVisionPayload sends PDFs to
    // Claude as a document block instead of through sharp, so ingesting one
    // no longer guarantees a failed job. Page-capping happens in the poller
    // after download (lib/bookkeeping/receipt-pdf.ts) — this walk only sees
    // Gmail part metadata, never bytes.
    expect(isReceiptMime("application/pdf")).toBe(true)
  })

  it("still rejects image/heic — sharp 0.33.5 cannot decode it", () => {
    // sharp reports heif with fileSuffix ['.avif'] only, and there is no
    // document-block escape hatch for HEIC the way there is for PDF.
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
        // The PDF is now scannable, so only the HEIC is counted here.
        { mimeType: "application/pdf", filename: "invoice.pdf", body: { size: 2048, attachmentId: "a1" } },
        { mimeType: "image/heic", filename: "IMG_1.heic", body: { size: 2048, attachmentId: "a2" } },
        { mimeType: "image/jpeg", filename: "ok.jpg", body: { size: 2048, attachmentId: "a3" } },
        // .ics invites are not receipt-shaped at all — must NOT inflate the count
        { mimeType: "text/calendar", filename: "invite.ics", body: { size: 512, attachmentId: "a4" } },
      ],
    }
    expect(countUnusableReceiptAttachments(payload).unsupportedMime).toBe(1)
    expect(countUnusableReceiptAttachments(undefined).unsupportedMime).toBe(0)
  })
})

describe("countUnusableReceiptAttachments", () => {
  // Review finding: the size filter in collectReceiptAttachments drops an
  // oversized image/jpeg, but a mime-only "unsupported" count cannot see it —
  // so a coach who emails one high-res phone photo used to get a run reporting
  // "attachmentless" that then settled the message permanently. Nothing,
  // anywhere, said a receipt had been dropped.
  // HEIC is the unreadable-mime stand-in throughout this block. It used to be
  // PDF, but PDF became scannable when the vision path learned document
  // blocks — the double-count guard being tested here is mime-agnostic.
  const payload = {
    mimeType: "multipart/mixed",
    parts: [
      { mimeType: "image/heic", filename: "IMG_1.heic", body: { size: 2048, attachmentId: "a1" } },
      { mimeType: "image/jpeg", filename: "huge.jpg", body: { size: MAX_ATTACHMENT_BYTES + 1, attachmentId: "a2" } },
      { mimeType: "image/png", filename: "also-huge.png", body: { size: MAX_ATTACHMENT_BYTES * 3, attachmentId: "a3" } },
      { mimeType: "image/jpeg", filename: "fine.jpg", body: { size: 2048, attachmentId: "a4" } },
      { mimeType: "text/calendar", filename: "invite.ics", body: { size: MAX_ATTACHMENT_BYTES + 1, attachmentId: "a5" } },
    ],
  }

  it("splits unreadable receipt attachments into unsupported-mime vs oversized", () => {
    expect(countUnusableReceiptAttachments(payload)).toEqual({ unsupportedMime: 1, oversized: 2 })
  })

  it("never double-counts: an oversized HEIC is unsupported-mime only", () => {
    expect(
      countUnusableReceiptAttachments({
        mimeType: "multipart/mixed",
        parts: [
          { mimeType: "image/heic", filename: "big.heic", body: { size: MAX_ATTACHMENT_BYTES + 1, attachmentId: "a1" } },
        ],
      }),
    ).toEqual({ unsupportedMime: 1, oversized: 0 })
  })

  it("an oversized PDF is now counted as oversized, not unsupported", () => {
    // The mime is readable now, so the size arm is the one that must fire —
    // otherwise a too-big PDF would be reported under the wrong reason.
    expect(
      countUnusableReceiptAttachments({
        mimeType: "multipart/mixed",
        parts: [
          { mimeType: "application/pdf", filename: "big.pdf", body: { size: MAX_ATTACHMENT_BYTES + 1, attachmentId: "a1" } },
        ],
      }),
    ).toEqual({ unsupportedMime: 0, oversized: 1 })
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
    expect(collectReceiptAttachments(payload)).toEqual([
      // Walk positions: root 0, multipart/alternative 1, its two children 2-3,
      // the pdf 4, the jpeg 5, the png 6. The .ics is not receipt-shaped.
      { filename: "invoice.pdf", mimeType: "application/pdf", attachmentId: "a1", size: 2048, refKey: "p4" },
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

  it("refKey did NOT move when the mime allow-list widened (no re-ingest)", () => {
    // The killer scenario for an array-index key: a mail whose PDF sits ahead
    // of the jpeg. Under an index key the jpeg was 'gmail:m:0' while PDF was
    // unscannable and would have become 'gmail:m:1' the day PDF was added —
    // the already-ingested receipt would stop matching its stored external_ref
    // and be re-ingested (duplicate document + a second vision spend).
    //
    // This is no longer hypothetical: PDF IS scannable now, so both parts come
    // back, and the jpeg's key is still its partId.
    const parts = [
      { partId: "1", mimeType: "application/pdf", filename: "i.pdf", body: { size: 10, attachmentId: "p" } },
      { partId: "2", mimeType: "image/jpeg", filename: "r.jpg", body: { size: 10, attachmentId: "j" } },
    ]
    const widened = collectReceiptAttachments({ mimeType: "multipart/mixed", parts })
    expect(widened.map((a) => a.refKey)).toEqual(["1", "2"])
    // The pre-widening world (jpeg alone in the readable set) gave the jpeg
    // the same key — which is the property that prevented the re-ingest.
    const jpegOnly = collectReceiptAttachments({ mimeType: "multipart/mixed", parts: [parts[1]] })
    expect(jpegOnly.map((a) => a.refKey)).toEqual(["2"])
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

describe("findReceiptBody", () => {
  it("prefers the first text/html part over text/plain, walking nested multipart/alternative", () => {
    const payload = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { size: 20, data: "cGxhaW4" } },
        { mimeType: "text/html", body: { size: 900, data: "PGI-aHRtbDwvYj4" } },
      ],
    }
    expect(findReceiptBody(payload)).toEqual({ mimeType: "text/html", size: 900, data: "PGI-aHRtbDwvYj4" })
  })

  it("falls back to text/plain when no html part exists (single-part message: payload IS the body)", () => {
    expect(findReceiptBody({ mimeType: "text/plain", body: { size: 5, data: "aGVsbG8" } })).toEqual({
      mimeType: "text/plain", size: 5, data: "aGVsbG8",
    })
  })

  it("skips text parts that are ATTACHMENTS (filename set) — a notes.html attachment is not the body", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/html", filename: "notes.html", body: { size: 100, attachmentId: "a1" } },
        { mimeType: "text/plain", body: { size: 20, data: "cGxhaW4" } },
      ],
    }
    expect(findReceiptBody(payload)).toEqual({ mimeType: "text/plain", size: 20, data: "cGxhaW4" })
  })

  it("carries an attachmentId ref when Gmail did not inline the part; null for empty/absent bodies", () => {
    expect(
      findReceiptBody({
        mimeType: "multipart/alternative",
        parts: [{ mimeType: "text/html", body: { size: 300000, attachmentId: "big-body" } }],
      }),
    ).toEqual({ mimeType: "text/html", size: 300000, attachmentId: "big-body" })
    expect(findReceiptBody({ mimeType: "text/html", body: { size: 0 } })).toBeNull()
    expect(findReceiptBody(undefined)).toBeNull()
  })
})

describe("decodeBodyData", () => {
  it("decodes unpadded base64url (-/_ alphabet) to the original bytes", () => {
    const bytes = Buffer.from([0xfb, 0xff, 0xef, 0x01, 0x3e])
    const b64url = bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
    expect(decodeBodyData(b64url).equals(bytes)).toBe(true)
  })
})

describe("messageSubject", () => {
  it("reads the Subject header case-insensitively, trimmed; null when absent or blank", () => {
    expect(
      messageSubject({ headers: [{ name: "SUBJECT", value: "  Your receipt from Vercel Inc. #2090-9787 " }] }),
    ).toBe("Your receipt from Vercel Inc. #2090-9787")
    expect(messageSubject({ headers: [{ name: "Subject", value: "   " }] })).toBeNull()
    expect(messageSubject({ headers: [] })).toBeNull()
    expect(messageSubject(undefined)).toBeNull()
  })
})
