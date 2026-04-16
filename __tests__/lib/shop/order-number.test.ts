import { describe, it, expect } from "vitest"
import { generateOrderNumber } from "@/lib/shop/order-number"

describe("generateOrderNumber", () => {
  it("starts with 'DJP-'", () => {
    expect(generateOrderNumber()).toMatch(/^DJP-/)
  })

  it("includes 8+ chars after prefix", () => {
    const n = generateOrderNumber()
    expect(n.length).toBeGreaterThanOrEqual(12)
  })

  it("produces unique values over 500 calls", () => {
    const set = new Set<string>()
    for (let i = 0; i < 500; i++) set.add(generateOrderNumber())
    expect(set.size).toBe(500)
  })

  it("uses only uppercase letters and digits (no ambiguous chars)", () => {
    for (let i = 0; i < 20; i++) {
      const n = generateOrderNumber()
      expect(n.slice(4)).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]+$/)
    }
  })
})
