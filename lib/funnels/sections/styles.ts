// lib/funnels/sections/styles.ts — the section stylesheet.
//
// Hand-authored, flat, ~7-10 KB. `doc.ts` (Stage 1.3) concatenates
// `THEME_CSS + SECTION_CSS[kind]` for every kind actually used in a doc and
// hands the result to `compileFunnelStep` as the page's `css`.
//
// Two hard rules from the plan (§2 "Three constraints the renderer obeys by
// construction", lines 202-234), both load-bearing:
//
// 1. FLAT CSS, NEVER NESTED. `walkRules` (compile/css-scope.ts:42) recurses
//    into nested rules and prefixes them too, producing something like
//    `#djp-funnel-root &:hover`, which per CSS Nesting can never match. Every
//    rule below is a single flat selector list — descendant combinators
//    (`.a .b`) are fine, native CSS nesting syntax (`.a { &:hover {...} }`)
//    is never used.
// 2. Colour via `var(--primary)` / `var(--accent)` / `var(--surface)`
//    (CLAUDE.md), never hex. Their paired `-foreground` tokens
//    (`--primary-foreground`, `--accent-foreground`) are used the same way
//    `app/globals.css` itself already uses them, for readable text on a
//    coloured background — not a new convention. Neutral UI tokens already
//    on bare `:root` (`--foreground`, `--muted-foreground`, `--surface`) are
//    used for default text/background, exactly as `components/ui/*` and
//    CLAUDE.md's own table-style tokens (`text-muted-foreground`,
//    `border-border`) already do elsewhere in this app.
//
// Font caveat (plan §2 "The stylesheet"): `--font-heading` / `--font-body` /
// `--font-mono` are declared inside `@theme inline {}` (globals.css:82-86),
// NOT on bare `:root`, so nothing guarantees Tailwind v4 emits them as real
// custom properties reachable from here. Every font-family below uses the
// full fallback chain the plan specifies, ending in the next/font variable
// that IS guaranteed on `<body>` (app/layout.tsx) and then a system fallback.
//
// `--djp-radius` is this file's one invented custom property: a single knob
// every rounded corner below reads from, defaulting to a "soft" radius here.
// It is deliberately NOT wired to `SectionDoc.theme.radius` — that's a
// page-level concern for whatever composes the final stylesheet (Stage 1.3),
// which can append one more rule (`#djp-funnel-root { --djp-radius: ... }`)
// AFTER this file's output to override the default via normal CSS cascade,
// with no change needed here.

import type { SectionKind } from "@/lib/funnels/sections/registry"

const ROOT = "#djp-funnel-root"

// ---------------------------------------------------------------------------
// Icons — six flat SVGs, URL-encoded inline (constraint 1: never <svg> in the
// markup itself, never a data:image/svg+xml <img> — safeUrl only allows
// raster mime types for images). Drawn in `fill='white'`/`stroke='white'` on
// purpose: CSS `mask-image` defaults to LUMINANCE masking, so a black shape
// on a transparent background would mask itself almost fully invisible
// (opaque + near-zero luminance = near-zero mask value). White shapes give a
// mask value of ~1 wherever the icon is drawn, letting `background-color:
// currentColor` on `.djp-ic` paint the icon in whatever colour the
// surrounding CSS sets — never a hardcoded colour, brand or otherwise.
// ---------------------------------------------------------------------------

const ICON_DATA: Record<string, string> = {
  check:
    "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E",
  star: "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white'%3E%3Cpath d='M12 2 14.9 8.6 22 9.3 16.6 14 18.2 21 12 17.3 5.8 21 7.4 14 2 9.3 9.1 8.6z'/%3E%3C/svg%3E",
  bolt: "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white'%3E%3Cpath d='M13 2 3 14h7l-1 8 10-12h-7z'/%3E%3C/svg%3E",
  shield:
    "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white'%3E%3Cpath d='M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z'/%3E%3C/svg%3E",
  clock:
    "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='9'/%3E%3Cpath d='M12 7v5l3 3'/%3E%3C/svg%3E",
  arrow:
    "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12h14M13 6l6 6-6 6'/%3E%3C/svg%3E",
}

function iconRule(name: string, encoded: string): string {
  const url = `url("data:image/svg+xml,${encoded}")`
  return `${ROOT} .djp-ic-${name} { -webkit-mask-image: ${url}; mask-image: ${url}; }`
}

const ICON_CSS = Object.entries(ICON_DATA)
  .map(([name, encoded]) => iconRule(name, encoded))
  .join("\n")

// ---------------------------------------------------------------------------
// THEME_CSS — base reset, the four shared style knobs (`data-h`/`data-align`/
// `data-tone`/`data-pad`, identical across every kind so they only need to be
// defined once), fonts, buttons, and icon masks.
// ---------------------------------------------------------------------------

export const THEME_CSS = `
${ROOT} { --djp-radius: 0.6rem; }
${ROOT}, ${ROOT} *, ${ROOT} *::before, ${ROOT} *::after { box-sizing: border-box; }

${ROOT} .djp-s {
  font-family: var(--font-body, var(--font-lexend-deca), "Lexend Deca", system-ui, sans-serif);
  color: var(--foreground);
  padding-block: 3rem;
  padding-inline: 1.25rem;
}
${ROOT} .djp-s > * { max-width: 72rem; margin-inline: auto; }

/* pad knob */
${ROOT} .djp-s[data-pad="tight"] { padding-block: 1.5rem; }
${ROOT} .djp-s[data-pad="normal"] { padding-block: 3rem; }
${ROOT} .djp-s[data-pad="roomy"] { padding-block: 5.5rem; }

/* align knob */
${ROOT} .djp-s[data-align="left"] { text-align: left; }
${ROOT} .djp-s[data-align="center"] { text-align: center; }
${ROOT} .djp-s[data-align="center"] .djp-sub { margin-inline: auto; }

/* tone knob — the three brand tokens CLAUDE.md names, plus their paired
   -foreground tokens for contrast (app/globals.css already pairs them this
   way; this is not a new convention). */
${ROOT} .djp-s[data-tone="muted"] { background: var(--surface); }
${ROOT} .djp-s[data-tone="accent"] { background: var(--accent); color: var(--accent-foreground); }
${ROOT} .djp-s[data-tone="dark"] { background: var(--primary); color: var(--primary-foreground); }
${ROOT} .djp-s[data-tone="accent"] .djp-hd,
${ROOT} .djp-s[data-tone="dark"] .djp-hd { color: inherit; }
${ROOT} .djp-s[data-tone="accent"] .djp-sub,
${ROOT} .djp-s[data-tone="dark"] .djp-sub { color: inherit; opacity: 0.85; }

/* headline knob */
${ROOT} .djp-hd {
  font-family: var(--font-heading, var(--font-lexend-exa), "Lexend Exa", system-ui, sans-serif);
  font-weight: 700;
  line-height: 1.1;
  color: var(--primary);
  margin: 0 0 0.75rem;
  font-size: clamp(1.5rem, 3.4vw, 2.25rem);
}
${ROOT} .djp-s[data-h="sm"] .djp-hd { font-size: clamp(1.25rem, 2.6vw, 1.75rem); }
${ROOT} .djp-s[data-h="md"] .djp-hd { font-size: clamp(1.5rem, 3.4vw, 2.25rem); }
${ROOT} .djp-s[data-h="lg"] .djp-hd { font-size: clamp(2rem, 4.4vw, 3rem); }
${ROOT} .djp-s[data-h="xl"] .djp-hd { font-size: clamp(2.5rem, 6vw, 4.25rem); }

${ROOT} .djp-sub {
  font-size: 1.05rem;
  line-height: 1.6;
  color: var(--muted-foreground);
  margin: 0 0 1.5rem;
  max-width: 46rem;
}

${ROOT} .djp-eyebrow {
  font-family: var(--font-mono, var(--font-jetbrains-mono), "JetBrains Mono", ui-monospace, monospace);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.8rem;
  color: var(--accent);
  margin: 0 0 0.5rem;
}

/* buttons — shared across every CTA site: hero, pricing, cta, footer */
${ROOT} .djp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.75rem 1.5rem;
  border-radius: var(--djp-radius, 0.6rem);
  font-family: var(--font-body, var(--font-lexend-deca), "Lexend Deca", system-ui, sans-serif);
  font-weight: 600;
  text-decoration: none;
  border: 2px solid transparent;
  cursor: pointer;
}
${ROOT} .djp-btn-primary { background: var(--accent); color: var(--accent-foreground); }
${ROOT} .djp-btn-secondary { background: transparent; color: inherit; border-color: currentColor; }
${ROOT} .djp-btn-disabled { opacity: 0.5; cursor: not-allowed; pointer-events: none; }
${ROOT} .djp-footer-link { color: inherit; text-decoration: underline; text-underline-offset: 2px; }

/* icons */
${ROOT} .djp-ic {
  display: inline-block;
  width: 1.1em;
  height: 1.1em;
  background-color: currentColor;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  vertical-align: -0.15em;
  flex-shrink: 0;
}
${ICON_CSS}
`.trim()

// ---------------------------------------------------------------------------
// Per-kind CSS — layout only. Every knob response (pad/align/tone/headline)
// already lives in THEME_CSS above, scoped to the shared `.djp-s` class, so
// these only need to cover what's structurally different per kind: grids,
// flex direction, card chrome.
// ---------------------------------------------------------------------------

export const HERO_CSS = `
${ROOT} .djp-s-hero .djp-hero-inner { display: flex; align-items: center; gap: 2.5rem; flex-wrap: wrap; }
${ROOT} .djp-s-hero .djp-hero-copy { flex: 1 1 24rem; }
${ROOT} .djp-s-hero .djp-hero-media {
  flex: 1 1 22rem;
  max-width: 100%;
  height: auto;
  border: 0;
  border-radius: var(--djp-radius, 0.6rem);
  aspect-ratio: 16 / 9;
}
${ROOT} .djp-s-hero .djp-hero-ctas { display: flex; gap: 0.9rem; flex-wrap: wrap; margin-top: 0.5rem; }
${ROOT} .djp-s-hero.djp-v-centered .djp-hero-inner { flex-direction: column; text-align: center; }
${ROOT} .djp-s-hero.djp-v-centered .djp-hero-ctas { justify-content: center; }
${ROOT} .djp-s-hero.djp-v-image-bg { position: relative; overflow: hidden; }
${ROOT} .djp-s-hero.djp-v-image-bg .djp-hero-media {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 0;
  z-index: 0;
}
${ROOT} .djp-s-hero.djp-v-image-bg .djp-hero-copy {
  position: relative;
  z-index: 1;
  background: color-mix(in oklch, var(--background) 78%, transparent);
  padding: 2rem;
  border-radius: var(--djp-radius, 0.6rem);
}
`.trim()

export const BULLETS_CSS = `
${ROOT} .djp-s-bullets .djp-bullets-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 1.25rem;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
}
${ROOT} .djp-s-bullets .djp-bullet-item { display: flex; gap: 0.85rem; align-items: flex-start; }
${ROOT} .djp-s-bullets .djp-bullet-title {
  font-family: var(--font-heading, var(--font-lexend-exa), "Lexend Exa", system-ui, sans-serif);
  font-size: 1.05rem;
  margin: 0 0 0.25rem;
}
${ROOT} .djp-s-bullets .djp-bullet-text { margin: 0; color: var(--muted-foreground); font-size: 0.95rem; }
${ROOT} .djp-s-bullets .djp-ic { color: var(--accent); margin-top: 0.2rem; }

${ROOT} .djp-s-bullets.djp-v-cards .djp-bullet-item {
  flex-direction: column;
  background: var(--surface);
  border-radius: var(--djp-radius, 0.6rem);
  padding: 1.5rem;
}
${ROOT} .djp-s-bullets.djp-v-list .djp-bullets-list { grid-template-columns: 1fr; }
${ROOT} .djp-s-bullets.djp-v-numbered .djp-bullets-list { counter-reset: djp-bul; grid-template-columns: 1fr; }
${ROOT} .djp-s-bullets.djp-v-numbered .djp-bullet-item { counter-increment: djp-bul; }
${ROOT} .djp-s-bullets.djp-v-numbered .djp-ic { display: none; }
${ROOT} .djp-s-bullets.djp-v-numbered .djp-bullet-item::before {
  content: counter(djp-bul);
  flex-shrink: 0;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-foreground);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.85rem;
}
`.trim()

export const STEPS_CSS = `
${ROOT} .djp-s-steps .djp-steps-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 1.5rem;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  counter-reset: djp-step;
}
${ROOT} .djp-s-steps .djp-step-item { counter-increment: djp-step; position: relative; padding-left: 3rem; }
${ROOT} .djp-s-steps .djp-step-item::before {
  content: counter(djp-step);
  position: absolute;
  left: 0;
  top: 0;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 999px;
  background: var(--primary);
  color: var(--primary-foreground);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-family: var(--font-heading, var(--font-lexend-exa), "Lexend Exa", system-ui, sans-serif);
}
${ROOT} .djp-s-steps .djp-step-title {
  margin: 0 0 0.25rem;
  font-family: var(--font-heading, var(--font-lexend-exa), "Lexend Exa", system-ui, sans-serif);
  font-size: 1.05rem;
}
${ROOT} .djp-s-steps .djp-step-text { margin: 0; color: var(--muted-foreground); font-size: 0.95rem; }

${ROOT} .djp-s-steps.djp-v-timeline .djp-steps-list { grid-template-columns: 1fr; gap: 0; }
${ROOT} .djp-s-steps.djp-v-timeline .djp-step-item {
  padding-bottom: 2rem;
  padding-left: 2.4rem;
  margin-left: 1.1rem;
  border-left: 2px solid var(--surface);
}
${ROOT} .djp-s-steps.djp-v-timeline .djp-step-item::before { left: -1.1rem; width: 2.2rem; height: 2.2rem; }
${ROOT} .djp-s-steps.djp-v-timeline .djp-step-item:last-child { border-left-color: transparent; }
`.trim()

export const TESTIMONIAL_CSS = `
${ROOT} .djp-s-testimonial .djp-testimonial-grid {
  display: grid;
  gap: 1.5rem;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
}
${ROOT} .djp-s-testimonial .djp-quote {
  margin: 0;
  border: 0;
  background: var(--surface);
  border-radius: var(--djp-radius, 0.6rem);
  padding: 1.5rem;
}
${ROOT} .djp-s-testimonial .djp-quote-text { margin: 0 0 1rem; font-size: 1.05rem; line-height: 1.5; }
${ROOT} .djp-s-testimonial .djp-quote-attribution {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
  font-size: 0.9rem;
  color: var(--muted-foreground);
}
${ROOT} .djp-s-testimonial .djp-quote-name { font-weight: 700; color: var(--foreground); }
${ROOT} .djp-s-testimonial.djp-v-stack .djp-testimonial-grid {
  grid-template-columns: 1fr;
  max-width: 42rem;
  margin-inline: auto;
}
`.trim()

export const PRICING_CSS = `
${ROOT} .djp-s-pricing .djp-pricing-grid {
  display: grid;
  gap: 1.5rem;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  align-items: stretch;
}
${ROOT} .djp-s-pricing .djp-plan {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  background: var(--surface);
  border: 2px solid transparent;
  border-radius: var(--djp-radius, 0.6rem);
  padding: 2rem;
}
${ROOT} .djp-s-pricing .djp-plan-highlight { border-color: var(--accent); }
${ROOT} .djp-s-pricing .djp-plan-name {
  margin: 0;
  font-family: var(--font-heading, var(--font-lexend-exa), "Lexend Exa", system-ui, sans-serif);
}
${ROOT} .djp-s-pricing .djp-plan-price { margin: 0; font-size: 2rem; font-weight: 700; color: var(--primary); }
${ROOT} .djp-s-pricing .djp-plan-cadence {
  margin-left: 0.35rem;
  font-size: 0.9rem;
  font-weight: 400;
  color: var(--muted-foreground);
}
${ROOT} .djp-s-pricing .djp-plan-blurb { margin: 0; color: var(--muted-foreground); }
${ROOT} .djp-s-pricing .djp-plan-features {
  flex: 1;
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
${ROOT} .djp-s-pricing .djp-plan-features li { display: flex; gap: 0.5rem; align-items: flex-start; font-size: 0.95rem; }
${ROOT} .djp-s-pricing .djp-plan-features .djp-ic { color: var(--accent); margin-top: 0.2rem; }
${ROOT} .djp-s-pricing .djp-plan-cta { margin-top: auto; }
${ROOT} .djp-s-pricing .djp-plan-cta .djp-btn { width: 100%; }
${ROOT} .djp-s-pricing.djp-v-single .djp-pricing-grid { grid-template-columns: 1fr; max-width: 24rem; margin-inline: auto; }
${ROOT} .djp-s-pricing .djp-footnote { margin-top: 1.5rem; font-size: 0.85rem; color: var(--muted-foreground); text-align: center; }
`.trim()

export const FAQ_CSS = `
${ROOT} .djp-s-faq .djp-faq-list {
  margin: 0;
  padding: 0;
  max-width: 46rem;
  margin-inline: auto;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
${ROOT} .djp-s-faq .djp-faq-item { border-bottom: 1px solid var(--surface); padding-bottom: 1.25rem; }
${ROOT} .djp-s-faq .djp-faq-q {
  margin: 0 0 0.4rem;
  font-weight: 700;
  font-family: var(--font-heading, var(--font-lexend-exa), "Lexend Exa", system-ui, sans-serif);
}
${ROOT} .djp-s-faq .djp-faq-a { margin: 0; color: var(--muted-foreground); }
`.trim()

export const FORM_CSS = `
${ROOT} .djp-s-form { max-width: 34rem; }
${ROOT} .djp-s-form.djp-v-boxed { background: var(--surface); border-radius: var(--djp-radius, 0.6rem); padding: 2.5rem; }
${ROOT} .djp-s-form.djp-v-band { max-width: 100%; }
${ROOT} .djp-s-form[data-align="center"] { margin-inline: auto; }
`.trim()

export const CTA_CSS = `
${ROOT} .djp-s-cta .djp-cta-inner { display: flex; flex-direction: column; align-items: flex-start; gap: 1rem; }
${ROOT} .djp-s-cta[data-align="center"] .djp-cta-inner { align-items: center; }
${ROOT} .djp-s-cta.djp-v-boxed .djp-cta-inner {
  background: var(--surface);
  border-radius: var(--djp-radius, 0.6rem);
  padding: 2.5rem;
}
`.trim()

export const FOOTER_CSS = `
${ROOT} .djp-s-footer .djp-footer-inner { display: flex; flex-direction: column; gap: 1rem; }
${ROOT} .djp-s-footer .djp-footer-business {
  margin: 0;
  font-weight: 700;
  font-family: var(--font-heading, var(--font-lexend-exa), "Lexend Exa", system-ui, sans-serif);
}
${ROOT} .djp-s-footer .djp-footer-lines { display: flex; flex-direction: column; gap: 0.2rem; }
${ROOT} .djp-s-footer .djp-footer-line { margin: 0; font-size: 0.9rem; color: var(--muted-foreground); }
${ROOT} .djp-s-footer .djp-footer-links { list-style: none; display: flex; flex-wrap: wrap; gap: 1rem; margin: 0; padding: 0; }
${ROOT} .djp-s-footer .djp-footer-legal { margin: 0; font-size: 0.8rem; color: var(--muted-foreground); }
${ROOT} .djp-s-footer.djp-v-columns .djp-footer-inner { flex-direction: row; flex-wrap: wrap; justify-content: space-between; }
`.trim()

/** One CSS string per kind — `doc.ts` pulls only the kinds a doc actually uses. */
export const SECTION_CSS: Record<SectionKind, string> = {
  hero: HERO_CSS,
  bullets: BULLETS_CSS,
  steps: STEPS_CSS,
  testimonial: TESTIMONIAL_CSS,
  pricing: PRICING_CSS,
  faq: FAQ_CSS,
  form: FORM_CSS,
  cta: CTA_CSS,
  footer: FOOTER_CSS,
}
