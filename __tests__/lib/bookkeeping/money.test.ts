import { describe, it, expect } from "vitest"
import { formatCents, signedCents } from "@/lib/bookkeeping/money"

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
