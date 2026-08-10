// Stage 1.2 of the AI page builder: the section renderer
// (lib/funnels/sections/render.ts) and stylesheet (lib/funnels/sections/styles.ts).
//
// The most valuable test in this file is the compiler round-trip: for every
// one of the nine kinds, render a realistic section and run the output
// through the REAL, frozen `compileFunnelStep` — not a hand-rolled
// allowlist check. `ok === true` AND `warnings` empty AND the expected
// element survives is the only thing that proves constraints 1-3 from the
// plan (only ALLOWED_TAGS, flat CSS, `data-h` not `data-djp-h`) are honoured
// by construction rather than merely intended. A non-empty `warnings` array
// means the compiler silently removed something this renderer emitted
// (compile/sanitize.ts's `content_removed` / `iframe_host_not_allowed`
// codes exist for exactly this).
import { describe, it, expect } from "vitest"
import { compileFunnelStep } from "@/lib/funnels/compile"
import type { FunnelNode } from "@/lib/funnels/compile/types"
import { parseIslandProps } from "@/lib/funnels/islands"
import { escapeHtml, renderSection, type RenderContext } from "@/lib/funnels/sections/render"
import { THEME_CSS, SECTION_CSS } from "@/lib/funnels/sections/styles"
import {
  SECTION_KINDS,
  SECTION_ICONS,
  SECTION_REGISTRY,
  type Section,
  type SectionKind,
} from "@/lib/funnels/sections/registry"

const VALID_UUID = "11111111-1111-4111-8111-111111111111"
const OTHER_UUID = "22222222-2222-4222-8222-222222222222"

const urlCta = { label: "Learn more", target: { kind: "url" as const, href: "/thanks" } }
const bookingCta = { label: "Book a call", target: { kind: "booking" as const } }

function fullCss(kind: SectionKind): string {
  return `${THEME_CSS}\n${SECTION_CSS[kind]}`
}

/** Compiles one section in isolation with its own kind's CSS and asserts the
 * standard "renderer built this correctly" shape: ok, no warnings. */
function compileSection(section: Section, ctx?: RenderContext) {
  const html = renderSection(section, ctx)
  const result = compileFunnelStep({ html, css: fullCss(section.kind) })
  return { html, result }
}

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

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

describe("escapeHtml", () => {
  it("escapes all five characters, & first so its own entities are not re-escaped", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;")
  })

  it("leaves ordinary text untouched", () => {
    expect(escapeHtml("Get stronger, faster")).toBe("Get stronger, faster")
  })

  it("neutralises an injected script tag as inert text, not a live tag", () => {
    const escaped = escapeHtml(`<script>alert(1)</script>`)
    expect(escaped).not.toContain("<script>")
    expect(escaped).toContain("&lt;script&gt;")
  })

  it("neutralises an attribute breakout attempt", () => {
    const escaped = escapeHtml(`"><img src=x onerror=alert(1)>`)
    expect(escaped).not.toContain('">')
    expect(escaped).not.toContain("<img")
  })
})

// ---------------------------------------------------------------------------
// The whole stylesheet is syntactically valid, flat CSS
// ---------------------------------------------------------------------------

describe("THEME_CSS + SECTION_CSS", () => {
  it("every kind's stylesheet parses cleanly through the real compiler (no css_parse_failed)", () => {
    for (const kind of SECTION_KINDS) {
      const result = compileFunnelStep({ html: "<p>x</p>", css: fullCss(kind) })
      expect(result.ok, `kind=${kind} css failed to parse`).toBe(true)
    }
  })

  it("scopes every selector under #djp-funnel-root — no unscoped global rule", () => {
    const result = compileFunnelStep({ html: "<p>x</p>", css: THEME_CSS + SECTION_CSS.hero })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.css).toContain("#djp-funnel-root .djp-hd")
    expect(result.css).toContain("#djp-funnel-root .djp-s-hero")
  })

  // Derived from SECTION_ICONS (the real, closed enum in registry.ts), not a
  // restated literal list — a 7th icon added to the enum with no artwork in
  // styles.ts's ICON_DATA fails THIS test immediately instead of shipping an
  // empty box (IMPORTANT 7/8, Stage 1.2 fix round 1).
  it.each(SECTION_ICONS)("defines mask-image artwork for icon '%s'", (icon) => {
    expect(THEME_CSS).toContain(`.djp-ic-${icon}`)
    expect(THEME_CSS).toContain(`.djp-ic-${icon} { -webkit-mask-image: url("data:image/svg+xml,`)
  })

  it("uses the documented font fallback chain, never assuming @theme inline vars resolve", () => {
    expect(THEME_CSS).toContain(
      'font-family: var(--font-heading, var(--font-lexend-exa), "Lexend Exa", system-ui, sans-serif);',
    )
  })
})

// ---------------------------------------------------------------------------
// Style knobs survive as data-h / data-align / data-tone / data-pad — the
// single most important proof of constraint 3. If this ever silently
// regresses to data-djp-*, this test catches it because the compiler would
// strip the attribute and it would be absent from the node tree.
// ---------------------------------------------------------------------------

describe("style knobs (constraint 3: data-h, never data-djp-h)", () => {
  it("all four resolved style attributes survive the real compiler", () => {
    const section: Section = {
      id: "h1",
      kind: "hero",
      variant: "centered",
      style: { headline: "xl", align: "center", tone: "dark", pad: "roomy" },
      props: { headline: "Get stronger", primaryCta: urlCta },
    }
    const { result } = compileSection(section)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const json = serialize(result.nodes)
    expect(json).toContain('"data-h":"xl"')
    expect(json).toContain('"data-align":"center"')
    expect(json).toContain('"data-tone":"dark"')
    expect(json).toContain('"data-pad":"roomy"')
    // The reserved prefix must never appear at all.
    expect(json).not.toContain("data-djp-h")
    expect(json).not.toContain("data-djp-tone")
  })

  it("emits resolved defaults when style is empty, never an absent attribute", () => {
    const section: Section = {
      id: "h1",
      kind: "hero",
      variant: "centered",
      style: {},
      props: { headline: "Get stronger", primaryCta: urlCta },
    }
    const { result } = compileSection(section)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const json = serialize(result.nodes)
    expect(json).toContain('"data-h":"md"')
    expect(json).toContain('"data-align":"left"')
    expect(json).toContain('"data-tone":"default"')
    expect(json).toContain('"data-pad":"normal"')
  })
})

// ---------------------------------------------------------------------------
// One realistic section per kind, through the real compiler.
// ---------------------------------------------------------------------------

describe("every kind compiles clean through the real compiler", () => {
  it("hero: headline, sub, image media, primary + secondary CTA", () => {
    const section: Section = {
      id: "hero1",
      kind: "hero",
      variant: "split",
      style: {},
      props: {
        eyebrow: "New",
        headline: "Get stronger, faster",
        sub: "An 8-week rotational power program",
        media: { kind: "image", src: "/hero.jpg", alt: "Athlete training", w: 1200, h: 800 },
        primaryCta: urlCta,
        secondaryCta: bookingCta,
      },
    }
    const { result } = compileSection(section)
    expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const json = serialize(result.nodes)
    expect(json).toContain("Get stronger, faster")
    expect(json).toContain('"tag":"img"')
    expect(json).toContain("/hero.jpg")
    // secondaryCta targets "booking" -> an island, not a link.
    const islands = findIslands(result.nodes)
    expect(islands.some((i) => i.name === "booking")).toBe(true)
  })

  it("hero: youtube media embeds via the allowlisted privacy-enhanced host", () => {
    const section: Section = {
      id: "hero2",
      kind: "hero",
      variant: "centered",
      style: {},
      props: {
        headline: "Watch the program",
        media: { kind: "youtube", src: "dQw4w9WgXcQ", alt: "Program overview", w: 1280, h: 720 },
        primaryCta: urlCta,
      },
    }
    const { result } = compileSection(section)
    expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const json = serialize(result.nodes)
    expect(json).toContain("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")
  })

  it("bullets: 2..6 items, icons, cards variant", () => {
    const section: Section = {
      id: "b1",
      kind: "bullets",
      variant: "cards",
      style: {},
      props: {
        heading: "Why athletes choose us",
        items: [
          { title: "Fast results", body: "See progress in weeks", icon: "bolt" },
          { title: "Safe programming", icon: "shield" },
          { title: "5-star coaching", icon: "star" },
        ],
      },
    }
    const { result } = compileSection(section)
    expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const json = serialize(result.nodes)
    expect(json).toContain("Fast results")
    expect(json).toContain("djp-ic-bolt")
    expect(json).toContain("djp-ic-shield")
  })

  // Only bolt/shield/star (via the fixture above) and "check" (hardcoded in
  // renderPricingSection) were ever exercised through the real compiler
  // before this fix — a class-name mismatch between render.ts's renderIcon
  // and styles.ts's selector naming for clock/arrow could have gone
  // unnoticed indefinitely. Driven from SECTION_ICONS so it stays exhaustive
  // as the enum grows (IMPORTANT 7/8, Stage 1.2 fix round 1).
  it("bullets: every closed-enum icon renders and survives the real compiler", () => {
    const section: Section = {
      id: "bicons",
      kind: "bullets",
      variant: "list",
      style: {},
      props: {
        items: SECTION_ICONS.map((icon, i) => ({ title: `Item ${i}`, icon })),
      },
    }
    const { result } = compileSection(section)
    expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const json = serialize(result.nodes)
    for (const icon of SECTION_ICONS) {
      expect(json, `missing djp-ic-${icon}`).toContain(`djp-ic-${icon}`)
    }
  })

  it("steps: numbered how-it-works, no <details>/<summary> anywhere", () => {
    const section: Section = {
      id: "s1",
      kind: "steps",
      variant: "numbered",
      style: {},
      props: {
        heading: "How it works",
        steps: [
          { title: "Book a call", body: "15-minute fit check" },
          { title: "Get your plan" },
          { title: "Start training", body: "Weekly check-ins" },
        ],
      },
    }
    const { result } = compileSection(section)
    expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const json = serialize(result.nodes)
    expect(json).toContain('"tag":"ol"')
    expect(json).not.toContain('"tag":"details"')
    expect(json).not.toContain('"tag":"summary"')
  })

  it("testimonial (source: quote): authored quotes as <blockquote>", () => {
    const section: Section = {
      id: "t1",
      kind: "testimonial",
      variant: "grid",
      style: {},
      props: {
        source: "quote",
        quotes: [
          { quote: "Best program I've done.", name: "Alex", detail: "Age 16, sprinter" },
          { quote: "Injury-free all season.", name: "Jordan" },
        ],
      },
    }
    const { result } = compileSection(section)
    expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const json = serialize(result.nodes)
    expect(json).toContain('"tag":"blockquote"')
    // Escaped to &#39; in the emitted HTML, but parse5 decodes text-node
    // entities back to the literal character — the final tree has the real
    // apostrophe, not the entity.
    expect(json).toContain("Best program I've done.")
  })

  it("testimonial (source: live): renders the testimonials island with resolved defaults", () => {
    const section: Section = {
      id: "t2",
      kind: "testimonial",
      variant: "stack",
      style: {},
      props: { source: "live" },
    }
    const { result } = compileSection(section)
    expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const islands = findIslands(result.nodes)
    const island = islands.find((i) => i.name === "testimonials")
    expect(island).toBeDefined()
    expect(island?.props).toEqual({ limit: 3, featuredOnly: false })
    const parsed = parseIslandProps("testimonials", island?.props)
    expect(parsed.ok, JSON.stringify(!parsed.ok && parsed.errors)).toBe(true)
  })

  it("pricing: 1..3 plans, features, highlight, resolved checkout CTA", () => {
    const section: Section = {
      id: "p1",
      kind: "pricing",
      variant: "cards",
      style: {},
      props: {
        heading: "Pick your plan",
        plans: [
          {
            name: "Starter",
            price: "$99",
            cadence: "/mo",
            features: ["Weekly check-ins", "Form review"],
            cta: { label: "Buy now", target: { kind: "program", ref: VALID_UUID } },
          },
          {
            name: "Pro",
            price: "$199",
            features: ["Everything in Starter", "1:1 coaching"],
            highlight: true,
            cta: { label: "Go pro", target: { kind: "session_pack", ref: "10-pack" } },
          },
        ],
        footnote: "Cancel anytime.",
      },
    }
    const { result } = compileSection(section)
    expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const json = serialize(result.nodes)
    expect(json).toContain("Starter")
    expect(json).toContain("Cancel anytime.")
    const islands = findIslands(result.nodes)
    expect(
      islands.find((i) => i.name === "checkout" && (i.props as { productId?: string }).productId === VALID_UUID),
    ).toBeDefined()
    // "10-pack" never resolved to a UUID — session_pack still renders a valid,
    // working checkout island (CheckoutIsland ignores productId for that kind).
    const sessionPackIsland = islands.find(
      (i) => i.name === "checkout" && (i.props as { productKind?: string }).productKind === "session_pack",
    )
    expect(sessionPackIsland).toBeDefined()
    expect((sessionPackIsland?.props as Record<string, unknown>).productId).toBeUndefined()
  })

  it("faq (source: inline): <dl>/<dt>/<dd>, not <details>/<summary>", () => {
    const section: Section = {
      id: "f1",
      kind: "faq",
      variant: "stack",
      style: {},
      props: {
        heading: "Questions",
        source: "inline",
        items: [
          { q: "Do you offer refunds?", a: "Yes, within 14 days." },
          { q: "Is this safe for teens?", a: "Yes — every program is age-appropriate." },
        ],
      },
    }
    const { result } = compileSection(section)
    expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const json = serialize(result.nodes)
    expect(json).toContain('"tag":"dl"')
    expect(json).not.toContain('"tag":"details"')
    expect(json).not.toContain('"tag":"summary"')
  })

  it("faq (source: live): renders the faq island", () => {
    const section: Section = {
      id: "f2",
      kind: "faq",
      variant: "stack",
      style: {},
      props: { source: "live", pageKey: "home" },
    }
    const { result } = compileSection(section)
    expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const islands = findIslands(result.nodes)
    const island = islands.find((i) => i.name === "faq")
    // limit is not authored — faqIslandSchema fills its own default (6) when
    // the compiler re-validates the island's JSON props.
    expect(island?.props).toEqual({ pageKey: "home", limit: 6 })
    const parsed = parseIslandProps("faq", island?.props)
    expect(parsed.ok, JSON.stringify(!parsed.ok && parsed.errors)).toBe(true)
  })

  it("form: always the form island, heading/sub separated from island props", () => {
    const section: Section = {
      id: "form1",
      kind: "form",
      variant: "boxed",
      style: {},
      props: {
        heading: "Get your free guide",
        sub: "We'll email it instantly",
        formKey: "optin",
        fields: [
          { name: "first_name", label: "First name", type: "text", required: true },
          { name: "email", label: "Email", type: "email", required: true },
        ],
        submitLabel: "Send it",
      },
    }
    const { result } = compileSection(section)
    expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const json = serialize(result.nodes)
    expect(json).toContain("Get your free guide")
    const islands = findIslands(result.nodes)
    const island = islands.find((i) => i.name === "form")
    expect(island).toBeDefined()
    const parsed = parseIslandProps("form", island?.props)
    expect(parsed.ok, JSON.stringify(!parsed.ok && parsed.errors)).toBe(true)
  })

  it("cta: headline, sub, resolved event CTA", () => {
    const section: Section = {
      id: "cta1",
      kind: "cta",
      variant: "band",
      style: {},
      props: {
        headline: "Spots are limited",
        sub: "Summer camp starts June 1",
        cta: { label: "Reserve your spot", target: { kind: "event", ref: VALID_UUID } },
      },
    }
    const { result } = compileSection(section)
    expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const islands = findIslands(result.nodes)
    const island = islands.find((i) => i.name === "event")
    expect(island?.props).toMatchObject({ eventId: VALID_UUID, label: "Reserve your spot" })
  })

  it("footer: business name, lines, links (mixed CtaTarget kinds), legal", () => {
    const section: Section = {
      id: "foot1",
      kind: "footer",
      variant: "columns",
      style: {},
      props: {
        businessName: "DJP Athlete",
        lines: ["Tampa, FL", "hello@darrenjpaul.com"],
        links: [
          { label: "Privacy", target: { kind: "url", href: "/privacy" } },
          { label: "Book a call", target: { kind: "booking" } },
        ],
        legal: "© 2026 DJP Athlete. All rights reserved.",
      },
    }
    const { result } = compileSection(section)
    expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const json = serialize(result.nodes)
    expect(json).toContain("DJP Athlete")
    expect(json).toContain("© 2026 DJP Athlete. All rights reserved.")
    const islands = findIslands(result.nodes)
    expect(islands.some((i) => i.name === "booking")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Every declared variant for every kind still compiles clean (markup is
// variant-invariant; styles.ts differentiates purely via CSS class, so this
// also proves the .djp-v-<variant> class name never collides with anything
// the sanitiser treats specially).
// ---------------------------------------------------------------------------

const MINIMAL_PROPS_BY_KIND: Record<SectionKind, Record<string, unknown>> = {
  hero: { headline: "Get stronger", primaryCta: urlCta },
  bullets: { items: [{ title: "Fast" }, { title: "Safe" }] },
  steps: { steps: [{ title: "Book" }, { title: "Train" }] },
  testimonial: { source: "live" },
  pricing: { plans: [{ name: "Starter", price: "$99", features: ["x"], cta: urlCta }] },
  faq: { source: "live", pageKey: "home" },
  form: { formKey: "optin", fields: [{ name: "email", label: "Email", type: "email" }] },
  cta: { headline: "Ready?", cta: bookingCta },
  footer: { businessName: "DJP", lines: [], links: [] },
}

describe("every declared variant compiles clean", () => {
  // Derived from SECTION_REGISTRY[kind].variants — the real registry — rather
  // than a restated literal list. A restated list can silently drift from
  // the schema it's meant to exercise (the exact "tests_that_cannot_fail"
  // pattern flagged in Stage 1.1's own review); reading the registry means
  // this test's coverage can only ever match what the registry actually
  // declares (IMPORTANT 7/8, Stage 1.2 fix round 1).
  it.each(SECTION_KINDS.flatMap((kind) => SECTION_REGISTRY[kind].variants.map((variant) => [kind, variant] as const)))(
    "%s / %s",
    (kind, variant) => {
      const section: Section = {
        id: "sx",
        kind,
        variant,
        style: {},
        props: MINIMAL_PROPS_BY_KIND[kind],
      }
      const { result } = compileSection(section)
      expect(result.ok, `${kind}/${variant}: ${JSON.stringify(!result.ok && result.errors)}`).toBe(true)
      if (!result.ok) return
      expect(result.warnings, `${kind}/${variant} produced warnings`).toEqual([])
    },
  )
})

// ---------------------------------------------------------------------------
// CtaTarget resolution — every kind, both the resolved and unresolved path.
// ---------------------------------------------------------------------------

describe("CtaTarget rendering", () => {
  function ctaCta(target: unknown) {
    const section: Section = {
      id: "cta1",
      kind: "cta",
      variant: "band",
      style: {},
      props: { headline: "Go", cta: { label: "Click me", target } },
    }
    return section
  }

  it("url: plain <a> with the authored href, survives safeUrl", () => {
    const { result } = compileSection(ctaCta({ kind: "url", href: "/thanks" }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    expect(serialize(result.nodes)).toContain('"href":"/thanks"')
  })

  // IMPORTANT 3 (Stage 1.2 fix round 1): ctaTargetSchema's `^(\/|https:\/\/)`
  // regex (registry.ts, frozen) matches "//evil.example" because it only
  // checks for ONE leading slash. safeUrl (compile/sanitize.ts) rejects
  // protocol-relative URLs outright, so without this guard the href would be
  // silently dropped — a dead button with zero compiler warning.
  it("url with a protocol-relative href renders a disabled placeholder, not a dead <a>", () => {
    const { result } = compileSection(ctaCta({ kind: "url", href: "//evil.example/steal-me" }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const json = serialize(result.nodes)
    expect(json).toContain("djp-btn-disabled")
    expect(json).not.toContain('"tag":"a"')
  })

  it('anchor: <a href="#sectionId">, always resolvable with no context', () => {
    const { result } = compileSection(ctaCta({ kind: "anchor", sectionId: "pricing" }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    expect(serialize(result.nodes)).toContain('"href":"#pricing"')
  })

  it("step WITHOUT funnelBasePath renders a disabled placeholder, not a broken link", () => {
    const { result } = compileSection(ctaCta({ kind: "step", stepSlug: "checkout" }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const json = serialize(result.nodes)
    expect(json).toContain("djp-btn-disabled")
    expect(json).toContain('"aria-disabled":"true"')
    // Must not be a live link to nowhere.
    expect(json).not.toContain('"tag":"a"')
  })

  it("step WITH funnelBasePath renders a real, working <a>", () => {
    const html = renderSection(ctaCta({ kind: "step", stepSlug: "checkout" }), {
      funnelBasePath: "/go/summer-camp",
    })
    const result = compileFunnelStep({ html, css: fullCss("cta") })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    expect(serialize(result.nodes)).toContain('"href":"/go/summer-camp/checkout"')
  })

  // IMPORTANT 6 (Stage 1.2 fix round 1): the RenderContext comment always
  // stated "no trailing slash" / an implied leading slash, but nothing
  // enforced it — a caller passing "go/x" (missing the leading slash) would
  // reproduce the exact bare-relative silent-drop trap the parameter exists
  // to prevent.
  it("step WITH a funnelBasePath missing its leading slash renders a disabled placeholder, not a bare-relative href", () => {
    const html = renderSection(ctaCta({ kind: "step", stepSlug: "checkout" }), {
      funnelBasePath: "go/summer-camp",
    })
    const result = compileFunnelStep({ html, css: fullCss("cta") })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const json = serialize(result.nodes)
    expect(json).toContain("djp-btn-disabled")
    expect(json).not.toContain('"tag":"a"')
  })

  it("a bare relative href (what step-without-context would be if NOT guarded) is silently dropped by the real compiler — the exact trap this renderer avoids", () => {
    const result = compileFunnelStep({ html: `<a class="djp-btn" href="checkout">Click</a>`, css: "" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([]) // no warning is emitted either — purely silent
    const json = serialize(result.nodes)
    expect(json).not.toContain('"href"') // the attribute vanished with zero signal
  })

  it("booking: always an island, no ref needed", () => {
    const { result } = compileSection(ctaCta({ kind: "booking" }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const islands = findIslands(result.nodes)
    // href is not authored on the CtaTarget (booking carries no ref/href at
    // all) — bookingIslandSchema fills its own default ("/contact") when the
    // compiler re-validates the island's JSON props.
    expect(islands.find((i) => i.name === "booking")?.props).toEqual({ label: "Click me", href: "/contact" })
  })

  it("program with a resolved (UUID-shaped) ref renders a valid checkout island", () => {
    const { result } = compileSection(ctaCta({ kind: "program", ref: VALID_UUID }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const islands = findIslands(result.nodes)
    const island = islands.find((i) => i.name === "checkout")
    expect(island?.props).toMatchObject({ productKind: "program", productId: VALID_UUID })
    const parsed = parseIslandProps("checkout", island?.props)
    expect(parsed.ok, JSON.stringify(!parsed.ok && parsed.errors)).toBe(true)
  })

  it("program with an UNRESOLVED ref (a name, not a UUID) renders a disabled placeholder, never a schema-invalid island", () => {
    const { result } = compileSection(ctaCta({ kind: "program", ref: "Comeback Code" }))
    // This is the critical assertion: if the renderer naively emitted the
    // island anyway, checkoutIslandSchema's required productId uuid would
    // fail and this compile would be ok:false (a FATAL island_props_invalid
    // for the whole page), not just a warning.
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const islands = findIslands(result.nodes)
    expect(islands).toHaveLength(0)
    expect(serialize(result.nodes)).toContain("djp-btn-disabled")
  })

  // CRITICAL 1 (Stage 1.2 fix round 1): the original guard was a hand-rolled
  // GUID-shape regex, looser than Zod v4's `.uuid()` (RFC 9562: version
  // nibble must be 1-8, variant nibble must be 8/9/a/b). A GUID-shaped but
  // non-conformant placeholder — exactly what a model is likely to produce —
  // would have passed the old guard, reached the island, and failed
  // `checkoutIslandSchema`'s real `.uuid()` check, which is a FATAL
  // `island_props_invalid` for the whole page. `renderIslandIfValid` now
  // asks `parseIslandProps` itself, so it cannot drift from the schema it
  // guards.
  it.each([
    ["version nibble '1' is not a valid RFC 9562 variant nibble", "12345678-1234-1234-1234-123456789012"],
    ["version nibble 'c' is outside 1-8", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"],
    ["nil-like UUID: version and variant nibbles both '0'", "00000000-0000-0000-0000-000000000001"],
  ])(
    "program ref '%s' (%s) is GUID-shaped but RFC-nonconformant — renders a disabled placeholder, not a FATAL island",
    (_desc, ref) => {
      const { result } = compileSection(ctaCta({ kind: "program", ref }))
      expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true)
      if (!result.ok) return
      expect(result.warnings).toEqual([])
      expect(findIslands(result.nodes)).toHaveLength(0)
      expect(serialize(result.nodes)).toContain("djp-btn-disabled")
    },
  )

  it("event with an UNRESOLVED ref renders a disabled placeholder (eventId is unconditionally required)", () => {
    const { result } = compileSection(ctaCta({ kind: "event", ref: "Summer Camp" }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    expect(findIslands(result.nodes)).toHaveLength(0)
    expect(serialize(result.nodes)).toContain("djp-btn-disabled")
  })

  it("event with a resolved ref renders a valid island", () => {
    const { result } = compileSection(ctaCta({ kind: "event", ref: OTHER_UUID }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const islands = findIslands(result.nodes)
    const island = islands.find((i) => i.name === "event")
    const parsed = parseIslandProps("event", island?.props)
    expect(parsed.ok, JSON.stringify(!parsed.ok && parsed.errors)).toBe(true)
  })

  it("session_pack with an unresolved ref STILL renders a working checkout island (productId is optional for this kind)", () => {
    const { result } = compileSection(ctaCta({ kind: "session_pack", ref: "10-pack" }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const islands = findIslands(result.nodes)
    const island = islands.find((i) => i.name === "checkout")
    expect(island).toBeDefined()
    const parsed = parseIslandProps("checkout", island?.props)
    expect(parsed.ok, JSON.stringify(!parsed.ok && parsed.errors)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Hero media validation (IMPORTANT 4/5, Stage 1.2 fix round 1).
// `heroMediaSchema.src` has no URL-shape constraint at all — only Zod's
// `min(1).max(500)`. Every case below passes that schema and would have
// reached the DOM as a broken `<img>`/`<iframe>` with zero compiler warning
// before this fix (`safeUrl` silently drops an invalid `src`; an allowlisted
// host with a garbage path just compiles clean and shows YouTube's own
// error frame).
// ---------------------------------------------------------------------------

describe("hero media validation", () => {
  function heroWithMedia(media: unknown): Section {
    return {
      id: "hero1",
      kind: "hero",
      variant: "centered",
      style: {},
      props: { headline: "Get stronger", primaryCta: urlCta, media },
    }
  }

  it.each([
    ["missing leading slash", "hero.jpg"],
    ["protocol-relative", "//cdn.example/hero.jpg"],
    ["insecure http", "http://cdn.example/hero.jpg"],
    ["disallowed data mime type", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="],
  ])("image media.src that is %s (%s) degrades to a visible placeholder, never a src-less <img>", (_desc, src) => {
    const { result } = compileSection(heroWithMedia({ kind: "image", src, alt: "Athlete", w: 800, h: 600 }))
    expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const json = serialize(result.nodes)
    expect(json).not.toContain('"tag":"img"')
    expect(json).toContain("djp-media-invalid")
    expect(json).toContain("Athlete") // alt text surfaces as visible placeholder content
  })

  it("a valid image src still renders a real <img>", () => {
    const { result } = compileSection(
      heroWithMedia({ kind: "image", src: "/hero.jpg", alt: "Athlete", w: 800, h: 600 }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const json = serialize(result.nodes)
    expect(json).toContain('"tag":"img"')
    expect(json).not.toContain("djp-media-invalid")
  })

  it("a full YouTube URL in media.src (not a bare id) degrades to a visible placeholder instead of an iframe pointed at a garbage path", () => {
    const { result } = compileSection(
      heroWithMedia({
        kind: "youtube",
        src: "https://youtu.be/dQw4w9WgXcQ",
        alt: "Program overview",
        w: 1280,
        h: 720,
      }),
    )
    expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const json = serialize(result.nodes)
    expect(json).not.toContain('"tag":"iframe"')
    expect(json).toContain("djp-media-invalid")
  })

  it("a bare video id still renders a real <iframe>", () => {
    const { result } = compileSection(
      heroWithMedia({ kind: "youtube", src: "dQw4w9WgXcQ", alt: "Program overview", w: 1280, h: 720 }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    expect(serialize(result.nodes)).toContain('"tag":"iframe"')
  })
})

// ---------------------------------------------------------------------------
// Style knobs are re-validated, not trusted raw (IMPORTANT 2, Stage 1.2 fix
// round 1).
// ---------------------------------------------------------------------------

describe("style knob validation", () => {
  it("a style value outside its closed enum throws rather than being interpolated unescaped into an attribute", () => {
    const section: Section = {
      id: "h1",
      kind: "hero",
      variant: "centered",
      style: { headline: 'x" style="position:fixed;inset:0' } as unknown as Section["style"],
      props: { headline: "Get stronger", primaryCta: urlCta },
    }
    expect(() => renderSection(section)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Escaping — authored copy that looks like markup must survive as inert text,
// never as a live tag, and never break out of an attribute.
// ---------------------------------------------------------------------------

describe("authored copy is always escaped (constraint 4)", () => {
  it("a headline containing a script tag renders as inert text", () => {
    const section: Section = {
      id: "hero1",
      kind: "hero",
      variant: "centered",
      style: {},
      props: { headline: `<script>alert(1)</script>`, primaryCta: urlCta },
    }
    const { result } = compileSection(section)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const json = serialize(result.nodes)
    expect(json).toContain("alert(1)") // the text survived
    expect(json).not.toContain('"tag":"script"') // never became a live tag
  })

  it("a CTA label containing an attribute-breakout attempt cannot escape the <a>", () => {
    const section: Section = {
      id: "cta1",
      kind: "cta",
      variant: "band",
      style: {},
      props: {
        headline: "Go",
        cta: { label: `"><img src=x onerror=alert(1)>`, target: { kind: "url", href: "/thanks" } },
      },
    }
    const { result } = compileSection(section)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const json = serialize(result.nodes)
    // No injected <img> element anywhere in the tree.
    expect(json.match(/"tag":"img"/g)).toBeNull()
    // Positive assertion (minor, Stage 1.2 fix round 1): the label text
    // itself must still be present as inert text, not silently dropped —
    // "no <img> anywhere" alone would also pass if the renderer had simply
    // eaten the whole label.
    expect(json).toContain(`"><img src=x onerror=alert(1)>`)
  })

  it("an island prop (form field label) containing a single quote survives the JSON+HTML round trip intact — the one character JSON.stringify does NOT escape, so single-quoted data-djp-props depends entirely on our own escaping for it (IMPORTANT 9, Stage 1.2 fix round 1)", () => {
    const section: Section = {
      id: "form2",
      kind: "form",
      variant: "boxed",
      style: {},
      props: {
        formKey: "optin",
        fields: [{ name: "name", label: "Athlete's name", type: "text" }],
      },
    }
    const { result } = compileSection(section)
    expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const islands = findIslands(result.nodes)
    const island = islands.find((i) => i.name === "form")
    const fields = (island?.props as { fields: Array<{ label: string }> }).fields
    expect(fields[0].label).toBe("Athlete's name")
  })

  it("an island prop (form field label) containing a quote and ampersand survives the JSON+HTML round trip intact", () => {
    const section: Section = {
      id: "form1",
      kind: "form",
      variant: "boxed",
      style: {},
      props: {
        formKey: "optin",
        fields: [{ name: "email", label: `Email — Terms & Conditions "apply"`, type: "email" }],
      },
    }
    const { result } = compileSection(section)
    expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    const islands = findIslands(result.nodes)
    const island = islands.find((i) => i.name === "form")
    const fields = (island?.props as { fields: Array<{ label: string }> }).fields
    expect(fields[0].label).toBe(`Email — Terms & Conditions "apply"`)
  })
})

// ---------------------------------------------------------------------------
// A full, realistic multi-section page — the end-to-end proof.
// ---------------------------------------------------------------------------

describe("a full page assembled from multiple kinds", () => {
  it("compiles clean with zero warnings and every section present in the tree", () => {
    const sections: Section[] = [
      {
        id: "hero1",
        kind: "hero",
        variant: "centered",
        style: { headline: "xl" },
        props: { headline: "Train like an athlete", primaryCta: urlCta },
      },
      {
        id: "b1",
        kind: "bullets",
        variant: "numbered",
        style: {},
        props: { items: [{ title: "Assess", icon: "clock" }, { title: "Program" }, { title: "Progress" }] },
      },
      {
        id: "form1",
        kind: "form",
        variant: "band",
        style: { tone: "muted" },
        props: { formKey: "optin", fields: [{ name: "email", label: "Email", type: "email", required: true }] },
      },
      {
        id: "foot1",
        kind: "footer",
        variant: "simple",
        style: {},
        props: { businessName: "DJP Athlete", lines: [], links: [] },
      },
    ]

    const html = sections.map((s) => renderSection(s)).join("\n")
    const usedKinds = new Set(sections.map((s) => s.kind))
    const css =
      THEME_CSS +
      Array.from(usedKinds)
        .map((k) => SECTION_CSS[k])
        .join("\n")

    const result = compileFunnelStep({ html, css })
    expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    for (const section of sections) {
      expect(serialize(result.nodes)).toContain(`"id":"${section.id}"`)
    }
  })
})
