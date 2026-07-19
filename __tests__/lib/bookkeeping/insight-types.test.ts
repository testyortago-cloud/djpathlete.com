import { describe, expect, it } from "vitest"
import { coerceHomeOfficePercent, coerceTaxRatePercent, isBlankPurpose, normalizeCounterparty } from "@/lib/bookkeeping/insight-types"

describe("normalizeCounterparty", () => {
  it("trims, lowercases, collapses internal whitespace", () => {
    expect(normalizeCounterparty("  Trainerize   App ")).toBe("trainerize app")
  })
  it("returns null for null, empty, and whitespace-only", () => {
    expect(normalizeCounterparty(null)).toBeNull()
    expect(normalizeCounterparty("")).toBeNull()
    expect(normalizeCounterparty("   ")).toBeNull()
  })
  it("preserves punctuation (only whitespace/case normalized)", () => {
    expect(normalizeCounterparty("Renter's  Insurance")).toBe("renter's insurance")
  })
})

describe("coerceHomeOfficePercent", () => {
  it("passes a valid number through", () => {
    expect(coerceHomeOfficePercent(12.5)).toBe(12.5)
    expect(coerceHomeOfficePercent(100)).toBe(100)
  })
  it("rejects junk: null, strings, NaN, Infinity, 0, negatives, >100", () => {
    for (const v of [null, undefined, "12.5", Number.NaN, Number.POSITIVE_INFINITY, 0, -5, 100.01, {}, true]) {
      expect(coerceHomeOfficePercent(v)).toBeNull()
    }
  })
})

describe("coerceTaxRatePercent", () => {
  it("passes a valid number through", () => {
    expect(coerceTaxRatePercent(22.5)).toBe(22.5)
    expect(coerceTaxRatePercent(100)).toBe(100)
  })
  it("rejects junk: null, strings, NaN, Infinity, 0, negatives, >100", () => {
    for (const v of [null, undefined, "22.5", Number.NaN, Number.POSITIVE_INFINITY, 0, -5, 100.01, {}, true]) {
      expect(coerceTaxRatePercent(v)).toBeNull()
    }
  })
})

describe("isBlankPurpose (shared by deduction finder + receipt watchdog)", () => {
  it("null, empty, and whitespace-only are blank; real text is not", () => {
    expect(isBlankPurpose(null)).toBe(true)
    expect(isBlankPurpose("")).toBe(true)
    expect(isBlankPurpose("   ")).toBe(true)
    expect(isBlankPurpose("client lunch")).toBe(false)
  })
})
