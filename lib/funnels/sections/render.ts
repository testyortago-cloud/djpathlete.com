// lib/funnels/sections/render.ts — the section renderer.
//
// Turns a validated `Section` (lib/funnels/sections/registry.ts) into an HTML
// fragment for the existing, frozen publish compiler (lib/funnels/compile/).
// This is the ONLY code in the system that writes markup: the AI emits a
// typed SectionDoc — never HTML, never CSS, never a UUID — so every
// constraint the compiler imposes (lib/funnels/compile/sanitize.ts) is this
// file's responsibility to satisfy BY CONSTRUCTION. The sanitiser drops
// unknown tags/unsafe attributes SILENTLY (no error, no warning), so a
// mistake here reads as "the AI forgot the icon," not as a bug report.
//
// PRECONDITION: `section.props` has already been validated once, upstream
// (apply.ts / the AI layer). Every per-kind renderer re-parses it anyway with
// the registry's own `propsSchema.parse()` (throws) rather than trusting the
// loose `Record<string, unknown>` type on `Section` — cheap, and turns
// "should be impossible" bad input into a loud crash instead of a silently
// wrong page.
//
// Source of truth: docs/superpowers/plans/2026-08-10-ai-page-builder-sections.md
// §2 "Three constraints the renderer obeys by construction" (lines 202-234)
// and the nine-kind table (lines 190-200).

import {
  SECTION_REGISTRY,
  type Section,
  type SectionKind,
  type SectionStyleKnobs,
  type SectionIcon,
  type CtaWithLabel,
  type CtaTarget,
  type HeroSectionProps,
  type BulletsSectionProps,
  type StepsSectionProps,
  type TestimonialSectionProps,
  type PricingSectionProps,
  type FaqSectionProps,
  type FormSectionProps,
  type CtaSectionProps,
  type FooterSectionProps,
} from "@/lib/funnels/sections/registry"
import type { IslandName } from "@/lib/funnels/islands"

// ---------------------------------------------------------------------------
// Escaping — constraint 4. Every interpolated string, text node OR attribute
// value, goes through this. `&` must be replaced first, or the entities this
// function inserts for the other four characters would themselves get
// re-escaped on their own `&`.
// ---------------------------------------------------------------------------

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

// ---------------------------------------------------------------------------
// Rendering context — the one piece of information a Section cannot carry
// itself: the base path this funnel's OTHER steps live under, needed to turn
// `CtaTarget.kind === "step"` into a real link. Everything else a renderer
// needs lives on the Section.
//
// Threaded in by whoever calls `renderSection` (doc.ts's `reassemble()`,
// Stage 1.3). When it's omitted (unit tests; a caller that hasn't wired it up
// yet), a "step" CTA renders as a disabled placeholder rather than guessing —
// see the comment on `renderCtaTarget` below for why a bare relative href
// would be worse: it would compile "successfully" and then compile ITS OWN
// href away with zero warning.
// ---------------------------------------------------------------------------

export interface RenderContext {
  /** e.g. "/go/summer-camp" — no trailing slash. */
  funnelBasePath?: string
}

// ---------------------------------------------------------------------------
// Style knobs -> resolved defaults -> `data-*` attributes.
//
// Constraint 3: these MUST be `data-h` / `data-align` / `data-tone` /
// `data-pad`, never `data-djp-*` — `filterAttrs` (sanitize.ts:229) strips
// every `data-djp-` attribute from a non-island element before the plain
// `data-*` passthrough (sanitize.ts:234) ever runs. Getting this wrong is
// silent: the section would just render at defaults with no compiler error.
//
// Defaults are resolved and always emitted (never left off when the AI
// didn't specify a knob) so `styles.ts` only ever has to match against a
// concrete value, never reason about "attribute absent = default".
// ---------------------------------------------------------------------------

interface ResolvedStyle {
  headline: "sm" | "md" | "lg" | "xl"
  align: "left" | "center"
  tone: "default" | "muted" | "accent" | "dark"
  pad: "tight" | "normal" | "roomy"
}

function resolveStyle(style: SectionStyleKnobs): ResolvedStyle {
  return {
    headline: style.headline ?? "md",
    align: style.align ?? "left",
    tone: style.tone ?? "default",
    pad: style.pad ?? "normal",
  }
}

function sectionOpenTag(section: Section): string {
  const { headline, align, tone, pad } = resolveStyle(section.style)
  const classes = `djp-s djp-s-${section.kind} djp-v-${section.variant}`
  return (
    `<section id="${escapeHtml(section.id)}" class="${escapeHtml(classes)}" ` +
    `data-h="${headline}" data-align="${align}" data-tone="${tone}" data-pad="${pad}">`
  )
}

// ---------------------------------------------------------------------------
// Icons — closed six-value enum (registry.ts SECTION_ICONS), rendered as a
// styled <span>, never <svg> (dropped with its whole subtree by
// DROPPED_TAGS) and never <img src="data:image/svg+xml"> (safeUrl only
// allows png/jpeg/gif/webp/avif data URIs). styles.ts supplies the
// mask-image artwork for each of the six spans this can emit.
// ---------------------------------------------------------------------------

function renderIcon(icon: SectionIcon | undefined): string {
  if (!icon) return ""
  return `<span class="djp-ic djp-ic-${icon}" aria-hidden="true"></span>`
}

// ---------------------------------------------------------------------------
// Islands — CTAs targeting program/session_pack/event/booking, the live
// testimonial/faq feeds, and the form section all short-circuit through
// `data-djp-island` / `data-djp-props`. This is the ONE place `data-djp-*`
// is correct to emit: `convertIsland` (sanitize.ts:199) reads these BEFORE
// `filterAttrs` ever runs, so they are never subject to the reserved-prefix
// strip that constraint 3 is about.
//
// The attribute is single-quoted and its JSON payload run through
// `escapeHtml` — not just to neutralise a literal `'` inside the JSON, but
// because parse5 decodes HTML entities in attribute values before our code
// ever sees them again. An unescaped `&` in authored copy (e.g. a form
// field label "Terms & Conditions") would otherwise risk being consumed as
// the start of a bogus entity by the time it round-trips through the
// compiler. `escapeHtml` on the whole JSON string, then single-quoting the
// attribute, is the only combination that survives that round trip intact:
// `parseFragment` decodes entities back to `& < > " '` before `JSON.parse`
// ever runs on it.
// ---------------------------------------------------------------------------

function renderIsland(name: IslandName, props: Record<string, unknown>): string {
  const json = escapeHtml(JSON.stringify(props))
  return `<div data-djp-island="${name}" data-djp-props='${json}'></div>`
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function looksLikeUuid(value: string): boolean {
  return UUID_RE.test(value)
}

function disabledCta(label: string, className: string): string {
  // Not a <button disabled> — "disabled" is not in ALLOWED_ATTRS, so it would
  // be silently dropped and the element would look and act like a live
  // button. A <span> styled + aria-disabled fails visibly instead.
  return (
    `<span class="${className} djp-btn-disabled" role="button" aria-disabled="true">` + `${escapeHtml(label)}</span>`
  )
}

// ---------------------------------------------------------------------------
// CtaTarget -> a clickable element.
//
// `url` / `anchor` always produce a safe href by construction (the registry's
// `ctaTargetSchema` pins `url.href` to `/` or `https://`; `anchor` is always
// `#<sectionId>`). `step` is more subtle: without `ctx.funnelBasePath` the
// only href we could emit is a bare relative slug ("checkout"), and
// `safeUrl` (compile/sanitize.ts) REJECTS any href that isn't rooted at `/`,
// `#`, `https://`, `mailto:` or `tel:` — a bare relative slug is silently
// dropped as an attribute, leaving an <a> with NO href and zero compiler
// warning. That is worse than a visibly disabled button, so "step" without
// context degrades the same way an unresolved program/event ref does.
//
// `program` / `session_pack` / `event` / `booking` render as islands.
// `ref` (the plan's name-not-UUID mechanism, registry.ts's `ctaTargetSchema`)
// is only trustworthy as a real id once `lib/funnels/sections/resolve.ts`
// (Stage 1.5) has substituted it. `eventIslandSchema.eventId` and
// `checkoutIslandSchema.productId` (productKind: "program" branch) are
// REQUIRED uuids — emitting an unresolved ref like "Comeback Code" into
// either would fail that island's own Zod schema, and `island_props_invalid`
// is a FATAL compile code (compile/types.ts's FATAL_COMPILE_CODES), turning
// one bad CTA into a blocked publish for the WHOLE page. Gating on
// `looksLikeUuid` here means an unresolved ref degrades to a disabled
// placeholder instead — exactly the plan's own "0 or ≥2 matches" behaviour,
// enforced by construction rather than assumed to have already happened.
// `session_pack` is the one exception: `productId` is optional there
// (`CheckoutIsland.tsx` ignores it for that productKind and always routes to
// /client/sessions per islands.ts's own comment), so an unresolved ref never
// blocks that button.
// ---------------------------------------------------------------------------

function renderCtaTarget(target: CtaTarget, label: string, className: string, ctx: RenderContext): string {
  switch (target.kind) {
    case "url":
      return `<a class="${className}" href="${escapeHtml(target.href)}">${escapeHtml(label)}</a>`
    case "anchor":
      return `<a class="${className}" href="#${escapeHtml(target.sectionId)}">${escapeHtml(label)}</a>`
    case "step": {
      if (!ctx.funnelBasePath) return disabledCta(label, className)
      const href = `${ctx.funnelBasePath}/${encodeURIComponent(target.stepSlug)}`
      return `<a class="${className}" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
    }
    case "booking":
      return renderIsland("booking", { label })
    case "event": {
      if (!looksLikeUuid(target.ref)) return disabledCta(label, className)
      return renderIsland("event", { eventId: target.ref, label })
    }
    case "program": {
      if (!looksLikeUuid(target.ref)) return disabledCta(label, className)
      return renderIsland("checkout", { productKind: "program", productId: target.ref, label })
    }
    case "session_pack":
      return renderIsland(
        "checkout",
        looksLikeUuid(target.ref)
          ? { productKind: "session_pack", productId: target.ref, label }
          : { productKind: "session_pack", label },
      )
    default: {
      const _exhaustive: never = target
      return _exhaustive
    }
  }
}

function renderCtaButton(cta: CtaWithLabel, className: string, ctx: RenderContext): string {
  return renderCtaTarget(cta.target, cta.label, className, ctx)
}

// ---------------------------------------------------------------------------
// Hero media.
//
// `kind: "youtube"` treats `media.src` as a bare video id and embeds it via
// the privacy-enhanced host — the one YouTube host family on the compiler's
// iframe allowlist (compile/sanitize.ts ALLOWED_IFRAME_HOSTS) alongside
// Vimeo. This convention (id, not a full URL) must be carried into the
// Stage 1.6 prompt so the model knows what to write into `media.src`.
// ---------------------------------------------------------------------------

function renderMedia(media: NonNullable<HeroSectionProps["media"]>): string {
  if (media.kind === "image") {
    return (
      `<img class="djp-hero-media" src="${escapeHtml(media.src)}" alt="${escapeHtml(media.alt)}" ` +
      `width="${media.w}" height="${media.h}" loading="lazy" />`
    )
  }
  const embedSrc = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(media.src)}`
  return `<iframe class="djp-hero-media" src="${escapeHtml(embedSrc)}" title="${escapeHtml(media.alt)}" loading="lazy"></iframe>`
}

// ---------------------------------------------------------------------------
// hero
// ---------------------------------------------------------------------------

function renderHeroSection(section: Section, ctx: RenderContext): string {
  const props = SECTION_REGISTRY.hero.propsSchema.parse(section.props) as HeroSectionProps
  const parts: string[] = [sectionOpenTag(section), `<div class="djp-hero-inner">`, `<div class="djp-hero-copy">`]
  if (props.eyebrow) parts.push(`<p class="djp-eyebrow">${escapeHtml(props.eyebrow)}</p>`)
  parts.push(`<h1 class="djp-hd">${escapeHtml(props.headline)}</h1>`)
  if (props.sub) parts.push(`<p class="djp-sub">${escapeHtml(props.sub)}</p>`)
  parts.push(`<div class="djp-hero-ctas">`)
  parts.push(renderCtaButton(props.primaryCta, "djp-btn djp-btn-primary", ctx))
  if (props.secondaryCta) parts.push(renderCtaButton(props.secondaryCta, "djp-btn djp-btn-secondary", ctx))
  parts.push(`</div>`, `</div>`) // .djp-hero-ctas, .djp-hero-copy
  if (props.media) parts.push(renderMedia(props.media))
  parts.push(`</div>`, `</section>`) // .djp-hero-inner
  return parts.join("")
}

// ---------------------------------------------------------------------------
// bullets
// ---------------------------------------------------------------------------

function renderBulletsSection(section: Section, _ctx: RenderContext): string {
  const props = SECTION_REGISTRY.bullets.propsSchema.parse(section.props) as BulletsSectionProps
  const parts: string[] = [sectionOpenTag(section)]
  if (props.heading) parts.push(`<h2 class="djp-hd">${escapeHtml(props.heading)}</h2>`)
  if (props.intro) parts.push(`<p class="djp-sub">${escapeHtml(props.intro)}</p>`)
  parts.push(`<ul class="djp-bullets-list">`)
  for (const item of props.items) {
    parts.push(`<li class="djp-bullet-item">`)
    parts.push(renderIcon(item.icon))
    parts.push(`<div class="djp-bullet-body">`)
    parts.push(`<h3 class="djp-bullet-title">${escapeHtml(item.title)}</h3>`)
    if (item.body) parts.push(`<p class="djp-bullet-text">${escapeHtml(item.body)}</p>`)
    parts.push(`</div>`, `</li>`)
  }
  parts.push(`</ul>`, `</section>`)
  return parts.join("")
}

// ---------------------------------------------------------------------------
// steps — <ol>/<li>, never <details>/<summary> (constraint 1: not
// allowlisted, unwrapped, an accordion would silently flatten).
// ---------------------------------------------------------------------------

function renderStepsSection(section: Section, _ctx: RenderContext): string {
  const props = SECTION_REGISTRY.steps.propsSchema.parse(section.props) as StepsSectionProps
  const parts: string[] = [sectionOpenTag(section)]
  if (props.heading) parts.push(`<h2 class="djp-hd">${escapeHtml(props.heading)}</h2>`)
  if (props.intro) parts.push(`<p class="djp-sub">${escapeHtml(props.intro)}</p>`)
  parts.push(`<ol class="djp-steps-list">`)
  for (const step of props.steps) {
    parts.push(`<li class="djp-step-item">`)
    parts.push(`<div class="djp-step-body">`)
    parts.push(`<h3 class="djp-step-title">${escapeHtml(step.title)}</h3>`)
    if (step.body) parts.push(`<p class="djp-step-text">${escapeHtml(step.body)}</p>`)
    parts.push(`</div>`, `</li>`)
  }
  parts.push(`</ol>`, `</section>`)
  return parts.join("")
}

// ---------------------------------------------------------------------------
// testimonial — discriminated union: "live" is the `testimonials` island,
// "quote" is authored <blockquote>s. No <cite> (not allowlisted) — the
// attribution line uses <footer><span>, both allowed.
// ---------------------------------------------------------------------------

function renderTestimonialSection(section: Section, _ctx: RenderContext): string {
  const props = SECTION_REGISTRY.testimonial.propsSchema.parse(section.props) as TestimonialSectionProps
  const parts: string[] = [sectionOpenTag(section)]
  if (props.source === "live") {
    parts.push(renderIsland("testimonials", { limit: props.limit, featuredOnly: props.featuredOnly }))
  } else {
    parts.push(`<div class="djp-testimonial-grid">`)
    for (const quote of props.quotes) {
      parts.push(`<blockquote class="djp-quote">`)
      parts.push(`<p class="djp-quote-text">${escapeHtml(quote.quote)}</p>`)
      parts.push(`<footer class="djp-quote-attribution">`)
      parts.push(`<span class="djp-quote-name">${escapeHtml(quote.name)}</span>`)
      if (quote.detail) parts.push(`<span class="djp-quote-detail">${escapeHtml(quote.detail)}</span>`)
      parts.push(`</footer>`, `</blockquote>`)
    }
    parts.push(`</div>`)
  }
  parts.push(`</section>`)
  return parts.join("")
}

// ---------------------------------------------------------------------------
// pricing
// ---------------------------------------------------------------------------

function renderPricingSection(section: Section, ctx: RenderContext): string {
  const props = SECTION_REGISTRY.pricing.propsSchema.parse(section.props) as PricingSectionProps
  const parts: string[] = [sectionOpenTag(section)]
  if (props.heading) parts.push(`<h2 class="djp-hd">${escapeHtml(props.heading)}</h2>`)
  parts.push(`<div class="djp-pricing-grid">`)
  for (const plan of props.plans) {
    const highlightClass = plan.highlight ? " djp-plan-highlight" : ""
    parts.push(`<article class="djp-plan${highlightClass}">`)
    parts.push(`<h3 class="djp-plan-name">${escapeHtml(plan.name)}</h3>`)
    parts.push(`<p class="djp-plan-price">${escapeHtml(plan.price)}`)
    if (plan.cadence) parts.push(`<span class="djp-plan-cadence">${escapeHtml(plan.cadence)}</span>`)
    parts.push(`</p>`)
    if (plan.blurb) parts.push(`<p class="djp-plan-blurb">${escapeHtml(plan.blurb)}</p>`)
    parts.push(`<ul class="djp-plan-features">`)
    for (const feature of plan.features) {
      parts.push(`<li>${renderIcon("check")}<span>${escapeHtml(feature)}</span></li>`)
    }
    parts.push(`</ul>`)
    parts.push(`<div class="djp-plan-cta">`)
    parts.push(renderCtaButton(plan.cta, "djp-btn djp-btn-primary", ctx))
    parts.push(`</div>`, `</article>`)
  }
  parts.push(`</div>`)
  if (props.footnote) parts.push(`<p class="djp-footnote">${escapeHtml(props.footnote)}</p>`)
  parts.push(`</section>`)
  return parts.join("")
}

// ---------------------------------------------------------------------------
// faq — discriminated union: "live" is the `faq` island, "inline" is a
// <dl>/<dt>/<dd> list — NOT <details>/<summary> (constraint 1).
// ---------------------------------------------------------------------------

function renderFaqSection(section: Section, _ctx: RenderContext): string {
  const props = SECTION_REGISTRY.faq.propsSchema.parse(section.props) as FaqSectionProps
  const parts: string[] = [sectionOpenTag(section)]
  if (props.heading) parts.push(`<h2 class="djp-hd">${escapeHtml(props.heading)}</h2>`)
  if (props.source === "live") {
    parts.push(renderIsland("faq", { pageKey: props.pageKey }))
  } else {
    parts.push(`<dl class="djp-faq-list">`)
    for (const item of props.items) {
      parts.push(`<div class="djp-faq-item">`)
      parts.push(`<dt class="djp-faq-q">${escapeHtml(item.q)}</dt>`)
      parts.push(`<dd class="djp-faq-a">${escapeHtml(item.a)}</dd>`)
      parts.push(`</div>`)
    }
    parts.push(`</dl>`)
  }
  parts.push(`</section>`)
  return parts.join("")
}

// ---------------------------------------------------------------------------
// form — always the `form` island. `heading`/`sub` are the only fields NOT
// part of `formIslandSchema`; everything else in `props` is passed through
// verbatim as the island's props.
// ---------------------------------------------------------------------------

function renderFormSection(section: Section, _ctx: RenderContext): string {
  const props = SECTION_REGISTRY.form.propsSchema.parse(section.props) as FormSectionProps
  const { heading, sub, ...islandProps } = props
  const parts: string[] = [sectionOpenTag(section)]
  if (heading) parts.push(`<h2 class="djp-hd">${escapeHtml(heading)}</h2>`)
  if (sub) parts.push(`<p class="djp-sub">${escapeHtml(sub)}</p>`)
  parts.push(renderIsland("form", islandProps))
  parts.push(`</section>`)
  return parts.join("")
}

// ---------------------------------------------------------------------------
// cta
// ---------------------------------------------------------------------------

function renderCtaSection(section: Section, ctx: RenderContext): string {
  const props = SECTION_REGISTRY.cta.propsSchema.parse(section.props) as CtaSectionProps
  const parts: string[] = [sectionOpenTag(section), `<div class="djp-cta-inner">`]
  parts.push(`<h2 class="djp-hd">${escapeHtml(props.headline)}</h2>`)
  if (props.sub) parts.push(`<p class="djp-sub">${escapeHtml(props.sub)}</p>`)
  parts.push(renderCtaButton(props.cta, "djp-btn djp-btn-primary", ctx))
  parts.push(`</div>`, `</section>`)
  return parts.join("")
}

// ---------------------------------------------------------------------------
// footer
// ---------------------------------------------------------------------------

function renderFooterSection(section: Section, ctx: RenderContext): string {
  const props = SECTION_REGISTRY.footer.propsSchema.parse(section.props) as FooterSectionProps
  const parts: string[] = [sectionOpenTag(section), `<footer class="djp-footer-inner">`]
  parts.push(`<p class="djp-footer-business">${escapeHtml(props.businessName)}</p>`)
  if (props.lines.length > 0) {
    parts.push(`<div class="djp-footer-lines">`)
    for (const line of props.lines) parts.push(`<p class="djp-footer-line">${escapeHtml(line)}</p>`)
    parts.push(`</div>`)
  }
  if (props.links.length > 0) {
    parts.push(`<ul class="djp-footer-links">`)
    for (const link of props.links) parts.push(`<li>${renderCtaButton(link, "djp-footer-link", ctx)}</li>`)
    parts.push(`</ul>`)
  }
  if (props.legal) parts.push(`<p class="djp-footer-legal">${escapeHtml(props.legal)}</p>`)
  parts.push(`</footer>`, `</section>`)
  return parts.join("")
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const SECTION_RENDERERS: Record<SectionKind, (section: Section, ctx: RenderContext) => string> = {
  hero: renderHeroSection,
  bullets: renderBulletsSection,
  steps: renderStepsSection,
  testimonial: renderTestimonialSection,
  pricing: renderPricingSection,
  faq: renderFaqSection,
  form: renderFormSection,
  cta: renderCtaSection,
  footer: renderFooterSection,
}

/**
 * Renders one `Section` to an HTML fragment (a single `<section>` element)
 * for the publish compiler. `doc.ts` (Stage 1.3) is expected to call this
 * once per section and concatenate the results, alongside `styles.ts`'s
 * `THEME_CSS` + per-kind CSS, into the `{html, css}` pair
 * `compileFunnelStep` accepts.
 */
export function renderSection(section: Section, ctx: RenderContext = {}): string {
  return SECTION_RENDERERS[section.kind](section, ctx)
}
