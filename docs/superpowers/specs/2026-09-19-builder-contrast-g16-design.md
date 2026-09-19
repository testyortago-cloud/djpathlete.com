# The funnel builder's dark/accent contrast pass — G16 and the shapes around it

**Date:** 2026-09-19
**Gap:** G16 (`docs/builder-gaps.md`), plus two shape-contrast defects G16 does not name
**Branch:** `worktree-builder-contrast-g16`
**Evidence harness:** `scripts/ab-self-render-critics.ts` (real render → real art critic)
**Measurement harness:** `scripts/measure-funnel-contrast.ts` (new, this branch)

---

## 1. What is actually wrong

Three defects, all in the same family: **a colour that is only guaranteed against
the background somebody was thinking about at the time.**

### 1a. `--muted-foreground` never enters the palette's guarantee (G16)

`--muted-foreground` is a FIXED app-level token (`app/globals.css:19`,
`oklch(0.5 0.01 250)` ≈ `#5f6469`). No `PALETTE_TABLE` preset derives or
overrides it, so `resolvePalette`'s AA proof never touches it. Measured against
all twelve presets:

| | on paper | on surface |
|---|---|---|
| the seven **light** presets | 5.98 | 5.27 – 5.43 |
| `midnight` `ember` `steel` `plum` `ink` (**dark**) | **3.26** | **3.14 – 3.24** |

Against a 4.5:1 body-text floor, the five dark-seeded presets fail and the seven
light ones pass comfortably. The defect is **dark-mode palettes only**.

### 1b. G16's "nine classes" is an undercount — the list is the bug

G16's row names nine consuming classes. `styles.ts` actually contains **21**
`color: var(--muted-foreground)` declarations. Fixing "the nine" would leave
twelve more consumers broken and silent on exactly the same palettes.

This matters beyond arithmetic. This repo has shipped four unreadable-text bugs
green, and every one hid behind a hand-listed table of legal pairs. G16's own row
is such a list. **The fix must not be another one.**

### 1c. Two shapes have no guaranteed contrast against what is behind them

Reported independently by the art-director critic at `art/high` in the
2026-09-19 A/B runs, on two different documents:

- **`7f5da342`** (light palette) — `pricing-card-contrast`: *"The pricing card
  sits on an accent-tone background and is rendered in a barely-lighter tan,
  giving the card almost no visual separation from the band behind it."*
- **`5ac26645`** (`ink` preset, dark) — `low-contrast-cta`: *"a near-black button
  on a near-black background, making it almost invisible against the dark card."*

Measured across all 12 presets × 4 tones (48 cells), floor 3:1 (WCAG 1.4.11):

| pair | result |
|---|---|
| card vs the band behind it | fails **48/48** (1.01 – 1.42) |
| CTA button vs the card it sits on | fails **26/48** (worst `ink` 1.08) |

The button's fill is `--accent` (`styles.ts:585`), flipped to `--primary` on an
accent-toned section (`styles.ts:510`) to escape the same-token collision there.
So it is a *different* unguaranteed pair per tone, which is why one measurement
of it was never going to be enough.

---

## 2. The two decisions, and why

### Decision 1 — override `--muted-foreground` itself, do not add a third `-on-paper` token

G16 frames this as "derive a palette-aware token **or** accept a lower floor".
Both were rejected in favour of a third option that the measurement surfaced.

**Why not accept a lower floor.** The identical classes score 5.98:1 on seven
presets and 3.26:1 on five. A floor accepted here would not be a principle about
secondary copy, it would be an accident of which preset the coach picked. And
`.djp-bullet-text` and `.djp-faq-a` are the page's selling copy, not fine print —
only `.djp-footnote` and `.djp-footer-legal` are genuinely secondary.

**Why not a third `--muted-on-paper` token.** G14/G15 needed new names
(`--primary-on-paper`, `--accent-on-paper`) for a specific reason: `--primary`
and `--accent` do **double duty as backgrounds**, so their value could not be
changed without repainting every band that uses them. `--muted-foreground` has no
such second job. Verified: of its 21 uses in `styles.ts`, 21 are `color:`; its
only other appearance is a `1px dashed` border on the render-only island
placeholder. **It is only ever a foreground, so it can simply be given a better
value.**

That difference is decisive, because the `-on-paper` route would require editing
all 21 call sites to `var(--muted-on-paper, var(--muted-foreground))` — and those
21 edits *are* a hand-listed table. One missed site fails silently, on dark
palettes only. Overriding the token needs **zero `styles.ts` edits** and
therefore cannot miss a consumer.

**The derivation.** `deriveMutedOnPaper(ink, paper, surface)`: start at the
palette's own `ink` (already proved against `paper` by `pickInk`) and step it
*toward* `paper` — dimmer — for as long as it still clears 4.5:1 against **both**
`paper` and `surface`. The last passing value is the most subordinate colour that
is still readable, which is what "muted" should mean. Measured result:

| | derived | on paper | on surface | (ink, for reference) |
|---|---|---|---|---|
| light presets | `#6b6b6b` – `#6e6e6e` | 5.10 – 5.33 | 4.51 – 4.70 | 21.00 |
| dark presets | `#797a7c` – `#7e7f80` | 4.53 – 4.85 | 4.50 – 4.68 | 19.46 |

All twelve pass, and at ~5:1 against `ink`'s 21:1 the token is still visibly
subordinate. Termination is guaranteed by the same argument `deriveOnPaper`
already relies on: stepping lightness toward `paper` monotonically reduces
contrast, so the loop either finds its last passing step or keeps `ink` itself.

### Decision 2 — draw a hairline edge in the pair's own foreground, do not repaint fills

The shapes in §1c fail because their **fill** is a token nothing guarantees
against the token behind it. Deriving new fills would add tokens, repaint the
page, and create a fresh set of pairs nobody has measured.

Instead, draw an **edge** in the foreground of the pair the shape already sits
in. This needs no new palette token and no table, because the guarantee already
exists: `pickInk` proves pair-foreground against the band, and the card is only
an 8–12% wash of that same foreground into that same band — so the edge moves
toward the foreground while the card barely moves at all.

That reasoning was **measured, not asserted**. A full-strength pair-foreground
edge clears 3:1 in **all 48 cells**, worst case 3.75 at `bone/accent`.

**Full strength, not the existing 22% idiom, and not the 80% minimum.**
- The `+ sibling` divider idiom in `styles.ts` uses 22%. At 22% the edge scores
  **1.41 – 2.01 and fails everywhere.** Copying the house idiom here would have
  shipped a visual no-op that looked like a fix.
- The lightest alpha that passes everywhere is 80% — but it clears by **0.04** at
  `bone/dark` (3.04 vs 3.00). `palettes.ts`'s own banner records that a 3.007:1
  near-miss is "luck, not a guarantee" and is what let an earlier bug through.
  A margin that thin is not worth the few pixels of lightness it buys.

**The mechanism.** One new CSS variable, `--djp-pair-fg`, set in the three places
`styles.ts` already sets `color` per tone. A shape cannot use `currentColor` for
this — a button overwrites `color` with its own label colour — so the pair's
foreground needs a name of its own.

```
.djp-s                     { --djp-pair-fg: var(--foreground); }          /* default + muted */
.djp-s[data-tone="accent"] { --djp-pair-fg: var(--accent-foreground); }
.djp-s[data-tone="dark"]   { --djp-pair-fg: var(--primary-foreground); }
```

Three declarations cover all four tones, and any future shape needing a
guaranteed edge reads the variable instead of earning a new table row.

---

## 3. What changes

| File | Change |
|---|---|
| `lib/funnels/sections/palettes.ts` | `PaletteTokens` gains `mutedOnPaper`; new `deriveMutedOnPaper`; `resolvePalette` populates it |
| `lib/funnels/sections/doc.ts` | palette block gains `--muted-foreground: ${palette.mutedOnPaper};` |
| `lib/funnels/sections/styles.ts` | `--djp-pair-fg` on the three tone rules; a `1px` ring on `.djp-btn-primary`; `.djp-plan`'s existing `2px solid transparent` border takes the pair foreground |
| `scripts/measure-funnel-contrast.ts` | new — walks all 12 presets × 4 tones rather than a chosen few |

`styles.ts` needs **no change for G16 at all**. Every one of the 21 consumers
already reads `var(--muted-foreground)`.

### `.djp-plan`'s border width is deliberately left at 2px

`.djp-plan` already declares `border: 2px solid transparent` (`styles.ts:941`).
Only its *colour* changes. Narrowing it to 1px would shift every pricing card's
content by one pixel on both axes for no contrast benefit.

---

## 4. Invariants this must not break

1. **No new stored key, optional or otherwise.** `PaletteTokens` is derived at
   runtime and never stored — `funnel_steps.project_data` stores the palette
   *seed* (`{preset:"ink"}` or `{brand,accent,mode}`), verified against the dev
   clone. Widening `PaletteTokens` therefore cannot break a stored draft. **No
   change to `doc.ts`'s palette zod schema is in scope.**
2. **A document with NO palette must still emit NO colour override.** The new
   declaration goes *inside* the existing `palette ? ... : ""` block. All 13
   production pages currently have `palette: null` (verified), so production
   rendering is byte-identical until somebody sets a palette.
3. **Published funnel CSS is frozen.** These changes reach a live page only when
   that funnel is re-published. No cache is involved.
4. **`SECTION_BUILDER_BLOCK_A` = 20670 and `SECTION_BUILDER_BLOCK_DESIGN` = 4433.**
   Measured at baseline; `lib/funnels/sections/prompt.ts` is not touched.
5. **Admin UI is light-only.** Nothing here builds against a `.dark` variant.

---

## 5. How this is verified

**The A/B harness is the evidence. The ratio table is not.** A ratio table only
measures the pairs it is told about, which is the failure mode that shipped four
bugs. `scripts/measure-funnel-contrast.ts` exists to design the fix and to catch
a regression in a derivation cheaply — its own banner says so.

Two documents, because one is not enough:

| document | palette | baseline `art/high` finding that must disappear |
|---|---|---|
| `7f5da342` | light (`#a8563a` / `#c99a6b`) | `pricing-card-contrast` / `low-contrast-card` |
| `5ac26645` | `ink` preset, dark page | `low-contrast-cta` |

`7f5da342` alone **cannot** prove G16: its palette is light, where
`--muted-foreground` already scores 5.98:1. The dark-palette document is what
puts G16's defect in front of the critic at all.

Baselines captured before any change:
`ab-index-7f5da342-2026-09-19063959.txt`, `ab-index-5ac26645-2026-09-19064401.txt`.

Plus: targeted vitest (`__tests__/lib/funnels`, `__tests__/app/api/admin/funnels`,
`__tests__/components/admin`), `tsc --noEmit` compared as a per-file error SET
against the 238/55-file baseline, and `npm run build` — a third gate, and the
only one Vercel runs.

---

## 6. Explicitly out of scope

- **The CTA button's fill choice.** Only its edge changes. Re-deriving the fill
  per tone is a larger design question.
- **`card/band` as a hierarchy complaint.** On the untoned ground, `--surface` on
  `--paper` is *designed* to be a whisper (`deriveSurface` mixes ≤ 8%). The edge
  fixes the boundary; it does not try to make every card a landmark.
- **The quiz classes' absence from the tone override list.** `.djp-quiz-*` reads
  `--muted-foreground` and is not in `styles.ts`'s accent/dark `color: inherit`
  list, so on a *light* palette with a *dark-toned* quiz section it is still
  unguaranteed. Decision 1 does not fix that case. **Logged as a new gap row, not
  silently folded in.**
- **`lib/funnels/sections/prompt.ts`** — not touched, per the invariant above.
