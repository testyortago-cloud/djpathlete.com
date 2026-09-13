# Widening the page builder's design system

**Date:** 2026-09-13
**Status:** approved, ready for planning
**Applies to:** both boards. `/admin/funnels/[id]/edit/[stepId]` and
`/admin/pages/[id]/edit/[stepId]` render the same `FunnelBuilder`, post to the same
`POST /api/admin/funnels/steps/[stepId]/build`, and share one prompt. One change covers both.

---

## 1. The problem, stated as the code states it

The owner's complaint is that every page the builder produces looks the same. That is not a
regression and not a model failure. It is the design, and `prompt.ts` says so out loud:

> A server-side renderer turns the document into markup; a hand-authored stylesheet already
> handles every visual decision. Your job is structure and copy: which sections, in what
> order, saying what.
>
> — [`SECTION_BUILDER_BLOCK_A`](../../../lib/funnels/sections/prompt.ts), the frozen cached prefix

That sentence was correct when the engine was built: it is what makes every generated page
publishable, safe and on-brand without a human checking the CSS. The cost, which has now been
paid long enough to see, is that the design surface handed to the model is this small:

| Knob | Range today | Owner |
|---|---|---|
| `theme.tone` | `light` \| `dark` | `registry.ts:167` |
| `theme.accent` | `accent` \| `primary` | `registry.ts:167` |
| `theme.radius` | `sharp` \| `soft` \| `round` | `registry.ts:167` |
| colour | **nothing** | — |
| typography | **nothing** — Lexend Exa / Deca hardcoded | `styles.ts:352` |
| container width | **nothing** — 72rem, every section, every page | `styles.ts:191` |
| `section.style` | `headline` (4) · `align` (2) · `tone` (4) · `pad` (3) | `registry.ts:141` |
| images | **hero only** — `heroMediaSchema` is the document's only media field | `registry.ts:223` |

**12 distinct page looks exist.** `2 × 2 × 3`. Every other visual decision is fixed in a
56 KB hand-authored stylesheet. A page cannot carry a colour, a font, a width, a background
image outside the hero, or a section divider, because no field exists to carry one.

Three further things narrow it beyond the schema:

- **Variants are thin, and two kinds have exactly one.** `faq` and `quiz` have a single
  variant each, so "make the FAQ look different" has no answer at all. `proof`, `steps`,
  `testimonial`, `pricing`, `cta` and `footer` have two.
- **`LEADGEN_RULES` prescribes one skeleton.** [`prompt.ts:521`](../../../lib/funnels/sections/prompt.ts)
  requires every capture page to open with `form` `variant:"split"` with no hero above it,
  put proof near the top, run 6-9 sections and end on a thin footer. It is good advice, and
  it is applied to every page, so every capture page comes out the same shape *by
  instruction*.
- **Nothing varies between runs.** The system prefix is frozen, the catalogue is stable, and
  the turn message carries only the doc, 8 turns of prose and the owner's sentence. The same
  brief produces the same page.

### 1a. The constraint that has been silently blocking this

`SECTION_BUILDER_BLOCK_A` is **17,393 characters against a ceiling of 17,400** pinned by
[`prompt.test.ts:354`](../../../__tests__/lib/funnels/sections/prompt.test.ts). **Seven
characters of headroom.** Measured on this branch's base, not estimated.

That ceiling has been raised three times, each time by measured content with the reason
written into the test. It is not arbitrary: Block A is written into the prompt cache on the
first turn of every page, and the test exists as a tripwire against someone inlining the
per-kind JSON Schemas (11,119 characters) instead of the compact signatures.

So a new design vocabulary cannot simply be appended. §5 says how it is paid for.

---

## 2. What this build does

Five things, in dependency order. Each is independently useful and independently testable.

1. A tracked gap inventory, `docs/builder-gaps.md`.
2. The page theme grows from 3 keys to 8, all new keys optional.
3. Per-section style grows from 4 knobs to 8.
4. Variants roughly double; images escape the hero.
5. The prompt learns the new vocabulary, learns more than one page shape, and varies.

Plus a tenant brand kit (§7), which is what makes the palette default to something other
than DJP's green.

---

## 3. The theme — 3 keys to 8

```ts
sectionDocThemeSchema = z.object({
  // existing, required, unchanged
  tone:    z.enum(["light", "dark"]),
  accent:  z.enum(["accent", "primary"]),
  radius:  z.enum(["sharp", "soft", "round"]),

  // new, every one OPTIONAL
  palette: paletteSchema.optional(),
  font:    z.enum(["athletic", "editorial", "clean", "bold", "technical"]).optional(),
  density: z.enum(["tight", "normal", "airy"]).optional(),
  width:   z.enum(["narrow", "normal", "wide", "full"]).optional(),
  rhythm:  z.enum(["flat", "alternating", "banded"]).optional(),
})
```

**Optional is load-bearing, not politeness.** `SectionDoc` is stored as JSON in
`funnel_steps.project_data`. Every existing draft holds a 3-key theme. A required key would
make `sectionDocSchema.parse` throw on read, and `reassemble` parses on every render — so a
required key breaks every existing draft *and* every draft preview, immediately, for both
boards. This is the repo's standing "tolerate the old schema" rule and here it is not about a
deploy race: the old rows are permanent until someone edits them.

### 3.1 `palette` — the one that actually changes the look

```ts
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)

const paletteSchema = z.union([
  z.object({ preset: z.enum(PALETTE_PRESETS) }),
  z.object({ brand: hex, accent: hex.optional(), mode: z.enum(["light","dark"]).optional() }),
])
```

**A custom palette is two colours, not seven, and the rest is derived.** This was changed
from a seven-value object during planning and the reason is worth stating: asking a model to
hand-pick seven mutually-contrasting hex values is asking it to do colour theory in a JSON
field, and it will sometimes produce an unreadable page. Instead `resolvePalette()` takes
`brand` (plus an optional `accent` and `mode`) and derives the full seven-token row
deterministically — ink chosen black-or-white by **measuring contrast against both candidates
and taking the winner** (never by a luminance threshold, which picks the losing colour for
mid-luminance and very bright brands alike), `surface` as brand mixed a few percent into the
paper, `accent` complemented from `brand` when not given. So "make it purple" produces a
coherent, readable purple page, which is
exactly the behaviour the owner asked for, and contrast is a **property of the function**
rather than a hope about the model.

**The palette needs no change to `styles.ts` whatsoever.** Every colour rule in that 56 KB
file already resolves through `var(--primary)`, `var(--primary-foreground)`, `var(--accent)`,
`var(--accent-foreground)`, `var(--surface)`, `var(--foreground)` and `var(--background)`
(see `styles.ts:206-212`). `themeCss()` redefining those seven custom properties under
`#djp-funnel-root` repaints every section, every card, every button and every tone band at
once. This is the single highest-leverage change in the build and it is roughly twenty lines.

`PALETTE_PRESETS` is a named, contrast-checked set of **twelve** so the model can pick a
coherent palette by name without doing colour theory in a JSON field, and so a preset can be
improved later without touching a single stored document. Twelve is chosen against Block A's
budget (§5.3): the names render once, not once per kind. The set spans warm/cool, light/dark
and high/low chroma so "make it warmer", "make it calmer" and "make it louder" each have an
answer:

`slate` · `midnight` · `forest` · `sand` · `clay` · `ember` · `ocean` · `steel` ·
`bone` · `moss` · `plum` · `ink`

Each preset is a full seven-token row (`brand`, `brandInk`, `accent`, `accentInk`, `surface`,
`ink`, `paper`) held in one table in `lib/funnels/sections/palettes.ts`, every foreground /
background pair checked to at least WCAG AA — 4.5:1 for body text, 3:1 for large text. The
contrast check is a **test over the real table**, not a comment: a preset that fails it
cannot ship, and the same assertion runs over `resolvePalette()`'s derived output for a
spread of brand hues so the custom path is held to the identical standard.

**Resolution order, and why absence matters:**

1. `theme.palette` present → use it.
2. Absent → the **tenant brand kit** (§7).
3. Tenant has none → today's behaviour exactly: `var(--primary)` / `var(--accent)`.

So **every existing page is byte-identical until someone edits it**, and a new page defaults
to on-brand rather than to a random palette.

**The hex regex is the security boundary, and it has to be, because `safeStyle` is not.**
[`sanitize.ts:98`](../../../lib/funnels/compile/sanitize.ts) drops declarations containing
`javascript:`, `expression(`, `@import`, `behavior:` or `-moz-binding` — and passes
everything else, including `url(https://attacker.example/x)`. A palette value therefore must
never reach CSS unvalidated. Two rules:

- Palette values are emitted **only** as custom property declarations in `themeCss()`,
  never interpolated into a selector or a shorthand.
- Anything not matching `^#[0-9a-fA-F]{6}$` fails Zod before it is ever rendered.

### 3.2 `font`

Five pairings. **Every one recombines fonts the page already loads** — Lexend Exa, Lexend
Deca and JetBrains Mono come from the root `app/layout.tsx`, which is the only layout
`/go` pages inherit ([`app/(funnel)/layout.tsx`](../../../app/(funnel)/layout.tsx) is a
passthrough) — plus system serif / sans / condensed stacks. No new network request, no CSP
change, no font-loading flash. Custom web fonts are a separate job and are logged as an open
gap, not smuggled in here.

### 3.3 `density`, `width`, `rhythm`

- `density` scales the section padding ramp that `data-pad` already selects. `tight` ≈ 0.75×,
  `normal` = today's values, `airy` ≈ 1.4×.
- `width` replaces the hardcoded `max-width: 72rem` at `styles.ts:191` with a custom property:
  `narrow` 56rem, `normal` 72rem (today), `wide` 88rem, `full` none.
- `rhythm` decides what a section that sets **no tone of its own** renders as, as a function
  of its position. This is the single highest-leverage knob for "it looks the same", because
  it changes the page's texture without the model reasoning per-section:
  - `flat` — today's behaviour exactly: every untoned section is `default`.
  - `alternating` — untoned sections alternate `default` / `muted` down the page.
  - `banded` — untoned sections run `default`, and every third one takes the theme's
    accent tone, so the page reads as groups rather than a list.

  `rhythm` is applied in `effectiveTone` ([`doc.ts:117`](../../../lib/funnels/sections/doc.ts)),
  which is already the single extracted rule for "what tone does this section actually render
  at" and is already shared with the review auditor. Adding a second copy of the rule
  anywhere else is the drift this codebase has paid for three times; it goes in that function
  or nowhere. `effectiveTone` therefore gains the section's **index**, and an explicit
  `style.tone` continues to outrank the page rhythm exactly as it outranks the page tone
  today.

---

## 4. Per-section style — 4 knobs to 8

```ts
sectionStyleSchema = z.object({
  headline: z.enum(["sm","md","lg","xl"]).optional(),
  align:    z.enum(["left","center","right"]).optional(),   // "right" is new
  tone:     z.enum(["default","muted","accent","dark"]).optional(),
  pad:      z.enum(["tight","normal","roomy"]).optional(),

  bg:       sectionBgSchema.optional(),                      // new
  width:    z.enum(["narrow","normal","wide","full"]).optional(),  // new, overrides theme
  divider:  z.enum(["none","line","angle","curve","fade"]).optional(),  // new
  reverse:  z.boolean().optional(),                          // new
})
```

All new knobs render the way the existing four do — as `data-*` attributes on the section
wrapper in `sectionOpenTag` ([`render.ts:285`](../../../lib/funnels/sections/render.ts)),
with the CSS living in `styles.ts`. `filterAttrs` passes `data-*` through untouched, so the
frozen compiler needs no change. `resolveStyle` gains the four new defaults.

**`bg` is the one exception and needs care:**

```ts
const sectionBgSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("gradient"), from: hex, to: hex, angle: z.number().int().min(0).max(360).optional() }),
  z.object({ kind: z.literal("image"), src: z.string().min(1).max(500),
             overlay: z.number().min(0).max(0.9).optional(),
             position: z.enum(["center","top","bottom"]).optional() }),
])
```

A `kind:"image"` background is the only new thing that emits an **inline style** rather than
a data attribute, because the URL is per-section data and cannot live in a stylesheet.
Therefore:

- The renderer passes `src` through **`safeUrl`** before emitting it — the same function
  the hero's media already uses. `safeStyle` is not sufficient (§3.1) and is not relied on.
- A `src` that fails `safeUrl` renders **no background**, not a broken one, and is reported.
- The model may not invent image URLs. It gets `bg.kind:"gradient"` freely; `kind:"image"`
  is only legal with a `src` the owner supplied (the existing `ImageSlotDialog` upload
  path). This mirrors the existing rule that the model never writes a UUID.

---

## 5. Variants, media, and paying for Block A

### 5.1 Variants

Every kind reaches 3-5 variants, prioritising the starved ones:

| Kind | Today | After |
|---|---|---|
| `faq` | `stack` | `stack`, `two-col`, `cards`, `bordered` |
| `quiz` | `boxed` | `boxed`, `band`, `split` |
| `proof` | `strip`, `stats` | + `cards`, `inline` |
| `steps` | `numbered`, `timeline` | + `cards`, `alternating` |
| `testimonial` | `stack`, `grid` | + `feature`, `carousel-static` |
| `pricing` | `cards`, `single` | + `table`, `highlight` |
| `cta` | `band`, `boxed` | + `split`, `minimal` |
| `footer` | `simple`, `columns` | + `centered` |
| `hero` | `centered`, `split`, `image-bg` | + `stacked`, `side-form` |
| `bullets` | `cards`, `list`, `numbered` | + `grid-2`, `icon-row` |
| `form` | `boxed`, `band`, `split` | + `stacked` |

### 5.2 Media escapes the hero

Optional media/image fields on `bullets` items, `steps` items, `testimonial` quotes (avatar),
`pricing` plans and `cta`. Same `safeUrl` discipline as §4. **No new section kinds in this
build** — `gallery`, logo strip, comparison table, countdown and guarantee badge are logged
as open gaps. Each new kind costs Block A directly (§5.3) and none is required to answer the
owner's complaint.

### 5.3 How Block A is paid for

Seven characters of headroom, and §5.1 adds roughly 300 characters of variant names —
*excluding* `quiz`, which `NOT_OFFERED_TO_THE_BUILDER` keeps out of Block A entirely, so its
new variants cost nothing there and are reachable only through the inspector. Three moves, in
order:

1. **New vocabulary goes in a new `SECTION_BUILDER_BLOCK_DESIGN`,** concatenated into the
   cached system string after Block A and before Block B, with **its own ceiling test and its
   own rationale**. This keeps Block A's ceiling meaning exactly what it means today — a
   tripwire against per-kind duplication — instead of turning it into a general budget that
   no longer catches the thing it was built to catch. Total cached tokens are what they are;
   splitting the assertion does not hide cost, it keeps each number interpretable.
2. **Compact the `form` description.** It is ~1,200 characters, the largest in the registry,
   and it restates the checkout rule three times. Compaction is attempted **before** any
   ceiling is raised, exactly as the 2026-09-08 raise did.
3. **Raise Block A's ceiling only by what is left over, measured**, with the reason written
   into the test alongside the three previous raises. The tripwire property must survive: an
   inlined JSON Schema must still blow straight past it.

Cache correctness is a hard constraint: Blocks A, DESIGN and B must stay **byte-stable for
the life of a page**. Nothing per-turn, no timestamps, no counters, no randomness.

---

## 6. The prompt stops saying the stylesheet decides

### 6.1 Delete the sentence that causes the complaint

"a hand-authored stylesheet already handles every visual decision" becomes false the moment
§3 and §4 land. It is replaced by a statement of what the model now owns and what it still
does not (it still never writes HTML, CSS or a UUID).

The `BUILDER_RULES` tone rule must also change. It currently ends: *"no hex or colour field
exists anywhere in this document, so these four tones ARE the colour control."* That sentence
exists because the live model, asked for "a green background with white text", **blocked the
turn** rather than answering. After §3.1 it is simply wrong, and leaving a wrong absolute in
the cached prefix is worse than leaving a gap — it would teach the model to refuse a request
it can now satisfy. It is rewritten to say tones handle *section rhythm* and the palette
handles *brand colour*.

### 6.2 One skeleton becomes a set of named recipes

`LEADGEN_RULES` is re-cut as **page recipes**, each with a name, the job it is for, and its
section spine. The model picks one and says which it picked:

- `capture-split` — today's rule, unchanged, still the default for a bare opt-in.
- `capture-hero-first` — hero, proof, short pitch, then the form. For traffic that does not
  already know the offer.
- `long-form-sales` — the full pitch: hero, problem, proof, method, pricing, objections, CTA.
- `event` — date/place/price forward, for a camp or clinic.
- `application` — qualifying page for high-ticket, where friction is the point.
- `thank-you` — confirmation and the one next action.

The conversion rules that are genuinely universal (one offer one action; no site-wide FAQ on
a campaign page; proof above the fold; the footer is not a site footer) stay as rules that
apply to **every** recipe. Only the *shape* becomes plural. This matters: the existing rules
were each written because a real page shipped broken, and none of those reasons has expired.

### 6.3 Variation

Two additions, **both in Block C (the user message), which is already uncached**:

- The model must choose and name a **design direction** on a first draft — the palette, font,
  density, rhythm and recipe it picked, and one line of why — returned in `reply` so the
  owner can read it and argue with it.
- A **variation nonce** so two identical briefs do not produce identical pages.

Putting either in Block A or B would destroy the prompt cache on every turn. `prompt.test.ts`
already asserts Block A carries no timestamp and no long digit run; the equivalent assertion
is extended to the new design block.

---

## 7. The tenant brand kit

`business_settings` has `logo_url` and no colours at all. Four columns are added:

```sql
ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS brand_color  text,
  ADD COLUMN IF NOT EXISTS accent_color text;
```

Two columns, not seven, for the same reason the custom palette is two values (§3.1): the rest
is derived by `resolvePalette()`, so a coach sets their brand colour and everything else
follows and stays readable.

Nullable with no default, deliberately: `NULL` means "this tenant has not set a brand", which
is what makes rule 3 of §3.1 resolve to today's `var(--primary)` behaviour. A default would
make every existing tenant claim a brand it never chose. A `CHECK` constrains both to
`^#[0-9a-fA-F]{6}$` so the database refuses what the Zod regex refuses — the value reaches
CSS, so one guard is not enough.

**The reader is named before the column is written**, per the standing rule: `themeCss()`
reads it as the palette default, and the builder's theme panel reads it to render the
"use my brand colours" choice. **The writer is named too**: the builder's theme panel writes
it. A column with no writer is a labelling gap.

This is the white-label-ready shape and it is why it is worth doing now rather than hardcoding
a second constant: a coach's pages stop being wired to DJP's green. It adds **no** new
`SINGLETON_BUSINESS_ID` reference — the business id is resolved the way every other
per-tenant reader resolves it.

---

## 7a. The builder UI

The new vocabulary must be reachable by hand, not only by asking the AI. Two surfaces:

- **A theme panel** in the builder, alongside the existing preview/inspector chrome. It edits
  the eight theme keys: the twelve palette presets as swatches plus a custom four-colour
  option, font, density, width, rhythm, and the existing tone/accent/radius. It also carries
  the "use my brand colours" control, which is the **writer** for §7's four columns.
- **The section inspector** ([`SectionInspector.tsx`](../../../components/admin/funnels/builder/SectionInspector.tsx))
  gains the four new per-section knobs and the widened variant lists. It already renders
  `style` knobs from the schema, so this is an extension of an existing pattern, not a new one.

Both write through the **existing** op path — the inspector already builds `update_section`
and `set_theme` ops via `patchForPath` — so a hand edit and an AI edit are the same
transaction, land in the same turn log, and are undone by the same history. No second write
path is introduced.

Per the repo's table rule this is not a table, so `data-table.tsx` does not apply; the panel
follows the existing builder chrome. Admin UI is light-only — the panel must not be built
against a `.dark` variant.

## 8. Data flow

```
owner types  ──▶ POST /steps/[stepId]/build
                   │
                   ├─ buildSystemPrompt   = BLOCK_A + BLOCK_DESIGN + BLOCK_B   (cached, byte-stable)
                   ├─ buildTurnMessage    = doc + history + message + direction + nonce   (uncached)
                   │
                   ├─ model returns ops ─▶ applyOps          (transactional, unchanged)
                   │                        └─ set_theme now carries 5 more optional keys
                   ├─ resolveDoc                              (unchanged)
                   ├─ reassemble ──▶ renderSection ──▶ sectionOpenTag  (+4 data attrs, +1 inline style)
                   │              └▶ themeCss(doc.theme, brandKit)     ◀── NEW second argument
                   └─ compileFunnelStep                       (frozen, unchanged)
```

`themeCss` gaining a second argument is the whole integration. Its callers are
`reassemble` and, through it, the draft preview and the publish path — which already share
one renderer (`renderDraftPreview`), so preview and publish cannot disagree.

**Published pages are unaffected until re-published.** Funnel CSS is frozen per publish; a
live page keeps the CSS it was published with. That is the correct behaviour here and should
be stated to the owner rather than treated as a caching bug.

---

## 9. What is explicitly NOT in this build

Logged in `docs/builder-gaps.md` as open, each with its constraint site:

- Free-form CSS per section. The owner chose the typed system; a CSS escape hatch bypasses
  the frozen compiler and lets preview and publish diverge.
- New section kinds: gallery, logo strip, comparison table, countdown, guarantee badge,
  contact/map, before-after.
- Image input in chat — pasting a reference design or brand board. `ChatPane` has no
  attachment path and the build route takes text only.
- The model seeing its own rendered page. It edits JSON with no visual feedback loop.
- Multi-page turns: "make all four pages match" cannot be expressed; a turn edits one step.
- The model editing the funnel itself — adding, reordering or renaming steps.
- Custom web fonts.
- Image generation or stock search.
- Wiring checkout / quiz / event — `eventId`, `quizId` and every UUID stay owner-only by
  design, and that design is correct.

---

## 10. Testing

Targeted suites plus a build, per the standing instruction. No full-suite run.

**Baseline, measured on this branch's base before any edit:**
`__tests__/lib/funnels` + `__tests__/app/api/admin/funnels` = **56 files, 1354 tests, all
passing**. `tsc --noEmit` = **238 errors across 79 files** (pre-existing; the per-file error
set is captured so a new error cannot hide behind a falling count).

**New tests:**

| Area | What it must pin |
|---|---|
| `registry` | A stored 3-key theme still parses. Each new key is optional. The hex regex rejects `url(`, `expression(`, `#12345`, `red`. |
| `registry` | Every kind's variant list is non-empty and every listed variant has CSS. |
| `doc`/`themeCss` | Palette resolution order: doc → tenant → `var(--primary)`. Emitted palette CSS is custom-property declarations only — assert no selector interpolation. |
| `render` | New knobs emit `data-*`. A `bg.kind:"image"` with a hostile `src` emits **no** background. `reverse`/`divider`/`width` reach the wrapper. |
| `apply` | `set_theme` merges the new optional keys partially and leaves unmentioned keys alone. |
| `prompt` | Block A **and** the new design block each stay under their own ceiling. Both are byte-stable across two renders. The nonce and the design direction appear in Block C **only**. The "no hex or colour field exists" sentence is **gone** — an inverted assertion, so re-adding it goes red. |
| `prompt` | Every recipe name in the prompt is reachable, and the universal conversion rules survive in all of them. |
| migration | Applied to dev; the four columns exist and are nullable. |

**Mutation checks** on the two guards that are load-bearing and easy to break silently: the
hex regex, and the `safeUrl` call on `bg.src`. A test that passes when the guard is deleted
is pinning nothing.

**Verification in the real app** (not a harness): three pages built through the real builder
at `/admin/funnels/[id]/edit/[stepId]` from three different briefs, screenshotted on the real
route, annotated, in `screenshots/builder-design-variety/`.

---

## 11. Risks

| Risk | Handling |
|---|---|
| A required new theme key breaks every stored draft | Every new key optional. Test parses a real 3-key doc. |
| Palette hex reaches CSS unvalidated | Zod regex + custom-property-only emission + mutation test. `safeStyle` explicitly not relied on. |
| Block A ceiling raised carelessly, losing the tripwire | Separate block with its own ceiling; compaction before raising; reason written into the test. |
| Prompt cache destroyed by per-turn content | Nonce and direction in Block C only; byte-stability asserted for A, DESIGN and B. |
| The model now picks garish palettes | Presets are contrast-checked; palette defaults to the tenant brand; the direction is stated in `reply` so the owner can reject it in one sentence. |
| Wider vocabulary makes the model slower or more likely to fail a batch | `SECTION_BUILDER_MAX_OPS` and the retry path are unchanged; new knobs are all optional, so a conservative turn is still valid. |
| Live pages change unexpectedly | They cannot — funnel CSS is frozen at publish. Stated to the owner rather than discovered by them. |

---

## 12. Open decision taken rather than asked

The tenant brand kit (§7) is a migration plus a new writer, which is more than the owner's
complaint strictly requires — the palette could have been per-page only. It is taken because
the cost is the same today and the alternative hardcodes a second single-tenant assumption
into the one subsystem that is closest to being white-label-ready. Flagged here so it can be
reversed as a scoping decision rather than discovered later.
