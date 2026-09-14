import { describe, expect, it } from "vitest"
import { FUNNEL_ROOT_ID } from "@/lib/funnels/compile"
import type { RenderBrowser } from "@/lib/funnels/browser"
import {
  buildRenderDocument,
  dynamicRegionsIn,
  islandsBySection,
  planTiles,
  RENDER_FONT_FAMILIES,
  renderDocToImages,
} from "@/lib/funnels/render-image"
import { reassemble } from "@/lib/funnels/sections/doc"
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

// The same document with the form taken out — the CONTROL for every assertion
// about islands below. "No region is reported" is worth nothing unless the
// same code reports one on a page that has one.
const DOC_WITHOUT_ISLANDS = sectionDocSchema.parse({
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
        primaryCta: { label: "Read more", target: { kind: "url", href: "https://example.com/x" } },
      },
    },
  ],
}) as SectionDoc

function fakeBrowser(over: Partial<{ height: number; fonts: boolean; shootThrows: boolean }> = {}) {
  const closed = { value: false }
  const browser: RenderBrowser = {
    async newPage() {
      return {
        async setContent() {},
        async fontsInUseLoaded() {
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

  it("reports the regions the pictures cannot show", async () => {
    // THE FABRICATED-TESTIMONIAL GUARD. Without this list the art critic reads
    // an unhydrated island as an empty band, and the reviser fills it with
    // content it invented — observed end to end on 2026-09-14, on a live page,
    // with a named person and a made-up 40-yard-dash time.
    const { browser } = fakeBrowser()
    const result = await renderDocToImages(DOC, { brandKit: null }, async () => browser)
    expect(result.dynamicRegions).toEqual(["signup (a form)"])
  })

  it("reports no regions for a page that has none — the absence control", async () => {
    const { browser } = fakeBrowser()
    const result = await renderDocToImages(DOC_WITHOUT_ISLANDS, { brandKit: null }, async () => browser)
    expect(result.dynamicRegions).toEqual([])
    // The render still happened, so the empty list is an answer and not a
    // silent failure earlier in the function.
    expect(result.error).toBeNull()
    expect(result.images.length).toBeGreaterThan(0)
  })

  it("claims no regions when there are no pictures to describe", async () => {
    const result = await renderDocToImages(DOC, { brandKit: null }, async () => null)
    expect(result.dynamicRegions).toEqual([])
  })

  it("closes the browser even when the render fails", async () => {
    // A leaked Chrome in a serverless container is a memory leak that outlives
    // the request.
    const { browser, closed } = fakeBrowser({ shootThrows: true })
    await renderDocToImages(DOC, { brandKit: null }, async () => browser)
    expect(closed.value).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The island scan. READ OUT OF THE EMITTED HTML, never re-derived from the
// document: which sections hold an island depends on a `source:"live"`
// discriminant on two kinds, a CTA's target kind on several more, and
// validation passing inside `renderIslandIfValid`. A second copy of those rules
// would be right on the day it was written and wrong afterwards, which is the
// bug class that produced the fabricated testimonial in the first place.
// ---------------------------------------------------------------------------
describe("islandsBySection", () => {
  it("attributes an island to the section it sits inside", () => {
    const { html } = reassemble(DOC, { brandKit: null })
    expect(islandsBySection(html)).toEqual({ signup: ["form"] })
  })

  it("reads the real markup, not a guess — the form island IS in that html", () => {
    // Pins the two halves to each other: if `renderIsland` ever stops emitting
    // this attribute, this fails rather than the scan quietly returning
    // nothing for every page forever.
    const { html } = reassemble(DOC, { brandKit: null })
    expect(html).toContain('data-djp-island="form"')
  })

  it("returns nothing for a page with no island — the presence control's twin", () => {
    const { html } = reassemble(DOC_WITHOUT_ISLANDS, { brandKit: null })
    expect(html).not.toContain("data-djp-island")
    expect(islandsBySection(html)).toEqual({})
  })

  it("keeps two different islands in one section apart, and two sections apart", () => {
    const html =
      `<section id="alpha" class="djp-s"><div data-djp-island="form" data-djp-props='{}'></div>` +
      `<div data-djp-island="checkout" data-djp-props='{}'></div></section>` +
      `<section id="beta" class="djp-s"><div data-djp-island="faq" data-djp-props='{}'></div></section>`
    expect(islandsBySection(html)).toEqual({ alpha: ["form", "checkout"], beta: ["faq"] })
  })
})

describe("dynamicRegionsIn", () => {
  it("names the section AND what is in it, because 'form' alone is not actionable", () => {
    const { html } = reassemble(DOC, { brandKit: null })
    expect(dynamicRegionsIn(html)).toEqual(["signup (a form)"])
  })

  it("describes each island in words a critic can act on", () => {
    const html =
      `<section id="proof" class="djp-s"><div data-djp-island="testimonials" data-djp-props='{}'></div></section>` +
      `<section id="questions" class="djp-s"><div data-djp-island="faq" data-djp-props='{}'></div></section>`
    expect(dynamicRegionsIn(html)).toEqual(["proof (a live testimonial feed)", "questions (a live FAQ list)"])
  })

  it("still reports an island it cannot attribute to a section", () => {
    // Cannot happen today — every renderer emits islands inside a <section>.
    // It must not silently vanish if that changes: a region nobody warns the
    // critic about is the entire defect this list exists to prevent.
    expect(dynamicRegionsIn(`<div data-djp-island="form" data-djp-props='{}'></div>`)).toEqual(["a form"])
  })
})
