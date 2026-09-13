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
  // THE GUARANTEE `brand` NEVER HAD. `brand` is paired with `brandInk` only as
  // a BACKGROUND (the assertion above, "text on brand band"); as TEXT on the
  // page's own ground (.djp-hd / .djp-plan-price / .djp-proof-value, painted
  // var(--primary) at the DEFAULT, untoned section) nothing ever proved it —
  // deriveSurface only proves ink-vs-surface. Measured before this fix:
  // `ink` (brand #111827, itself near-black) scored 1.10:1 against paper,
  // decisively below even the large-text 3:1 floor; `midnight` (1.88),
  // `steel` (2.19) and `plum` (2.74) also failed outright; only `ember`
  // cleared 3:1, and only by 0.01 (3.007:1) — a margin that thin is luck, not
  // a guarantee, especially for `.djp-plan-price`/`.djp-proof-value`, which
  // are not reliably "large text" the way a heading is.
  //
  // `brandOnPaper` targets 4.5:1 (body-text AA), not the 3:1 large-text floor
  // that produced the 3.007 near-miss — checked against BOTH `paper` and
  // `surface`, because `surface` measured uniformly slightly worse than
  // `paper` in every row, so paper alone would just move the bug one band
  // over. Worst case after this fix, across all twelve presets: `ember` at
  // 4.510:1 against surface (still comfortably >= 4.5) — see the report for
  // the full measured table.
  it("guarantees brandOnPaper reads on the page's own ground, not just the brand band", () => {
    for (const [name, p] of Object.entries(PALETTE_TABLE)) {
      expect(contrastRatio(p.brandOnPaper, p.paper), `${name}: brandOnPaper on paper`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.brandOnPaper, p.surface), `${name}: brandOnPaper on surface`).toBeGreaterThanOrEqual(4.5)
    }
  })
  // THE SAME GUARANTEE `accent` NEVER HAD — final whole-branch review, finding
  // 1 (2026-09-13). `accent` is paired with `accentInk` only as a BACKGROUND
  // (the AA test above, "text on accent band"); as TEXT on the page's own
  // ground (`.djp-eyebrow` / `.djp-ic` / `.djp-req`, painted `var(--accent)`
  // at the DEFAULT, untoned section) nothing ever proved it. Measured before
  // this fix: `ink` 1.11:1, `steel` 1.40:1, `midnight` 2.47 — the same order
  // of magnitude as the `brandOnPaper` defect above, missed by the
  // tone-contrast sweep in styles.ts because that sweep only ever covered the
  // accent/dark/muted TONES, never the untoned default ground.
  it("guarantees accentOnPaper reads on the page's own ground, not just the accent band", () => {
    for (const [name, p] of Object.entries(PALETTE_TABLE)) {
      expect(contrastRatio(p.accentOnPaper, p.paper), `${name}: accentOnPaper on paper`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.accentOnPaper, p.surface), `${name}: accentOnPaper on surface`).toBeGreaterThanOrEqual(4.5)
    }
  })
  // THE POINT OF *TWELVE* PRESETS. Every row is `resolvePalette(seed)`, so the
  // AA test above can only fail if `resolvePalette` itself is broken — it says
  // nothing about whether two SEEDS picked the same colour under different
  // names. "12 presets" that are secretly 3 colours is the exact bug this
  // whole build exists to fix, wearing a new hat. Plain RGB distance is not
  // good enough here (it calls #000080 and #008000 far apart when they read
  // as similar dark colours to a person) so this measures perceptual distance
  // — CIE76 ΔE over CIE Lab.
  //
  // Threshold picked by MEASURING the actual twelve `brand` seeds: the
  // closest real pair is `sand` (#b45309) / `clay` (#9a3412) at ΔE ≈ 16.82.
  // 15 sits just below that with a margin for floating point, so it still
  // catches a genuine near-collision without being tripped by two
  // legitimately-close-but-distinct earth tones. (`steel` used to collide
  // with `slate` at ΔE ≈ 8.6 — same Tailwind slate scale, two shades of one
  // colour — which is why `steel`'s seed was changed rather than the
  // threshold being lowered to fit it.)
  it("keeps every preset's brand colour perceptually distinct from every other", () => {
    const MIN_DELTA_E = 15
    const names = Object.keys(PALETTE_TABLE)
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = names[i]
        const b = names[j]
        const delta = deltaE76(PALETTE_TABLE[a as keyof typeof PALETTE_TABLE].brand, PALETTE_TABLE[b as keyof typeof PALETTE_TABLE].brand)
        expect(delta, `${a} vs ${b}`).toBeGreaterThanOrEqual(MIN_DELTA_E)
      }
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
      expect(contrastRatio(p.brandOnPaper, p.paper), `hue ${hue}: brandOnPaper on paper`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.brandOnPaper, p.surface), `hue ${hue}: brandOnPaper on surface`).toBeGreaterThanOrEqual(
        4.5,
      )
      expect(contrastRatio(p.accentOnPaper, p.paper), `hue ${hue}: accentOnPaper on paper`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.accentOnPaper, p.surface), `hue ${hue}: accentOnPaper on surface`).toBeGreaterThanOrEqual(
        4.5,
      )
    }
  })
  // Both modes, not just light: dark mode's paper is near-black, which is
  // exactly the case that broke `ink`/`midnight`/`steel`/`plum` above.
  it("meets brandOnPaper's and accentOnPaper's 4.5:1 in dark mode too, all the way round the wheel", () => {
    for (let hue = 0; hue < 360; hue += 15) {
      const brand = hslToHex(hue, 0.65, 0.45)
      const p = resolvePalette({ brand, mode: "dark" })
      expect(contrastRatio(p.brandOnPaper, p.paper), `hue ${hue} (dark): brandOnPaper on paper`).toBeGreaterThanOrEqual(
        4.5,
      )
      expect(
        contrastRatio(p.brandOnPaper, p.surface),
        `hue ${hue} (dark): brandOnPaper on surface`,
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        contrastRatio(p.accentOnPaper, p.paper),
        `hue ${hue} (dark): accentOnPaper on paper`,
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        contrastRatio(p.accentOnPaper, p.surface),
        `hue ${hue} (dark): accentOnPaper on surface`,
      ).toBeGreaterThanOrEqual(4.5)
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
  it("normalises an uppercase input to lowercase output", () => {
    expect(resolvePalette({ brand: "#6D28D9" }).brand).toBe("#6d28d9")
  })
})

// ---------------------------------------------------------------------------
// CIE76 ΔE over CIE Lab (D65), used only by the distinctness test above. Not
// exported from the module under test: this is a test-only measuring stick,
// deliberately independent of anything `palettes.ts` does internally.
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function srgbToLinear(channelByte: number): number {
  const c = channelByte / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function rgbToXyz(r: number, g: number, b: number): [number, number, number] {
  const R = srgbToLinear(r)
  const G = srgbToLinear(g)
  const B = srgbToLinear(b)
  return [
    R * 0.4124564 + G * 0.3575761 + B * 0.1804375,
    R * 0.2126729 + G * 0.7151522 + B * 0.072175,
    R * 0.0193339 + G * 0.119192 + B * 0.9503041,
  ]
}

function xyzToLab(x: number, y: number, z: number): [number, number, number] {
  const xn = 0.95047
  const yn = 1.0
  const zn = 1.08883
  const delta = 6 / 29
  const f = (t: number) => (t > delta ** 3 ? Math.cbrt(t) : t / (3 * delta ** 2) + 4 / 29)
  const fx = f(x / xn)
  const fy = f(y / yn)
  const fz = f(z / zn)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

function hexToLab(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex)
  const [x, y, z] = rgbToXyz(r, g, b)
  return xyzToLab(x, y, z)
}

function deltaE76(hexA: string, hexB: string): number {
  const [l1, a1, b1] = hexToLab(hexA)
  const [l2, a2, b2] = hexToLab(hexB)
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2)
}

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const to = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0")
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`
}
