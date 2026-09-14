import { describe, expect, it } from "vitest"
import { FUNNEL_ROOT_ID } from "@/lib/funnels/compile"
import type { RenderBrowser } from "@/lib/funnels/browser"
import { buildRenderDocument, planTiles, RENDER_FONT_FAMILIES, renderDocToImages } from "@/lib/funnels/render-image"
import { sectionDocSchema, type SectionDoc } from "@/lib/funnels/sections/registry"

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

// VALIDATED against sectionDocSchema and run through reassemble() while this
// plan was written — do not "tidy" any key here without re-running that check.
// The first draft of this fixture had SIX schema errors and every one of them
// looked plausible: `version` (it is `v`), a missing `engine: "sections"`,
// `target: {kind:"section", id}` (it is `{kind:"anchor", sectionId}`), a
// missing `formKey`, `fields` as strings (they are objects), and `headline` on
// the form (a form takes `heading`; only the hero takes `headline`).
const DOC = sectionDocSchema.parse({
  v: 1,
  engine: "sections",
  theme: { tone: "light", accent: "accent", radius: "sharp" },
  sections: [
    {
      id: "hero",
      kind: "hero",
      variant: "centered",
      style: { headline: "xl", align: "center", tone: "default", pad: "roomy" },
      props: {
        headline: "Twelve sessions",
        primaryCta: { label: "Reserve a place", target: { kind: "anchor", sectionId: "signup" } },
      },
    },
    {
      id: "signup",
      kind: "form",
      variant: "split",
      style: { headline: "lg", align: "left", tone: "dark", pad: "roomy" },
      props: {
        formKey: "test-form",
        heading: "Reserve a place",
        fields: [{ name: "email", role: "parent_email", type: "email", label: "Email address", required: true }],
        submitLabel: "Send",
      },
    },
  ],
  // `buildSectionSchema`'s `propsSchema` parameter is deliberately typed as
  // bare `z.ZodType` (registry.ts, "widened for storage"), so the STATIC type
  // z.infer gives `sectionDocSchema` has `props: unknown` on every section —
  // even though `.parse()` has just validated each one against its concrete
  // per-kind schema at runtime. Cast to the hand-written `SectionDoc`
  // interface rather than loosen anything the assertions below check.
}) as SectionDoc

function fakeBrowser(over: Partial<{ height: number; fonts: boolean; shootThrows: boolean }> = {}) {
  const closed = { value: false }
  const browser: RenderBrowser = {
    async newPage() {
      return {
        async setContent() {},
        async fontsLoaded() {
          return over.fonts ?? true
        },
        async pageHeight() {
          return over.height ?? 2000
        },
        async shoot() {
          if (over.shootThrows) throw new Error("screenshot exploded")
          return Buffer.from("PNGDATA")
        },
      }
    },
    async close() {
      closed.value = true
    },
  }
  return { browser, closed }
}

describe("renderDocToImages", () => {
  it("returns an overview plus one image per slice", async () => {
    const { browser } = fakeBrowser({ height: 2000 })
    const result = await renderDocToImages(DOC, { brandKit: null }, async () => browser)
    expect(result.error).toBeNull()
    // 2000px at a 1400px tile height = 2 slices, plus the overview.
    expect(result.images).toHaveLength(3)
    expect(result.height).toBe(2000)
  })

  it("sends BARE base64 with no data: prefix", async () => {
    // The wire format callAgent's images option requires. A data: prefix would
    // satisfy the type and be rejected by the provider.
    const { browser } = fakeBrowser()
    const result = await renderDocToImages(DOC, { brandKit: null }, async () => browser)
    for (const image of result.images) {
      expect(image.data.startsWith("data:")).toBe(false)
      expect(image.mediaType).toBe("image/png")
      expect(image.data).toBe(Buffer.from("PNGDATA").toString("base64"))
    }
  })

  it("reports honestly when the webfonts did not load", async () => {
    const { browser } = fakeBrowser({ fonts: false })
    const result = await renderDocToImages(DOC, { brandKit: null }, async () => browser)
    expect(result.typographyFaithful).toBe(false)
    // ...and still renders. A fallback face is not a reason to show nothing.
    expect(result.images.length).toBeGreaterThan(0)
  })

  it("reports faithful typography when they did — the presence control", async () => {
    const { browser } = fakeBrowser({ fonts: true })
    const result = await renderDocToImages(DOC, { brandKit: null }, async () => browser)
    expect(result.typographyFaithful).toBe(true)
  })

  it("flags a page too tall to capture", async () => {
    const { browser } = fakeBrowser({ height: 100_000 })
    const result = await renderDocToImages(DOC, { brandKit: null }, async () => browser)
    expect(result.truncated).toBe(true)
    expect(result.images).toHaveLength(6) // overview + 5 capped slices
  })

  it("returns no images and an error when there is no browser", async () => {
    const result = await renderDocToImages(DOC, { brandKit: null }, async () => null)
    expect(result.images).toEqual([])
    expect(result.error).toMatch(/browser/i)
  })

  it("returns an error rather than throwing when the launcher throws", async () => {
    const result = await renderDocToImages(DOC, { brandKit: null }, async () => {
      throw new Error("launch exploded")
    })
    expect(result.images).toEqual([])
    expect(result.error).toContain("launch exploded")
  })

  it("returns an error rather than throwing when a screenshot throws", async () => {
    const { browser } = fakeBrowser({ shootThrows: true })
    const result = await renderDocToImages(DOC, { brandKit: null }, async () => browser)
    expect(result.images).toEqual([])
    expect(result.error).toContain("screenshot exploded")
  })

  it("closes the browser even when the render fails", async () => {
    // A leaked Chrome in a serverless container is a memory leak that outlives
    // the request.
    const { browser, closed } = fakeBrowser({ shootThrows: true })
    await renderDocToImages(DOC, { brandKit: null }, async () => browser)
    expect(closed.value).toBe(true)
  })
})
