import { describe, it, expect } from "vitest"
import {
  PALETTE_PRESETS, PALETTE_TABLE, resolvePalette, contrastRatio,
} from "@/lib/funnels/sections/palettes"

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for a colour on itself", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1)
    expect(contrastRatio("#3a7d44", "#3a7d44")).toBeCloseTo(1, 5)
  })
  it("is symmetric", () => {
    expect(contrastRatio("#123456", "#fedcba")).toBeCloseTo(contrastRatio("#fedcba", "#123456"), 5)
  })
})

describe("PALETTE_TABLE", () => {
  it("has a row for every advertised preset and no extras", () => {
    expect(Object.keys(PALETTE_TABLE).sort()).toEqual([...PALETTE_PRESETS].sort())
  })
  it("holds only six-digit hex", () => {
    for (const [name, row] of Object.entries(PALETTE_TABLE))
      for (const [token, value] of Object.entries(row))
        expect(value, `${name}.${token}`).toMatch(/^#[0-9a-f]{6}$/)
  })
  // THE POINT OF THE TABLE. A preset that cannot be read is worse than no preset:
  // it ships an unreadable page under a reassuring name.
  it("meets WCAG AA on every foreground/background pair it actually renders", () => {
    for (const [name, p] of Object.entries(PALETTE_TABLE)) {
      expect(contrastRatio(p.ink, p.paper), `${name}: body text on paper`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.ink, p.surface), `${name}: body text on muted band`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.brandInk, p.brand), `${name}: text on brand band`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.accentInk, p.accent), `${name}: text on accent band`).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe("resolvePalette", () => {
  it("returns every token for a bare brand colour", () => {
    const p = resolvePalette({ brand: "#6d28d9" })
    for (const value of Object.values(p)) expect(value).toMatch(/^#[0-9a-f]{6}$/)
    expect(p.brand).toBe("#6d28d9")
  })
  // The derivation exists so the MODEL never has to do colour theory. If it only
  // works for the hues someone happened to try, it has not done its job.
  it("meets WCAG AA for brand hues all the way round the wheel", () => {
    for (let hue = 0; hue < 360; hue += 15) {
      const brand = hslToHex(hue, 0.65, 0.45)
      const p = resolvePalette({ brand })
      expect(contrastRatio(p.ink, p.paper), `hue ${hue}: body on paper`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.ink, p.surface), `hue ${hue}: body on surface`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.brandInk, p.brand), `hue ${hue}: text on brand`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.accentInk, p.accent), `hue ${hue}: text on accent`).toBeGreaterThanOrEqual(4.5)
    }
  })
  it("survives the extremes that break a naive luminance split", () => {
    for (const brand of ["#000000", "#ffffff", "#ffff00", "#0000ff", "#808080"]) {
      const p = resolvePalette({ brand })
      expect(contrastRatio(p.brandInk, p.brand), brand).toBeGreaterThanOrEqual(4.5)
    }
  })
  it("honours an explicit accent and a dark mode", () => {
    expect(resolvePalette({ brand: "#6d28d9", accent: "#f59e0b" }).accent).toBe("#f59e0b")
    const dark = resolvePalette({ brand: "#6d28d9", mode: "dark" })
    const light = resolvePalette({ brand: "#6d28d9", mode: "light" })
    expect(dark.paper).not.toBe(light.paper)
    expect(contrastRatio(dark.ink, dark.paper)).toBeGreaterThanOrEqual(4.5)
  })
  it("is deterministic", () => {
    expect(resolvePalette({ brand: "#3a7d44" })).toEqual(resolvePalette({ brand: "#3a7d44" }))
  })
})

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const to = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0")
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`
}
