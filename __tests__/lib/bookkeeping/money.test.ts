import { describe, it, expect } from "vitest"
import { formatCents, signedCents, parseDollarsToCents, centsToDollarInput } from "@/lib/bookkeeping/money"

describe("formatCents", () => {
  it("formats USD with thousands + cents", () => {
    expect(formatCents(123456)).toBe("$1,234.56")
  })
  it("formats zero", () => {
    expect(formatCents(0)).toBe("$0.00")
  })
  it("formats negative", () => {
    expect(formatCents(-500)).toBe("-$5.00")
  })
})

describe("signedCents", () => {
  it("income is positive", () => {
    expect(signedCents(500, "income")).toBe(500)
  })
  it("expense is negative", () => {
    expect(signedCents(500, "expense")).toBe(-500)
  })
})

describe("parseDollarsToCents", () => {
  it("parses plain, currency-marked and grouped input", () => {
    expect(parseDollarsToCents("249")).toBe(24900)
    expect(parseDollarsToCents("249.00")).toBe(24900)
    expect(parseDollarsToCents("$1,249.50")).toBe(124950)
    expect(parseDollarsToCents(" 0.07 ")).toBe(7)
  })

  it("pads a single decimal place and truncates beyond two", () => {
    expect(parseDollarsToCents("12.5")).toBe(1250)
    expect(parseDollarsToCents("12.567")).toBe(1256)
  })

  it("splits on the decimal point rather than multiplying a float", () => {
    // 8.29 * 100 === 828.9999... — a rounding-free implementation is required,
    // and the string-split one is exact for every 2-dp value.
    expect(parseDollarsToCents("8.29")).toBe(829)
    expect(parseDollarsToCents("1.005")).toBe(100)
    expect(parseDollarsToCents("70.07")).toBe(7007)
  })

  it("rejects blank, negative and non-numeric input", () => {
    expect(parseDollarsToCents("")).toBeNull()
    expect(parseDollarsToCents("   ")).toBeNull()
    expect(parseDollarsToCents("-5.00")).toBeNull()
    expect(parseDollarsToCents("abc")).toBeNull()
    expect(parseDollarsToCents("1.2.3")).toBeNull()
  })
})

describe("centsToDollarInput", () => {
  it("renders an editable plain-decimal value", () => {
    expect(centsToDollarInput(24900)).toBe("249.00")
    expect(centsToDollarInput(7)).toBe("0.07")
    expect(centsToDollarInput(0)).toBe("0.00")
  })

  it("round-trips through parseDollarsToCents", () => {
    for (const cents of [0, 1, 7, 999, 24900, 124950, 100000000]) {
      expect(parseDollarsToCents(centsToDollarInput(cents))).toBe(cents)
    }
  })
})
