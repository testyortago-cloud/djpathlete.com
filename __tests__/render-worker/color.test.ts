// __tests__/render-worker/color.test.ts
import { describe, it, expect } from "vitest"
import { oklchToHex } from "@/render-worker/src/lib/color"

describe("oklchToHex", () => {
  it("converts an oklch string to a 6-digit hex", () => {
    const hex = oklchToHex("oklch(0.70 0.13 140)")
    expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
  })
  it("falls back to the brand accent on an unparseable string", () => {
    expect(oklchToHex("not-a-color")).toBe("#C49B7A")
  })
})
