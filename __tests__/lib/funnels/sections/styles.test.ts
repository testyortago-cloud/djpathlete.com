// __tests__/lib/funnels/sections/styles.test.ts
//
// Task 3 widened every section kind's variant list, and the registry now
// advertises those new names — soon to the AI model as well — before Task 7
// wrote any CSS behind most of them. A variant with no CSS renders as an
// unstyled section on a live page: the compiler sees valid HTML and valid
// CSS, `ok: true, warnings: []`, and the visitor sees browser defaults.
//
// THE OBVIOUS VERSION OF THIS TEST IS WRONG. "Every variant has a
// `djp-v-<name>` selector" is false against code that shipped long before
// this build: nine variants across nine different kinds ARE the base look
// for their kind, styled by the kind's unqualified rule, with no `djp-v-`
// selector at all. `VARIANTS_STYLED_BY_BASE_RULE` (styles.ts) is the
// reviewed allowlist of exactly those nine — a record of pre-existing base
// cases, not an escape hatch for a future variant that just hasn't been
// styled yet.

import { describe, it, expect } from "vitest"
import { SECTION_REGISTRY, SECTION_KINDS } from "@/lib/funnels/sections/registry"
import { SECTION_CSS, VARIANTS_STYLED_BY_BASE_RULE } from "@/lib/funnels/sections/styles"
import { renderSection } from "@/lib/funnels/sections/render"
import { FUNNEL_STEP_CSS_MAX_LENGTH } from "@/lib/validators/funnel"
import { THEME_CSS } from "@/lib/funnels/sections/styles"
import type { Section } from "@/lib/funnels/sections/registry"

describe("every variant the registry advertises has CSS behind it", () => {
  const exempt = new Set(VARIANTS_STYLED_BY_BASE_RULE)

  for (const kind of SECTION_KINDS) {
    for (const variant of SECTION_REGISTRY[kind].variants) {
      const key = `${kind}.${variant}`
      if (exempt.has(key)) continue
      it(`has a CSS rule for ${key}`, () => {
        expect(SECTION_CSS[kind], key).toContain(`djp-v-${variant}`)
      })
    }
  }

  // The allowlist itself is a claim about the CURRENT stylesheet — if one of
  // these nine ever gained a real `djp-v-` rule (a legitimate future
  // improvement), leaving it in the allowlist would just be stale, not
  // wrong. But every entry must still name a real (kind, variant) pair the
  // registry actually declares, or the allowlist is silently exempting
  // nothing at all.
  it("VARIANTS_STYLED_BY_BASE_RULE names only real, registry-declared variants", () => {
    for (const entry of VARIANTS_STYLED_BY_BASE_RULE) {
      const [kind, variant] = entry.split(".") as [keyof typeof SECTION_REGISTRY, string]
      expect(SECTION_REGISTRY[kind], entry).toBeDefined()
      expect(SECTION_REGISTRY[kind].variants, entry).toContain(variant)
    }
  })
})

// ---------------------------------------------------------------------------
// Item media (design-system spec §5.2) — "media beyond the hero". Until Task
// 7, `heroMediaSchema` was the document's only image field. `safeUrl`
// (compile/sanitize.ts) is the actual security boundary here, exactly as it
// already is for the hero's own media and for Task 6's section background: a
// hostile scheme must never reach the page, and a rejected URL renders no
// image at all rather than a broken one.
// ---------------------------------------------------------------------------

const urlCta = { label: "Learn more", target: { kind: "url" as const, href: "/thanks" } }

describe("item media beyond the hero", () => {
  it("renders a safe bullet item image with loading=lazy, and drops a hostile one", () => {
    const safeSection: Section = {
      id: "b1",
      kind: "bullets",
      variant: "cards",
      style: {},
      props: {
        items: [
          { title: "Fast results", media: { src: "/uploads/a.png", alt: "Progress chart" } },
          { title: "Safe programming" },
        ],
      },
    }
    const html = renderSection(safeSection)
    expect(html).toContain('src="/uploads/a.png"')
    expect(html).toContain('alt="Progress chart"')
    expect(html).toContain('loading="lazy"')
    expect(html).toContain("djp-bullet-media")

    const hostileSection: Section = {
      ...safeSection,
      props: {
        items: [{ title: "Fast results", media: { src: "javascript:alert(1)" } }, { title: "Safe programming" }],
      },
    }
    const hostileHtml = renderSection(hostileSection)
    expect(hostileHtml).not.toContain("javascript:")
    expect(hostileHtml).not.toContain("<img")
  })

  it("renders a safe step item image, and drops a hostile one", () => {
    const section: Section = {
      id: "s1",
      kind: "steps",
      variant: "cards",
      style: {},
      props: {
        steps: [{ title: "Book a call", media: { src: "/uploads/step1.jpg" } }, { title: "Get your plan" }],
      },
    }
    expect(renderSection(section)).toContain('src="/uploads/step1.jpg"')

    const hostile: Section = {
      ...section,
      props: {
        steps: [{ title: "Book a call", media: { src: "//evil.example/x.jpg" } }, { title: "Get your plan" }],
      },
    }
    expect(renderSection(hostile)).not.toContain("<img")
  })

  it("renders a safe testimonial quote image, and drops a hostile one", () => {
    const section: Section = {
      id: "t1",
      kind: "testimonial",
      variant: "grid",
      style: {},
      props: {
        source: "quote",
        quotes: [{ quote: "Best program I have done.", name: "Alex", media: { src: "/uploads/alex.jpg" } }],
      },
    }
    expect(renderSection(section)).toContain('src="/uploads/alex.jpg"')

    const hostile: Section = {
      ...section,
      props: {
        source: "quote",
        quotes: [{ quote: "Best program.", name: "Alex", media: { src: "data:image/svg+xml,evil" } }],
      },
    }
    expect(renderSection(hostile)).not.toContain("<img")
  })

  it("renders a safe pricing plan image, and drops a hostile one", () => {
    const section: Section = {
      id: "p1",
      kind: "pricing",
      variant: "cards",
      style: {},
      props: {
        plans: [
          {
            name: "Starter",
            price: "$99",
            features: ["Weekly check-ins"],
            cta: urlCta,
            media: { src: "/uploads/plan.jpg" },
          },
        ],
      },
    }
    expect(renderSection(section)).toContain('src="/uploads/plan.jpg"')

    const hostile: Section = {
      ...section,
      props: {
        plans: [
          {
            name: "Starter",
            price: "$99",
            features: ["Weekly check-ins"],
            cta: urlCta,
            media: { src: "javascript:alert(1)" },
          },
        ],
      },
    }
    expect(renderSection(hostile)).not.toContain("<img")
  })

  it("renders a safe cta image, and drops a hostile one", () => {
    const section: Section = {
      id: "c1",
      kind: "cta",
      variant: "band",
      style: {},
      props: { headline: "Spots are limited", cta: urlCta, media: { src: "/uploads/camp.jpg" } },
    }
    expect(renderSection(section)).toContain('src="/uploads/camp.jpg"')

    const hostile: Section = {
      ...section,
      props: { headline: "Spots are limited", cta: urlCta, media: { src: "javascript:alert(1)" } },
    }
    expect(renderSection(hostile)).not.toContain("<img")
  })

  it("renders nothing at all — no placeholder — when an item has no media", () => {
    const section: Section = {
      id: "c1",
      kind: "cta",
      variant: "band",
      style: {},
      props: { headline: "Spots are limited", cta: urlCta },
    }
    expect(renderSection(section)).not.toContain("djp-cta-media")
  })
})

// ---------------------------------------------------------------------------
// CSS size — FUNNEL_STEP_CSS_MAX_LENGTH is the same publish-time cap
// `checkSizeCaps` (doc.ts) enforces, imported rather than restated. Measured
// against the worst-case document: every kind's CSS shipped at once (a real
// page never ships more than that, since `reassemble` sends only the CSS of
// the kinds a document actually uses, deduplicated per kind regardless of
// how many sections of that kind it has).
// ---------------------------------------------------------------------------

describe("CSS size stays under the publish cap", () => {
  it("THEME_CSS + every kind's CSS, concatenated, is comfortably under FUNNEL_STEP_CSS_MAX_LENGTH", () => {
    const worstCase = [THEME_CSS, ...Object.values(SECTION_CSS)].join("\n")
    expect(worstCase.length).toBeLessThan(FUNNEL_STEP_CSS_MAX_LENGTH)
  })
})
