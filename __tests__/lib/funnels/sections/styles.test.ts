// @vitest-environment jsdom
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
import { MUTED_PANEL_WASH } from "@/lib/funnels/sections/palettes"
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
// cta.split structure — review fix (task-7-report.md). renderCtaSection
// used to emit the headline, the sub and the button as three independent
// siblings of .djp-cta-inner. djp-v-split's CSS put .djp-cta-inner into a
// two-up flex row and gave the headline AND the sub their own flex-basis,
// which produced THREE columns (headline / sub / button) instead of the
// intended two (copy / button). The fix groups the headline and sub into
// one .djp-cta-copy wrapper; this pins that grouping so a regression back
// to independent siblings fails here rather than only looking wrong in a
// browser.
// ---------------------------------------------------------------------------

describe("cta markup groups headline and sub into one copy block", () => {
  it("wraps the headline and sub in .djp-cta-copy, as siblings of the button — not three independent flex items", () => {
    const html = renderSection({
      id: "c1",
      kind: "cta",
      variant: "split",
      style: {},
      props: { headline: "Spots are limited", sub: "Summer camp starts June 1", cta: urlCta },
    })
    const root = document.createElement("div")
    root.innerHTML = html
    const inner = root.querySelector(".djp-cta-inner")
    expect(inner).not.toBeNull()
    // .djp-cta-inner's direct children must be [.djp-cta-copy, <a|span> (the
    // button)] — exactly two items — never .djp-hd/.djp-sub as direct
    // children of .djp-cta-inner.
    const directChildren = Array.from(inner!.children).map((el) => el.className)
    expect(directChildren).toEqual(["djp-cta-copy", "djp-btn djp-btn-primary"])
    const copy = inner!.querySelector(":scope > .djp-cta-copy")
    expect(copy).not.toBeNull()
    expect(copy!.querySelector(".djp-hd")).not.toBeNull()
    expect(copy!.querySelector(".djp-sub")).not.toBeNull()
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

// ---------------------------------------------------------------------------
// THE SHAPE-CONTRAST PASS (2026-09-19).
//
// The art-director critic, looking at a real render, filed two art/high
// findings that no text-contrast rule covers, because neither is about text:
//
//   - on a LIGHT palette: "the pricing card ... is rendered in a barely-lighter
//     tan, giving the card almost no visual separation from the band behind it"
//   - on the `ink` preset: "a near-black button on a near-black background,
//     making it almost invisible against the dark card"
//
// Measured over all 12 presets x 4 tones: the card fails 3:1 against its band
// in 48/48 cells, and the button fails against the card in 26/48 (worst 1.08).
//
// THE FIX IS AN EDGE, NOT A NEW FILL. A shape gets a boundary drawn in the
// foreground of the pair it already sits in (--djp-pair-fg), which pickInk has
// ALREADY proved against that band. No new palette token, and no table of legal
// pairs — the artefact the last four unreadable-text bugs hid behind.
// ---------------------------------------------------------------------------
describe("shapes have a boundary against whatever is behind them", () => {
  // The variable has to be SET for all four tones, or a shape on the tone it
  // was forgotten on silently falls back and the bug survives on that tone
  // alone. `.djp-s`'s base rule covers `default` and `muted` (both sit in the
  // neutral pair); `accent` and `dark` repaint, so they need their own.
  it("defines --djp-pair-fg for every tone a section can take", () => {
    expect(THEME_CSS).toMatch(/\.djp-s \{[^}]*--djp-pair-fg: var\(--foreground\)/)
    expect(THEME_CSS).toMatch(/\[data-tone="accent"\] \{[^}]*--djp-pair-fg: var\(--accent-foreground\)/)
    expect(THEME_CSS).toMatch(/\[data-tone="dark"\] \{[^}]*--djp-pair-fg: var\(--primary-foreground\)/)
  })

  // The button is the WCAG 1.4.11 failure of the two — it is a UI component, so
  // its boundary must clear 3:1, not merely look tidier.
  it("rings the primary button in the surrounding pair's foreground", () => {
    expect(THEME_CSS).toMatch(/\.djp-btn-primary \{[^}]*box-shadow: 0 0 0 1px var\(--djp-pair-fg/)
  })

  // `currentColor` CANNOT serve as the button's ring. `.djp-btn-primary` sets
  // its own `color` for its label, so inside the button `currentColor` is the
  // LABEL colour, not the ground the button sits on — a ring drawn in it would
  // be the button's own text colour against the button's own fill, which
  // `pickInk` deliberately makes maximally contrasty and which says nothing
  // about the card behind it. That is the whole reason the pair's foreground
  // needed a name of its own.
  it("does not reach for currentColor, which the button overwrites with its label colour", () => {
    expect(THEME_CSS).not.toMatch(/\.djp-btn-primary \{[^}]*box-shadow:[^;]*currentColor/)
  })

  // THE TIE THAT STOPS THE DERIVATION DRIFTING AWAY FROM THE CSS.
  //
  // palettes.ts cannot import a stylesheet, so `MUTED_PANEL_WASH` restates the
  // wash percentage that Move 1 paints for a panel on a muted section. That
  // number is load-bearing: `deriveMutedOnPaper` guarantees body copy against
  // the ground it describes, so if the CSS moved to (say) 14% and this constant
  // did not, the derivation would be proving readability against a ground that
  // no longer exists — and the only symptom would be hard-to-read body copy on
  // a pricing card, which is exactly the bug this whole pass is about.
  //
  // Asserted against the CSS SOURCE, not a rendered value, because that is the
  // thing that can change independently.
  // ANCHORED ON THE RULE, NOT THE FILE. Scanning the whole of THEME_CSS for the
  // percentage looks equivalent and is not: THEME_CSS contains three
  // `color-mix(in oklch, var(--foreground) N%, transparent)` values — 10% and
  // 14% for the `+ sibling` dividers sixty lines above, and 8% for this panel.
  // So a whole-file `toContain` passes for 0.08, 0.10 AND 0.14 (proved by
  // mutation: 0.10 and 0.14 both survived; only 0.20 died). Those are not
  // obscure wrong values — they are the neighbouring idiom's, which is exactly
  // the drift that would silently invalidate the derivation while the page kept
  // painting 8%. So the assertion names the panel rule itself.
  it("derives against the same muted panel wash the stylesheet actually paints", () => {
    const percent = `${Math.round(MUTED_PANEL_WASH * 100)}%`
    const panelRule = THEME_CSS.split("}").find(
      (rule) => rule.includes('[data-tone="muted"]') && rule.includes(".djp-plan") && rule.includes("background:"),
    )
    expect(panelRule, "the muted-tone panel rule should exist").toBeDefined()
    expect(panelRule).toContain(`color-mix(in oklch, var(--foreground) ${percent}, transparent)`)
  })

  // THE TWO FIXES THAT CAME OUT OF REVIEW HAD NO TEST AT ALL — proved by
  // mutation: emptying the whole quiz-band rule, and deleting `.djp-quiz`'s
  // pair declaration, both left 1087/1087 green. That is also how a real bug
  // (an `inherit` that walked past `.djp-quiz-profile`'s own background) shipped
  // green in the first place.
  it("gives the band-variant quiz its section's pair, since it has no card to sit on", () => {
    expect(THEME_CSS).toMatch(/\.djp-s-quiz\.djp-v-band\[data-tone="accent"\] \.djp-quiz-step/)
    expect(THEME_CSS).toMatch(/\.djp-s-quiz\.djp-v-band\[data-tone="dark"\] \.djp-quiz-scale \{ color: inherit/)
  })

  // The container exception, pinned as an ABSENCE with a presence control above:
  // `.djp-quiz-profile` repaints itself `--surface`, so its body text must keep
  // reading the neutral token rather than inheriting the section's foreground.
  it("does not hand the section's foreground to text inside a container that repainted itself", () => {
    expect(THEME_CSS).not.toMatch(/\.djp-v-band\[data-tone="(accent|dark)"\] \.djp-quiz-profile-body/)
  })

  // SECTION_CSS.quiz, not THEME_CSS: the card rule is per-kind CSS, and only the
  // shared tone knobs live in THEME_CSS. Asserting against the wrong sheet was
  // the first version of this test and it failed loudly, which is the right way
  // round — a test that searched BOTH sheets would have passed either way and
  // told me nothing about where the declaration actually is.
  it("re-declares the pair inside the quiz card, which paints its own background", () => {
    expect(SECTION_CSS.quiz).toMatch(/\.djp-s-quiz \.djp-quiz \{[\s\S]*?--djp-pair-fg: var\(--foreground\)/)
  })

  // GAP G21 — THE CARD'S TEXT, which the pair variable alone does not fix.
  //
  // `.djp-quiz` paints itself `var(--background)` on every tone, but nothing set
  // `color` on it, so on an accent or dark section every unstyled child — the
  // prompt, the labels, the options, the profile name — inherited the SECTION's
  // foreground onto that neutral card. Measured over 12 presets x 4 tones the
  // card's text was **1.00:1 in the worst case** (slate on a dark section: the
  // identical colour, invisible), failing in 13 of 48 cells. Setting the card's
  // own colour takes every one of them to 19.46-21.00.
  it("gives the quiz card its own text colour, not the section's", () => {
    expect(SECTION_CSS.quiz).toMatch(/\.djp-s-quiz \.djp-quiz \{[\s\S]*?color: var\(--foreground\)/)
  })

  // ...AND THE BAND VARIANT HAS TO GIVE BOTH BACK. It sets the quiz
  // `background: transparent`, so the quiz IS the section band again — there the
  // neutral pair is the WRONG answer for exactly the same reason it is the right
  // one above. Leaving the card rule's overrides in place left the ring at
  // 1.43:1 in the worst case (moss on an accent band), a bug introduced by the
  // fix two commits earlier.
  //
  // This is the same container-vs-variant trap that has now bitten three times
  // in this file, which is why it gets its own assertion rather than a comment.
  it("hands the pair and the text back on the band variant, which is not a card", () => {
    const bandRule = SECTION_CSS.quiz
      .split("}")
      .find((rule) => rule.includes(".djp-v-band .djp-quiz") && rule.includes("background: transparent"))
    expect(bandRule, "the band-variant quiz rule should exist").toBeDefined()
    expect(bandRule, "band quiz must give back the section's text colour").toContain("color: inherit")
    expect(bandRule, "band quiz must give back the section's pair").toContain("--djp-pair-fg: inherit")
  })

  // THIS HAS NOW BITTEN TWICE, WHICH IS WHY IT GETS A TEST RATHER THAN A NOTE.
  //
  // `box-shadow` does not merge across rules — a later declaration REPLACES the
  // whole shadow. The pricing CSS has two rules that set a shadow on a plan
  // card: `.djp-plan` (the guaranteed boundary) and
  // `.djp-v-highlight .djp-plan-highlight` (the lift on a featured plan, at
  // higher specificity). If the second one ever stops restating the ring, the
  // featured card — the one a pricing section is usually built around — silently
  // loses its guaranteed edge, and NOTHING else fails.
  //
  // The first version of this fix used `border-color` and was defeated the same
  // way by `.djp-plan-highlight { border-color: var(--accent) }`. Measured on
  // the real rendered page, that edge was 1.11:1 while the fix was supposedly
  // in — which is how this test came to exist.
  //
  // Asserted over the pricing CSS as a WHOLE: every rule that shadows a plan
  // must name the pair foreground. That is a property, not a list of the two
  // rules that happen to exist today.
  it("never lets a later box-shadow rule drop a plan card's guaranteed edge", () => {
    const planShadowRules = SECTION_CSS.pricing
      .split("}")
      .filter((rule) => rule.includes("box-shadow") && rule.includes(".djp-plan"))

    expect(planShadowRules.length, "expected at least the base and highlight rules").toBeGreaterThanOrEqual(2)
    for (const rule of planShadowRules) {
      const selector = rule.split("{")[0].trim().replace(/\s+/g, " ")
      expect(rule, `box-shadow on "${selector}" must restate the pair-foreground ring`).toContain("--djp-pair-fg")
    }
  })
})
