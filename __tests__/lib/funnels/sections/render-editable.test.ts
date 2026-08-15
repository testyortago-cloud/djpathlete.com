// Editable render mode — the path anchors click-to-edit is built on.
//
// The load-bearing property is the FIRST test: a render that was not asked to
// be editable must be byte-identical to what it was before this feature
// existed. Publish, /go and the published-version rows all run that path, and
// an anchor leaking into them would be editor scaffolding shipped to visitors.
//
// The second load-bearing property is that the anchors survive the compiler.
// `filterAttrs` strips every `data-djp-*` attribute from a non-island element
// BEFORE its plain `data-*` passthrough runs, and does it silently — no error,
// no warning. Choosing that prefix would have produced a feature that simply
// does nothing, with nothing anywhere saying why.

import { describe, it, expect } from "vitest"
import { renderSection } from "@/lib/funnels/sections/render"
import { reassemble } from "@/lib/funnels/sections/doc"
import { compileFunnelStep } from "@/lib/funnels/compile"
import { SECTION_KINDS, type Section, type SectionDoc } from "@/lib/funnels/sections/registry"

// ---------------------------------------------------------------------------
// Fixtures — one of every kind, each with its optional fields SET, so the
// "every text prop is anchored" sweep has something to find at every path.
// ---------------------------------------------------------------------------

const FIXTURES: Record<(typeof SECTION_KINDS)[number], Section> = {
  hero: {
    id: "h1",
    kind: "hero",
    variant: "centered",
    style: {},
    props: {
      eyebrow: "Seven days",
      headline: "Free trial week",
      sub: "Full access to the app.",
      primaryCta: { label: "Start my free week", target: { kind: "url", href: "/signup" } },
      secondaryCta: { label: "See the plans", target: { kind: "anchor", sectionId: "p1" } },
    },
  },
  proof: {
    id: "pr1",
    kind: "proof",
    variant: "stats",
    style: {},
    props: {
      heading: "Track record",
      items: [
        { value: "500+", label: "athletes trained" },
        { value: "12 years", label: "coaching" },
      ],
    },
  },
  bullets: {
    id: "b1",
    kind: "bullets",
    variant: "cards",
    style: {},
    props: {
      heading: "What you get",
      intro: "Everything in the app.",
      items: [
        { title: "Your program", body: "Built for you.", icon: "check" },
        { title: "Your numbers", body: "Tracked every session." },
      ],
    },
  },
  steps: {
    id: "st1",
    kind: "steps",
    variant: "numbered",
    style: {},
    props: {
      heading: "How it works",
      intro: "Three steps.",
      steps: [
        { title: "Tell me your sport", body: "One line is enough." },
        { title: "Get your program", body: "Inside 24 hours." },
      ],
    },
  },
  testimonial: {
    id: "t1",
    kind: "testimonial",
    variant: "stack",
    style: {},
    props: {
      source: "quote",
      quotes: [{ quote: "Best coaching I have had.", name: "Jordan", detail: "400m" }],
    },
  },
  pricing: {
    id: "p1",
    kind: "pricing",
    variant: "cards",
    style: {},
    props: {
      heading: "Plans",
      plans: [
        {
          name: "Monthly",
          price: "$99",
          cadence: "per month",
          blurb: "Cancel any time.",
          features: ["Your program", "Weekly check-in"],
          cta: { label: "Choose monthly", target: { kind: "url", href: "/buy" } },
        },
      ],
      footnote: "Prices in USD.",
    },
  },
  faq: {
    id: "f1",
    kind: "faq",
    variant: "stack",
    style: {},
    props: {
      heading: "Questions",
      source: "inline",
      items: [{ q: "Do I need a card?", a: "No." }],
    },
  },
  form: {
    id: "fm1",
    kind: "form",
    variant: "split",
    style: {},
    props: {
      heading: "Start your week",
      sub: "Tell me your sport.",
      proofPoints: ["No payment now", "Cancel any time"],
      formKey: "trial",
      fields: [{ name: "email", label: "Email", type: "email", required: true }],
      submitLabel: "Start my free week",
    },
  },
  cta: {
    id: "c1",
    kind: "cta",
    variant: "band",
    style: {},
    props: {
      headline: "Ready?",
      sub: "It takes a minute.",
      cta: { label: "Start", target: { kind: "url", href: "/signup" } },
    },
  },
  footer: {
    id: "ft1",
    kind: "footer",
    variant: "simple",
    style: {},
    props: {
      businessName: "DJP Athlete",
      lines: ["Tampa Bay, FL"],
      links: [{ label: "Privacy", target: { kind: "url", href: "/privacy" } }],
      legal: "All rights reserved.",
    },
  },
}

/** Every path the inspector and inline editing must be able to reach. */
const TEXT_PATHS: Record<(typeof SECTION_KINDS)[number], string[]> = {
  hero: ["eyebrow", "headline", "sub", "primaryCta.label", "secondaryCta.label"],
  proof: ["heading", "items.0.value", "items.0.label", "items.1.value", "items.1.label"],
  bullets: ["heading", "intro", "items.0.title", "items.0.body", "items.1.title"],
  steps: ["heading", "intro", "steps.0.title", "steps.0.body", "steps.1.title"],
  testimonial: ["quotes.0.quote", "quotes.0.name", "quotes.0.detail"],
  pricing: [
    "heading",
    "plans.0.name",
    "plans.0.price",
    "plans.0.cadence",
    "plans.0.blurb",
    "plans.0.features.0",
    "plans.0.features.1",
    "plans.0.cta.label",
    "footnote",
  ],
  faq: ["heading", "items.0.q", "items.0.a"],
  form: ["heading", "sub", "proofPoints.0", "proofPoints.1"],
  cta: ["headline", "sub", "cta.label"],
  footer: ["businessName", "lines.0", "links.0.label", "legal"],
}

function docWith(section: Section): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [section],
  }
}

describe("editable render mode", () => {
  it.each(SECTION_KINDS)("renders a %s byte-identically when editable is not set", (kind) => {
    // MUTANT KILLED: stamping anchors unconditionally. Every published page
    // and every version row runs this path.
    const section = FIXTURES[kind]
    expect(renderSection(section, {})).toBe(renderSection(section, { editable: false }))
    expect(renderSection(section, {})).not.toContain("data-edit")
    expect(renderSection(section, {})).not.toContain("data-sec")
    expect(renderSection(section, {})).not.toContain("data-item")
  })

  it.each(SECTION_KINDS)("marks the %s section wrapper with its id", (kind) => {
    expect(renderSection(FIXTURES[kind], { editable: true })).toContain(
      `data-sec="${FIXTURES[kind].id}"`,
    )
  })

  it.each(SECTION_KINDS)("anchors every text prop of a %s", (kind) => {
    const html = renderSection(FIXTURES[kind], { editable: true })
    for (const path of TEXT_PATHS[kind]) {
      expect(html, `missing anchor for ${kind}.${path}`).toContain(`data-edit="${path}"`)
    }
  })

  it("wraps each repeating item so the toolbar knows which one it is", () => {
    const html = renderSection(FIXTURES.bullets, { editable: true })
    expect(html).toContain('data-item="0"')
    expect(html).toContain('data-item="1"')
  })

  it("gives an unset optional field a placeholder to click", () => {
    // Without an anchor there is no pixel to click, so an empty optional field
    // is unreachable forever — the single most common "I can't edit this" bug.
    const hero: Section = {
      ...FIXTURES.hero,
      props: { ...FIXTURES.hero.props, sub: undefined, eyebrow: undefined },
    }
    const html = renderSection(hero, { editable: true })
    expect(html).toContain('data-edit="sub"')
    expect(html).toContain('data-edit="eyebrow"')
    expect(html).toContain("data-edit-empty")
  })

  it("emits no placeholder at all when not editing", () => {
    // MUTANT KILLED: shipping "Add a subheading" to a real visitor.
    const hero: Section = { ...FIXTURES.hero, props: { ...FIXTURES.hero.props, sub: undefined } }
    const html = renderSection(hero, {})
    expect(html).not.toContain("djp-sub")
    expect(html).not.toContain("data-edit-empty")
  })

  it("leaves an island CTA to the inspector rather than a broken anchor", () => {
    // convertIsland consumes the element before filterAttrs runs, so a
    // data-edit on an island div would not survive. Anchoring it anyway would
    // be a click target that silently does nothing.
    const section: Section = {
      ...FIXTURES.cta,
      props: {
        ...FIXTURES.cta.props,
        cta: { label: "Buy", target: { kind: "booking" } },
      },
    }
    const html = renderSection(section, { editable: true })
    expect(html).toContain("data-djp-island")
    expect(html).not.toContain('data-edit="cta.label"')
  })

  it("survives the compiler, which strips data-djp-* silently", () => {
    const { html, css } = reassemble(docWith(FIXTURES.hero), { editable: true })
    const compiled = compileFunnelStep({ html, css })
    expect(compiled.ok).toBe(true)
    const serialized = JSON.stringify(compiled.nodes)
    expect(serialized).toContain("data-edit")
    expect(serialized).toContain("data-sec")
  })

  it("reassembles without anchors by default, exactly as publish does", () => {
    const editable = reassemble(docWith(FIXTURES.hero), { editable: true })
    const published = reassemble(docWith(FIXTURES.hero), {})
    expect(published.html).not.toContain("data-edit")
    // The stylesheet is not a function of edit mode.
    expect(published.css).toBe(editable.css)
  })
})
