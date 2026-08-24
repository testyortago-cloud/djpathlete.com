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
import { CANVAS_EDIT_CSS } from "@/lib/funnels/sections/edit-css"
import { SECTION_CSS, THEME_CSS } from "@/lib/funnels/sections/styles"

/** Everything a VISITOR's page is styled by. The canvas sheet is not in it. */
const PUBLISHED_CSS = [THEME_CSS, ...Object.values(SECTION_CSS)].join("\n")

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
  quiz: {
    id: "qz1",
    kind: "quiz",
    variant: "boxed",
    style: {},
    props: {
      heading: "Find what is limiting you",
      sub: "Three minutes, and you get a readout.",
      quizId: "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9",
      submitLabel: "See my result",
    },
  },
}

/** Every path the inspector and inline editing must be able to reach. */
const TEXT_PATHS: Record<(typeof SECTION_KINDS)[number], string[]> = {
  // The quiz section owns only its heading copy. The questions live in the
  // database behind `quizId`, so there is no authored text to anchor there.
  quiz: ["heading", "sub"],
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

  // -------------------------------------------------------------------------
  // Island CTA labels.
  //
  // This block REPLACES a test that asserted the opposite ("leaves an island
  // CTA to the inspector rather than a broken anchor"). The reasoning it
  // recorded — `convertIsland` consumes the element before `filterAttrs` runs,
  // so a `data-edit` on an island div does not survive — is still true and is
  // still what makes the WRAPPER necessary. What changed is the conclusion:
  // "buy now" is the string a funnel page exists for, and no anchor at all is
  // its own kind of broken.
  // -------------------------------------------------------------------------

  const ISLAND_TARGETS = [
    { name: "booking", target: { kind: "booking" } },
    { name: "event", target: { kind: "event", ref: "11111111-2222-4333-8444-555555555555" } },
    { name: "program", target: { kind: "program", ref: "11111111-2222-4333-8444-555555555555" } },
    { name: "session_pack", target: { kind: "session_pack", ref: "Ten Session Pack" } },
  ] as const

  function ctaWith(target: unknown): Section {
    return { ...FIXTURES.cta, props: { ...FIXTURES.cta.props, cta: { label: "Buy", target } } }
  }

  it.each(ISLAND_TARGETS)("anchors a $name CTA's label through a wrapper", ({ target }) => {
    const html = renderSection(ctaWith(target), { editable: true })
    expect(html).toContain("data-djp-island")
    expect(html).toContain('data-edit="cta.label"')
    // The anchor must be OUTSIDE the island element, or the compiler eats it.
    expect(html).toMatch(/<span class="djp-edit-slot" data-edit="cta\.label"><(div|span)/)
  })

  it.each(ISLAND_TARGETS)("ships no wrapper around a $name CTA when not editing", ({ target }) => {
    // MUTANT KILLED: an unconditional wrapper. It would be new markup on every
    // published page, and `styles.ts` is written against the markup this file
    // currently emits.
    const html = renderSection(ctaWith(target), {})
    expect(html).toContain("data-djp-island")
    expect(html).not.toContain("djp-edit-slot")
    expect(html).not.toContain("data-edit")
  })

  it("anchors an island CTA that degraded to a disabled placeholder", () => {
    // An unresolvable ref renders as `disabledCta`, and that is EXACTLY when
    // the owner most needs to reach the label — the same rule the image slot
    // follows for an unrenderable src. A `program` ref that is not a valid uuid
    // cannot reach the island, so this is the degraded branch.
    const html = renderSection(ctaWith({ kind: "program", ref: "Comeback Code" }), { editable: true })
    expect(html).toContain("djp-btn-disabled")
    expect(html).toContain('data-edit="cta.label"')
  })

  it("survives the compiler on an island CTA, which is the whole reason for the wrapper", () => {
    // The load-bearing claim, checked against the REAL compiler rather than
    // asserted: `filterAttrs` strips `data-djp-*` silently and `convertIsland`
    // consumes the island element whole, so the only proof that this anchor is
    // clickable is that it is still there after compiling.
    const { html, css } = reassemble(docWith(ctaWith({ kind: "booking" })), { editable: true })
    const compiled = compileFunnelStep({ html, css })
    if (!compiled.ok) throw new Error(compiled.errors.map((e) => e.message).join("; "))
    expect(JSON.stringify(compiled.nodes)).toContain('"data-edit":"cta.label"')
  })

  it("styles the canvas notes so they survive a dark section", () => {
    // MUTANT KILLED: a note that sets only `color`. Section tone is one of
    // four, `dark` among them, and the FIRST version of this shipped grey text
    // onto the near-black testimonials band — caught in a screenshot, not by a
    // test, because markup assertions cannot see contrast. Declaring BOTH a
    // background and a colour is the property that makes it tone-independent,
    // and that much a test can hold.
    const note = CANVAS_EDIT_CSS.slice(CANVAS_EDIT_CSS.indexOf(".djp-edit-note {"))
    const block = note.slice(0, note.indexOf("}"))
    expect(block).toContain("background:")
    expect(block).toContain("color:")

    const chip = CANVAS_EDIT_CSS.slice(CANVAS_EDIT_CSS.indexOf(".djp-edit-chip {"))
    const chipBlock = chip.slice(0, chip.indexOf("}"))
    expect(chipBlock).toContain("background:")
    expect(chipBlock).toContain("color:")
  })

  it("keeps every canvas-only class OUT of the published stylesheet", () => {
    // The pair to the class/stylesheet harness in leadgen.test.ts, from the
    // other side: these classes must live in CANVAS_EDIT_CSS *only*, because
    // that sheet is injected by the editable preview route and by nothing else.
    for (const cls of [".djp-edit-slot", ".djp-edit-note", ".djp-edit-chip", ".djp-edit-options"]) {
      expect(CANVAS_EDIT_CSS, `${cls} must be defined in the canvas stylesheet`).toContain(cls)
      expect(PUBLISHED_CSS, `${cls} must NOT be in the published stylesheet`).not.toContain(cls)
    }
  })

  it.each(["testimonial", "faq"] as const)("says why a live %s feed cannot be typed into", (kind) => {
    // Not decoration. Every other block on the canvas answers a click; these
    // two deliberately do not, and "deliberately read-only" and "broken" look
    // identical to whoever is clicking at it.
    const section: Section =
      kind === "testimonial"
        ? { ...FIXTURES.testimonial, props: { source: "live", limit: 3, featuredOnly: false } }
        : { ...FIXTURES.faq, props: { heading: "Questions", source: "live", pageKey: "camps" } }

    const editing = renderSection(section, { editable: true })
    expect(editing).toContain("djp-edit-note")
    expect(editing).toMatch(/cannot be retyped here/)

    // MUTANT KILLED: editor chrome shipped to a visitor.
    expect(renderSection(section, {})).not.toContain("djp-edit-note")
  })

  it("marks a hero's media as an image slot", () => {
    const hero: Section = {
      ...FIXTURES.hero,
      props: {
        ...FIXTURES.hero.props,
        media: { kind: "image", src: "https://cdn.example.com/a.jpg", alt: "Athlete", w: 1200, h: 800 },
      },
    }
    expect(renderSection(hero, { editable: true })).toContain('data-edit-image="media"')
    // MUTANT KILLED: shipping the editor's slot marker to visitors.
    expect(renderSection(hero, {})).not.toContain("data-edit-image")
  })

  it("gives a hero with NO media a slot to click, so one can be added", () => {
    // The image twin of the placeholder rule. `renderMedia` is only called when
    // `props.media` exists, so without this an image-less hero has no pixel
    // that opens the picker and can never gain an image from the canvas.
    const html = renderSection(FIXTURES.hero, { editable: true })
    expect(FIXTURES.hero.props.media).toBeUndefined()
    expect(html).toContain('data-edit-image="media"')
    expect(html).toContain("data-edit-empty")
  })

  it("emits no empty media slot when not editing", () => {
    // MUTANT KILLED: an empty grey box on every published hero without a photo.
    expect(renderSection(FIXTURES.hero, {})).not.toContain("djp-hero-media")
  })

  it("marks a youtube hero's slot too", () => {
    const hero: Section = {
      ...FIXTURES.hero,
      props: { ...FIXTURES.hero.props, media: { kind: "youtube", src: "dQw4w9WgXcQ", alt: "Intro", w: 16, h: 9 } },
    }
    expect(renderSection(hero, { editable: true })).toContain('data-edit-image="media"')
  })

  it("marks the slot even when the media is unrenderable", () => {
    // A `src` that fails `safeUrl` degrades to a visible placeholder. That
    // placeholder is EXACTLY when the owner most needs to click it and pick a
    // real image, so it must carry the slot marker like any other.
    const hero: Section = {
      ...FIXTURES.hero,
      props: { ...FIXTURES.hero.props, media: { kind: "image", src: "not-a-url", alt: "Broken", w: 10, h: 10 } },
    }
    const html = renderSection(hero, { editable: true })
    expect(html).toContain("djp-media-invalid")
    expect(html).toContain('data-edit-image="media"')
  })

  it("survives the compiler, which strips data-djp-* silently", () => {
    const { html, css } = reassemble(docWith(FIXTURES.hero), { editable: true })
    const compiled = compileFunnelStep({ html, css })
    if (!compiled.ok) throw new Error(compiled.errors.map((e) => e.message).join("; "))
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
