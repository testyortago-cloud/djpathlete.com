// lib/funnels/sections/registry.ts — the section registry.
//
// Stage 1 replaces the GrapesJS free-form canvas with a conversational
// builder over a TYPED SECTION document. An AI turns a prompt into a
// SectionDoc — never HTML, never CSS, never a UUID — and a hand-written
// server-side renderer (a later stage) turns that into {html, css} for the
// existing, unmodified publish compiler (lib/funnels/compile/, frozen).
//
// This file is the ONE place the section kinds are defined, mirroring
// the pattern lib/funnels/islands.ts:9-11 already establishes for islands:
// the renderer, the AI prompt builder, and the validator all derive their
// kind lists, variant lists, and prop shapes from here, so those three can
// never drift apart.
//
// Source of truth: docs/superpowers/plans/2026-08-10-ai-page-builder-sections.md
// §1a (lines 54-86, the SectionDoc/Section interfaces) and §2 (lines 184-251,
// the section registry table + CtaTarget).

import { z } from "zod"
import { formIslandSchema, SAFE_LINK } from "@/lib/funnels/islands"

// ---------------------------------------------------------------------------
// SectionDoc / Section — the data model (plan §1a, lines 58-83, copied
// exactly: `v: 1`, `engine: "sections"`, the theme shape, and `sections`
// bounded 1..24). These are the AI's entire output surface — it never emits
// HTML, CSS, or a UUID.
// ---------------------------------------------------------------------------

export interface SectionDoc {
  v: 1
  engine: "sections"
  theme: {
    tone: "light" | "dark"
    accent: "accent" | "primary"
    radius: "sharp" | "soft" | "round"
  }
  sections: Section[] // 1..24
}

export interface Section {
  id: string // short, stable: "h1", "b2" — also the anchor target
  kind: SectionKind // one of 9
  variant: string // constrained per kind
  style: {
    headline?: "sm" | "md" | "lg" | "xl"
    align?: "left" | "center"
    tone?: "default" | "muted" | "accent" | "dark"
    pad?: "tight" | "normal" | "roomy"
  }
  props: Record<string, unknown> // validated by the kind's Zod schema
}

// ---------------------------------------------------------------------------
// CtaTarget — the mechanism that eliminates hallucinated UUIDs (plan §2,
// lines 218-227). Copied verbatim: the model writes a NAME
// (`{kind:"program", ref:"Comeback Code"}`), never an id.
// `lib/funnels/sections/resolve.ts` (a later stage) matches `ref` against the
// real tables and substitutes the UUID, or renders a disabled placeholder and
// blocks publish when the name doesn't resolve to exactly one row.
//
// NOTE: the "url" variant's `href` ASKS THE VALIDATOR — `SAFE_LINK` from
// islands.ts — instead of restating it. The plan's own text spelled the regex
// out as `/^(\/|https:\/\/)/`, which accepts `//evil.example`: protocol-
// relative, so it reads as a path and navigates off-site on the page's own
// scheme. That is this repo's third divergent-link-regex bug, and Stage 1.6
// showed why restating it is worse here than anywhere else: the builder
// prompt is GENERATED from these schemas, so the weak pattern was printed
// into a frozen, cached prompt prefix about thirty lines above the strong one
// (`form.props.redirectUrl`, which already used `SAFE_LINK`) — two
// contradictory link rules in one cached instruction, teaching the model that
// `//evil.example` is valid. `renderCtaTarget` (render.ts) then gates on
// `SAFE_LINK` and degrades it to a disabled placeholder with `ok:true,
// warnings:[]`: a dead button the prompt told the model to write.
//
// The verbatim-copy instruction covers the SHAPE of the union, not a
// hand-typed copy of a regex that already has one owner. render.ts keeps its
// own `SAFE_LINK` gate as defence in depth.
// ---------------------------------------------------------------------------

export const ctaTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("url"),
    href: z.string().max(300).regex(SAFE_LINK, "Must be a site path or an https URL"),
  }),
  z.object({ kind: z.literal("step"), stepSlug: z.string() }),
  z.object({ kind: z.literal("anchor"), sectionId: z.string() }),
  z.object({ kind: z.literal("program"), ref: z.string().max(120) }),
  z.object({ kind: z.literal("session_pack"), ref: z.string().max(120) }),
  z.object({ kind: z.literal("event"), ref: z.string().max(120) }),
  z.object({ kind: z.literal("booking") }),
])

export type CtaTarget = z.infer<typeof ctaTargetSchema>

// ---------------------------------------------------------------------------
// CtaTarget wrapped with authored button copy.
//
// `ctaTargetSchema` alone has nowhere for the AI to write button text: `url`
// /`step`/`anchor` carry no label field at all, and `program`/`session_pack`
// /`event`/`booking` only reach a label deep inside the ISLAND schema, never
// threaded through `CtaTarget` or `SectionDoc`. Every CTA site in the table
// that isn't itself a footer link needs the same fix `footerLinkSchema`
// already models: wrap the target with an authored `label`. One shared
// schema, so hero/pricing/cta/footer all use the identical bound.
// ---------------------------------------------------------------------------

export const ctaWithLabelSchema = z.object({
  label: z.string().min(1).max(60),
  target: ctaTargetSchema,
})

export type CtaWithLabel = z.infer<typeof ctaWithLabelSchema>

// ---------------------------------------------------------------------------
// Icons — a CLOSED enum, not a free-form string.
//
// Constraint 1 from the plan (§2, lines 204): `<svg>` is dropped by the
// sanitiser with its whole subtree, and `<img src="data:image/svg+xml">` is
// rejected by `safeUrl` (png/jpeg/gif/webp/avif only). So icons render as
// `<span class="djp-ic djp-ic-check">` styled with `mask-image` in the
// hand-authored stylesheet — a closed vocabulary the renderer already has
// artwork for, never an arbitrary string that could point at nothing.
// ---------------------------------------------------------------------------

export const SECTION_ICONS = ["check", "star", "bolt", "shield", "clock", "arrow"] as const
export type SectionIcon = (typeof SECTION_ICONS)[number]
const sectionIconSchema = z.enum(SECTION_ICONS)

// ---------------------------------------------------------------------------
// Shared style knobs (plan §1a). All optional — a section with `style: {}`
// renders at every default. Rendered as `data-h` / `data-align` / `data-tone`
// / `data-pad` attributes (constraint 3, §2 lines 206): NEVER `data-djp-*`,
// which `filterAttrs` (compile/sanitize.ts) strips from every non-island
// element: its `RESERVED_ATTR_PREFIX` guard `continue`s BEFORE the plain
// `data-*` passthrough is reached, so the passthrough never sees them. Named
// by function and guard rather than by line number on purpose — the two line
// numbers this comment used to cite (`:216` / `:222`) had already decayed to
// `:229` / `:234` by the time anyone checked them.
// ---------------------------------------------------------------------------

export const sectionStyleSchema = z.object({
  headline: z.enum(["sm", "md", "lg", "xl"]).optional(),
  align: z.enum(["left", "center"]).optional(),
  tone: z.enum(["default", "muted", "accent", "dark"]).optional(),
  pad: z.enum(["tight", "normal", "roomy"]).optional(),
})

export type SectionStyleKnobs = z.infer<typeof sectionStyleSchema>

// ---------------------------------------------------------------------------
// Section id — short, stable, and also used as the HTML anchor target for
// `CtaTarget.kind === "anchor"`. Constrained to safe id/URL-fragment
// characters (mirrors the `formKey` convention in islands.ts).
// ---------------------------------------------------------------------------

const sectionIdSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]{0,39}$/,
    "Section id must be short: lowercase letters, digits and hyphens, starting with a letter",
  )

// ---------------------------------------------------------------------------
// Theme (plan §1a).
// ---------------------------------------------------------------------------

export const sectionDocThemeSchema = z.object({
  tone: z.enum(["light", "dark"]),
  accent: z.enum(["accent", "primary"]),
  radius: z.enum(["sharp", "soft", "round"]),
})

export type SectionDocTheme = z.infer<typeof sectionDocThemeSchema>

// ---------------------------------------------------------------------------
// Section kinds — a closed set (plan §2 table, lines 190-200, plus `proof`).
// Deliberately no `nav`: a landing page's job is to remove exits.
//
// ORDER IS NOT ARBITRARY. `prompt.ts` generates Block A by walking this list,
// so it doubles as the running order the model is shown — `proof` sits second
// because a credential strip belongs directly under the hero, not at the bottom
// of the page where it reads as an afterthought.
// ---------------------------------------------------------------------------

export const SECTION_KINDS = [
  "hero",
  "proof",
  "bullets",
  "steps",
  "testimonial",
  "pricing",
  "faq",
  "form",
  "cta",
  "footer",
] as const

export type SectionKind = (typeof SECTION_KINDS)[number]

export function isSectionKind(value: unknown): value is SectionKind {
  return typeof value === "string" && (SECTION_KINDS as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// hero
// ---------------------------------------------------------------------------

const HERO_VARIANTS = ["centered", "split", "image-bg"] as const

const heroMediaSchema = z.object({
  kind: z.enum(["image", "youtube"]),
  src: z.string().min(1).max(500),
  alt: z.string().max(200),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
})

export const heroPropsSchema = z.object({
  eyebrow: z.string().max(60).optional(),
  headline: z.string().min(1).max(160),
  sub: z.string().max(300).optional(),
  media: heroMediaSchema.optional(),
  primaryCta: ctaWithLabelSchema,
  secondaryCta: ctaWithLabelSchema.optional(),
})

export type HeroSectionProps = z.infer<typeof heroPropsSchema>

// ---------------------------------------------------------------------------
// proof — a credential / stat strip, high on the page.
//
// DELIBERATELY TEXT-ONLY, AND THE REASON MATTERS. The obvious shape for this is
// a logo bar, and a logo bar needs image URLs. An image URL is precisely the
// field the model would invent: `heroMediaSchema.src` already has no URL-shape
// constraint at all, and `render.ts` has a hand-written guard in front of it for
// exactly that reason. A fabricated logo `src` would be dropped by the
// sanitiser with NO compiler warning — `ok: true, warnings: []` — and ship as a
// broken image on a live campaign page.
//
// "12 years · coaching" and "500+ · athletes trained" carry the same trust
// signal with nothing to hallucinate. If a real logo bar is ever wanted, it
// needs an asset picker, not a prompt.
// ---------------------------------------------------------------------------

const PROOF_VARIANTS = ["strip", "stats"] as const

const proofItemSchema = z.object({
  /** The number or short claim: "500+", "12 years", "World Champion". */
  value: z.string().min(1).max(40),
  /** What it is: "athletes trained", "coaching", "400m". */
  label: z.string().min(1).max(80),
})

export const proofPropsSchema = z.object({
  heading: z.string().max(120).optional(),
  items: z.array(proofItemSchema).min(2).max(5),
})

export type ProofSectionProps = z.infer<typeof proofPropsSchema>

// ---------------------------------------------------------------------------
// bullets
// ---------------------------------------------------------------------------

const BULLETS_VARIANTS = ["cards", "list", "numbered"] as const

const bulletItemSchema = z.object({
  title: z.string().min(1).max(100),
  body: z.string().max(300).optional(),
  icon: sectionIconSchema.optional(),
})

export const bulletsPropsSchema = z.object({
  heading: z.string().max(120).optional(),
  intro: z.string().max(300).optional(),
  items: z.array(bulletItemSchema).min(2).max(6),
})

export type BulletsSectionProps = z.infer<typeof bulletsPropsSchema>

// ---------------------------------------------------------------------------
// steps
// ---------------------------------------------------------------------------

const STEPS_VARIANTS = ["numbered", "timeline"] as const

const stepItemSchema = z.object({
  title: z.string().min(1).max(100),
  body: z.string().max(300).optional(),
})

export const stepsPropsSchema = z.object({
  heading: z.string().max(120).optional(),
  intro: z.string().max(300).optional(),
  steps: z.array(stepItemSchema).min(2).max(6),
})

export type StepsSectionProps = z.infer<typeof stepsPropsSchema>

// ---------------------------------------------------------------------------
// testimonial — discriminated union on `source` (live vs. quote), NOT
// optional fields: a "live" testimonial has no quotes to author, and a
// "quote" testimonial has no live-feed knobs, so modelling this as one
// object with a bunch of `?` fields would let the AI emit a section that is
// simultaneously both or neither.
// ---------------------------------------------------------------------------

const TESTIMONIAL_VARIANTS = ["stack", "grid"] as const

const testimonialQuoteSchema = z.object({
  quote: z.string().min(1).max(500),
  name: z.string().min(1).max(120),
  detail: z.string().max(160).optional(),
})

export const testimonialPropsSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("live"),
    limit: z.number().int().min(1).max(12).optional().default(3),
    featuredOnly: z.boolean().optional().default(false),
  }),
  z.object({
    source: z.literal("quote"),
    quotes: z.array(testimonialQuoteSchema).min(1).max(3),
  }),
])

export type TestimonialSectionProps = z.infer<typeof testimonialPropsSchema>

// ---------------------------------------------------------------------------
// pricing
// ---------------------------------------------------------------------------

const PRICING_VARIANTS = ["cards", "single"] as const

const pricingPlanSchema = z.object({
  name: z.string().min(1).max(60),
  price: z.string().min(1).max(40),
  cadence: z.string().max(40).optional(),
  blurb: z.string().max(200).optional(),
  features: z.array(z.string().min(1).max(160)).min(1).max(8),
  cta: ctaWithLabelSchema,
  highlight: z.boolean().optional(),
})

export const pricingPropsSchema = z.object({
  heading: z.string().max(120).optional(),
  plans: z.array(pricingPlanSchema).min(1).max(3),
  footnote: z.string().max(300).optional(),
})

export type PricingSectionProps = z.infer<typeof pricingPropsSchema>

// ---------------------------------------------------------------------------
// faq — discriminated union on `source` (live vs. inline), same reasoning as
// testimonial above.
// ---------------------------------------------------------------------------

const FAQ_VARIANTS = ["stack"] as const

const faqInlineItemSchema = z.object({
  q: z.string().min(1).max(200),
  a: z.string().min(1).max(1000),
})

const faqSourceSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("live"), pageKey: z.string().min(1).max(60) }),
  z.object({ source: z.literal("inline"), items: z.array(faqInlineItemSchema).min(1).max(12) }),
])

// `source` is the discriminant, so it must live at the top level of the props
// object (sibling of `heading`), not nested one level down. Composed the same
// way as `formSectionPropsSchema` below: a shared optional-fields object
// intersected with the discriminated union.
export const faqPropsSchema = z.intersection(z.object({ heading: z.string().max(120).optional() }), faqSourceSchema)

export type FaqSectionProps = z.infer<typeof faqPropsSchema>

// ---------------------------------------------------------------------------
// form — `heading?`/`sub?` PLUS `formIslandSchema` VERBATIM (islands.ts:107-140).
// Imported, not restated: this is the one kind that renders as the `form`
// island, so its props must accept exactly what the island component reads
// (including the redirectUrl host-allowlist hardening from Stage 0).
// ---------------------------------------------------------------------------

// `split` is the lead-capture layout: the pitch on one side, the form itself in
// a card on the other, as a full-width band. It exists because the page this
// builder shipped put the form at the bottom of a four-screen scroll, which is
// where opt-in pages go to die — a waitlist form belongs on the first screen.
//
// It needs NO new island and NO second `formKey`: the same form island renders
// inside a different wrapper. `proofPoints` are the two or three lines of
// reassurance that sit beside a form ("No payment now", "Coached in person"),
// and the other two variants ignore them.
const FORM_VARIANTS = ["boxed", "band", "split"] as const

export const formSectionPropsSchema = z.intersection(
  z.object({
    heading: z.string().max(120).optional(),
    sub: z.string().max(300).optional(),
    proofPoints: z.array(z.string().min(1).max(80)).max(4).optional(),
  }),
  formIslandSchema,
)

export type FormSectionProps = z.infer<typeof formSectionPropsSchema>

// ---------------------------------------------------------------------------
// cta
// ---------------------------------------------------------------------------

const CTA_VARIANTS = ["band", "boxed"] as const

export const ctaPropsSchema = z.object({
  headline: z.string().min(1).max(160),
  sub: z.string().max(300).optional(),
  cta: ctaWithLabelSchema,
})

export type CtaSectionProps = z.infer<typeof ctaPropsSchema>

// ---------------------------------------------------------------------------
// footer
// ---------------------------------------------------------------------------

const FOOTER_VARIANTS = ["simple", "columns"] as const

// `{label, target}` is exactly `ctaWithLabelSchema` — this is the shape the
// reviewer told the rest of the CTA sites to mirror, so footer reuses the
// shared schema rather than keeping its own near-duplicate definition.
export const footerPropsSchema = z.object({
  businessName: z.string().min(1).max(120),
  lines: z.array(z.string().min(1).max(160)).max(4),
  links: z.array(ctaWithLabelSchema).max(6),
  legal: z.string().max(300).optional(),
})

export type FooterSectionProps = z.infer<typeof footerPropsSchema>

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Full validator for a `Section` of a specific kind: id + kind (pinned to a
 * literal) + variant (constrained to that kind's allowed values) + the shared
 * style knobs + the kind's own props schema. Built once per kind so the
 * per-kind entries in `SECTION_REGISTRY` and the cross-kind `sectionSchema`
 * discriminated union below are the same objects, not near-duplicates.
 *
 * Its return type is left for TypeScript to infer (a `ZodObject` with a
 * literal `kind` field) rather than annotated as `z.ZodType` — that literal
 * type is exactly what `z.discriminatedUnion` needs to accept each branch
 * below, so widening it here would break that call.
 */
function buildSectionSchema<Kind extends SectionKind, Variants extends readonly [string, ...string[]]>(
  kind: Kind,
  variants: Variants,
  propsSchema: z.ZodType,
) {
  return z.object({
    id: sectionIdSchema,
    kind: z.literal(kind),
    variant: z.enum(variants),
    style: sectionStyleSchema,
    props: propsSchema,
  })
}

const heroSchema = buildSectionSchema("hero", HERO_VARIANTS, heroPropsSchema)
const proofSchema = buildSectionSchema("proof", PROOF_VARIANTS, proofPropsSchema)
const bulletsSchema = buildSectionSchema("bullets", BULLETS_VARIANTS, bulletsPropsSchema)
const stepsSchema = buildSectionSchema("steps", STEPS_VARIANTS, stepsPropsSchema)
const testimonialSchema = buildSectionSchema("testimonial", TESTIMONIAL_VARIANTS, testimonialPropsSchema)
const pricingSchema = buildSectionSchema("pricing", PRICING_VARIANTS, pricingPropsSchema)
const faqSchema = buildSectionSchema("faq", FAQ_VARIANTS, faqPropsSchema)
const formSchema = buildSectionSchema("form", FORM_VARIANTS, formSectionPropsSchema)
const ctaSchema = buildSectionSchema("cta", CTA_VARIANTS, ctaPropsSchema)
const footerSchema = buildSectionSchema("footer", FOOTER_VARIANTS, footerPropsSchema)

export interface SectionDef<Kind extends SectionKind = SectionKind> {
  kind: Kind
  /** Shown in the AI prompt / any future editor UI. */
  label: string
  description: string
  /** Constrained per kind — the only values `variant` may take for this kind. */
  variants: readonly string[]
  propsSchema: z.ZodType
  /** Full `Section` validator for this kind (id + kind + variant + style + props). */
  schema: z.ZodType
}

const heroDef: SectionDef<"hero"> = {
  kind: "hero",
  label: "Hero",
  description: "Above-the-fold headline, subhead, optional media, and primary/secondary CTAs.",
  variants: HERO_VARIANTS,
  propsSchema: heroPropsSchema,
  schema: heroSchema,
}

const proofDef: SectionDef<"proof"> = {
  kind: "proof",
  label: "Proof",
  description:
    "A credential or stat strip — 2 to 5 short number/label pairs. Text only: no logos, no images. Belongs high on the page, right under the hero.",
  variants: PROOF_VARIANTS,
  propsSchema: proofPropsSchema,
  schema: proofSchema,
}

const bulletsDef: SectionDef<"bullets"> = {
  kind: "bullets",
  label: "Bullets",
  description: "A short list of benefits or features, 2 to 6 items.",
  variants: BULLETS_VARIANTS,
  propsSchema: bulletsPropsSchema,
  schema: bulletsSchema,
}

const stepsDef: SectionDef<"steps"> = {
  kind: "steps",
  label: "Steps",
  description: "'How it works' — 2 to 6 sequential steps.",
  variants: STEPS_VARIANTS,
  propsSchema: stepsPropsSchema,
  schema: stepsSchema,
}

const testimonialDef: SectionDef<"testimonial"> = {
  kind: "testimonial",
  label: "Testimonial",
  description: "Social proof: either pulled live from the testimonials table, or 1-3 authored quotes.",
  variants: TESTIMONIAL_VARIANTS,
  propsSchema: testimonialPropsSchema,
  schema: testimonialSchema,
}

const pricingDef: SectionDef<"pricing"> = {
  kind: "pricing",
  label: "Pricing",
  description: "1 to 3 plans, each with a name, price, feature list and a CTA.",
  variants: PRICING_VARIANTS,
  propsSchema: pricingPropsSchema,
  schema: pricingSchema,
}

const faqDef: SectionDef<"faq"> = {
  kind: "faq",
  label: "FAQ",
  description: "Either pulled live from the faqs table for a page key, or 1-12 authored Q&As.",
  variants: FAQ_VARIANTS,
  propsSchema: faqPropsSchema,
  schema: faqSchema,
}

const formDef: SectionDef<"form"> = {
  kind: "form",
  label: "Form",
  description:
    "An opt-in / lead-capture form. Renders as the `form` island. " +
    // THE RULE, NOT JUST THE SIGNATURE. The generated props above already show
    // `role` and `successMode: "checkout"`, so a model can see the fields exist
    // and cannot tell from them that a checkout form with a missing role is
    // REFUSED AT PUBLISH. Said here rather than in prompt.ts so it travels with
    // the schema it constrains.
    'NEVER WRITE successMode "checkout" AND NEVER WRITE eventId. A form that sells a camp ' +
    "needs a camp id that only the owner can supply, in the builder, so a checkout form you " +
    "wrote yourself could never be completed — and because eventId is required for that mode, " +
    "the whole batch of ops would be rejected and the owner's turn would fail. Write " +
    'successMode "message" or "redirect".' +
    " IF A FORM ALREADY HAS successMode \"checkout\", KEEP IT AND KEEP ITS eventId EXACTLY AS " +
    "THEY ARE — the owner switched that on deliberately. Such a form must keep a field for each " +
    "of parent_name, parent_email, athlete_name, athlete_age and waiver_accepted, each carrying " +
    "that value in its `role`, with the waiver field a required checkbox. Dropping any of them, " +
    "or the eventId, makes the page impossible to publish.",
  variants: FORM_VARIANTS,
  propsSchema: formSectionPropsSchema,
  schema: formSchema,
}

const ctaDef: SectionDef<"cta"> = {
  kind: "cta",
  label: "Call to action",
  description: "A standalone headline + single CTA band, usually placed near the end of the page.",
  variants: CTA_VARIANTS,
  propsSchema: ctaPropsSchema,
  schema: ctaSchema,
}

const footerDef: SectionDef<"footer"> = {
  kind: "footer",
  label: "Footer",
  description: "Business name, optional address/contact lines, links and legal text.",
  variants: FOOTER_VARIANTS,
  propsSchema: footerPropsSchema,
  schema: footerSchema,
}

export const SECTION_REGISTRY: Record<SectionKind, SectionDef> = {
  hero: heroDef,
  proof: proofDef,
  bullets: bulletsDef,
  steps: stepsDef,
  testimonial: testimonialDef,
  pricing: pricingDef,
  faq: faqDef,
  form: formDef,
  cta: ctaDef,
  footer: footerDef,
}

export const SECTION_LIST: readonly SectionDef[] = SECTION_KINDS.map((k) => SECTION_REGISTRY[k])

/**
 * Cross-kind validator for a single `Section` of ANY kind — used to validate
 * `SectionDoc.sections` without the caller needing to know each element's
 * kind up front. Discriminates on `kind`, so an unknown kind fails fast with
 * a clear Zod issue rather than silently matching the wrong branch.
 *
 * Built from the concretely-typed per-kind schemas above (not from
 * `SECTION_REGISTRY[k].schema`, which is deliberately widened to `z.ZodType`
 * for storage) so `z.discriminatedUnion` can see each branch's literal `kind`
 * value at the type level.
 */
export const sectionSchema = z.discriminatedUnion("kind", [
  heroSchema,
  proofSchema,
  bulletsSchema,
  stepsSchema,
  testimonialSchema,
  pricingSchema,
  faqSchema,
  formSchema,
  ctaSchema,
  footerSchema,
])

/**
 * The full `SectionDoc` validator: theme + 1..24 sections, each checked
 * against its own kind's schema via `sectionSchema` above.
 */
export const sectionDocSchema = z.object({
  v: z.literal(1),
  engine: z.literal("sections"),
  theme: sectionDocThemeSchema,
  sections: z.array(sectionSchema).min(1).max(24),
})

/**
 * Validates a raw, unknown value as a `Section` of a SPECIFIC kind — mirrors
 * the shape of `parseIslandProps` in lib/funnels/islands.ts (same
 * ok/errors contract) so the codebase has one idiom for "validate this
 * against its registry entry," not two.
 */
export function parseSection(
  kind: SectionKind,
  raw: unknown,
): { ok: true; section: Section } | { ok: false; errors: string[] } {
  const result = SECTION_REGISTRY[kind].schema.safeParse(raw)
  if (result.success) {
    return { ok: true, section: result.data as Section }
  }
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join(".")
    return path ? `${path}: ${issue.message}` : issue.message
  })
  return { ok: false, errors }
}
