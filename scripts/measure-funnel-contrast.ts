// scripts/measure-funnel-contrast.ts — the numbers behind gap G16 and the
// accent/dark tone pass, measured rather than asserted.
//
//   export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"
//   npx tsx scripts/measure-funnel-contrast.ts
//
// ---------------------------------------------------------------------------
// WHAT THIS IS FOR, AND WHAT IT IS EXPLICITLY NOT FOR
// ---------------------------------------------------------------------------
// This repo has shipped FOUR unreadable-text bugs green, and every one of them
// hid behind a hand-listed table of "legal pairs" — the list WAS the bug,
// because a pair nobody thought to list is a pair nobody measures.
//
// So this file is NOT the evidence that the fix works. It cannot be: it only
// ever measures the pairs it is told about, which is the same failure mode.
// The evidence is `scripts/ab-self-render-critics.ts` — a real render put in
// front of the real art critic, which finds pairs nobody enumerated.
//
// What this IS for: measuring EVERY preset against a rule, so the fix can be
// designed and so a regression in a derivation is caught cheaply. It walks all
// twelve PALETTE_TABLE presets rather than a chosen few, which is the one
// thing a hand-listed table cannot do.
//
// Rows are printed for every preset, passing and failing alike. A measurement
// script that printed only failures would go quiet on the day it broke.

import {
  contrastRatio,
  PALETTE_PRESETS,
  PALETTE_TABLE,
  resolvePalette,
  type PaletteTokens,
} from "@/lib/funnels/sections/palettes"

// app/globals.css:19 — `--muted-foreground: oklch(0.5 0.01 250)`. A FIXED
// app-level token: no PALETTE_TABLE preset derives or overrides it, so it never
// enters resolvePalette's AA guarantee at all.
const MUTED_FOREGROUND_HEX = "#5f6469"

// WCAG 2.1: 4.5:1 for body text, 3:1 for large text and for a non-text shape
// that has to be distinguishable from what is behind it (1.4.11).
const AA_BODY = 4.5
const AA_LARGE = 3

const f = (n: number): string => n.toFixed(2).padStart(5)
const mark = (n: number, floor: number): string => (n >= floor ? "ok  " : "FAIL")

function section(title: string): void {
  console.log(`\n${"=".repeat(78)}\n${title}\n${"=".repeat(78)}`)
}

function main(): void {
  // ── G16 itself ────────────────────────────────────────────────────────────
  section("G16 — the FIXED --muted-foreground against each preset's own ground")
  console.log("Body copy floor is 4.5:1. `paper` is the untoned section background")
  console.log("(--background), `surface` is the muted tone's (--surface).\n")
  console.log("preset      mode    paper     on paper       surface   on surface")
  for (const name of PALETTE_PRESETS) {
    const p = PALETTE_TABLE[name]
    const onPaper = contrastRatio(MUTED_FOREGROUND_HEX, p.paper)
    const onSurface = contrastRatio(MUTED_FOREGROUND_HEX, p.surface)
    const mode = p.paper === "#ffffff" ? "light" : "dark "
    console.log(
      `${name.padEnd(10)}  ${mode}   ${p.paper}   ${f(onPaper)} ${mark(onPaper, AA_BODY)}   ` +
        `${p.surface}   ${f(onSurface)} ${mark(onSurface, AA_BODY)}`,
    )
  }

  // ── What a derived token would score instead ──────────────────────────────
  //
  // The candidate rule: start at the palette's own `ink` (which pickInk has
  // already proved against paper) and step it TOWARD paper — i.e. make it
  // dimmer — for as long as it still clears the body floor against BOTH paper
  // and surface. The last passing value is the most subordinate colour that is
  // still readable, which is exactly what "muted" should mean.
  section("The candidate derivation — ink stepped toward paper while it still clears 4.5:1")
  console.log("preset      ink       muted-on-paper   on paper   on surface   vs ink")
  for (const name of PALETTE_PRESETS) {
    const p = PALETTE_TABLE[name]
    const candidate = deriveMutedCandidate(p.ink, p.paper, p.surface)
    const onPaper = contrastRatio(candidate, p.paper)
    const onSurface = contrastRatio(candidate, p.surface)
    const inkOnPaper = contrastRatio(p.ink, p.paper)
    console.log(
      `${name.padEnd(10)}  ${p.ink}   ${candidate}        ${f(onPaper)} ${mark(onPaper, AA_BODY)}  ` +
        `${f(onSurface)} ${mark(onSurface, AA_BODY)}   ${f(inkOnPaper)} (ink)`,
    )
  }

  // ── The wider pass the art critic reported ────────────────────────────────
  //
  // These are SHAPE contrasts, not text contrasts: a pricing card lifting off
  // the band behind it, and the CTA button sitting on that card. Both are
  // 1.4.11 non-text contrast, floor 3:1. Neither is in G16's nine classes, and
  // BOTH produced art/high findings in the 2026-09-19 A/B runs — the panel on
  // the light-palette document (`pricing-card-contrast`), the button on the
  // dark-palette one (`low-contrast-cta`: "a near-black button on a near-black
  // background").
  //
  // THE BUTTON'S FILL IS `--accent`, NOT `--primary` (styles.ts:585) — except
  // on an accent-toned section, where styles.ts:510 flips it to `--primary` to
  // escape the same-token collision with the band. So the button is a DIFFERENT
  // pair per tone, which is why one measurement of it is not enough.
  section("Pricing card + its CTA button, every preset × every tone, floor 3:1")
  console.log("card  = .djp-plan background (base --surface; a lift on a toned section)")
  console.log("btn   = .djp-btn-primary fill (--accent; --primary on an accent section)")
  console.log("card/band = does the card separate from the section behind it?")
  console.log("btn/card  = does the button separate from the card it sits on?\n")
  for (const tone of ["default", "muted", "dark", "accent"] as const) {
    console.log(`── tone="${tone}" ──`)
    console.log("preset      band      card      btn       card/band    btn/card")
    for (const name of PALETTE_PRESETS) {
      const p = PALETTE_TABLE[name]
      const band = sectionBackground(p, tone)
      const card = planBackground(p, tone)
      const btn = tone === "accent" ? p.brand : p.accent
      const cardVsBand = contrastRatio(card, band)
      const btnVsCard = contrastRatio(btn, card)
      console.log(
        `${name.padEnd(10)}  ${band}   ${card}   ${btn}   ` +
          `${f(cardVsBand)} ${mark(cardVsBand, AA_LARGE)}    ${f(btnVsCard)} ${mark(btnVsCard, AA_LARGE)}`,
      )
    }
    console.log("")
  }

  // ── The proposed fix: a hairline edge in the pair's own foreground ────────
  //
  // The shapes above fail because their FILL is a token nothing guarantees
  // against the token behind them. Rather than derive new fills (more tokens,
  // a repaint, and a fresh set of unguaranteed pairs), draw an EDGE in the
  // foreground of the pair the shape already sits in — `--djp-pair-fg`,
  // resolving to `--foreground` / `--accent-foreground` / `--primary-foreground`
  // per tone.
  //
  // WHY THIS NEEDS NO TABLE: `pickInk` already proves pair-fg against the BAND.
  // The card is only an 8-12% wash of that same fg into the band, so the edge
  // moves toward the fg while the card barely moves at all. The numbers below
  // are the check that this reasoning survives contact with all 12 presets —
  // asserting it without measuring is exactly the habit that shipped four bugs.
  section("The proposed fix — a pair-foreground edge, against every surface it lands on")
  console.log("edge  = var(--djp-pair-fg) at full strength (the button ring)")
  console.log("edge22 = the same colour at 22% over the card (the card border idiom)")
  console.log("Floor is 3:1 for both: each is a shape boundary, not text.\n")
  let worstFull = Number.POSITIVE_INFINITY
  let worstFullAt = ""
  let worstDim = Number.POSITIVE_INFINITY
  let worstDimAt = ""
  for (const tone of ["default", "muted", "dark", "accent"] as const) {
    console.log(`── tone="${tone}" ──`)
    console.log("preset      pair-fg   card      edge/card    edge22/card")
    for (const name of PALETTE_PRESETS) {
      const p = PALETTE_TABLE[name]
      const pairFg = pairForeground(p, tone)
      const card = planBackground(p, tone)
      const full = contrastRatio(pairFg, card)
      const dim = contrastRatio(mixHex(card, pairFg, 0.22), card)
      if (full < worstFull) {
        worstFull = full
        worstFullAt = `${name}/${tone}`
      }
      if (dim < worstDim) {
        worstDim = dim
        worstDimAt = `${name}/${tone}`
      }
      console.log(
        `${name.padEnd(10)}  ${pairFg}   ${card}   ${f(full)} ${mark(full, AA_LARGE)}     ` +
          `${f(dim)} ${mark(dim, AA_LARGE)}`,
      )
    }
    console.log("")
  }
  console.log(`WORST full-strength edge: ${f(worstFull)} at ${worstFullAt}`)
  console.log(`WORST 22% edge:           ${f(worstDim)} at ${worstDimAt}`)
  console.log("\nIf the 22% row fails anywhere, the card border has to be drawn stronger")
  console.log("than the existing `+ sibling` divider idiom, and the spec must say so.")

  // The lightest edge that still clears the floor EVERYWHERE. A full-strength
  // 2px ink border on every pricing card is a heavier visual change than this
  // fix needs; the minimum is what the spec should specify, so the page changes
  // as little as it can while still being correct.
  section("The lightest edge that clears 3:1 in every preset × tone")
  let needed = 0
  let neededAt = ""
  for (let alpha = 5; alpha <= 100; alpha += 5) {
    let worst = Number.POSITIVE_INFINITY
    let worstAt = ""
    for (const tone of ["default", "muted", "dark", "accent"] as const) {
      for (const name of PALETTE_PRESETS) {
        const p = PALETTE_TABLE[name]
        const card = planBackground(p, tone)
        const ratio = contrastRatio(mixHex(card, pairForeground(p, tone), alpha / 100), card)
        if (ratio < worst) {
          worst = ratio
          worstAt = `${name}/${tone}`
        }
      }
    }
    console.log(`  ${String(alpha).padStart(3)}%  worst ${f(worst)} ${mark(worst, AA_LARGE)}  (${worstAt})`)
    if (worst >= AA_LARGE && needed === 0) {
      needed = alpha
      neededAt = worstAt
    }
  }
  console.log(`\nMINIMUM ALPHA THAT PASSES EVERYWHERE: ${needed}% (binding case ${neededAt})`)

  // ── THE GROUND THE FIRST ATTEMPT MISSED ───────────────────────────────────
  //
  // The first cut of `deriveMutedOnPaper` guaranteed its value against `paper`
  // and `surface` — the two grounds it was obvious to think of — and the A/B
  // critic immediately filed three NEW art/high findings on the very page the
  // fix was meant to repair:
  //
  //   "The blurb ... renders in a mid-grey against the near-black muted
  //    background, making it visibly harder to read than the surrounding white
  //    feature list."
  //
  // `.djp-plan-blurb` and `.djp-footnote` are `--muted-foreground` consumers
  // that sit inside `.djp-plan`. On a MUTED-toned section that card is not
  // `surface` — styles.ts Move 1 paints it an 8% wash of `--foreground` into
  // `--surface`, a third ground nothing measured. (On accent and dark tones
  // these classes are switched to `color: inherit`, so they never read the token
  // there; muted is precisely the tone that override list leaves out.)
  //
  // This row is kept permanently as the reminder: "the grounds I thought of" is
  // not the same set as "the grounds it lands on", and only looking found the
  // difference.
  section("--muted-foreground on the MUTED-tone plan card — the missed third ground")
  console.log("card = color-mix(--foreground 8%, transparent) over --surface (styles.ts Move 1)\n")
  console.log("preset      surface   card      first cut   on card")
  for (const name of PALETTE_PRESETS) {
    const p = PALETTE_TABLE[name]
    const card = planBackground(p, "muted")
    const firstCut = deriveMutedCandidate(p.ink, p.paper, p.surface)
    const onCard = contrastRatio(firstCut, card)
    console.log(
      `${name.padEnd(10)}  ${p.surface}   ${card}   ${firstCut}     ${f(onCard)} ${mark(onCard, AA_BODY)}`,
    )
  }

  // ── G21: the quiz card, where the container and the variant disagree ──────
  //
  // `.djp-s-quiz .djp-quiz` paints itself `var(--background)` on EVERY tone, so
  // its children are in the neutral pair whatever the section is doing. But
  // nothing sets `color` on it, so on an accent or dark section every unstyled
  // child inherits the SECTION's foreground onto that neutral card.
  //
  // The `band` variant then inverts the problem: it sets the quiz
  // `background: transparent`, so the quiz IS the band again — and there the
  // section's pair is the right one, while the neutral one is wrong.
  //
  // So the two variants need OPPOSITE answers, and a fix that gets one right
  // gets the other wrong. Both columns below are printed for that reason.
  section("G21 — quiz text and ring, per variant, where the two answers differ")
  console.log("card variant: quiz paints --background. Its children must use the NEUTRAL pair.")
  console.log("band variant: quiz is transparent. Its children must use the SECTION's pair.\n")
  let worstCardText = Number.POSITIVE_INFINITY
  let worstCardAt = ""
  let worstBandRing = Number.POSITIVE_INFINITY
  let worstBandAt = ""
  for (const tone of ["default", "muted", "dark", "accent"] as const) {
    console.log(`── tone="${tone}" ──`)
    console.log("preset      CARD: text now  after     BAND: ring now  after")
    for (const name of PALETTE_PRESETS) {
      const p = PALETTE_TABLE[name]
      const band = sectionBackground(p, tone)
      const sectionFg = pairForeground(p, tone)

      // CARD variant. Ground is --background (paper). Today the text is the
      // section's foreground; the fix makes it the palette's own ink.
      const cardTextNow = contrastRatio(sectionFg, p.paper)
      const cardTextAfter = contrastRatio(p.ink, p.paper)

      // BAND variant. Ground is the section band. Today the RING is
      // --foreground (the card rule's override leaks into the band variant,
      // which never gives it back); the fix restores the section's own pair.
      const bandRingNow = contrastRatio(p.ink, band)
      const bandRingAfter = contrastRatio(sectionFg, band)

      if (cardTextNow < worstCardText) {
        worstCardText = cardTextNow
        worstCardAt = `${name}/${tone}`
      }
      if (bandRingNow < worstBandRing) {
        worstBandRing = bandRingNow
        worstBandAt = `${name}/${tone}`
      }
      console.log(
        `${name.padEnd(10)}  ${f(cardTextNow)} ${mark(cardTextNow, AA_BODY)}  ${f(cardTextAfter)} ${mark(cardTextAfter, AA_BODY)}   ` +
          `${f(bandRingNow)} ${mark(bandRingNow, AA_LARGE)}  ${f(bandRingAfter)} ${mark(bandRingAfter, AA_LARGE)}`,
      )
    }
    console.log("")
  }
  console.log(`WORST card text today: ${f(worstCardText)} at ${worstCardAt}  (floor ${AA_BODY})`)
  console.log(`WORST band ring today: ${f(worstBandRing)} at ${worstBandAt}  (floor ${AA_LARGE})`)

  // ── The exact document the A/B harness runs ───────────────────────────────
  section("The A/B document's own palette (brand #a8563a, accent #c99a6b, light)")
  const ab = resolvePalette({ brand: "#a8563a", accent: "#c99a6b", mode: "light" })
  console.log(JSON.stringify(ab, null, 2))
  const abMuted = contrastRatio(MUTED_FOREGROUND_HEX, ab.paper)
  const abBtn = contrastRatio(ab.brand, ab.accent)
  const abPanel = mixHex(ab.accent, ab.accentInk, 0.12)
  console.log(`\n--muted-foreground on its paper:   ${f(abMuted)} ${mark(abMuted, AA_BODY)}`)
  console.log(`--primary button on --accent band: ${f(abBtn)} ${mark(abBtn, AA_LARGE)}`)
  console.log(
    `plan panel lift (${abPanel}) on --accent: ${f(contrastRatio(abPanel, ab.accent))} ` +
      `${mark(contrastRatio(abPanel, ab.accent), AA_LARGE)}`,
  )
  console.log(
    "\nThis is the page the art critic called out: 'the Reserve a place CTA button renders",
  )
  console.log("in deep clay on the tan accent background' and 'the pricing card ... is itself")
  console.log("rendered in a similar tan/sand tone'. Both numbers above are the reason.")
}

type Tone = "default" | "muted" | "dark" | "accent"

/**
 * The foreground of the PAIR a section is in — what styles.ts already sets as
 * `color` for that tone (`.djp-s`'s base rule, plus the accent/dark tone rules
 * at styles.ts:211-212). The proposed `--djp-pair-fg` variable is exactly this
 * value, named so a shape can reach it without depending on `currentColor` —
 * which a button overwrites with its own label colour.
 */
function pairForeground(p: PaletteTokens, tone: Tone): string {
  if (tone === "dark") return p.brandInk
  if (tone === "accent") return p.accentInk
  return p.ink
}

/** What `.djp-s[data-tone=…]` paints behind the section (styles.ts:212 and siblings). */
function sectionBackground(p: PaletteTokens, tone: Tone): string {
  if (tone === "dark") return p.brand
  if (tone === "accent") return p.accent
  if (tone === "muted") return p.surface
  return p.paper
}

/**
 * What `.djp-plan` ends up painted (styles.ts:940 base, Move 1 lifts).
 *
 * The lift is `color-mix(in oklch, <ink> N%, transparent)` — a translucent
 * wash COMPOSITED over the band, so the result is an N% blend of that ink into
 * the band colour. Modelled here in sRGB rather than oklch: the browser
 * composites the alpha in sRGB, and the oklch only sets the wash's own coords,
 * so the magnitude is right even where the last digit is not.
 */
function planBackground(p: PaletteTokens, tone: Tone): string {
  if (tone === "accent") return mixHex(p.accent, p.accentInk, 0.12)
  if (tone === "dark") return mixHex(p.brand, p.brandInk, 0.12)
  if (tone === "muted") return mixHex(p.surface, p.ink, 0.08)
  return p.surface
}

// A local copy of the candidate rule, deliberately NOT imported from
// palettes.ts — this script has to be able to measure a derivation that does
// not exist yet, and once one does, an independent second implementation is
// what makes a disagreement visible instead of self-confirming.
function deriveMutedCandidate(ink: string, paper: string, surface: string): string {
  let best = ink
  for (let step = 1; step <= 100; step++) {
    const candidate = mixHex(ink, paper, step / 100)
    if (contrastRatio(candidate, paper) < 4.5 || contrastRatio(candidate, surface) < 4.5) break
    best = candidate
  }
  return best
}

function mixHex(a: string, b: string, amount: number): string {
  const pa = hex(a)
  const pb = hex(b)
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * amount))
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`
}

function hex(value: string): [number, number, number] {
  const v = value.replace("#", "")
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]
}

main()
