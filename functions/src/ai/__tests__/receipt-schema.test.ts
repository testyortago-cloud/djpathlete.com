import { describe, it, expect } from "vitest"
import { receiptScanSchema } from "../receipt-schema.js"

describe("receiptScanSchema", () => {
  it("parses a full extraction", () => {
    const r = receiptScanSchema.safeParse({
      vendor: "Whole Foods", amount_cents: 4212, occurred_on: "2026-07-18",
      suggested_category: "Meals (business purpose)", business_purpose_hint: "team lunch",
      memo: "Catered team lunch order", currency: "usd", confidence: "high", warnings: [],
    })
    expect(r.success).toBe(true)
  })
  it("parses an ALL-NULL result (unreadable photo) — RTDB null-leaf safety", () => {
    const r = receiptScanSchema.safeParse({
      vendor: null, amount_cents: null, occurred_on: null,
      suggested_category: null, business_purpose_hint: null, currency: null,
      confidence: "low", warnings: ["image too blurry to read"],
    })
    expect(r.success).toBe(true)
  })
  it("parses a result with fields OMITTED entirely (RTDB dropped the null leaves)", () => {
    const r = receiptScanSchema.safeParse({ confidence: "low", warnings: [] })
    expect(r.success).toBe(true)
  })
  it("rejects a bad date shape", () => {
    expect(receiptScanSchema.safeParse({ occurred_on: "07/18/2026", confidence: "low", warnings: [] }).success).toBe(false)
  })
  it("accepts paid/due payment_status and rejects anything else", () => {
    expect(receiptScanSchema.safeParse({ payment_status: "due", confidence: "low", warnings: [] }).success).toBe(true)
    expect(receiptScanSchema.safeParse({ payment_status: "paid", confidence: "low", warnings: [] }).success).toBe(true)
    expect(receiptScanSchema.safeParse({ payment_status: "pending", confidence: "low", warnings: [] }).success).toBe(false)
  })
})
