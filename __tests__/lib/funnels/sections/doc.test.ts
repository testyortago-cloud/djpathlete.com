// Stage 1.3 of the AI page builder: reassembling a whole SectionDoc
// (lib/funnels/sections/doc.ts).
//
// The most valuable test here is the full-page compiler round-trip: build a
// realistic multi-kind SectionDoc, run it through the real `reassemble()`,
// then feed the result to the REAL, frozen `compileFunnelStep` and assert
// `ok === true` AND `warnings` is EMPTY. `content_removed` is non-fatal, so
// asserting only `ok` would pass while the compiler quietly ate markup this
// stage produced — see render.test.ts's own header comment for why that
// distinction matters.
import { describe, it, expect } from "vitest"
import { compileFunnelStep } from "@/lib/funnels/compile"
import type { FunnelNode } from "@/lib/funnels/compile/types"
import { THEME_CSS, SECTION_CSS } from "@/lib/funnels/sections/styles"
import type { SectionDoc, Section } from "@/lib/funnels/sections/registry"
import {
  reassemble,
  checkSizeCaps,
  type SectionDocProblem,
} from "@/lib/funnels/sections/doc"
import { FUNNEL_STEP_HTML_MAX_LENGTH, FUNNEL_STEP_CSS_MAX_LENGTH } from "@/lib/validators/funnel"

const urlCta = { label: "Learn more", target: { kind: "url" as const, href: "/thanks" } }
const bookingCta = { label: "Book a call", target: { kind: "booking" as const } }

function findIslands(nodes: FunnelNode[]): Extract<FunnelNode, { t: "island" }>[] {
  const out: Extract<FunnelNode, { t: "island" }>[] = []
  for (const node of nodes) {
    if (node.t === "island") out.push(node)
    if (node.t === "el") out.push(...findIslands(node.children))
  }
  return out
}

function serialize(nodes: FunnelNode[]): string {
  return JSON.stringify(nodes)
}

function baseDoc(overrides: Partial<SectionDoc> = {}): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [],
    ...overrides,
  }
}

// A realistic full page: every one of the nine kinds, at least once.
function fullPageSections(): Section[] {
  return [
    {
      id: "hero1",
      kind: "hero",
      variant: "centered",
      style: { headline: "xl" },
      props: {
        eyebrow: "New",
        headline: "Train like an athlete",
        sub: "An 8-week rotational power program",
        primaryCta: urlCta,
        secondaryCta: bookingCta,
      },
    },
    {
      id: "pr1",
      kind: "proof",
      variant: "strip",
      style: {},
      props: {
        items: [
          { value: "12 years", label: "coaching" },
          { value: "500+", label: "athletes trained" },
        ],
      },
    },
    {
      id: "b1",
      kind: "bullets",
      variant: "cards",
      style: {},
      props: { heading: "Why athletes choose us", items: [{ title: "Fast results" }, { title: "Safe programming" }] },
    },
    {
      id: "s1",
      kind: "steps",
      variant: "numbered",
      style: {},
      props: { heading: "How it works", steps: [{ title: "Book a call" }, { title: "Start training" }] },
    },
    {
      id: "t1",
      kind: "testimonial",
      variant: "grid",
      style: {},
      props: { source: "quote", quotes: [{ quote: "Best program I've done.", name: "Alex" }] },
    },
    {
      id: "p1",
      kind: "pricing",
      variant: "cards",
      style: {},
      props: {
        heading: "Pick your plan",
        plans: [{ name: "Starter", price: "$99", features: ["Weekly check-ins"], cta: urlCta }],
      },
    },
    {
      id: "f1",
      kind: "faq",
      variant: "stack",
      style: {},
      props: { heading: "Questions", source: "inline", items: [{ q: "Refunds?", a: "Yes, within 14 days." }] },
    },
    {
      id: "form1",
      kind: "form",
      variant: "boxed",
      style: { tone: "muted" },
      props: {
        heading: "Get your free guide",
        formKey: "optin",
        fields: [{ name: "email", label: "Email", type: "email", required: true }],
      },
    },
    {
      id: "cta1",
      kind: "cta",
      variant: "band",
      style: {},
      props: { headline: "Spots are limited", cta: { label: "Reserve your spot", target: { kind: "step", stepSlug: "checkout" } } },
    },
    {
      id: "foot1",
      kind: "footer",
      variant: "simple",
      style: {},
      props: {
        businessName: "DJP Athlete",
        lines: ["Tampa, FL"],
        links: [{ label: "Privacy", target: { kind: "url", href: "/privacy" } }],
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// The test that matters most: a full, realistic doc through the real compiler.
// ---------------------------------------------------------------------------

describe("reassemble — full page through the real compiler", () => {
  it("compiles clean with zero warnings, every section present, theme wired", () => {
    const doc = baseDoc({
      theme: { tone: "dark", accent: "primary", radius: "round" },
      sections: fullPageSections(),
    })
    const { html, css, problems } = reassemble(doc, { funnelBasePath: "/go/summer-camp" })
    expect(problems).toEqual([])

    const result = compileFunnelStep({ html, css })
    expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])

    const json = serialize(result.nodes)
    for (const section of doc.sections) {
      expect(json, `missing section ${section.id}`).toContain(`"id":"${section.id}"`)
    }
    // "step" CTA resolved via the threaded funnelBasePath, not a placeholder.
    expect(json).toContain('"href":"/go/summer-camp/checkout"')
    // Theme attributes survived the compiler on the page wrapper.
    expect(json).toContain('"data-page-tone":"dark"')
    expect(json).toContain('"data-page-accent":"primary"')
    expect(json).toContain('"data-page-radius":"round"')
    expect(json).not.toContain("data-djp-tone")
    expect(json).not.toContain("data-djp-accent")
    expect(json).not.toContain("data-djp-radius")
    // Both islands referenced in the fixture actually landed.
    const islands = findIslands(result.nodes)
    expect(islands.some((i) => i.name === "booking")).toBe(true)
    expect(islands.some((i) => i.name === "form")).toBe(true)
    // Radius theme reached the compiled stylesheet.
    expect(result.css).toContain("--djp-radius: 1.75rem")
  })

  it("without a funnelBasePath, a step CTA degrades to a disabled placeholder rather than a dead link", () => {
    const doc = baseDoc({ sections: fullPageSections() })
    const { html, css } = reassemble(doc)
    const result = compileFunnelStep({ html, css })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const json = serialize(result.nodes)
    expect(json).toContain("djp-btn-disabled")
    expect(json).not.toContain('"href":"/checkout"')
  })

  it("a funnelBasePath missing its leading slash also degrades, not a bare-relative href (the invariant is enforced by render.ts's own guard, threaded through unchanged)", () => {
    const doc = baseDoc({ sections: fullPageSections() })
    const { html, css } = reassemble(doc, { funnelBasePath: "go/summer-camp" })
    const result = compileFunnelStep({ html, css })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    expect(serialize(result.nodes)).not.toContain('"href":"go/summer-camp/checkout"')
  })
})

// ---------------------------------------------------------------------------
// CSS is THEME_CSS + only the kinds actually used — not all nine.
// ---------------------------------------------------------------------------

describe("reassemble — per-kind CSS is selective", () => {
  it("a hero + cta page ships hero/cta CSS but not pricing/faq/bullets/steps/testimonial/form/footer CSS", () => {
    const doc = baseDoc({
      sections: [
        { id: "hero1", kind: "hero", variant: "centered", style: {}, props: { headline: "Go", primaryCta: urlCta } },
        { id: "cta1", kind: "cta", variant: "band", style: {}, props: { headline: "Ready?", cta: bookingCta } },
      ],
    })
    const { css } = reassemble(doc)

    // Present: THEME_CSS (always) and the two kinds actually used.
    expect(css).toContain(".djp-btn-primary") // THEME_CSS
    expect(css).toContain(".djp-s-hero .djp-hero-inner") // HERO_CSS marker
    expect(css).toContain(".djp-s-cta .djp-cta-inner") // CTA_CSS marker

    // Absent: every other kind's CSS, keyed off a marker unique to that
    // kind's stylesheet (not shared with THEME_CSS or another kind's CSS).
    expect(css).not.toContain(SECTION_CSS.pricing)
    expect(css).not.toContain(SECTION_CSS.faq)
    expect(css).not.toContain(SECTION_CSS.bullets)
    expect(css).not.toContain(SECTION_CSS.steps)
    expect(css).not.toContain(SECTION_CSS.testimonial)
    expect(css).not.toContain(SECTION_CSS.form)
    expect(css).not.toContain(SECTION_CSS.footer)
    expect(css).not.toContain(".djp-pricing-grid")
    expect(css).not.toContain(".djp-faq-list")
  })

  it("a doc using every kind ships every kind's CSS exactly once", () => {
    const doc = baseDoc({ sections: fullPageSections() })
    const { css } = reassemble(doc)
    expect(css).toContain(THEME_CSS)
    for (const kindCss of Object.values(SECTION_CSS)) {
      const occurrences = css.split(kindCss).length - 1
      expect(occurrences).toBe(1)
    }
  })
})

// ---------------------------------------------------------------------------
// Determinism: same doc in, byte-identical output out. Section/CSS ordering
// must not depend on Set or array iteration order derived from the doc.
// ---------------------------------------------------------------------------

describe("reassemble — deterministic output", () => {
  it("the same doc reassembled twice produces byte-identical html and css", () => {
    const doc = baseDoc({ sections: fullPageSections() })
    const a = reassemble(doc)
    const b = reassemble(doc)
    expect(a.html).toBe(b.html)
    expect(a.css).toBe(b.css)
  })

  it("reordering sections of the same kinds produces byte-identical CSS (canonical registry order, not doc order)", () => {
    const sections = fullPageSections()
    const forward = baseDoc({ sections })
    const reversed = baseDoc({ sections: [...sections].reverse() })
    const a = reassemble(forward)
    const b = reassemble(reversed)
    expect(a.css).toBe(b.css)
  })
})

// ---------------------------------------------------------------------------
// Theme wiring (SectionDoc.theme) — the field Stage 1.2 reported as dead.
// ---------------------------------------------------------------------------

describe("reassemble — theme wiring", () => {
  const oneHeroSection: Section[] = [
    { id: "hero1", kind: "hero", variant: "centered", style: {}, props: { headline: "Go", primaryCta: urlCta } },
  ]

  it("resolves radius to the documented --djp-radius override, one rule per enum value", () => {
    const sharp = reassemble(baseDoc({ theme: { tone: "light", accent: "accent", radius: "sharp" }, sections: oneHeroSection }))
    expect(sharp.css).toContain("--djp-radius: 0.125rem")

    const soft = reassemble(baseDoc({ theme: { tone: "light", accent: "accent", radius: "soft" }, sections: oneHeroSection }))
    expect(soft.css).toContain("--djp-radius: 0.6rem")

    const round = reassemble(baseDoc({ theme: { tone: "light", accent: "accent", radius: "round" }, sections: oneHeroSection }))
    expect(round.css).toContain("--djp-radius: 1.75rem")
  })

  it("emits data-page-tone / data-page-accent / data-page-radius on the page wrapper, never data-djp-*", () => {
    const doc = baseDoc({
      theme: { tone: "dark", accent: "primary", radius: "round" },
      sections: [{ id: "hero1", kind: "hero", variant: "centered", style: {}, props: { headline: "Go", primaryCta: urlCta } }],
    })
    const { html } = reassemble(doc)
    expect(html).toContain('data-page-tone="dark"')
    expect(html).toContain('data-page-accent="primary"')
    expect(html).toContain('data-page-radius="round"')
    expect(html).not.toContain("data-djp-tone")
    expect(html).not.toContain("data-djp-accent")
    expect(html).not.toContain("data-djp-radius")
  })

  it("dark tone and primary accent CSS rules are present and survive the real compiler", () => {
    const doc = baseDoc({
      theme: { tone: "dark", accent: "primary", radius: "soft" },
      sections: [{ id: "hero1", kind: "hero", variant: "centered", style: {}, props: { headline: "Go", primaryCta: urlCta } }],
    })
    const { html, css } = reassemble(doc)
    expect(css).toContain('.djp-page[data-page-tone="dark"]')
    expect(css).toContain('.djp-page[data-page-accent="primary"]')
    const result = compileFunnelStep({ html, css })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    expect(result.css).toContain('[data-page-tone="dark"]')
  })
})

// ---------------------------------------------------------------------------
// Size caps enforced at draft time, imported (never restated) from
// lib/validators/funnel.ts.
// ---------------------------------------------------------------------------

describe("checkSizeCaps — publish caps enforced at draft time", () => {
  it("a well-under-cap doc is reported as clean", () => {
    const doc = baseDoc({ sections: fullPageSections() })
    const { problems } = reassemble(doc)
    expect(problems).toEqual([])
  })

  it("exactly at the html cap is fine (matches z.string().max — inclusive)", () => {
    const problems = checkSizeCaps("a".repeat(FUNNEL_STEP_HTML_MAX_LENGTH), "")
    expect(problems).toEqual([])
  })

  it("one character over the html cap is reported, not silently truncated", () => {
    const oversizedHtml = "a".repeat(FUNNEL_STEP_HTML_MAX_LENGTH + 1)
    const problems = checkSizeCaps(oversizedHtml, "")
    expect(problems).toHaveLength(1)
    expect(problems[0].code).toBe("html_too_large")
    // Nothing about the check mutates or truncates the input.
    expect(oversizedHtml.length).toBe(FUNNEL_STEP_HTML_MAX_LENGTH + 1)
  })

  it("exactly at the css cap is fine", () => {
    const problems = checkSizeCaps("", "a".repeat(FUNNEL_STEP_CSS_MAX_LENGTH))
    expect(problems).toEqual([])
  })

  it("one character over the css cap is reported", () => {
    const problems = checkSizeCaps("", "a".repeat(FUNNEL_STEP_CSS_MAX_LENGTH + 1))
    expect(problems).toHaveLength(1)
    expect(problems[0].code).toBe("css_too_large")
  })

  it("both caps can be exceeded at once and both are reported", () => {
    const problems: SectionDocProblem[] = checkSizeCaps(
      "a".repeat(FUNNEL_STEP_HTML_MAX_LENGTH + 1),
      "a".repeat(FUNNEL_STEP_CSS_MAX_LENGTH + 1),
    )
    expect(problems.map((p) => p.code).sort()).toEqual(["css_too_large", "html_too_large"])
  })
})
