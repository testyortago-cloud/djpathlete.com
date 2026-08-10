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
//
// ---------------------------------------------------------------------------
// THE TONE CONTRAST PASS (the block marked "TONE CONTRAST PASS" below).
// ---------------------------------------------------------------------------
//
// THE RULE THIS FILE OBEYS, STATED ONCE: a colour token and a background token
// are safe together only if they are a PAIR. `app/globals.css` declares three
// — `--primary`/`--primary-foreground`, `--accent`/`--accent-foreground`, and
// the neutral surfaces `--background`/`--surface` with
// `--foreground`/`--muted-foreground`. Mixing across pairs is not "slightly
// low contrast", it is UNDEFINED contrast: this app declares those tokens in
// FOUR scopes with opposite polarity, so "`--muted-foreground` is mid-grey on
// a light page" is true in one scope and false in the next. Only the PAIRING
// is invariant, so the pairing is the only thing worth preserving — and the
// only thing `render.test.ts`'s tone-contrast suite asserts.
//
// `[data-tone="accent"]` and `[data-tone="dark"]` repaint the section
// background with `--accent` / `--primary`. Before this pass exactly TWO
// elements travelled with them (`.djp-hd` and `.djp-sub`, via
// `color: inherit`); everything else kept a light-mode colour:
//
//   - NINE per-kind classes hardcoded `var(--muted-foreground)`
//     (`.djp-bullet-text` `.djp-step-text` `.djp-quote-attribution`
//     `.djp-plan-blurb` `.djp-plan-cadence` `.djp-footnote` `.djp-faq-a`
//     `.djp-footer-line` `.djp-footer-legal`) — unpaired with either
//     repainted background.
//   - FIVE panels repainted themselves BACK to `var(--surface)` INSIDE the
//     repainted section (`.djp-bullet-item` in `cards`, `.djp-quote`,
//     `.djp-plan`, `.djp-s-form.djp-v-boxed`, `.djp-cta-inner` in `boxed`)
//     without restoring a paired foreground. So every unstyled child of one of
//     them — plan names, feature rows, quote bodies, a boxed form's own
//     heading — inherited `--primary-foreground` onto a near-white card. THAT
//     was the invisible text.
//   - `.djp-plan-price` (`--primary`) and `.djp-quote-name` (`--foreground`)
//     were saved from the dark background ONLY by their panel's `--surface`
//     repaint — i.e. by an unrelated layout rule, one edit away from changing.
//     They are pinned explicitly below rather than left implicit. (A review
//     round reported these two as the hard failures; they were the two most
//     nearly-broken, not the two already broken. The stylesheet does not care
//     which was worse — the pass covers both classes of hazard.)
//   - FOUR shapes were painted in the token of the background behind them: the
//     accent eyebrow, the accent list icon and the accent primary button on an
//     ACCENT section, and the steps counter badge (`--primary`) on a DARK
//     section. A shape in its own background's token is not low-contrast, it
//     is gone.
//
// THIS IS NOT MITIGATED UPSTREAM. `prompt.ts`'s rule 6 steers the model away
// from dark tone on text-heavy kinds, but Stage 2's inspector sets
// `style.tone` directly with no model in the loop — a behavioural mitigation
// upstream of a rendering bug is not a fix.
//
// THREE MOVES, APPLIED TO BOTH REPAINTING TONES:
//
//   1. A PANEL INSIDE A REPAINTED SECTION LIFTS; IT DOES NOT SWITCH PAIRS.
//      Instead of `var(--surface)` — a token from the other pair that drags
//      its own foreground requirement in with it — a panel becomes a low
//      percentage wash of the tone's OWN foreground over whatever is behind
//      it. The section's background still governs contrast, so every child
//      keeps inheriting the tone's paired foreground and no child needs a rule
//      of its own. (The image-bg scrim is the same move at full strength: it
//      sits over a photograph, so it takes the tone's own BACKGROUND token.)
//   2. EVERY REMAINING HARDCODED FOREGROUND BECOMES `inherit`. Secondary text
//      keeps its hierarchy through `opacity`, which is pair-agnostic, instead
//      of through a second colour token, which is not.
//   3. A SHAPE THAT COLLIDES WITH ITS OWN BACKGROUND MOVES TO THE OTHER BRAND
//      PAIR — never to a bare foreground token, so the swap survives a scope
//      flip.
//
// It lives HERE, in THEME_CSS beside the knob it belongs to, rather than split
// across the nine per-kind strings: the contrast contract has to be auditable
// in one place, and splitting it is how it went missing in the first place. It
// costs ~2 KB on every page against a 200 000-character publish cap
// (`FUNNEL_STEP_CSS_MAX_LENGTH`). Flat, `var(--…)` only — constraints 1 and 2
// at the top of this file apply to it exactly as they do to everything else.
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

/* TONE CONTRAST PASS — see the block comment above THEME_CSS. Move 1:
   a panel inside a repainted section LIFTS, it does not switch to --surface. */
${ROOT} .djp-s[data-tone="accent"].djp-s-bullets.djp-v-cards .djp-bullet-item,
${ROOT} .djp-s[data-tone="accent"] .djp-quote,
${ROOT} .djp-s[data-tone="accent"] .djp-plan,
${ROOT} .djp-s[data-tone="accent"].djp-s-cta.djp-v-boxed .djp-cta-inner {
  background: color-mix(in oklch, var(--accent-foreground) 12%, transparent);
}
${ROOT} .djp-s[data-tone="dark"].djp-s-bullets.djp-v-cards .djp-bullet-item,
${ROOT} .djp-s[data-tone="dark"] .djp-quote,
${ROOT} .djp-s[data-tone="dark"] .djp-plan,
${ROOT} .djp-s[data-tone="dark"].djp-s-cta.djp-v-boxed .djp-cta-inner {
  background: color-mix(in oklch, var(--primary-foreground) 12%, transparent);
}

/* Move 1 for the THIRD repainting tone. The "muted" tone paints the section
   var(--surface) — the SAME token these five panels paint THEMSELVES — so
   every card, plan, quote and boxed CTA on a muted section was a shape in its
   own background's colour: not low-contrast, GONE. It is the accent/dark
   collision one pair over, and the same lift fixes it, washed with the
   NEUTRAL pair's foreground because that is the pair a muted section is in.
   (The first tone pass ran its collision check on "accent" and "dark" only,
   which is how this survived it; the suite now runs all four tones.) */
${ROOT} .djp-s[data-tone="muted"].djp-s-bullets.djp-v-cards .djp-bullet-item,
${ROOT} .djp-s[data-tone="muted"] .djp-quote,
${ROOT} .djp-s[data-tone="muted"] .djp-plan,
${ROOT} .djp-s[data-tone="muted"].djp-s-cta.djp-v-boxed .djp-cta-inner,
${ROOT} .djp-s[data-tone="muted"].djp-s-hero .djp-media-invalid {
  background: color-mix(in oklch, var(--foreground) 8%, transparent);
}

/* The boxed FORM is the one panel that is the section itself, so it cannot
   lift: a wash there composites over the PAGE, not over the tone, and the
   section's own tone background never gets painted because FORM_CSS ties on
   specificity and wins on source order. It takes the tone colour outright —
   .djp-s-form is already max-width 34rem, so the box reads as a box. */
${ROOT} .djp-s[data-tone="accent"].djp-s-form.djp-v-boxed { background: var(--accent); }
${ROOT} .djp-s[data-tone="dark"].djp-s-form.djp-v-boxed { background: var(--primary); }

/* Move 1 at full strength: the image-bg scrim sits over a PHOTOGRAPH, so it
   takes the tone's own BACKGROUND token rather than a wash of its foreground. */
${ROOT} .djp-s[data-tone="accent"].djp-s-hero.djp-v-image-bg .djp-hero-copy {
  background: color-mix(in oklch, var(--accent) 78%, transparent);
}
${ROOT} .djp-s[data-tone="dark"].djp-s-hero.djp-v-image-bg .djp-hero-copy {
  background: color-mix(in oklch, var(--primary) 78%, transparent);
}

/* Move 2: every hardcoded foreground travels with the tone. First the two
   non-muted ones. */
${ROOT} .djp-s[data-tone="accent"] .djp-plan-price,
${ROOT} .djp-s[data-tone="accent"] .djp-quote-name,
${ROOT} .djp-s[data-tone="dark"] .djp-plan-price,
${ROOT} .djp-s[data-tone="dark"] .djp-quote-name { color: inherit; }

/* ...then all nine --muted-foreground classes. Opacity, not a second colour
   token, is what keeps them subordinate. */
${ROOT} .djp-s[data-tone="accent"] .djp-bullet-text,
${ROOT} .djp-s[data-tone="accent"] .djp-step-text,
${ROOT} .djp-s[data-tone="accent"] .djp-quote-attribution,
${ROOT} .djp-s[data-tone="accent"] .djp-plan-blurb,
${ROOT} .djp-s[data-tone="accent"] .djp-plan-cadence,
${ROOT} .djp-s[data-tone="accent"] .djp-footnote,
${ROOT} .djp-s[data-tone="accent"] .djp-faq-a,
${ROOT} .djp-s[data-tone="accent"] .djp-footer-line,
${ROOT} .djp-s[data-tone="accent"] .djp-footer-legal,
${ROOT} .djp-s[data-tone="dark"] .djp-bullet-text,
${ROOT} .djp-s[data-tone="dark"] .djp-step-text,
${ROOT} .djp-s[data-tone="dark"] .djp-quote-attribution,
${ROOT} .djp-s[data-tone="dark"] .djp-plan-blurb,
${ROOT} .djp-s[data-tone="dark"] .djp-plan-cadence,
${ROOT} .djp-s[data-tone="dark"] .djp-footnote,
${ROOT} .djp-s[data-tone="dark"] .djp-faq-a,
${ROOT} .djp-s[data-tone="dark"] .djp-footer-line,
${ROOT} .djp-s[data-tone="dark"] .djp-footer-legal { color: inherit; opacity: 0.85; }

/* Move 3: shapes painted in their own background's token. The second .djp-ic
   selector is not a duplicate — PRICING_CSS's .djp-plan-features .djp-ic ties
   on specificity and wins on source order, so the icon inside a plan needs
   the deeper selector to be reached at all. */
${ROOT} .djp-s[data-tone="accent"] .djp-eyebrow,
${ROOT} .djp-s[data-tone="accent"] .djp-ic,
${ROOT} .djp-s[data-tone="accent"] .djp-plan-features .djp-ic { color: inherit; }
${ROOT} .djp-s[data-tone="accent"] .djp-btn-primary,
${ROOT} .djp-s[data-tone="accent"].djp-s-bullets.djp-v-numbered .djp-bullet-item::before {
  background: var(--primary);
  color: var(--primary-foreground);
}
${ROOT} .djp-s[data-tone="dark"].djp-s-steps .djp-step-item::before {
  background: var(--accent);
  color: var(--accent-foreground);
}

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

/* States. A CTA with no hover reads as text that happens to have a background,
   and a focus ring is the difference between a keyboard-reachable page and a
   page that merely does not crash for one. Applied to .djp-btn rather than
   per-variant so the tone pass's repaints are inherited rather than restated:
   filter and currentColor are both relative to whatever colour won.
   (No backticks in a comment inside a template literal — they close it.) */
${ROOT} .djp-btn:hover { filter: brightness(0.94); }
${ROOT} .djp-btn:active { transform: translateY(1px); }
${ROOT} .djp-btn:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 3px;
}
${ROOT} .djp-btn-disabled:hover { filter: none; }
${ROOT} .djp-footer-link:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
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
${ROOT} .djp-s-hero .djp-media-invalid {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 1.5rem;
  min-height: 12rem;
  background: var(--surface);
  color: var(--muted-foreground);
  border: 1px dashed var(--muted-foreground);
}
${ROOT} .djp-s-hero.djp-v-centered .djp-hero-inner { flex-direction: column; }
/* "centered" only changes layout direction — text-align is the align knob's
   job (THEME_CSS's .djp-s[data-align=...]), never forced here, or a hero
   with variant:"centered" + style.align:"left" could never actually be
   left-aligned. */
${ROOT} .djp-s-hero.djp-v-centered[data-align="center"] .djp-hero-ctas { justify-content: center; }
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
/* .djp-quote-detail has been emitted by render.ts since the authored
   testimonial variant was written and was never styled — it inherited the
   attribution row and was indistinguishable from the name beside it. Found by
   the island/stylesheet agreement test, which walks the classes the markup
   actually emits rather than the ones the stylesheet happens to define. */
${ROOT} .djp-s-testimonial .djp-quote-detail { opacity: 0.8; }
${ROOT} .djp-s-testimonial .djp-quote-detail::before { content: "· "; }
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

/* The LIVE faq island renders <details>, so it needs the one thing the authored
   <dl> variant does not: the UA disclosure triangle replaced with a control
   that looks deliberate. Without this the section shipped with a raw black
   "▶" against a designed page. */
${ROOT} .djp-s-faq .djp-faq-details > summary {
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1.5rem;
  padding-right: 0.25rem;
}
${ROOT} .djp-s-faq .djp-faq-details > summary::-webkit-details-marker { display: none; }
${ROOT} .djp-s-faq .djp-faq-details > summary::after {
  content: "+";
  flex: none;
  font-weight: 400;
  font-size: 1.4rem;
  line-height: 1;
  color: var(--accent);
}
${ROOT} .djp-s-faq .djp-faq-details[open] > summary::after { content: "\\2212"; }
${ROOT} .djp-s-faq .djp-faq-details[open] > .djp-faq-a { margin-top: 0.75rem; }
${ROOT} .djp-s-faq .djp-faq-details > summary:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
${ROOT} .djp-s[data-tone="accent"].djp-s-faq .djp-faq-details > summary::after,
${ROOT} .djp-s[data-tone="dark"].djp-s-faq .djp-faq-details > summary::after { color: inherit; }
`.trim()

// ---------------------------------------------------------------------------
// FORM_CSS
//
// This block used to be four rules — max-width, a boxed background, a band
// override and centring — and NOT ONE of them touched a label, a control, or
// the submit button. Every other kind in this file carries 15-40 lines of
// layout; the one section whose only job is to capture a lead carried none, so
// it rendered at browser defaults on a live campaign page.
//
// The theory that allowed it is quoted and buried in `FunnelForm.tsx`: the
// controls were supposed to inherit from a canvas the owner styled by hand.
// That canvas no longer exists.
//
// TWO THINGS TO PRESERVE WHEN EDITING THIS:
//
// 1. THE SUBMIT BUTTON IS NOT STYLED HERE. It carries `djp-btn
//    djp-btn-primary`, so it is the same button as every other CTA on the page
//    and it inherits the tone-contrast pass for free — including the rule that
//    repaints a primary button on an ACCENT section, without which it would be
//    a shape in its own background's colour. Only its width and margin are set
//    below. Do not give it its own colours.
//
// 2. EVERY COLOUR IS HALF OF A PAIR, and the tone rules below repaint BOTH
//    halves. A form is the one place in this file where getting that wrong is
//    invisible in review and fatal in production: `.djp-s-form.djp-v-boxed`
//    already repaints itself to `--accent` / `--primary` on those two tones, so
//    a label left at `--foreground` is dark-on-dark and a placeholder left at
//    `--muted-foreground` disappears — on the page, at the field, where the
//    lead is typing.
//
//    The CONTROLS deliberately keep the neutral `--background`/`--foreground`
//    pair on every tone. A white input on a coloured band is correct: it is the
//    affordance that says "type here", and washing it into the band to match
//    would be the same mistake in the other direction.
// ---------------------------------------------------------------------------

export const FORM_CSS = `
${ROOT} .djp-s-form { max-width: 34rem; }
${ROOT} .djp-s-form.djp-v-boxed {
  background: var(--surface);
  border-radius: var(--djp-radius, 0.6rem);
  padding: 2.5rem;
}
${ROOT} .djp-s-form.djp-v-band { max-width: 100%; }
${ROOT} .djp-s-form[data-align="center"] { margin-inline: auto; }

/* the form */
${ROOT} .djp-form { display: flex; flex-direction: column; gap: 1.15rem; margin-top: 1.5rem; }
${ROOT} .djp-form .djp-field { display: flex; flex-direction: column; gap: 0.4rem; }

/* A checkbox is a control with a label BESIDE it, not under it. Driven off
   data-djp-field-type rather than :has(), which would silently fall back to a
   stacked checkbox wherever :has() is unsupported. */
${ROOT} .djp-form .djp-field[data-djp-field-type="checkbox"] {
  flex-direction: row-reverse;
  align-items: center;
  justify-content: flex-start;
  gap: 0.6rem;
}
${ROOT} .djp-form .djp-field[data-djp-field-type="checkbox"] .djp-field-label { font-weight: 400; }
${ROOT} .djp-form .djp-field[data-djp-field-type="checkbox"] .djp-control {
  width: 1.15rem;
  height: 1.15rem;
  min-height: 0;
  flex: none;
  accent-color: var(--accent);
}

${ROOT} .djp-form .djp-field-label {
  font-family: var(--font-body, var(--font-lexend-deca), "Lexend Deca", system-ui, sans-serif);
  font-size: 0.9rem;
  font-weight: 600;
  line-height: 1.3;
  color: var(--foreground);
}
${ROOT} .djp-form .djp-req { color: var(--accent); }

${ROOT} .djp-form .djp-control {
  width: 100%;
  box-sizing: border-box;
  min-height: 2.9rem;
  padding: 0.7rem 0.9rem;
  font-family: var(--font-body, var(--font-lexend-deca), "Lexend Deca", system-ui, sans-serif);
  font-size: 1rem;
  line-height: 1.4;
  color: var(--foreground);
  background: var(--background);
  border: 1px solid var(--border);
  border-radius: var(--djp-radius, 0.6rem);
  outline: none;
  appearance: none;
}
${ROOT} .djp-form textarea.djp-control { min-height: 6rem; resize: vertical; }
${ROOT} .djp-form .djp-control::placeholder { color: var(--muted-foreground); opacity: 1; }

/* A real focus ring. Without this a keyboard user got whatever the UA draws
   over an unstyled input, which on a restyled input is frequently nothing. */
${ROOT} .djp-form .djp-control:focus-visible {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--accent) 35%, transparent);
}

/* The select's own arrow, since appearance:none removed it. Inline mask for the
   same reason the icons above use one: no <svg> in the markup, no data: image. */
${ROOT} .djp-form select.djp-control {
  padding-right: 2.4rem;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.85rem center;
  background-size: 1.1rem;
}

${ROOT} .djp-form .djp-form-submit { width: 100%; margin-top: 0.35rem; }
${ROOT} .djp-form .djp-form-submit:disabled { opacity: 0.6; cursor: progress; }

${ROOT} .djp-form .djp-consent {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.5;
  color: var(--muted-foreground);
}

${ROOT} .djp-form .djp-form-error {
  margin: 0;
  padding: 0.7rem 0.9rem;
  font-size: 0.9rem;
  color: var(--error);
  background: color-mix(in oklch, var(--error) 10%, transparent);
  border-radius: var(--djp-radius, 0.6rem);
}

/* The success panel is the MOST important state on the page — it is what a
   lead sees the moment they convert — and it was an unstyled <div>. */
${ROOT} .djp-form-success {
  margin-top: 1.5rem;
  padding: 1.25rem 1.4rem;
  font-size: 1.05rem;
  line-height: 1.5;
  color: var(--foreground);
  background: color-mix(in oklch, var(--success) 12%, transparent);
  border: 1px solid color-mix(in oklch, var(--success) 45%, transparent);
  border-radius: var(--djp-radius, 0.6rem);
}

/* ---- tone pairs. See the note above: both halves, every tone. ---- */
${ROOT} .djp-s[data-tone="accent"] .djp-field-label,
${ROOT} .djp-s[data-tone="accent"] .djp-consent,
${ROOT} .djp-s[data-tone="accent"] .djp-req,
${ROOT} .djp-s[data-tone="dark"] .djp-field-label,
${ROOT} .djp-s[data-tone="dark"] .djp-consent,
${ROOT} .djp-s[data-tone="dark"] .djp-req { color: inherit; }
${ROOT} .djp-s[data-tone="accent"] .djp-consent,
${ROOT} .djp-s[data-tone="dark"] .djp-consent { opacity: 0.85; }

/* The error and success panels take the tone's own pair.
   --error and --success are readable on a light page and undefined against
   --accent or --primary, so on a repainted section the panel keeps the tone's
   foreground and expresses itself as a wash instead of a colour.

   NAMED TOKENS, NOT currentColor. A color-mix over currentColor is correct CSS
   and unreadable to the tone-contrast analyser in render.test.ts, which
   resolves colours by TOKEN — it reported these four as UNMODELLED rather than
   passing them, which is the right behaviour for a check whose whole job is to
   know what colour something ends up. Writing the token the tone already
   guarantees keeps the rule checkable. */
${ROOT} .djp-s[data-tone="accent"] .djp-form-error {
  color: inherit;
  background: color-mix(in oklch, var(--accent-foreground) 15%, transparent);
}
${ROOT} .djp-s[data-tone="dark"] .djp-form-error {
  color: inherit;
  background: color-mix(in oklch, var(--primary-foreground) 15%, transparent);
}

${ROOT} .djp-s[data-tone="accent"] .djp-form-success {
  color: inherit;
  background: color-mix(in oklch, var(--accent-foreground) 12%, transparent);
  border-color: color-mix(in oklch, var(--accent-foreground) 40%, transparent);
}
${ROOT} .djp-s[data-tone="dark"] .djp-form-success {
  color: inherit;
  background: color-mix(in oklch, var(--primary-foreground) 12%, transparent);
  border-color: color-mix(in oklch, var(--primary-foreground) 40%, transparent);
}

/* NO muted override for the boxed form, deliberately. The boxed form IS the
   section, and .djp-s-form caps it at 34rem, so the ground behind it is the
   PAGE, not the band — painting it --surface there is correct and visible. An
   earlier version of this block gave it --background on the muted tone, which
   made it --background on --background: a box the width of the page's own
   colour. render.test.ts's "no element paints its own background in the token
   of the background behind it" caught it. */

/* ---- split: the form beside the pitch, above the fold ---- */
${ROOT} .djp-s-form.djp-v-split { max-width: 100%; }
${ROOT} .djp-s-form.djp-v-split .djp-form-split {
  display: flex;
  flex-wrap: wrap;
  gap: 2.5rem;
  align-items: flex-start;
}
${ROOT} .djp-s-form.djp-v-split .djp-form-pitch { flex: 1 1 22rem; min-width: 0; }
/* --surface, NOT --background: on an untoned section the ground behind this
   card IS --background, and a card in the colour of the thing behind it is not
   a subtle card, it is no card. Same rule .djp-quote and .djp-plan already
   follow. The controls inside stay --background, which is what gives the card
   its interior hierarchy. */
${ROOT} .djp-s-form.djp-v-split .djp-form-card {
  flex: 1 1 22rem;
  min-width: 0;
  max-width: 30rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--djp-radius, 0.6rem);
  padding: 1.75rem;
}
${ROOT} .djp-s-form.djp-v-split .djp-form-card .djp-form { margin-top: 0; }
${ROOT} .djp-s-form.djp-v-split .djp-form-proof {
  list-style: none;
  margin: 1.25rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
${ROOT} .djp-s-form.djp-v-split .djp-form-proof li {
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
  font-size: 0.98rem;
}
${ROOT} .djp-s-form.djp-v-split .djp-form-proof .djp-ic { color: var(--accent); margin-top: 0.15rem; }

/* The split card is a panel inside a possibly-repainted section, so it obeys
   Move 1 from the tone pass: it LIFTS off the tone rather than switching to a
   light background that would strand its own dark controls. Its controls keep
   the neutral pair regardless — see the note above. */
${ROOT} .djp-s[data-tone="accent"].djp-s-form.djp-v-split .djp-form-card {
  background: color-mix(in oklch, var(--accent-foreground) 12%, transparent);
  border-color: color-mix(in oklch, var(--accent-foreground) 25%, transparent);
}
${ROOT} .djp-s[data-tone="dark"].djp-s-form.djp-v-split .djp-form-card {
  background: color-mix(in oklch, var(--primary-foreground) 12%, transparent);
  border-color: color-mix(in oklch, var(--primary-foreground) 25%, transparent);
}
/* The muted tone paints the section --surface, which is what the card paints
   itself — so here, and only here, it lifts off the band instead. Neutral pair,
   because a muted section is in the neutral pair. */
${ROOT} .djp-s[data-tone="muted"].djp-s-form.djp-v-split .djp-form-card {
  background: color-mix(in oklch, var(--foreground) 8%, transparent);
}
${ROOT} .djp-s[data-tone="accent"].djp-s-form.djp-v-split .djp-form-proof .djp-ic,
${ROOT} .djp-s[data-tone="dark"].djp-s-form.djp-v-split .djp-form-proof .djp-ic { color: inherit; }
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

export const PROOF_CSS = `
${ROOT} .djp-s-proof .djp-proof-list {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem 2.5rem;
  margin: 0;
  padding: 0;
}
${ROOT} .djp-s-proof[data-align="center"] .djp-proof-list { justify-content: center; }
${ROOT} .djp-s-proof .djp-proof-item { flex: 0 1 auto; }
${ROOT} .djp-s-proof .djp-proof-value {
  font-family: var(--font-heading, var(--font-lexend-exa), "Lexend Exa", system-ui, sans-serif);
  font-size: 1.65rem;
  font-weight: 700;
  line-height: 1.1;
  color: var(--primary);
  margin: 0;
}
${ROOT} .djp-s-proof .djp-proof-label {
  margin: 0.15rem 0 0;
  font-size: 0.9rem;
  color: var(--muted-foreground);
}

/* stats: even columns with dividers, for a strip that carries real weight. */
${ROOT} .djp-s-proof.djp-v-stats .djp-proof-list { gap: 0; }
${ROOT} .djp-s-proof.djp-v-stats .djp-proof-item {
  flex: 1 1 9rem;
  padding: 0.25rem 1.5rem;
  border-left: 1px solid color-mix(in oklch, var(--foreground) 12%, transparent);
}
${ROOT} .djp-s-proof.djp-v-stats .djp-proof-item:first-child { border-left: 0; padding-left: 0; }

/* Both halves travel with a repainted tone — the value is --primary, which on
   a dark section IS the background. */
${ROOT} .djp-s[data-tone="accent"].djp-s-proof .djp-proof-value,
${ROOT} .djp-s[data-tone="dark"].djp-s-proof .djp-proof-value { color: inherit; }
${ROOT} .djp-s[data-tone="accent"].djp-s-proof .djp-proof-label,
${ROOT} .djp-s[data-tone="dark"].djp-s-proof .djp-proof-label { color: inherit; opacity: 0.85; }
${ROOT} .djp-s[data-tone="accent"].djp-s-proof.djp-v-stats .djp-proof-item {
  border-left-color: color-mix(in oklch, var(--accent-foreground) 25%, transparent);
}
${ROOT} .djp-s[data-tone="dark"].djp-s-proof.djp-v-stats .djp-proof-item {
  border-left-color: color-mix(in oklch, var(--primary-foreground) 25%, transparent);
}
${ROOT} .djp-s[data-tone="accent"].djp-s-proof.djp-v-stats .djp-proof-item:first-child,
${ROOT} .djp-s[data-tone="dark"].djp-s-proof.djp-v-stats .djp-proof-item:first-child { border-left: 0; }
`.trim()

/** One CSS string per kind — `doc.ts` pulls only the kinds a doc actually uses. */
export const SECTION_CSS: Record<SectionKind, string> = {
  hero: HERO_CSS,
  proof: PROOF_CSS,
  bullets: BULLETS_CSS,
  steps: STEPS_CSS,
  testimonial: TESTIMONIAL_CSS,
  pricing: PRICING_CSS,
  faq: FAQ_CSS,
  form: FORM_CSS,
  cta: CTA_CSS,
  footer: FOOTER_CSS,
}
