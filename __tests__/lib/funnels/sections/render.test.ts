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
import { z } from "zod"
import postcss from "postcss"
import { compileFunnelStep } from "@/lib/funnels/compile"
import type { FunnelNode } from "@/lib/funnels/compile/types"
import { parseIslandProps } from "@/lib/funnels/islands"
import { escapeHtml, renderSection, type RenderContext } from "@/lib/funnels/sections/render"
import { reassemble } from "@/lib/funnels/sections/doc"
import { THEME_CSS, SECTION_CSS } from "@/lib/funnels/sections/styles"
import {
  SECTION_KINDS,
  SECTION_ICONS,
  SECTION_REGISTRY,
  type Section,
  type SectionDoc,
  type SectionDocTheme,
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

/**
 * The thrown value itself, so a test can assert WHICH error it was.
 * `expect(fn).toThrow()` with no argument passes on any error at all, which is
 * how a test that claims a specific guard ends up proving only "something went
 * wrong somewhere".
 */
function captureError(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  throw new Error("expected the call to throw, but it returned normally")
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
// TONE CONTRAST — the one class of stylesheet bug that is INVISIBLE to every
// other test in this file.
//
// A section with `style.tone: "dark"` repaints its background `var(--primary)`
// and its text `var(--primary-foreground)`. Any per-kind rule that keeps a
// light-mode colour token, or that repaints a panel back to `var(--surface)`
// without restoring a paired foreground, produces text that is the same colour
// as what is behind it. The compiler cannot see it — the markup is valid, the
// CSS parses, `ok: true, warnings: []` — and neither can a test that asserts
// "the stylesheet contains a dark-tone rule", which is why this one does not.
//
// It builds the REAL rendered markup, parses the REAL stylesheet with the same
// postcss the compiler's `scopeCss` uses, runs an actual cascade (specificity,
// then source order) with `Element.matches`, resolves `inherit` and
// `transparent` up the real ancestor chain, and then asserts a PAIRING, not a
// numeric contrast ratio. The pairing is what matters: app/globals.css declares
// these tokens in four scopes with opposite polarity, so any assertion about a
// token's actual lightness is true in one scope and false in the next, whereas
// "--primary-foreground belongs on --primary" is invariant.
//
// MUTANTS THIS KILLS (each verified red by reverting exactly that rule):
//   - deleting the `.djp-plan` / `.djp-quote` / `.djp-bullet-item` panel-lift
//     rules (back to `background: var(--surface)`): plan names, feature rows
//     and quote bodies resolve to --primary-foreground on --surface;
//   - deleting the `.djp-plan-price` / `.djp-quote-name` overrides: --primary
//     on --primary, and --foreground on --primary;
//   - deleting any one of the nine `--muted-foreground` overrides;
//   - deleting the accent-tone eyebrow / icon / button rules or the dark-tone
//     step-counter rule: a shape painted in its own background's token;
//   - a future rule that introduces a colour form this model does not
//     understand (it is reported as UNMODELLED rather than skipped).
// ---------------------------------------------------------------------------

/** Which foreground tokens may legally sit on which background token. */
const READABLE_ON: Record<string, readonly string[]> = {
  // A repainted section takes its own paired foreground. `--accent` is also
  // legal ON `--primary` and vice versa: those are the two BRAND tokens, and
  // globals.css defines them as contrasting in every scope it declares.
  "--primary": ["--primary-foreground", "--accent"],
  "--accent": ["--accent-foreground", "--primary"],
  // The two neutral surfaces share one foreground family, and brand tokens
  // read as accents on them (that is what `.djp-hd` and `.djp-plan-price` are).
  "--background": ["--foreground", "--muted-foreground", "--primary", "--accent"],
  "--surface": ["--foreground", "--muted-foreground", "--primary", "--accent"],
}

const INHERIT = "INHERIT"
const TRANSPARENT = "TRANSPARENT"

/**
 * A colour VALUE reduced to the token that decides contrast.
 *
 * A `color-mix(... N%, transparent)` under 50% is treated as transparent: a
 * low wash does not change which foreground is legible, so whatever is behind
 * it still governs. At or above 50% it becomes its own token. Anything this
 * does not recognise comes back as `UNMODELLED(...)` and fails a test rather
 * than being quietly skipped.
 */
const WASH_RE = /^color-mix\(\s*in\s+[a-z]+\s*,\s*var\((--[a-z-]+)\)\s+(\d+(?:\.\d+)?)%\s*,\s*transparent\s*\)$/i

function colourToken(value: string): string {
  const raw = value.trim()
  if (raw === "inherit" || raw.toLowerCase() === "currentcolor") return INHERIT
  if (raw === "transparent" || raw === "none") return TRANSPARENT
  const mix = raw.match(WASH_RE)
  if (mix) return Number(mix[2]) >= 50 ? mix[1] : TRANSPARENT
  const token = raw.match(/^var\((--[a-z-]+)\s*(?:,[\s\S]*)?\)$/i)
  if (token) return token[1]
  return `UNMODELLED(${raw})`
}

/**
 * A translucent `color-mix(…, transparent)` is a WASH — it exists to blend
 * with whatever is behind it (a photograph, the section's own background), so
 * "same token as the layer behind" is its intended behaviour, not a collision.
 * An opaque fill is a SHAPE, and a shape in its own background's token is gone.
 */
function isWash(value: string): boolean {
  return WASH_RE.test(value.trim())
}

/** (a, b, c) folded into one comparable number, per CSS selector specificity. */
function specificity(selector: string): number {
  const noPseudoEl = selector.replace(/::[a-z-]+/g, "")
  const noAttrs = noPseudoEl.replace(/\[[^\]]*\]/g, "")
  const ids = (noPseudoEl.match(/#[A-Za-z0-9_-]+/g) ?? []).length
  const classes =
    (noAttrs.match(/\.[A-Za-z0-9_-]+/g) ?? []).length +
    (noPseudoEl.match(/\[[^\]]*\]/g) ?? []).length +
    (noAttrs.match(/:(?!:)[a-z-]+/g) ?? []).length
  const types = (noAttrs.match(/(?:^|[\s>+~])([a-z][a-z0-9]*)/g) ?? []).length + (selector.match(/::[a-z-]+/g) ?? []).length
  return ids * 1_000_000 + classes * 1_000 + types
}

interface StyleRule {
  base: string
  pseudo: "before" | null
  spec: number
  order: number
  color?: string
  bg?: string
}

/** The stylesheet flattened to one entry per (selector, declaration block). */
function parseRules(css: string): StyleRule[] {
  const rules: StyleRule[] = []
  let order = 0
  postcss.parse(css).walkRules((rule) => {
    const decls: { color?: string; bg?: string } = {}
    rule.walkDecls((decl) => {
      if (decl.prop === "color") decls.color = decl.value
      if (decl.prop === "background" || decl.prop === "background-color") decls.bg = decl.value
    })
    for (const selector of rule.selectors) {
      order += 1
      if (decls.color === undefined && decls.bg === undefined) continue
      const pseudo = /::before$/.test(selector) ? ("before" as const) : null
      rules.push({
        base: selector.replace(/::[a-z-]+$/, ""),
        pseudo,
        spec: specificity(selector),
        order,
        ...decls,
      })
    }
  })
  return rules
}

interface StyledNode {
  label: string
  el: Element
  pseudo: "before" | null
  parent: StyledNode | null
}

function winning(rules: StyleRule[], node: StyledNode, prop: "color" | "bg"): string | null {
  let best: StyleRule | null = null
  for (const rule of rules) {
    if (rule[prop] === undefined) continue
    if (rule.pseudo !== node.pseudo) continue
    if (!node.el.matches(rule.base)) continue
    if (best === null || rule.spec > best.spec || (rule.spec === best.spec && rule.order > best.order)) best = rule
  }
  return best === null ? null : (best[prop] as string)
}

function resolvedBackground(rules: StyleRule[], node: StyledNode): string {
  for (let cur: StyledNode | null = node; cur !== null; cur = cur.parent) {
    const raw = winning(rules, cur, "bg")
    if (raw === null) continue
    const token = colourToken(raw)
    if (token !== TRANSPARENT && token !== INHERIT) return token
  }
  // Nothing painted anything: the page's own background shows through.
  return "--background"
}

function resolvedColour(rules: StyleRule[], node: StyledNode): string {
  for (let cur: StyledNode | null = node; cur !== null; cur = cur.parent) {
    const raw = winning(rules, cur, "color")
    if (raw === null) continue
    const token = colourToken(raw)
    if (token !== INHERIT) return token
  }
  return "--foreground"
}

/** True when this element owns a text node of its own, i.e. it paints words. */
function hasOwnText(el: Element): boolean {
  return Array.from(el.childNodes).some((child) => child.nodeType === 3 && (child.textContent ?? "").trim() !== "")
}

function describeNode(el: Element, pseudo: "before" | null): string {
  const cls = el.getAttribute("class") ?? ""
  return `${el.tagName.toLowerCase()}${cls ? `.${cls.trim().split(/\s+/).join(".")}` : ""}${pseudo ? `::${pseudo}` : ""}`
}

/** Every node the cascade actually reaches, real elements plus ::before. */
function styledNodes(root: Element, rules: StyleRule[]): StyledNode[] {
  const byElement = new Map<Element, StyledNode>()
  const nodes: StyledNode[] = []
  const rootNode: StyledNode = { label: describeNode(root, null), el: root, pseudo: null, parent: null }
  byElement.set(root, rootNode)
  nodes.push(rootNode)
  for (const el of Array.from(root.querySelectorAll("*"))) {
    const parent = el.parentElement === null ? null : (byElement.get(el.parentElement) ?? null)
    const node: StyledNode = { label: describeNode(el, null), el, pseudo: null, parent }
    byElement.set(el, node)
    nodes.push(node)
  }
  const pseudoSelectors = new Set(rules.filter((rule) => rule.pseudo === "before").map((rule) => rule.base))
  for (const node of [...nodes]) {
    for (const selector of pseudoSelectors) {
      if (!node.el.matches(selector)) continue
      nodes.push({ label: describeNode(node.el, "before"), el: node.el, pseudo: "before", parent: node })
      break
    }
  }
  return nodes
}

/** Props that populate EVERY optional text field, so no class goes unrendered. */
const TONE_PROPS_BY_KIND: Record<SectionKind, Record<string, unknown>> = {
  hero: {
    eyebrow: "New block",
    headline: "Get stronger, faster",
    sub: "An eight-week rotational power program",
    media: { kind: "image", src: "/hero.jpg", alt: "Athlete training", w: 1200, h: 800 },
    primaryCta: urlCta,
    secondaryCta: bookingCta,
  },
  bullets: {
    heading: "Why athletes choose us",
    intro: "The short version",
    items: [
      { title: "Fast results", body: "See progress in weeks", icon: "bolt" },
      { title: "Safe programming", body: "Every block is screened first", icon: "shield" },
    ],
  },
  steps: {
    heading: "How it works",
    intro: "Three steps, no surprises",
    steps: [
      { title: "Book a call", body: "A fifteen-minute fit check" },
      { title: "Get your plan", body: "Built from your own numbers" },
    ],
  },
  testimonial: {
    source: "quote",
    quotes: [{ quote: "Best program I have done.", name: "Alex", detail: "Age 16, sprinter" }],
  },
  pricing: {
    heading: "Pick your plan",
    plans: [
      {
        name: "Starter",
        price: "$99",
        cadence: "/mo",
        blurb: "Everything you need to begin",
        features: ["Weekly check-ins", "Form review"],
        cta: urlCta,
      },
    ],
    footnote: "Cancel anytime.",
  },
  faq: {
    heading: "Questions",
    source: "inline",
    items: [{ q: "Do you offer refunds?", a: "Yes, within 14 days." }],
  },
  form: {
    heading: "Get your free guide",
    sub: "We email it instantly",
    formKey: "optin",
    fields: [{ name: "email", label: "Email", type: "email", required: true }],
  },
  cta: { headline: "Spots are limited", sub: "Summer camp starts June 1", cta: urlCta },
  footer: {
    businessName: "DJP Athlete",
    lines: ["Tampa, FL", "hello@darrenjpaul.com"],
    links: [{ label: "Privacy", target: { kind: "url", href: "/privacy" } }],
    legal: "© 2026 DJP Athlete. All rights reserved.",
  },
}

/**
 * Every (kind, variant) the registry declares, plus the hero's invalid-media
 * placeholder, which no other fixture reaches.
 */
function toneCases(): Array<{ label: string; section: Section }> {
  const cases = SECTION_KINDS.flatMap((kind) =>
    SECTION_REGISTRY[kind].variants.map((variant) => ({
      label: `${kind}/${variant}`,
      section: { id: "sx", kind, variant, style: {}, props: TONE_PROPS_BY_KIND[kind] } as Section,
    })),
  )
  cases.push({
    label: "hero/split (invalid media placeholder)",
    section: {
      id: "sx",
      kind: "hero",
      variant: "split",
      style: {},
      props: { ...TONE_PROPS_BY_KIND.hero, media: { kind: "image", src: "hero.jpg", alt: "Athlete", w: 800, h: 600 } },
    },
  })
  return cases
}

interface ContrastReading {
  case: string
  node: string
  colour: string
  background: string
}

/**
 * Every text-bearing node in every kind/variant, at one tone.
 *
 * Run at ALL FOUR tones, not just the two that repaint with a brand token.
 * `muted` repaints too — `var(--surface)`, the same token five per-kind panels
 * paint THEMSELVES — and checking only `accent`/`dark` is precisely how that
 * collision survived the first tone pass.
 */
function readContrast(tone: NonNullable<Section["style"]["tone"]>): ContrastReading[] {
  const readings: ContrastReading[] = []
  for (const { label, section } of toneCases()) {
    const html = renderSection({ ...section, style: { ...section.style, tone } })
    const rules = parseRules(fullCss(section.kind))
    const root = document.createElement("div")
    root.id = "djp-funnel-root"
    root.innerHTML = html
    document.body.appendChild(root)
    try {
      for (const node of styledNodes(root, rules)) {
        // Text-bearing nodes, plus any node a colour rule targets: an element
        // like <footer class="djp-quote-attribution"> holds no text of its own
        // but is the inheritance SOURCE for the spans that do.
        if (node.pseudo === null && !hasOwnText(node.el) && winning(rules, node, "color") === null) continue
        readings.push({
          case: label,
          node: node.label,
          colour: resolvedColour(rules, node),
          background: resolvedBackground(rules, node),
        })
      }
    } finally {
      root.remove()
    }
  }
  return readings
}

const ALL_TONES = ["default", "muted", "accent", "dark"] as const

describe("tone contrast: no per-kind colour is left behind by the tone knob", () => {
  it.each(ALL_TONES)(
    "every text node in every kind/variant resolves to a PAIRED colour on tone '%s'",
    (tone) => {
      const readings = readContrast(tone)
      const violations = readings.filter((reading) => {
        const allowed = READABLE_ON[reading.background]
        return allowed === undefined || !allowed.includes(reading.colour)
      })
      expect(violations, `unpaired colour/background: ${JSON.stringify(violations, null, 2)}`).toEqual([])
    },
  )

  it.each(ALL_TONES)(
    "no element on tone '%s' paints its own background in the token of the background behind it",
    (tone) => {
      const collisions: string[] = []
      for (const { label, section } of toneCases()) {
        const html = renderSection({ ...section, style: { ...section.style, tone } })
        const rules = parseRules(fullCss(section.kind))
        const root = document.createElement("div")
        root.id = "djp-funnel-root"
        root.innerHTML = html
        document.body.appendChild(root)
        try {
          for (const node of styledNodes(root, rules)) {
            const own = winning(rules, node, "bg")
            if (own === null || isWash(own)) continue
            const ownToken = colourToken(own)
            if (ownToken === TRANSPARENT || ownToken === INHERIT) continue
            if (node.parent === null) continue
            const behind = resolvedBackground(rules, node.parent)
            if (ownToken === behind) collisions.push(`${label}: ${node.label} paints ${ownToken} on ${behind}`)
          }
        } finally {
          root.remove()
        }
      }
      expect(collisions, collisions.join("\n")).toEqual([])
    },
  )

  // Without this the two tests above pass vacuously the moment a fixture stops
  // rendering a class — which is exactly how a "dark tone is covered" claim
  // gets made about a stylesheet nobody checked.
  it("actually reaches every element the tone pass exists for", () => {
    const readings = readContrast("dark")
    const seen = readings.map((reading) => reading.node).join(" ")
    for (const cls of [
      "djp-bullet-text",
      "djp-step-text",
      "djp-quote-attribution",
      "djp-plan-blurb",
      "djp-plan-cadence",
      "djp-footnote",
      "djp-faq-a",
      "djp-footer-line",
      "djp-footer-legal",
      "djp-plan-price",
      "djp-quote-name",
      "djp-eyebrow",
      "djp-media-invalid",
    ]) {
      expect(seen, `no fixture rendered .${cls}, so nothing was asserted about it`).toContain(cls)
    }
    // ...and the counter badges, which are ::before pseudo-elements.
    expect(seen).toContain("djp-step-item::before")
    expect(seen).toContain("djp-bullet-item::before")
  })

  it("understands every colour value the stylesheet actually uses", () => {
    // A future `oklch(...)` literal, a hex, or an unrecognised color-mix would
    // otherwise resolve to a token nothing in READABLE_ON matches — which would
    // fail loudly here rather than being silently waved through as "different
    // from the background".
    const values: string[] = []
    for (const kind of SECTION_KINDS) {
      for (const rule of parseRules(fullCss(kind))) {
        if (rule.color !== undefined) values.push(rule.color)
        if (rule.bg !== undefined) values.push(rule.bg)
      }
    }
    expect(values.length).toBeGreaterThan(20)
    const unmodelled = values.map(colourToken).filter((token) => token.startsWith("UNMODELLED"))
    expect(unmodelled, unmodelled.join(", ")).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// PAGE-LEVEL TONE CONTRAST — the SAME harness above, one level up, driven by
// the real `reassemble()` instead of `THEME_CSS + SECTION_CSS[kind]`.
//
// WHY THIS EXISTS AS A SEPARATE RUN. Everything above compiles one section
// with one kind's CSS. `doc.ts` adds two things no per-section run can see:
//   - a page WRAPPER (`.djp-page[data-page-tone]`) that repaints the ground
//     underneath every section, and
//   - a page ACCENT rule (`.djp-page[data-page-accent="primary"] .djp-btn-primary`)
//     appended AFTER both THEME_CSS and the per-kind CSS, so it outranks them
//     on source order at equal specificity and outranks THEME_CSS's own
//     `.djp-btn-primary` outright.
// Both are cross-FILE interactions, and both shipped broken:
//
//   B1 the wrapper painted `var(--primary)` and relied on INHERITANCE to carry
//      `--primary-foreground` down. It cannot: `${ROOT} .djp-s { color:
//      var(--foreground) }` is a DIRECT declaration on the section, and a
//      direct declaration always beats an inherited value no matter how
//      specific the ancestor's rule was. Every default-tone section on a dark
//      page painted `--foreground` on `--primary` — a whole unreadable page.
//   B2 `theme.accent:"primary"` painted `.djp-btn-primary` `var(--primary)`,
//      the same token a dark section paints its background, so the page's one
//      primary button vanished into its own section.
//
// MUTANTS THIS KILLS (each verified red, with the collected test count
// unchanged so a non-compiling mutant cannot masquerade as an uncaught one):
//   - dropping doc.ts's per-section dark-tone promotion (`sectionForPage`):
//     every default-tone section on a dark page reports `--foreground` and
//     nine-plus `--muted-foreground` readings on `--primary`;
//   - dropping doc.ts's `[data-page-accent="primary"] .djp-s[data-tone="dark"]
//     .djp-btn-primary` override: the button paints `--primary` on `--primary`.
// ---------------------------------------------------------------------------

/** The four page themes; `radius` cannot affect colour, so one value is enough. */
const PAGE_THEMES: readonly SectionDocTheme[] = [
  { tone: "light", accent: "accent", radius: "soft" },
  { tone: "light", accent: "primary", radius: "soft" },
  { tone: "dark", accent: "accent", radius: "soft" },
  { tone: "dark", accent: "primary", radius: "soft" },
]

const SECTION_TONES = ["default", "muted", "accent", "dark"] as const

/**
 * One doc holding EVERY (kind, variant) case at one section tone. `toneCases()`
 * yields 20, under `sectionDocSchema`'s 24-section cap, so a single
 * `reassemble()` call exercises the whole surface at once — including the
 * per-kind CSS selection, which is part of what decides the cascade.
 */
function pageDoc(theme: SectionDocTheme, tone: (typeof SECTION_TONES)[number]): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme,
    sections: toneCases().map(({ section }, index) => ({
      ...section,
      id: `s${index}`,
      // "default" means the author set NO tone at all — the case B1 broke.
      style: tone === "default" ? section.style : { ...section.style, tone },
    })),
  }
}

function themeLabel(theme: SectionDocTheme): string {
  return `page ${theme.tone}/${theme.accent}`
}

/** Runs one whole reassembled page through the cascade model above. */
function withPage<T>(
  theme: SectionDocTheme,
  tone: (typeof SECTION_TONES)[number],
  fn: (nodes: StyledNode[], rules: StyleRule[]) => T,
): T {
  const { html, css } = reassemble(pageDoc(theme, tone))
  const rules = parseRules(css)
  const root = document.createElement("div")
  root.id = "djp-funnel-root"
  root.innerHTML = html
  document.body.appendChild(root)
  try {
    return fn(styledNodes(root, rules), rules)
  } finally {
    root.remove()
  }
}

/** `hero/split#s0` — enough to point at the exact fixture that failed. */
function nodeAddress(node: StyledNode): string {
  const section = node.el.closest(".djp-s")
  const kindClass = Array.from(section?.classList ?? []).find((cls) => cls.startsWith("djp-s-")) ?? "page"
  return `${kindClass}#${section?.id ?? "-"} ${node.label}`
}

function readPageContrast(
  theme: SectionDocTheme,
  tone: (typeof SECTION_TONES)[number],
): ContrastReading[] {
  return withPage(theme, tone, (nodes, rules) => {
    const readings: ContrastReading[] = []
    for (const node of nodes) {
      if (node.pseudo === null && !hasOwnText(node.el) && winning(rules, node, "color") === null) continue
      readings.push({
        case: `${themeLabel(theme)} + section tone ${tone}`,
        node: nodeAddress(node),
        colour: resolvedColour(rules, node),
        background: resolvedBackground(rules, node),
      })
    }
    return readings
  })
}

describe("page tone contrast: reassemble()'s page wrapper and page accent", () => {
  const matrix = PAGE_THEMES.flatMap((theme) =>
    SECTION_TONES.map((tone) => ({ theme, tone, label: `${themeLabel(theme)} + section tone ${tone}` })),
  )

  it.each(matrix)("every text node resolves to a PAIRED colour on $label", ({ theme, tone }) => {
    const readings = readPageContrast(theme, tone)
    const violations = readings.filter((reading) => {
      const allowed = READABLE_ON[reading.background]
      return allowed === undefined || !allowed.includes(reading.colour)
    })
    expect(violations, `unpaired colour/background: ${JSON.stringify(violations, null, 2)}`).toEqual([])
  })

  it.each(matrix)("no SHAPE is painted in the token of the ground behind it on $label", ({ theme, tone }) => {
    const collisions = withPage(theme, tone, (nodes, rules) => {
      const found: string[] = []
      for (const node of nodes) {
        // A SECTION's own band is not a shape. Page tone exists precisely so a
        // section that did not choose a tone stops interrupting the page, so a
        // band matching the page ground is the feature, not a lost element.
        // Everything INSIDE a section still has to stay distinguishable.
        if (node.pseudo === null && node.el.classList.contains("djp-s")) continue
        const own = winning(rules, node, "bg")
        if (own === null || isWash(own)) continue
        const ownToken = colourToken(own)
        if (ownToken === TRANSPARENT || ownToken === INHERIT) continue
        if (node.parent === null) continue
        const behind = resolvedBackground(rules, node.parent)
        if (ownToken === behind) found.push(`${nodeAddress(node)} paints ${ownToken} on ${behind}`)
      }
      return found
    })
    expect(collisions, collisions.join("\n")).toEqual([])
  })

  // B2, named on its own: the generic collision test would also catch it, but a
  // failure there reads as "some shape somewhere", and this pairing is the one
  // that makes a page's single most important element disappear.
  it("theme.accent 'primary' keeps the primary button visible on a dark section", () => {
    for (const pageTone of ["light", "dark"] as const) {
      withPage({ tone: pageTone, accent: "primary", radius: "soft" }, "dark", (nodes, rules) => {
        const buttons = nodes.filter((node) => node.pseudo === null && node.el.classList.contains("djp-btn-primary"))
        expect(buttons.length, "no fixture rendered a .djp-btn-primary").toBeGreaterThan(0)
        for (const button of buttons) {
          const own = colourToken(winning(rules, button, "bg") ?? "transparent")
          const behind = resolvedBackground(rules, button.parent!)
          expect(own, `${nodeAddress(button)} on a ${pageTone} page`).not.toBe(behind)
          const allowed = READABLE_ON[own] ?? []
          expect(allowed, `${nodeAddress(button)} label colour`).toContain(resolvedColour(rules, button))
        }
      })
    }
  })

  // Anti-vacuity. Without this, every assertion above passes the moment
  // `pageDoc` stops producing the sections it claims to produce.
  it("actually reaches the page wrapper, every kind, and the elements B1/B2 broke", () => {
    const readings = readPageContrast({ tone: "dark", accent: "primary", radius: "soft" }, "default")
    const seen = readings.map((reading) => reading.node).join(" ")
    expect(seen).toContain("djp-page")
    for (const kind of SECTION_KINDS) {
      expect(seen, `no fixture rendered a ${kind} section`).toContain(`djp-s-${kind}#`)
    }
    for (const cls of ["djp-btn-primary", "djp-plan-price", "djp-faq-a", "djp-footer-legal", "djp-bullet-text"]) {
      expect(seen, `no fixture rendered .${cls}, so nothing was asserted about it`).toContain(cls)
    }
    expect(readings.length).toBeGreaterThan(80)
  })

  // The page CSS is a THIRD string (THEME_CSS + per-kind + doc.ts's own rules);
  // an unrecognised colour there would resolve to a token nothing in
  // READABLE_ON matches and be waved through as "different from the background".
  it("understands every colour value reassemble() actually emits", () => {
    const values: string[] = []
    for (const theme of PAGE_THEMES) {
      const { css } = reassemble(pageDoc(theme, "default"))
      for (const rule of parseRules(css)) {
        if (rule.color !== undefined) values.push(rule.color)
        if (rule.bg !== undefined) values.push(rule.bg)
      }
    }
    expect(values.length).toBeGreaterThan(20)
    const unmodelled = values.map(colourToken).filter((token) => token.startsWith("UNMODELLED"))
    expect(unmodelled, unmodelled.join(", ")).toEqual([])
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

  // THE PREMISE OF THIS TEST CHANGED IN STAGE 1.6 FIX ROUND 1 (H1). Read this
  // before "simplifying" anything it touches.
  //
  // BEFORE: `ctaTargetSchema.href` RESTATED the link rule as `^(\/|https:\/\/)`,
  // which ACCEPTS "//evil.example" — it only checks for ONE leading slash, and a
  // protocol-relative url reads as a path but navigates off-site on the page's
  // own scheme. So such a doc was schema-VALID, and the only thing between it
  // and a live-looking dead button (safeUrl drops the href with zero warning)
  // was the `SAFE_LINK` gate in `renderCtaTarget`'s `url` branch. That degrade
  // to a disabled placeholder is what this test used to pin.
  //
  // AFTER: `href` ASKS `SAFE_LINK` instead of restating it, so "//evil.example"
  // is rejected by the schema itself. No schema-valid document can contain one,
  // and `renderCtaSection` re-parses props through
  // `SECTION_REGISTRY.cta.propsSchema` before rendering — so the throw below is
  // the new guarantee, and it is strictly stronger than the old placeholder:
  // the value never gets far enough to need degrading.
  //
  // (Both references above named a LINE NUMBER until this cleanup, and both had
  // already rotted — ":239" and ":491" pointed at `renderCtaTarget`'s switch and
  // at `renderFormSection` respectively. Name the function; functions move with
  // their names, line numbers do not.)
  //
  // *** DO NOT DELETE render.ts's SAFE_LINK GATE ON THE GROUNDS THAT NOTHING
  // EXERCISES IT. *** It is defence in depth, and it is now UNREACHABLE through
  // the public API BY CONSTRUCTION — `renderCtaTarget` is not exported, and all
  // nine `render*Section` functions parse props before touching them, so there
  // is no way to hand the gate an href the schema would reject. (I tried: a
  // cast past the schema does not help, because the renderer uses the PARSED
  // props, not the argument.) Its remaining job is to survive a future caller
  // that skips the parse — which is precisely the shape of the bug that put it
  // there.
  //
  // The assertion below is also the pin for the parse-first property that whole
  // unreachability argument rests on: drop the `propsSchema.parse` from
  // `renderCtaSection` and this goes red rather than silently handing the gate
  // its old job back.
  it("url with a protocol-relative href is unrepresentable — the schema rejects it, so the renderer never sees it", () => {
    // A bare `.toThrow()` here would be satisfied by ANY error: a typo in the
    // fixture, a renderer crash, a postcss failure inside `compileSection` —
    // all of which would leave the claimed property completely unverified
    // while the test stayed green. The matcher names the LAYER (a Zod
    // rejection, not a runtime error) and the FIELD (this href, not some other
    // prop), so only the real guarantee satisfies it.
    const caught = captureError(() => compileSection(ctaCta({ kind: "url", href: "//evil.example/steal-me" })))
    expect(caught).toBeInstanceOf(z.ZodError)
    const issues = (caught as z.ZodError).issues
    expect(issues.map((issue) => issue.path.join("."))).toContain("cta.target.href")
    expect(JSON.stringify(issues)).toContain("Must be a site path or an https URL")
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
    // Same reasoning as the protocol-relative-href test above: pinned to a Zod
    // rejection OF THE STYLE KNOB. A bare `.toThrow()` would also pass if
    // `renderSection` blew up for an unrelated reason, which is precisely the
    // outcome that would look like "the guard works" while the guard was gone.
    const caught = captureError(() => renderSection(section))
    expect(caught).toBeInstanceOf(z.ZodError)
    expect((caught as z.ZodError).issues.map((issue) => issue.path.join("."))).toContain("headline")
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
