import { describe, it, expect } from "vitest"
import {
  resizeReceiptForVision,
  coalesceReceiptResult,
  documentBackfillPayload,
  buildReceiptVisionPayload,
  receiptUserMessage,
} from "../receipt-scan.js"

describe("buildReceiptVisionPayload", () => {
  it("sends a PDF as a document block and never touches sharp", async () => {
    // These bytes are not a decodable image. If the mimeType branch were lost
    // and this fell through to resizeReceiptForVision, sharp would reject with
    // "unsupported image format" and this test would fail — which is the
    // point: it cannot pass without the branch.
    const pdf = Buffer.from("%PDF-1.4\nnot an image at all\n%%EOF")
    const payload = await buildReceiptVisionPayload(pdf, "application/pdf")
    expect(payload.images).toBeUndefined()
    expect(payload.documents).toEqual([
      { media_type: "application/pdf", data: pdf.toString("base64") },
    ])
  })

  it("still resizes images through sharp", async () => {
    const sharp = (await import("sharp")).default
    const jpeg = await sharp({
      create: { width: 2400, height: 1800, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .jpeg()
      .toBuffer()
    const payload = await buildReceiptVisionPayload(jpeg, "image/jpeg")
    expect(payload.documents).toBeUndefined()
    expect(payload.images?.[0].media_type).toBe("image/jpeg")
    // Proof it went through the resizer rather than being passed through raw.
    expect(Buffer.from(payload.images![0].data, "base64").length).toBeLessThan(jpeg.length)
  })
})

describe("receiptUserMessage", () => {
  it("tells the model to find one grand total in a multi-page PDF", () => {
    const msg = receiptUserMessage("## Expense categories\nFuel", true)
    expect(msg).toMatch(/pdf/i)
    expect(msg).toMatch(/grand total/i)
    expect(msg).toContain("## Expense categories\nFuel")
  })
  it("keeps the image wording for photos", () => {
    const msg = receiptUserMessage("## Expense categories\nFuel", false)
    expect(msg).toMatch(/image/i)
    expect(msg).not.toMatch(/grand total/i)
  })
})

describe("resizeReceiptForVision", () => {
  it("produces a base64 jpeg under the vision size budget", async () => {
    const sharp = (await import("sharp")).default
    const big = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: { r: 200, g: 180, b: 160 } },
    })
      .jpeg()
      .toBuffer()
    const out = await resizeReceiptForVision(big)
    expect(out.media_type).toBe("image/jpeg")
    expect(out.data.length).toBeGreaterThan(0)
    // decoded bytes well under Anthropic's 5MB limit
    expect(Buffer.from(out.data, "base64").length).toBeLessThan(5 * 1024 * 1024)
  })
})

describe("coalesceReceiptResult", () => {
  it("fills missing/null fields (RTDB-dropped) with null and warnings []", () => {
    expect(coalesceReceiptResult({ confidence: "low" } as never)).toEqual({
      vendor: null,
      amount_cents: null,
      occurred_on: null,
      suggested_category: null,
      business_purpose_hint: null,
      currency: null,
      confidence: "low",
      warnings: [],
    })
  })
})

describe("documentBackfillPayload", () => {
  it("stamps occurred_on on both period bounds and persists the coalesced scan_result", () => {
    const result = coalesceReceiptResult({
      vendor: "Home Depot",
      amount_cents: 12555,
      occurred_on: "2026-07-20",
      confidence: "high",
    } as never)
    // Asserted against a spelled-out literal (NOT the `result` reference) so a
    // shallow-copy-and-drop-a-field mutation in the implementation fails here.
    expect(documentBackfillPayload(result)).toEqual({
      period_start: "2026-07-20",
      period_end: "2026-07-20",
      row_count: 1,
      scan_result: {
        vendor: "Home Depot",
        amount_cents: 12555,
        occurred_on: "2026-07-20",
        suggested_category: null,
        business_purpose_hint: null,
        currency: null,
        confidence: "high",
        warnings: [],
      },
    })
  })

  it("null occurred_on (blurry read) → null period bounds, scan_result still stored", () => {
    const result = coalesceReceiptResult(null)
    expect(documentBackfillPayload(result)).toEqual({
      period_start: null,
      period_end: null,
      row_count: 1,
      scan_result: {
        vendor: null,
        amount_cents: null,
        occurred_on: null,
        suggested_category: null,
        business_purpose_hint: null,
        currency: null,
        confidence: "low",
        warnings: [],
      },
    })
  })

  // receiptScanSchema only REGEX-validates occurred_on, so a hallucinated
  // calendar-invalid day survives callAgent's schema.parse. period_start/end
  // are `date` columns — Postgres aborts the WHOLE update with 22008
  // (verified live: `select '2026-02-30'::date` -> date/time field value out of
  // range), which would silently take scan_result down with the period bounds
  // that nothing reads. Null the bounds, keep the raw string in scan_result for
  // the human reviewer.
  it.each(["2026-02-30", "2026-04-31", "2026-02-29", "2026-13-01", "2026-00-10", "2026-7-20", "not-a-date"])(
    "calendar-invalid occurred_on %s → null period bounds, raw string preserved in scan_result",
    (day) => {
      const result = coalesceReceiptResult({ occurred_on: day, confidence: "high" } as never)
      const payload = documentBackfillPayload(result)
      expect(payload.period_start).toBeNull()
      expect(payload.period_end).toBeNull()
      expect(payload.scan_result.occurred_on).toBe(day)
    },
  )

  it("keeps a real leap day (2024-02-29)", () => {
    const result = coalesceReceiptResult({ occurred_on: "2024-02-29", confidence: "high" } as never)
    expect(documentBackfillPayload(result).period_start).toBe("2024-02-29")
    expect(documentBackfillPayload(result).period_end).toBe("2024-02-29")
  })
})
