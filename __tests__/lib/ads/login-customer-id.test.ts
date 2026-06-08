import { describe, it, expect, vi, beforeEach } from "vitest"
import { normalizeLoginCustomerId } from "@/lib/ads/login-customer-id"

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("normalizeLoginCustomerId", () => {
  it("returns a clean 10-digit id unchanged", () => {
    expect(normalizeLoginCustomerId("7120798092")).toBe("7120798092")
  })

  it("strips dashes and spaces", () => {
    expect(normalizeLoginCustomerId("712-079-8092")).toBe("7120798092")
    expect(normalizeLoginCustomerId(" 712 079 8092 ")).toBe("7120798092")
  })

  it("heals an exactly-doubled value (the bug from production)", () => {
    expect(normalizeLoginCustomerId("71207980927120798092")).toBe("7120798092")
  })

  it("returns undefined for empty / nullish input", () => {
    expect(normalizeLoginCustomerId(undefined)).toBeUndefined()
    expect(normalizeLoginCustomerId(null)).toBeUndefined()
    expect(normalizeLoginCustomerId("")).toBeUndefined()
    expect(normalizeLoginCustomerId("---")).toBeUndefined()
  })

  it("returns the digits without throwing for other malformed values", () => {
    expect(normalizeLoginCustomerId("12345")).toBe("12345")
  })
})
