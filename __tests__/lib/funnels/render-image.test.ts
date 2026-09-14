import { describe, expect, it } from "vitest"
import { FUNNEL_ROOT_ID } from "@/lib/funnels/compile"
import { buildRenderDocument, planTiles, RENDER_FONT_FAMILIES } from "@/lib/funnels/render-image"

describe("buildRenderDocument", () => {
  it("wraps the html in the id every CSS selector is scoped to", () => {
    // reassemble()'s CSS is ENTIRELY scoped to #djp-funnel-root and its html
    // starts at <div class="djp-page">. Omitting the wrapper loads all 237
    // rules and matches none of them, producing a screenshot of unstyled HTML
    // that reads to a critic as a page-wide disaster. Task 4 proves the effect
    // in a real browser; this proves the intent.
    const doc = buildRenderDocument("<div class='djp-page'>hi</div>", "#djp-funnel-root { color: red }")
    expect(doc).toContain(`id="${FUNNEL_ROOT_ID}"`)
    expect(doc.indexOf(`id="${FUNNEL_ROOT_ID}"`)).toBeLessThan(doc.indexOf("djp-page"))
  })

  it("defines the next/font variables the stylesheet reads", () => {
    // Without these the whole font-family declaration is invalid at
    // computed-value time and headings fall back to Times New Roman.
    const doc = buildRenderDocument("<p>x</p>", "")
    expect(doc).toContain("--font-lexend-exa")
    expect(doc).toContain("--font-lexend-deca")
    expect(doc).toContain("--font-jetbrains-mono")
  })

  it("puts the caller's css inside the style element", () => {
    expect(buildRenderDocument("<p>x</p>", ".sentinel{color:blue}")).toContain(".sentinel{color:blue}")
  })

  it("names exactly the families it asks the browser to load", () => {
    const doc = buildRenderDocument("<p>x</p>", "")
    for (const family of RENDER_FONT_FAMILIES) {
      expect(doc).toContain(family)
    }
  })
})

describe("planTiles", () => {
  it("returns one slice for a page shorter than a tile", () => {
    expect(planTiles(800, 1400, 5)).toEqual({ slices: [{ y: 0, height: 800 }], truncated: false })
  })

  it("returns exactly N for a page that is exactly N tiles, not N+1", () => {
    const plan = planTiles(2800, 1400, 5)
    expect(plan.slices).toHaveLength(2)
    expect(plan.truncated).toBe(false)
    expect(plan.slices[1]).toEqual({ y: 1400, height: 1400 })
  })

  it("adds a short final slice for a page one pixel over", () => {
    const plan = planTiles(2801, 1400, 5)
    expect(plan.slices).toHaveLength(3)
    expect(plan.slices[2]).toEqual({ y: 2800, height: 1 })
    expect(plan.truncated).toBe(false)
  })

  it("stops at maxTiles and says so", () => {
    const plan = planTiles(100_000, 1400, 5)
    expect(plan.slices).toHaveLength(5)
    expect(plan.truncated).toBe(true)
    // Truncation must not produce a slice past what was captured.
    expect(plan.slices[4]).toEqual({ y: 5600, height: 1400 })
  })

  it("treats a zero-height page as nothing to capture", () => {
    expect(planTiles(0, 1400, 5)).toEqual({ slices: [], truncated: false })
  })
})
