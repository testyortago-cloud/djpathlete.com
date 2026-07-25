import { describe, it, expect } from "vitest"
import { resizeReceiptForVision, coalesceReceiptResult, documentBackfillPayload } from "../receipt-scan.js"

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
    expect(documentBackfillPayload(result)).toEqual({
      period_start: "2026-07-20",
      period_end: "2026-07-20",
      row_count: 1,
      scan_result: result,
    })
    // The stored object is the coalesced shape — every field explicit,
    // never undefined leaves (RTDB discipline carried into the jsonb column).
    expect(documentBackfillPayload(result).scan_result).toMatchObject({
      suggested_category: null,
      business_purpose_hint: null,
      currency: null,
      warnings: [],
    })
  })

  it("null occurred_on (blurry read) → null period bounds, scan_result still stored", () => {
    const result = coalesceReceiptResult(null)
    expect(documentBackfillPayload(result)).toMatchObject({
      period_start: null,
      period_end: null,
      row_count: 1,
      scan_result: result,
    })
  })
})
