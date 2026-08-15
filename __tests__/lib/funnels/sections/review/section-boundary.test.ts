// __tests__/lib/funnels/sections/review/section-boundary.test.ts
//
// Two adjacent sections at the same tone had no boundary of any kind. Not a
// thin one, not a wrong-coloured one — there was no rule in styles.ts pairing
// one `.djp-s` with the next at all. They painted as one continuous band with
// both sections' `padding-block` stacked into a single void, which is what the
// owner reported as "a lot of look off spacing".
//
// THE SELECTORS ARE ASSERTED AGAINST MARKUP THE RENDERER ACTUALLY EMITS.
// A rule matching `[data-tone="default"]` is worthless if the renderer omits
// the attribute when the author set no tone — the CSS would be present, the
// test would be green, and the page would look exactly as broken as before.
// (It does not omit it: render.ts resolves defaults and always emits all four
// knobs. This file is what keeps that true, and it is the shape of test that
// `island_class_stylesheet_agreement` exists to demand.)

import { describe, expect, it } from "vitest"
import { THEME_CSS } from "@/lib/funnels/sections/styles"
import { renderSection } from "@/lib/funnels/sections/render"
import { FUNNEL_ROOT_ID } from "@/lib/funnels/compile"
import type { Section, SectionDoc } from "@/lib/funnels/sections/registry"

const TONES = ["default", "muted", "accent", "dark"] as const

function ctaSection(id: string, tone?: (typeof TONES)[number]): Section {
  return {
    id,
    kind: "cta",
    variant: "band",
    // `tone: "default"` is a legal explicit value; omitting it entirely is the
    // case that matters, because that is what the AI actually produces.
    style: tone === undefined || tone === "default" ? {} : { tone },
    props: { headline: "A headline", cta: { label: "Go", target: { kind: "booking" } } },
  } as Section
}

/** The boundary selectors as they appear in the real stylesheet. */
function boundarySelectors(): string[] {
  return [...THEME_CSS.matchAll(/^(#\S+ \.djp-s\[data-tone="\w+"\] \+ \.djp-s\[data-tone="\w+"\])/gm)].map(
    (match) => match[1],
  )
}

describe("the same-tone section boundary", () => {
  it.each(TONES)("has an adjacent-sibling rule for the %s tone", (tone) => {
    expect(THEME_CSS).toMatch(
      new RegExp(`\\.djp-s\\[data-tone="${tone}"\\]\\s*\\+\\s*\\.djp-s\\[data-tone="${tone}"\\]`),
    )
  })

  it("has exactly one rule per tone — no tone silently left without a seam", () => {
    expect(boundarySelectors()).toHaveLength(TONES.length)
  })

  it("gives every boundary rule a visible border, not just a selector", () => {
    for (const selector of boundarySelectors()) {
      const start = THEME_CSS.indexOf(selector)
      const block = THEME_CSS.slice(start, THEME_CSS.indexOf("}", start))
      expect(block).toMatch(/border-top:\s*1px solid/)
    }
  })

  it("never uses currentColor — the tone-contrast harness cannot see it", () => {
    // render.test.ts's contrast suite resolves colours BY TOKEN. A
    // currentColor divider is unmodelled by it: green suite, invisible rule.
    for (const selector of boundarySelectors()) {
      const start = THEME_CSS.indexOf(selector)
      const block = THEME_CSS.slice(start, THEME_CSS.indexOf("}", start))
      expect(block).not.toContain("currentColor")
      expect(block).toMatch(/var\(--(foreground|accent-foreground|primary-foreground)\)/)
    }
  })

  it("keeps the root scope prefix every rule in this file needs", () => {
    for (const selector of boundarySelectors()) {
      expect(selector.startsWith(`#${FUNNEL_ROOT_ID} `)).toBe(true)
    }
  })
})

describe("the selectors match what the renderer emits", () => {
  it("emits data-tone on a section whose author set NO tone", () => {
    // The whole boundary design rests on this. If the renderer ever stops
    // resolving defaults, the four rules above become dead CSS and the bug
    // comes back silently.
    expect(renderSection(ctaSection("a"))).toContain('data-tone="default"')
  })

  it.each(TONES)("selects the second of two adjacent %s sections in a real DOM", (tone) => {
    const container = document.createElement("div")
    container.id = FUNNEL_ROOT_ID
    container.innerHTML = renderSection(ctaSection("a", tone)) + renderSection(ctaSection("b", tone))
    document.body.append(container)

    const selector = boundarySelectors().find((entry) => entry.includes(`"${tone}"`))
    expect(selector).toBeDefined()

    // Matched against the REAL rendered markup, through the real selector,
    // including the `#djp-funnel-root` scope.
    const matched = document.querySelectorAll(selector as string)
    expect(matched).toHaveLength(1)
    expect((matched[0] as HTMLElement).id).toBe("b")

    container.remove()
  })

  it("does NOT select two sections of DIFFERENT tones", () => {
    const container = document.createElement("div")
    container.id = FUNNEL_ROOT_ID
    container.innerHTML = renderSection(ctaSection("a", "dark")) + renderSection(ctaSection("b", "accent"))
    document.body.append(container)

    for (const selector of boundarySelectors()) {
      expect(document.querySelectorAll(selector)).toHaveLength(0)
    }

    container.remove()
  })
})

describe("the auditor and the stylesheet agree about what a seam is", () => {
  it("flags exactly the pair the CSS would draw a line between", async () => {
    const { auditDoc } = await import("@/lib/funnels/sections/review/audit")
    const doc: SectionDoc = {
      v: 1,
      engine: "sections",
      theme: { tone: "light", accent: "accent", radius: "soft" },
      sections: [ctaSection("a", "dark"), ctaSection("b", "dark"), ctaSection("c", "accent")],
    }

    const seams = auditDoc(doc).filter((f) => f.code === "tone-run")
    expect(seams.map((f) => f.sectionIds)).toEqual([["a", "b"]])

    // And the CSS agrees: exactly one boundary is drawn, on "b".
    const container = document.createElement("div")
    container.id = FUNNEL_ROOT_ID
    container.innerHTML = doc.sections.map((section) => renderSection(section)).join("")
    document.body.append(container)

    const drawn = boundarySelectors().flatMap((selector) => [...document.querySelectorAll(selector)])
    expect(drawn.map((element) => (element as HTMLElement).id)).toEqual(["b"])

    container.remove()
  })
})
