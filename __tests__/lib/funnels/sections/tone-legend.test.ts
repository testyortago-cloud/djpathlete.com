// @vitest-environment node
//
// The legend is a CLAIM ABOUT THE STYLESHEET, not decoration: it is what the
// prompt tells the model a tone looks like, and what the inspector prints next
// to the swatch. A description that drifts from the CSS is worse than none —
// it teaches the model, confidently, to pick the wrong band.
//
// So this parses the REAL `THEME_CSS` and holds the table to it.
import { describe, it, expect } from "vitest"

import { THEME_CSS } from "@/lib/funnels/sections/styles"
import { TONE_SWATCHES, TONE_COLOUR_LEGEND, toneSwatch } from "@/lib/funnels/sections/tone-legend"
import { sectionStyleSchema } from "@/lib/funnels/sections/registry"

/** The `background:` a `[data-tone="x"]` rule actually sets, or null. */
function paintedBackground(tone: string): string | null {
  const rule = new RegExp(`\\.djp-s\\[data-tone="${tone}"\\]\\s*\\{([^}]*)\\}`)
  const match = THEME_CSS.match(rule)
  if (!match) return null
  const background = match[1].match(/background:\s*([^;]+);/)
  return background ? background[1].trim() : null
}

describe("the legend matches the stylesheet that paints it", () => {
  it("covers every tone the schema accepts, and invents none", () => {
    const schemaTones = sectionStyleSchema.shape.tone.unwrap().options as readonly string[]
    expect([...TONE_SWATCHES.map((s) => s.id)].sort()).toEqual([...schemaTones].sort())
  })

  it.each(["muted", "accent", "dark"])("`%s` names the token the CSS actually paints", (tone) => {
    const swatch = toneSwatch(tone as never)
    // Not "some background exists" — WHICH one. `dark` claiming `var(--accent)`
    // would sail past a presence check and mislead every reader of the legend.
    expect(paintedBackground(tone)).toBe(swatch.background)
  })

  it("`default` is the absence of a repaint, and says so", () => {
    // There is deliberately no `[data-tone="default"]` background rule; the
    // section keeps the page background. The legend still has to describe it,
    // because "default" is the one an owner asking for white will want.
    expect(paintedBackground("default")).toBeNull()
    expect(toneSwatch("default").background).toBe("var(--background)")
    expect(toneSwatch("default").description).toMatch(/white/i)
  })

  it("the tone whose background is `--primary` is the one described as green", () => {
    // The exact mapping the builder got wrong in production: the owner asked
    // for green, and `--primary` is the green.
    const green = TONE_SWATCHES.find((s) => s.background === "var(--primary)")
    expect(green?.id).toBe("dark")
    expect(green?.description).toMatch(/green/i)
    expect(green?.label).toMatch(/green/i)
  })

  it("the prompt legend names every tone AND a colour for each", () => {
    for (const swatch of TONE_SWATCHES) {
      expect(TONE_COLOUR_LEGEND).toContain(`"${swatch.id}"`)
      expect(TONE_COLOUR_LEGEND).toContain(swatch.description)
    }
  })

  it("every label names a colour, not just the role", () => {
    // "Default / Muted / Accent / Dark" is exactly the select the owner could
    // not use. Each label must carry a colour word.
    for (const swatch of TONE_SWATCHES) {
      expect(swatch.label).toMatch(/white|grey|gray|tan|gold|green/i)
    }
  })
})
