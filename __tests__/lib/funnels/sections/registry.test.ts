// Stage 1.1 of the AI page builder: the section registry
// (lib/funnels/sections/registry.ts). Every kind gets a happy-path parse AND
// at least one adversarial rejection — a schema test that only feeds valid
// input pins nothing (see MEMORY.md: tests_that_cannot_fail).
import { describe, it, expect } from "vitest"
import { z } from "zod"
import { SAFE_LINK } from "@/lib/funnels/islands"
import {
  ctaTargetSchema,
  ctaWithLabelSchema,
  sectionDocSchema,
  sectionSchema,
  parseSection,
  isSectionKind,
  SECTION_KINDS,
  SECTION_REGISTRY,
  SECTION_ICONS,
  heroPropsSchema,
  bulletsPropsSchema,
  stepsPropsSchema,
  testimonialPropsSchema,
  pricingPropsSchema,
  faqPropsSchema,
  formSectionPropsSchema,
  ctaPropsSchema,
  footerPropsSchema,
  type SectionKind,
} from "@/lib/funnels/sections/registry"

const VALID_UUID = "11111111-1111-4111-8111-111111111111"

// Bare CtaTarget fixtures — used directly by the ctaTargetSchema describe
// block, and as the `target` of a `ctaWithLabelSchema` everywhere else (a CTA
// site in a section always carries authored button copy, per CRITICAL 1 of
// the Stage 1.1 review: an AI page builder with no way to write "Book your
// assessment" instead of a hardcoded generic label is broken).
const urlCta = { kind: "url", href: "/thanks" } as const
const bookingCta = { kind: "booking" } as const

const labeledUrlCta = { label: "Learn more", target: urlCta }
const labeledBookingCta = { label: "Book a call", target: bookingCta }

function baseSection(overrides: Record<string, unknown>) {
  return {
    id: "s1",
    style: {},
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// ctaTargetSchema — the mechanism that eliminates hallucinated UUIDs
// ---------------------------------------------------------------------------

describe("ctaTargetSchema", () => {
  const validByKind: Record<string, unknown> = {
    url: { kind: "url", href: "/thanks" },
    step: { kind: "step", stepSlug: "checkout" },
    anchor: { kind: "anchor", sectionId: "pricing" },
    program: { kind: "program", ref: "Comeback Code" },
    session_pack: { kind: "session_pack", ref: "10-pack" },
    event: { kind: "event", ref: "Summer Camp" },
    booking: { kind: "booking" },
  }

  it.each(Object.entries(validByKind))("accepts a valid %s target", (_kind, value) => {
    const result = ctaTargetSchema.safeParse(value)
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true)
  })

  it("rejects an unknown kind (the mechanism a hallucinated UUID would otherwise slip through)", () => {
    const result = ctaTargetSchema.safeParse({ kind: "checkout", productId: VALID_UUID })
    expect(result.success).toBe(false)
  })

  it("accepts a UUID-shaped string as ref instead of rejecting it — ref is a free string, not a UUID field a model could target instead", () => {
    // The schema has no id-shaped field at all: `ref` is `z.string().max(120)`
    // whether it holds a name or (accidentally) a UUID-looking string.
    // Whether it resolves to exactly one real row is resolve.ts's job in a
    // later stage, not this schema's.
    const result = ctaTargetSchema.safeParse({ kind: "program", ref: VALID_UUID })
    expect(result.success).toBe(true)
    if (result.success && result.data.kind === "program") {
      expect(result.data.ref).toBe(VALID_UUID) // stored as an opaque string, not resolved here
    }
  })

  it("rejects program without a ref", () => {
    const result = ctaTargetSchema.safeParse({ kind: "program" })
    expect(result.success).toBe(false)
  })

  it("rejects url targets that don't start with / or https://", () => {
    const result = ctaTargetSchema.safeParse({ kind: "url", href: "javascript:alert(1)" })
    expect(result.success).toBe(false)
  })

  // Stage 1.6 fix round 1, H1. `href` used to RESTATE the link rule as
  // `/^(\/|https:\/\/)/`, which accepts a PROTOCOL-RELATIVE url: one leading
  // slash is all it checks for, so `//evil.example` reads as a path and
  // navigates off-site on the page's own scheme. `SAFE_LINK` (islands.ts)
  // carries the `(?!\/\/)` lookahead that closes it, and `href` now ASKS it.
  // Third divergent-link-regex bug in this repo.
  it.each([
    ["/thanks", true],
    ["https://calendly.com/djp", true],
    ["//evil.example/steal-me", false],
    ["//evil.example", false],
    ["javascript:alert(1)", false],
    ["http://insecure.example", false],
  ])("url href %s parses iff SAFE_LINK accepts it", (href, accepted) => {
    expect(SAFE_LINK.test(href)).toBe(accepted)
    expect(ctaTargetSchema.safeParse({ kind: "url", href }).success).toBe(accepted)
  })

  it("carries SAFE_LINK itself, not a copy that happens to agree today", () => {
    // The table above is a behaviour check on six inputs; this is the identity
    // check. Someone hand-typing a character-identical regex back in passes
    // every row above and re-opens the divergence the day SAFE_LINK changes —
    // which is exactly how the first two instances of this bug happened.
    const emitted = z.toJSONSchema(ctaTargetSchema, { io: "input", unrepresentable: "any" })
    const patterns = new Set<string>()
    const walk = (node: unknown): void => {
      if (node === null || typeof node !== "object") return
      const record = node as Record<string, unknown>
      if (typeof record.pattern === "string") patterns.add(record.pattern)
      for (const child of Object.values(record)) walk(child)
    }
    walk(emitted)
    expect([...patterns]).toEqual([SAFE_LINK.source])
  })
})

// ---------------------------------------------------------------------------
// Icons — closed enum
// ---------------------------------------------------------------------------

describe("section icon enum", () => {
  it("accepts every listed icon in a bullets item", () => {
    for (const icon of SECTION_ICONS) {
      const result = bulletsPropsSchema.safeParse({
        items: [{ title: "A", icon }, { title: "B" }],
      })
      expect(result.success, `icon ${icon}: ${JSON.stringify(!result.success && result.error.issues)}`).toBe(true)
    }
  })

  it("rejects an icon outside the closed set", () => {
    const result = bulletsPropsSchema.safeParse({
      items: [{ title: "A", icon: "flame" }, { title: "B" }],
    })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// hero
// ---------------------------------------------------------------------------

describe("heroPropsSchema", () => {
  it("accepts a full hero", () => {
    const result = heroPropsSchema.safeParse({
      eyebrow: "New",
      headline: "Get stronger, faster",
      sub: "8-week program",
      media: { kind: "image", src: "/hero.jpg", alt: "Athlete training", w: 1200, h: 800 },
      primaryCta: labeledUrlCta,
      secondaryCta: labeledBookingCta,
    })
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true)
  })

  it("accepts the minimal hero (headline + primaryCta only)", () => {
    const result = heroPropsSchema.safeParse({ headline: "Get stronger", primaryCta: labeledUrlCta })
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true)
  })

  it("rejects a missing headline", () => {
    const result = heroPropsSchema.safeParse({ primaryCta: labeledUrlCta })
    expect(result.success).toBe(false)
  })

  it("rejects a missing primaryCta", () => {
    const result = heroPropsSchema.safeParse({ headline: "Get stronger" })
    expect(result.success).toBe(false)
  })

  it("rejects a primaryCta missing its authored label — the AI must be able to write button copy", () => {
    const result = heroPropsSchema.safeParse({
      headline: "Get stronger",
      primaryCta: { target: urlCta },
    })
    expect(result.success).toBe(false)
  })

  it("rejects a CtaTarget with a bogus kind inside primaryCta.target", () => {
    const result = heroPropsSchema.safeParse({
      headline: "Get stronger",
      primaryCta: { label: "Go", target: { kind: "webhook", href: "https://evil.example" } },
    })
    expect(result.success).toBe(false)
  })

  it("rejects an incomplete media object (missing w/h)", () => {
    const result = heroPropsSchema.safeParse({
      headline: "Get stronger",
      primaryCta: labeledUrlCta,
      media: { kind: "image", src: "/hero.jpg", alt: "x" },
    })
    expect(result.success).toBe(false)
  })
})

describe("ctaWithLabelSchema", () => {
  it("accepts a labeled target", () => {
    const result = ctaWithLabelSchema.safeParse(labeledUrlCta)
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true)
  })

  it("rejects a missing label", () => {
    const result = ctaWithLabelSchema.safeParse({ target: urlCta })
    expect(result.success).toBe(false)
  })

  it("rejects an empty-string label", () => {
    const result = ctaWithLabelSchema.safeParse({ label: "", target: urlCta })
    expect(result.success).toBe(false)
  })

  it("rejects a missing target", () => {
    const result = ctaWithLabelSchema.safeParse({ label: "Go" })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// bullets
// ---------------------------------------------------------------------------

describe("bulletsPropsSchema", () => {
  it("accepts 2..6 items", () => {
    const result = bulletsPropsSchema.safeParse({
      heading: "Why us",
      items: [{ title: "Fast" }, { title: "Safe" }],
    })
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true)
  })

  it("rejects fewer than 2 items", () => {
    const result = bulletsPropsSchema.safeParse({ items: [{ title: "Only one" }] })
    expect(result.success).toBe(false)
  })

  it("rejects more than 6 items", () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ title: `Item ${i}` }))
    const result = bulletsPropsSchema.safeParse({ items })
    expect(result.success).toBe(false)
  })

  it("rejects an item missing its required title", () => {
    const result = bulletsPropsSchema.safeParse({ items: [{ body: "no title" }, { title: "ok" }] })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// steps
// ---------------------------------------------------------------------------

describe("stepsPropsSchema", () => {
  it("accepts 2..6 steps", () => {
    const result = stepsPropsSchema.safeParse({
      steps: [{ title: "Book a call" }, { title: "Start training" }],
    })
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true)
  })

  it("rejects a single step (below the min of 2)", () => {
    const result = stepsPropsSchema.safeParse({ steps: [{ title: "Only one" }] })
    expect(result.success).toBe(false)
  })

  it("rejects more than 6 steps", () => {
    const steps = Array.from({ length: 7 }, (_, i) => ({ title: `Step ${i}` }))
    const result = stepsPropsSchema.safeParse({ steps })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// testimonial — discriminated union on source
// ---------------------------------------------------------------------------

describe("testimonialPropsSchema", () => {
  it("accepts source: live with defaults applied", () => {
    const result = testimonialPropsSchema.safeParse({ source: "live" })
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true)
    if (result.success && result.data.source === "live") {
      expect(result.data.limit).toBe(3)
      expect(result.data.featuredOnly).toBe(false)
    }
  })

  it("accepts source: quote with 1..3 quotes", () => {
    const result = testimonialPropsSchema.safeParse({
      source: "quote",
      quotes: [{ quote: "Great program!", name: "Alex" }],
    })
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true)
  })

  it("rejects source: quote with zero quotes", () => {
    const result = testimonialPropsSchema.safeParse({ source: "quote", quotes: [] })
    expect(result.success).toBe(false)
  })

  it("rejects source: quote with more than 3 quotes", () => {
    const quotes = Array.from({ length: 4 }, (_, i) => ({ quote: `Q${i}`, name: `N${i}` }))
    const result = testimonialPropsSchema.safeParse({ source: "quote", quotes })
    expect(result.success).toBe(false)
  })

  it("rejects an unknown source discriminant", () => {
    const result = testimonialPropsSchema.safeParse({ source: "manual", quotes: [] })
    expect(result.success).toBe(false)
  })

  it("accepts source: live even with a stray quote-branch key present — Zod strips unknown keys, so `quotes` is simply ignored under live rather than validated or required", () => {
    const result = testimonialPropsSchema.safeParse({ source: "live", quotes: [] })
    expect(result.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// pricing
// ---------------------------------------------------------------------------

describe("pricingPropsSchema", () => {
  const validPlan = {
    name: "Starter",
    price: "$99",
    features: ["Weekly check-ins"],
    cta: labeledUrlCta,
  }

  it("accepts 1..3 plans", () => {
    const result = pricingPropsSchema.safeParse({ plans: [validPlan] })
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true)
  })

  it("rejects zero plans", () => {
    const result = pricingPropsSchema.safeParse({ plans: [] })
    expect(result.success).toBe(false)
  })

  it("rejects more than 3 plans", () => {
    const plans = Array.from({ length: 4 }, (_, i) => ({ ...validPlan, name: `Plan ${i}` }))
    const result = pricingPropsSchema.safeParse({ plans })
    expect(result.success).toBe(false)
  })

  it("rejects a plan with zero features (below min of 1)", () => {
    const result = pricingPropsSchema.safeParse({ plans: [{ ...validPlan, features: [] }] })
    expect(result.success).toBe(false)
  })

  it("rejects a plan with more than 8 features", () => {
    const features = Array.from({ length: 9 }, (_, i) => `Feature ${i}`)
    const result = pricingPropsSchema.safeParse({ plans: [{ ...validPlan, features }] })
    expect(result.success).toBe(false)
  })

  it("rejects a plan missing its cta", () => {
    const { cta: _cta, ...planWithoutCta } = validPlan
    const result = pricingPropsSchema.safeParse({ plans: [planWithoutCta] })
    expect(result.success).toBe(false)
  })

  it("rejects a plan whose cta.target has a bogus kind", () => {
    const result = pricingPropsSchema.safeParse({
      plans: [{ ...validPlan, cta: { label: "Buy", target: { kind: "discount_code", ref: "SAVE10" } } }],
    })
    expect(result.success).toBe(false)
  })

  it("rejects a plan whose cta is missing its authored label", () => {
    const result = pricingPropsSchema.safeParse({
      plans: [{ ...validPlan, cta: { target: urlCta } }],
    })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// faq — discriminated union on source
// ---------------------------------------------------------------------------

describe("faqPropsSchema", () => {
  it("accepts source: live with a pageKey", () => {
    const result = faqPropsSchema.safeParse({ source: "live", pageKey: "home" })
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true)
  })

  it("accepts source: inline with 1..12 items", () => {
    const result = faqPropsSchema.safeParse({
      source: "inline",
      items: [{ q: "Do you offer refunds?", a: "Yes, within 14 days." }],
    })
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true)
  })

  it("rejects source: live missing pageKey", () => {
    const result = faqPropsSchema.safeParse({ source: "live" })
    expect(result.success).toBe(false)
  })

  it("rejects source: inline with zero items", () => {
    const result = faqPropsSchema.safeParse({ source: "inline", items: [] })
    expect(result.success).toBe(false)
  })

  it("rejects source: inline with more than 12 items", () => {
    const items = Array.from({ length: 13 }, (_, i) => ({ q: `Q${i}`, a: `A${i}` }))
    const result = faqPropsSchema.safeParse({ source: "inline", items })
    expect(result.success).toBe(false)
  })

  it("rejects an unknown source discriminant", () => {
    const result = faqPropsSchema.safeParse({ source: "cms", items: [] })
    expect(result.success).toBe(false)
  })

  it("still honours the shared optional heading across both branches", () => {
    const result = faqPropsSchema.safeParse({ heading: "Questions", source: "live", pageKey: "home" })
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// form — must embed formIslandSchema VERBATIM
// ---------------------------------------------------------------------------

describe("formSectionPropsSchema", () => {
  const baseForm = {
    heading: "Get your free guide",
    formKey: "optin",
    fields: [{ name: "email", label: "Email", type: "email" as const, required: true }],
  }

  it("accepts a minimal valid form section", () => {
    const result = formSectionPropsSchema.safeParse(baseForm)
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true)
  })

  it("rejects a form with zero fields (formIslandSchema.fields.min(1))", () => {
    const result = formSectionPropsSchema.safeParse({ ...baseForm, fields: [] })
    expect(result.success).toBe(false)
  })

  it("inherits the redirectUrl host allowlist from formIslandSchema (proves it's imported, not restated)", () => {
    const result = formSectionPropsSchema.safeParse({
      ...baseForm,
      successMode: "redirect",
      redirectUrl: "https://attacker.example/",
    })
    expect(result.success).toBe(false)
  })

  it("allows a redirectUrl on an allowlisted host, same as the raw island schema", () => {
    const result = formSectionPropsSchema.safeParse({
      ...baseForm,
      successMode: "redirect",
      redirectUrl: "https://www.darrenjpaul.com/thanks",
    })
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true)
  })

  it("inherits the superRefine requiring redirectUrl when successMode is redirect", () => {
    const result = formSectionPropsSchema.safeParse({ ...baseForm, successMode: "redirect" })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// cta
// ---------------------------------------------------------------------------

describe("ctaPropsSchema", () => {
  it("accepts a valid cta section", () => {
    const result = ctaPropsSchema.safeParse({ headline: "Ready to start?", cta: labeledBookingCta })
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true)
  })

  it("rejects a missing headline", () => {
    const result = ctaPropsSchema.safeParse({ cta: labeledBookingCta })
    expect(result.success).toBe(false)
  })

  it("rejects a missing cta", () => {
    const result = ctaPropsSchema.safeParse({ headline: "Ready to start?" })
    expect(result.success).toBe(false)
  })

  it("rejects a cta.target with a bogus kind", () => {
    const result = ctaPropsSchema.safeParse({
      headline: "Ready?",
      cta: { label: "Go", target: { kind: "email_capture" } },
    })
    expect(result.success).toBe(false)
  })

  it("rejects a cta missing its authored label", () => {
    const result = ctaPropsSchema.safeParse({ headline: "Ready?", cta: { target: bookingCta } })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// footer
// ---------------------------------------------------------------------------

describe("footerPropsSchema", () => {
  it("accepts the minimal footer (empty lines/links)", () => {
    const result = footerPropsSchema.safeParse({ businessName: "DJP Athlete", lines: [], links: [] })
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true)
  })

  it("accepts up to 4 lines and 6 links", () => {
    const result = footerPropsSchema.safeParse({
      businessName: "DJP Athlete",
      lines: ["123 Main St", "Tampa, FL", "555-0100", "hello@darrenjpaul.com"],
      links: Array.from({ length: 6 }, (_, i) => ({ label: `Link ${i}`, target: urlCta })),
    })
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true)
  })

  it("rejects a missing businessName", () => {
    const result = footerPropsSchema.safeParse({ lines: [], links: [] })
    expect(result.success).toBe(false)
  })

  it("rejects more than 4 lines", () => {
    const result = footerPropsSchema.safeParse({
      businessName: "DJP Athlete",
      lines: ["a", "b", "c", "d", "e"],
      links: [],
    })
    expect(result.success).toBe(false)
  })

  it("rejects more than 6 links", () => {
    const result = footerPropsSchema.safeParse({
      businessName: "DJP Athlete",
      lines: [],
      links: Array.from({ length: 7 }, (_, i) => ({ label: `Link ${i}`, target: urlCta })),
    })
    expect(result.success).toBe(false)
  })

  it("rejects a link whose target has a bogus CtaTarget kind", () => {
    const result = footerPropsSchema.safeParse({
      businessName: "DJP Athlete",
      lines: [],
      links: [{ label: "Privacy", target: { kind: "external", href: "https://example.com" } }],
    })
    expect(result.success).toBe(false)
  })

  it("rejects a link missing its authored label", () => {
    const result = footerPropsSchema.safeParse({
      businessName: "DJP Athlete",
      lines: [],
      links: [{ target: urlCta }],
    })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// SECTION_REGISTRY — single source of truth
// ---------------------------------------------------------------------------

describe("SECTION_REGISTRY", () => {
  it("has exactly the nine kinds from the plan, no more, no fewer", () => {
    expect(Object.keys(SECTION_REGISTRY).sort()).toEqual([...SECTION_KINDS].sort())
    expect(SECTION_KINDS.length).toBe(9)
  })

  it("does not register a nav kind (landing pages remove exits, not add them)", () => {
    expect(isSectionKind("nav")).toBe(false)
  })

  it("isSectionKind narrows correctly", () => {
    expect(isSectionKind("hero")).toBe(true)
    expect(isSectionKind("banner")).toBe(false)
    expect(isSectionKind(42)).toBe(false)
  })
})

// The smallest props payload that satisfies each kind's real propsSchema —
// used ONLY to hold props constant while the variant field is what's under
// test below. If any of these ever stops matching its kind's schema, the
// "every declared variant is accepted" case for that kind fails immediately,
// so this table can't silently drift from the schemas it exercises.
const MINIMAL_VALID_PROPS: Record<SectionKind, Record<string, unknown>> = {
  hero: { headline: "Get stronger", primaryCta: labeledUrlCta },
  bullets: { items: [{ title: "Fast" }, { title: "Safe" }] },
  steps: { steps: [{ title: "Book a call" }, { title: "Start training" }] },
  testimonial: { source: "live" },
  pricing: { plans: [{ name: "Starter", price: "$99", features: ["x"], cta: labeledUrlCta }] },
  faq: { source: "live", pageKey: "home" },
  form: { formKey: "optin", fields: [{ name: "email", label: "Email", type: "email" }] },
  cta: { headline: "Ready?", cta: labeledBookingCta },
  footer: { businessName: "DJP", lines: [], links: [] },
}

describe("SECTION_REGISTRY variant enums actually gate their schema", () => {
  // Reviewer flag (IMPORTANT 3, Stage 1.1 fix round 1): the prior version of
  // this test only checked `typeof variant === "string"` and never called
  // `.safeParse` — it would have stayed green even if every propsSchema were
  // swapped for `z.object({}).passthrough()`. These two now actually parse
  // a full section through `def.schema` for every declared variant, and
  // prove an undeclared variant is rejected — the invariant the describe
  // title claims.
  it.each(SECTION_KINDS)("%s: every declared variant is accepted by the full section schema", (kind) => {
    const def = SECTION_REGISTRY[kind]
    const props = MINIMAL_VALID_PROPS[kind]
    for (const variant of def.variants) {
      const result = def.schema.safeParse({ id: "s1", kind, variant, style: {}, props })
      expect(
        result.success,
        `kind=${kind} variant=${variant}: ${JSON.stringify(!result.success && result.error.issues)}`,
      ).toBe(true)
    }
  })

  it.each(SECTION_KINDS)("%s: a variant outside the declared list is rejected", (kind) => {
    const def = SECTION_REGISTRY[kind]
    const props = MINIMAL_VALID_PROPS[kind]
    const result = def.schema.safeParse({
      id: "s1",
      kind,
      variant: "not-a-real-variant",
      style: {},
      props,
    })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// parseSection — mirrors parseIslandProps' { ok, errors } contract
// ---------------------------------------------------------------------------

describe("parseSection", () => {
  it("parses a valid full section for a given kind", () => {
    const result = parseSection(
      "cta",
      baseSection({ kind: "cta", variant: "band", props: { headline: "Go", cta: labeledBookingCta } }),
    )
    expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true)
  })

  it("returns readable errors for an invalid variant", () => {
    const result = parseSection(
      "cta",
      baseSection({ kind: "cta", variant: "sidebar", props: { headline: "Go", cta: labeledBookingCta } }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("variant"))).toBe(true)
    }
  })

  it("rejects a section whose kind literal doesn't match the schema being checked against", () => {
    const result = parseSection(
      "cta",
      baseSection({ kind: "hero", variant: "centered", props: { headline: "x", primaryCta: labeledUrlCta } }),
    )
    expect(result.ok).toBe(false)
  })

  it("rejects a malformed props payload (missing required slot) with a path-qualified error", () => {
    const result = parseSection("hero", baseSection({ kind: "hero", variant: "centered", props: {} }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.startsWith("props."))).toBe(true)
    }
  })

  it("rejects a section id that isn't short/safe", () => {
    const result = parseSection(
      "cta",
      baseSection({
        id: "Not Safe!",
        kind: "cta",
        variant: "band",
        props: { headline: "Go", cta: labeledBookingCta },
      }),
    )
    expect(result.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// sectionSchema — cross-kind discriminated union
// ---------------------------------------------------------------------------

describe("sectionSchema", () => {
  it("accepts a valid section of any kind", () => {
    const result = sectionSchema.safeParse(
      baseSection({ kind: "footer", variant: "simple", props: { businessName: "DJP", lines: [], links: [] } }),
    )
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true)
  })

  it("rejects an unknown top-level kind", () => {
    const result = sectionSchema.safeParse(baseSection({ kind: "gallery", variant: "grid", props: {} }))
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// sectionDocSchema — the full document
// ---------------------------------------------------------------------------

describe("sectionDocSchema", () => {
  const heroSection = baseSection({
    kind: "hero",
    variant: "centered",
    props: { headline: "Get stronger", primaryCta: labeledUrlCta },
  })

  it("accepts a minimal valid doc (1 section)", () => {
    const result = sectionDocSchema.safeParse({
      v: 1,
      engine: "sections",
      theme: { tone: "light", accent: "primary", radius: "soft" },
      sections: [heroSection],
    })
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true)
  })

  it("rejects zero sections (below the min of 1)", () => {
    const result = sectionDocSchema.safeParse({
      v: 1,
      engine: "sections",
      theme: { tone: "light", accent: "primary", radius: "soft" },
      sections: [],
    })
    expect(result.success).toBe(false)
  })

  it("rejects more than 24 sections", () => {
    const sections = Array.from({ length: 25 }, (_, i) =>
      baseSection({
        id: `h${i}`,
        kind: "hero",
        variant: "centered",
        props: { headline: `Headline ${i}`, primaryCta: labeledUrlCta },
      }),
    )
    const result = sectionDocSchema.safeParse({
      v: 1,
      engine: "sections",
      theme: { tone: "light", accent: "primary", radius: "soft" },
      sections,
    })
    expect(result.success).toBe(false)
  })

  it("rejects a bad theme.tone", () => {
    const result = sectionDocSchema.safeParse({
      v: 1,
      engine: "sections",
      theme: { tone: "neon", accent: "primary", radius: "soft" },
      sections: [heroSection],
    })
    expect(result.success).toBe(false)
  })

  it("rejects engine values other than 'sections' (the free-HTML escape hatch this plan replaced)", () => {
    const result = sectionDocSchema.safeParse({
      v: 1,
      engine: "grapesjs",
      theme: { tone: "light", accent: "primary", radius: "soft" },
      sections: [heroSection],
    })
    expect(result.success).toBe(false)
  })

  it("rejects v values other than 1", () => {
    const result = sectionDocSchema.safeParse({
      v: 2,
      engine: "sections",
      theme: { tone: "light", accent: "primary", radius: "soft" },
      sections: [heroSection],
    })
    expect(result.success).toBe(false)
  })
})
