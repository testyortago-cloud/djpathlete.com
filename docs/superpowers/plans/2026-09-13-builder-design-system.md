# Builder Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen the funnel/landing-page builder's design vocabulary from 12 possible page looks to a genuinely open design space, so two different briefs produce two different-looking pages.

**Architecture:** The document stays typed and the publish compiler stays frozen — the model never writes HTML or CSS. What changes is the size of the typed surface: the page theme grows from 3 keys to 8 (adding a derived colour palette, font pairing, density, width and section rhythm), per-section style grows from 4 knobs to 8 (adding backgrounds, width override, dividers and reversal), every section kind reaches 3-5 variants, and images escape the hero. The palette is wired by redefining the seven CSS custom properties `styles.ts` already resolves every colour through, so 56 KB of stylesheet repaints with ~20 lines and no edit.

**Tech Stack:** TypeScript, Zod 4, Next.js 16 App Router, Vitest, Supabase (Postgres), Anthropic via `@ai-sdk/anthropic`, Playwright for real-app verification.

**Spec:** `docs/superpowers/specs/2026-09-13-builder-design-system-design.md` — read it before Task 1. The plan argues from the spec; where they disagree the spec wins and the plan is wrong.

## Global Constraints

- **Node 24.** `export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"` before any `npx`. The test runner is only honest on 24.
- **Targeted tests only.** `npx vitest run <path>`. Never the full suite. A build (`npx tsc --noEmit`) is the separate "did I break compilation" gate.
- **Baseline, measured on this branch's base:** `__tests__/lib/funnels` + `__tests__/app/api/admin/funnels` = **56 files, 1354 tests, all passing**. `tsc --noEmit` = **238 errors across 79 files**, pre-existing. A task is green when it adds no failing test and no new tsc error *file*; a falling error count is not evidence.
- **Every new theme key and every new style knob is OPTIONAL.** `SectionDoc` is stored JSON in `funnel_steps.project_data`; `reassemble` parses on every render. A required key breaks every existing draft on both boards, permanently.
- **Colour values are a security boundary.** `safeStyle` in `lib/funnels/compile/sanitize.ts` passes `url(...)`. Every hex is validated by `^#[0-9a-fA-F]{6}$` in Zod *and* emitted only as a custom-property declaration, never interpolated into a selector. Every image URL goes through `safeUrl` in the renderer.
- **Blocks A, DESIGN and B must stay byte-stable for the life of a page.** No timestamps, no counters, no randomness. Per-turn content goes in Block C (the user message) only, or the prompt cache dies on every turn.
- **Never restate a rule; call the thing that owns it.** `effectiveTone` is the single extracted "what tone does this section render at" rule and is shared with the review auditor. Rhythm goes in that function or nowhere.
- **No new `SINGLETON_BUSINESS_ID` reference.** Resolve the business id the way other per-tenant readers do.
- **Admin UI is light-only.** Do not build the theme panel against a `.dark` variant.
- **No Claude attribution** in any commit message.
- Commit after every task. Conventional-commit subjects.

---

### Task 1: The tracked gap inventory

**Files:**
- Create: `docs/builder-gaps.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a document later tasks tick rows off in. Task 12 re-reads it.

No code, no tests — this is the owner-facing deliverable half of the request ("track any gaps... like what the prompt changer can't do").

- [ ] **Step 1: Write the inventory**

One table, one row per gap, columns: `ID` · `Area` · `What the owner cannot do` · `Constrained at` · `Severity` · `Status`.

`Constrained at` must be a real `file:line` verified by opening the file — not a guess. `Status` is one of `open` / `closing in 2026-09-13 build` / `closed`.

Seed it with every gap below. Mark the ones this build closes as `closing in 2026-09-13 build`; everything in spec §9 is `open`.

Design gaps (all `closing` unless noted): only 12 page looks exist (`registry.ts:167`); no colour field anywhere (`prompt.ts` BUILDER_RULES rule 6); no typography control (`styles.ts:352`); container width fixed at 72rem (`styles.ts:191`); `align` has no `right` (`registry.ts:143`); no section background or overlay; no section divider; no way to flip a split layout; `faq` has one variant and `quiz` has one (`registry.ts:360,424`); six more kinds have two; images exist only on the hero (`registry.ts:223`); no page-shape choice — one leadgen skeleton for every page (`prompt.ts:521`); identical briefs produce identical pages (no variation input).

Capability gaps (all `open`): no free-form CSS; no `gallery` / logo-strip / comparison-table / countdown / guarantee-badge / contact-map / before-after section kinds; no image input in chat, so a reference design cannot be pasted (`ChatPane.tsx` has no attachment path); the model never sees its own rendered page, only the JSON doc (`prompt.ts` `buildTurnMessage`); a turn edits one step, so "make all four pages match" cannot be expressed; the model cannot add, reorder or rename funnel steps; no custom web fonts; no image generation or stock search; `eventId` / `quizId` / every UUID are owner-only (`prompt.ts` — **this one is `open` and correct by design**, say so in the row); history is trimmed to 8 prose turns with no memory of its own past ops (`builder-config.ts:71`).

- [ ] **Step 2: Verify every `file:line` in the table**

For each row, open the cited file at the cited line and confirm it says what the row claims. A stale line number in a tracking doc is worse than none — this repo has been bitten by exactly that (two cited line numbers in `registry.ts` had already decayed before anyone checked).

- [ ] **Step 3: Commit**

```bash
git add docs/builder-gaps.md
git commit -m "docs(builder): tracked inventory of page-builder gaps"
```

---

### Task 2: The palette module

**Files:**
- Create: `lib/funnels/sections/palettes.ts`
- Test: `__tests__/lib/funnels/sections/palettes.test.ts`

**Interfaces:**
- Consumes: nothing. Pure, no imports from the rest of the engine.
- Produces:
  - `export const PALETTE_PRESETS: readonly ["slate","midnight","forest","sand","clay","ember","ocean","steel","bone","moss","plum","ink"]`
  - `export type PaletteName = (typeof PALETTE_PRESETS)[number]`
  - `export interface PaletteTokens { brand: string; brandInk: string; accent: string; accentInk: string; surface: string; ink: string; paper: string }` — all `#rrggbb`
  - `export const PALETTE_TABLE: Record<PaletteName, PaletteTokens>`
  - `export function resolvePalette(input: { brand: string; accent?: string; mode?: "light" | "dark" }): PaletteTokens`
  - `export function contrastRatio(a: string, b: string): number`
  - `export function relativeLuminance(hex: string): number`

This task is pure functions with zero engine coupling, so it is written test-first properly.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest"
import {
  PALETTE_PRESETS, PALETTE_TABLE, resolvePalette, contrastRatio,
} from "@/lib/funnels/sections/palettes"

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for a colour on itself", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1)
    expect(contrastRatio("#3a7d44", "#3a7d44")).toBeCloseTo(1, 5)
  })
  it("is symmetric", () => {
    expect(contrastRatio("#123456", "#fedcba")).toBeCloseTo(contrastRatio("#fedcba", "#123456"), 5)
  })
})

describe("PALETTE_TABLE", () => {
  it("has a row for every advertised preset and no extras", () => {
    expect(Object.keys(PALETTE_TABLE).sort()).toEqual([...PALETTE_PRESETS].sort())
  })
  it("holds only six-digit hex", () => {
    for (const [name, row] of Object.entries(PALETTE_TABLE))
      for (const [token, value] of Object.entries(row))
        expect(value, `${name}.${token}`).toMatch(/^#[0-9a-f]{6}$/)
  })
  // THE POINT OF THE TABLE. A preset that cannot be read is worse than no preset:
  // it ships an unreadable page under a reassuring name.
  it("meets WCAG AA on every foreground/background pair it actually renders", () => {
    for (const [name, p] of Object.entries(PALETTE_TABLE)) {
      expect(contrastRatio(p.ink, p.paper), `${name}: body text on paper`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.ink, p.surface), `${name}: body text on muted band`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.brandInk, p.brand), `${name}: text on brand band`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.accentInk, p.accent), `${name}: text on accent band`).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe("resolvePalette", () => {
  it("returns every token for a bare brand colour", () => {
    const p = resolvePalette({ brand: "#6d28d9" })
    for (const value of Object.values(p)) expect(value).toMatch(/^#[0-9a-f]{6}$/)
    expect(p.brand).toBe("#6d28d9")
  })
  // The derivation exists so the MODEL never has to do colour theory. If it only
  // works for the hues someone happened to try, it has not done its job.
  it("meets WCAG AA for brand hues all the way round the wheel", () => {
    for (let hue = 0; hue < 360; hue += 15) {
      const brand = hslToHex(hue, 0.65, 0.45)
      const p = resolvePalette({ brand })
      expect(contrastRatio(p.ink, p.paper), `hue ${hue}: body on paper`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.ink, p.surface), `hue ${hue}: body on surface`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.brandInk, p.brand), `hue ${hue}: text on brand`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.accentInk, p.accent), `hue ${hue}: text on accent`).toBeGreaterThanOrEqual(4.5)
    }
  })
  it("survives the extremes that break a naive luminance split", () => {
    for (const brand of ["#000000", "#ffffff", "#ffff00", "#0000ff", "#808080"]) {
      const p = resolvePalette({ brand })
      expect(contrastRatio(p.brandInk, p.brand), brand).toBeGreaterThanOrEqual(4.5)
    }
  })
  it("honours an explicit accent and a dark mode", () => {
    expect(resolvePalette({ brand: "#6d28d9", accent: "#f59e0b" }).accent).toBe("#f59e0b")
    const dark = resolvePalette({ brand: "#6d28d9", mode: "dark" })
    const light = resolvePalette({ brand: "#6d28d9", mode: "light" })
    expect(dark.paper).not.toBe(light.paper)
    expect(contrastRatio(dark.ink, dark.paper)).toBeGreaterThanOrEqual(4.5)
  })
  it("is deterministic", () => {
    expect(resolvePalette({ brand: "#3a7d44" })).toEqual(resolvePalette({ brand: "#3a7d44" }))
  })
})

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const to = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0")
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"
npx vitest run __tests__/lib/funnels/sections/palettes.test.ts
```
Expected: FAIL — `Failed to resolve import "@/lib/funnels/sections/palettes"`.

- [ ] **Step 3: Implement**

Write `lib/funnels/sections/palettes.ts`. Required behaviour:

- `relativeLuminance` — the WCAG formula: sRGB channel / 255, linearise each (`c <= 0.03928 ? c/12.92 : ((c+0.055)/1.055) ** 2.4`), then `0.2126R + 0.7152G + 0.0722B`.
- `contrastRatio(a, b)` — `(lighter + 0.05) / (darker + 0.05)`.
- `resolvePalette`:
  - `brandInk` / `accentInk` — pick `#ffffff` or a near-black by whichever has the **higher measured contrast** against that background. Do not branch on a luminance threshold: the `#ffff00` and `#808080` cases in the test are exactly where a fixed threshold picks the losing colour. Measure both, take the winner. If the winner is still under 4.5, darken/lighten the *background* in small steps until it clears — never ship the losing pair.
  - `paper` — `#ffffff` in light mode, a near-black in dark mode.
  - `surface` — `paper` mixed a few percent toward `brand`, then verified against `ink`; if it fails, reduce the mix.
  - `ink` — chosen against `paper` the same measured way.
  - `accent` — when absent, derived from `brand` by a fixed hue rotation, then contrast-fixed like the rest.
- `PALETTE_TABLE` — twelve hand-picked rows. Write them, then let Step 4 tell you which fail AA and fix those rows. Do not weaken the assertion to fit a colour you liked.

Every exported function must be pure and synchronous. No imports from the rest of the engine — this file is depended on by the schema, so a cycle here is expensive.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run __tests__/lib/funnels/sections/palettes.test.ts
```
Expected: PASS, all tests.

- [ ] **Step 5: Mutation-check the contrast guard**

The AA assertions are the whole value of this file. Prove they can fail: temporarily change one `PALETTE_TABLE` row's `ink` to its own `paper` value and re-run. The suite MUST go red naming that preset. Revert. A green run here means the assertion is pinning nothing and must be fixed before moving on.

- [ ] **Step 6: Commit**

```bash
git add lib/funnels/sections/palettes.ts __tests__/lib/funnels/sections/palettes.test.ts
git commit -m "feat(builder): contrast-checked palette presets and derivation"
```

---

### Task 3: Widen the theme and section-style schemas

**Files:**
- Modify: `lib/funnels/sections/registry.ts` — `sectionDocThemeSchema` (~:167), `sectionStyleSchema` (~:141), every `*_VARIANTS` (~:209-454)
- Test: `__tests__/lib/funnels/sections/registry.test.ts` (extend; create if absent)

**Interfaces:**
- Consumes: `PALETTE_PRESETS` from Task 2.
- Produces:
  - `sectionDocThemeSchema` with optional `palette`, `font`, `density`, `width`, `rhythm`
  - `export const paletteSchema`, `export type SectionPalette`
  - `sectionStyleSchema` with optional `bg`, `width`, `divider`, `reverse`, and `align` widened to include `"right"`
  - `export const sectionBgSchema`, `export type SectionBg`
  - Widened variant tuples exactly as spec §5.1 tabulates them

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest"
import {
  sectionDocThemeSchema, sectionStyleSchema, sectionDocSchema,
  SECTION_REGISTRY, SECTION_KINDS,
} from "@/lib/funnels/sections/registry"

describe("theme schema stays backward compatible", () => {
  // THE ONE THAT MATTERS. Every stored draft on both boards holds a 3-key
  // theme, and reassemble() parses on every render — so a required new key
  // does not fail a migration, it fails every existing page, forever.
  it("parses a stored three-key theme", () => {
    const stored = { tone: "light", accent: "accent", radius: "soft" }
    expect(sectionDocThemeSchema.parse(stored)).toEqual(stored)
  })
  it("parses a whole stored document that predates every new key", () => {
    const doc = {
      v: 1, engine: "sections",
      theme: { tone: "dark", accent: "primary", radius: "round" },
      sections: [{ id: "hero", kind: "hero", variant: "centered", style: {},
                   props: { headline: "Get strong", primaryCta: { label: "Start", target: { kind: "booking" } } } }],
    }
    expect(() => sectionDocSchema.parse(doc)).not.toThrow()
  })
  it("accepts every new key and rejects an unknown value for each", () => {
    const base = { tone: "light", accent: "accent", radius: "soft" }
    expect(() => sectionDocThemeSchema.parse({ ...base, palette: { preset: "ember" },
      font: "editorial", density: "airy", width: "wide", rhythm: "alternating" })).not.toThrow()
    expect(() => sectionDocThemeSchema.parse({ ...base, font: "comic" })).toThrow()
    expect(() => sectionDocThemeSchema.parse({ ...base, rhythm: "swirly" })).toThrow()
    expect(() => sectionDocThemeSchema.parse({ ...base, palette: { preset: "chartreuse" } })).toThrow()
  })
})

describe("palette hex is a security boundary, not a formatting preference", () => {
  const base = { tone: "light", accent: "accent", radius: "soft" }
  const reject = ["url(https://x/y)", "expression(alert(1))", "red", "#12345", "#1234567",
                  "#ggghhh", "#fff", "", "#123456;background:url(https://x)"]
  it.each(reject)("rejects %j as a brand colour", (brand) => {
    expect(() => sectionDocThemeSchema.parse({ ...base, palette: { brand } })).toThrow()
  })
  it("accepts a plain six-digit hex in either case", () => {
    expect(() => sectionDocThemeSchema.parse({ ...base, palette: { brand: "#6D28D9" } })).not.toThrow()
  })
})

describe("section style knobs", () => {
  it("still accepts an empty style object", () => {
    expect(sectionStyleSchema.parse({})).toEqual({})
  })
  it("accepts the new knobs", () => {
    expect(() => sectionStyleSchema.parse({
      align: "right", width: "narrow", divider: "angle", reverse: true,
      bg: { kind: "gradient", from: "#111111", to: "#333333", angle: 180 },
    })).not.toThrow()
  })
  it("rejects a hostile background image url at the schema, before render", () => {
    expect(() => sectionStyleSchema.parse({ bg: { kind: "image", src: "" } })).toThrow()
    expect(() => sectionStyleSchema.parse({ bg: { kind: "gradient", from: "url(x)", to: "#fff" } })).toThrow()
  })
  it("bounds the overlay so a background cannot black out its own copy", () => {
    expect(() => sectionStyleSchema.parse({ bg: { kind: "image", src: "/a.png", overlay: 1.5 } })).toThrow()
    expect(() => sectionStyleSchema.parse({ bg: { kind: "image", src: "/a.png", overlay: 0.5 } })).not.toThrow()
  })
})

describe("variants", () => {
  it("gives every kind at least three", () => {
    for (const kind of SECTION_KINDS)
      expect(SECTION_REGISTRY[kind].variants.length, kind).toBeGreaterThanOrEqual(3)
  })
  it("lists no duplicates", () => {
    for (const kind of SECTION_KINDS) {
      const v = SECTION_REGISTRY[kind].variants
      expect(new Set(v).size, kind).toBe(v.length)
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run __tests__/lib/funnels/sections/registry.test.ts
```
Expected: FAIL — the new-key, hex-rejection, style-knob and variant-count tests all fail; the two backward-compatibility tests PASS already (they are the regression guard, not a new feature).

- [ ] **Step 3: Implement**

In `registry.ts`:

```ts
import { PALETTE_PRESETS } from "@/lib/funnels/sections/palettes"

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colour must be a six-digit hex like #3a7d44")

export const paletteSchema = z.union([
  z.object({ preset: z.enum(PALETTE_PRESETS) }),
  z.object({ brand: hexColor, accent: hexColor.optional(), mode: z.enum(["light", "dark"]).optional() }),
])
export type SectionPalette = z.infer<typeof paletteSchema>

export const sectionBgSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("gradient"), from: hexColor, to: hexColor,
             angle: z.number().int().min(0).max(360).optional() }),
  z.object({ kind: z.literal("image"), src: z.string().min(1).max(500),
             overlay: z.number().min(0).max(0.9).optional(),
             position: z.enum(["center", "top", "bottom"]).optional() }),
])
export type SectionBg = z.infer<typeof sectionBgSchema>
```

Extend `sectionDocThemeSchema` with the five optional keys (`palette`, `font`, `density`, `width`, `rhythm`) using the enums from spec §3. Extend `sectionStyleSchema` with `bg`, `width`, `divider`, `reverse`, and add `"right"` to `align`. Widen every `*_VARIANTS` tuple to match the spec §5.1 table exactly.

Leave `tone`, `accent` and `radius` **required and untouched**.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run __tests__/lib/funnels/sections/registry.test.ts
```
Expected: PASS.

- [ ] **Step 5: Run the neighbours that parse documents**

```bash
npx vitest run __tests__/lib/funnels
```
Expected: no new failures against the 56-file / 1354-test baseline. Widening a union can silently break a consumer whose `switch` has no exhaustiveness arm — if anything here goes red, that is a real finding, not a flaky test.

- [ ] **Step 6: Commit**

```bash
git add lib/funnels/sections/registry.ts __tests__/lib/funnels/sections/registry.test.ts
git commit -m "feat(builder): widen theme, section style knobs and variant lists"
```

---

### Task 4: Wire the palette, width, density and font into the emitted CSS

**Files:**
- Modify: `lib/funnels/sections/doc.ts` — `themeCss` (~:133), `reassemble` (~:247)
- Modify: `lib/funnels/sections/styles.ts` — the two hardcoded `72rem` at `:188` and `:191`, the `data-pad` ramp at `:194-196`, the `font-family` declarations
- Test: `__tests__/lib/funnels/sections/doc.test.ts` (extend)

**Interfaces:**
- Consumes: `resolvePalette`, `PALETTE_TABLE` (Task 2); `SectionDocTheme` with new keys (Task 3).
- Produces: `themeCss(theme: SectionDocTheme, brandKit?: { brand: string; accent?: string } | null): string`, and `reassemble(doc, ctx)` where `ctx` gains an optional `brandKit` of that same shape.

This is the highest-leverage task in the plan: because every colour rule in `styles.ts` already resolves through seven custom properties, redefining them repaints the entire stylesheet.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest"
import { reassemble } from "@/lib/funnels/sections/doc"
import { PALETTE_TABLE } from "@/lib/funnels/sections/palettes"

const doc = (theme: Record<string, unknown>) => ({
  v: 1, engine: "sections", theme: { tone: "light", accent: "accent", radius: "soft", ...theme },
  sections: [{ id: "hero", kind: "hero", variant: "centered", style: {},
               props: { headline: "Get strong", primaryCta: { label: "Start", target: { kind: "booking" } } } }],
} as never)

describe("palette resolution order", () => {
  it("uses the document's own palette when it has one", () => {
    const css = reassemble(doc({ palette: { preset: "ember" } })).css
    expect(css).toContain(`--primary: ${PALETTE_TABLE.ember.brand}`)
  })
  it("falls back to the tenant brand kit when the document has none", () => {
    const css = reassemble(doc({}), { brandKit: { brand: "#6d28d9" } } as never).css
    expect(css).toContain("--primary: #6d28d9")
  })
  it("a document palette outranks the tenant brand kit", () => {
    const css = reassemble(doc({ palette: { preset: "ocean" } }), { brandKit: { brand: "#6d28d9" } } as never).css
    expect(css).toContain(`--primary: ${PALETTE_TABLE.ocean.brand}`)
    expect(css).not.toContain("--primary: #6d28d9")
  })
  // The no-regression guard: an untouched page must render exactly as it does today.
  it("emits no palette override at all when neither is present", () => {
    expect(reassemble(doc({})).css).not.toMatch(/--primary:/)
  })
})

describe("palette values reach CSS only as custom properties", () => {
  it("never interpolates a palette value into a selector", () => {
    const css = reassemble(doc({ palette: { brand: "#6d28d9" } })).css
    for (const line of css.split("\n")) {
      const brace = line.indexOf("{")
      const selector = brace === -1 ? line : line.slice(0, brace)
      expect(selector, line).not.toContain("#6d28d9")
    }
  })
})

describe("width, density and font", () => {
  it("narrow and wide change the emitted max width", () => {
    expect(reassemble(doc({ width: "narrow" })).css).toContain("--djp-maxw: 56rem")
    expect(reassemble(doc({ width: "wide" })).css).toContain("--djp-maxw: 88rem")
  })
  it("defaults to today's 72rem when width is absent", () => {
    expect(reassemble(doc({})).css).toContain("--djp-maxw: 72rem")
  })
  it("density scales the padding ramp", () => {
    expect(reassemble(doc({ density: "airy" })).css).toContain("--djp-density")
    expect(reassemble(doc({ density: "airy" })).css)
      .not.toBe(reassemble(doc({ density: "tight" })).css)
  })
  it("font swaps the heading and body stacks", () => {
    const a = reassemble(doc({ font: "editorial" })).css
    const b = reassemble(doc({ font: "technical" })).css
    expect(a).toContain("--djp-font-head")
    expect(a).not.toBe(b)
  })
})

describe("two different themes produce two different stylesheets", () => {
  it("is the whole point of the build", () => {
    const a = reassemble(doc({ palette: { preset: "ember" }, font: "bold", width: "narrow", density: "tight" })).css
    const b = reassemble(doc({ palette: { preset: "ocean" }, font: "editorial", width: "wide", density: "airy" })).css
    expect(a).not.toBe(b)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run __tests__/lib/funnels/sections/doc.test.ts
```
Expected: FAIL on every new test except the "emits no palette override" one, which passes already and is the regression guard.

- [ ] **Step 3: Implement**

In `doc.ts`, give `themeCss` a second parameter and emit a `#djp-funnel-root` block:

```ts
function paletteTokens(theme: SectionDocTheme, brandKit?: BrandKit | null): PaletteTokens | null {
  if (theme.palette) {
    return "preset" in theme.palette ? PALETTE_TABLE[theme.palette.preset] : resolvePalette(theme.palette)
  }
  if (brandKit?.brand) return resolvePalette(brandKit)
  return null   // today's behaviour, byte for byte
}
```

When it returns non-null, emit exactly these seven declarations and nothing else colour-related:
`--primary`, `--primary-foreground`, `--accent`, `--accent-foreground`, `--surface`,
`--foreground`, `--background`. Always emit `--djp-maxw`, `--djp-density` and the two font
custom properties, defaulting to today's values so an untouched page is unchanged.

In `styles.ts`, replace the two literal `72rem` with `var(--djp-maxw, 72rem)`, multiply the
three `data-pad` values by `var(--djp-density, 1)` via `calc()`, and point the `font-family`
declarations at `var(--djp-font-head, …)` / `var(--djp-font-body, …)` keeping the **existing
stacks as the fallback** so nothing changes when the properties are absent.

Thread `brandKit` through `reassemble`'s `RenderContext`.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run __tests__/lib/funnels/sections/doc.test.ts __tests__/lib/funnels/sections/styles.test.ts
```
Expected: PASS.

- [ ] **Step 5: Prove an untouched page did not move**

```bash
npx vitest run __tests__/lib/funnels
```
Expected: no new failures. Any existing snapshot that changes is a **real regression** for live pages — investigate, do not update the snapshot to match.

- [ ] **Step 6: Commit**

```bash
git add lib/funnels/sections/doc.ts lib/funnels/sections/styles.ts __tests__/lib/funnels/sections/doc.test.ts
git commit -m "feat(builder): emit palette, width, density and font as per-document CSS"
```

---

### Task 5: Section rhythm

**Files:**
- Modify: `lib/funnels/sections/doc.ts` — `effectiveTone` (~:117), `sectionForPage` (~:126), the `reassemble` map (~:250)
- Modify: `lib/funnels/sections/review/audit.ts` — the `effectiveTone` call site
- Test: `__tests__/lib/funnels/sections/doc.test.ts` (extend)

**Interfaces:**
- Consumes: `theme.rhythm` (Task 3).
- Produces: `effectiveTone(section: Section, theme: SectionDocTheme, index?: number)` — `index` optional so every existing caller still compiles and behaves identically.

- [ ] **Step 1: Write the failing tests**

```ts
describe("rhythm", () => {
  const page = (rhythm?: string) => ({
    v: 1, engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft", ...(rhythm ? { rhythm } : {}) },
    sections: ["a","b","c","d","e","f"].map((id) => ({
      id, kind: "bullets", variant: "list", style: {},
      props: { items: [{ title: "One" }, { title: "Two" }] },
    })),
  } as never)
  const tones = (html: string) => [...html.matchAll(/data-tone="([a-z]+)"/g)].map((m) => m[1])

  it("flat is today's behaviour: every untoned section renders default", () => {
    expect(new Set(tones(reassemble(page("flat")).html))).toEqual(new Set(["default"]))
  })
  it("absent rhythm is identical to flat", () => {
    expect(tones(reassemble(page()).html)).toEqual(tones(reassemble(page("flat")).html))
  })
  it("alternating alternates untoned sections", () => {
    expect(tones(reassemble(page("alternating")).html))
      .toEqual(["default","muted","default","muted","default","muted"])
  })
  it("banded groups the page instead of listing it", () => {
    const t = tones(reassemble(page("banded")).html)
    expect(new Set(t).size).toBeGreaterThan(1)
    expect(t.length).toBe(6)
  })
  // An explicit choice outranks a page default. This is already true of theme.tone
  // and must stay true of rhythm, or the inspector's tone control stops working.
  it("never overrides a section's own tone", () => {
    const doc = page("alternating") as never as { sections: { style: Record<string, string> }[] }
    doc.sections[1].style.tone = "accent"
    expect(tones(reassemble(doc as never).html)[1]).toBe("accent")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run __tests__/lib/funnels/sections/doc.test.ts -t rhythm
```
Expected: FAIL — `alternating` and `banded` currently render all-`default`.

- [ ] **Step 3: Implement**

Add the rhythm branch **inside `effectiveTone`**, after the existing "own tone wins" guard and before the page-tone default. Per the Global Constraints, this rule lives in exactly one function — `sectionForPage` and the review auditor call it, they do not re-implement it. `reassemble`'s map passes the section's index. `index === undefined` must behave exactly as today.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run __tests__/lib/funnels/sections/doc.test.ts
```
Expected: PASS.

- [ ] **Step 5: Mutation-check the precedence guard**

Delete the "own tone wins" early return and re-run. The "never overrides a section's own tone" test MUST go red. Restore it. Two guards masking each other is a known failure in this repo — if the test stays green, it is pinning nothing.

- [ ] **Step 6: Commit**

```bash
git add lib/funnels/sections/doc.ts lib/funnels/sections/review/audit.ts __tests__/lib/funnels/sections/doc.test.ts
git commit -m "feat(builder): section rhythm so untoned sections vary down the page"
```

---

### Task 6: Render the new per-section knobs

**Files:**
- Modify: `lib/funnels/sections/render.ts` — `resolveStyle` (~:275), `sectionOpenTag` (~:285)
- Modify: `lib/funnels/sections/styles.ts` — add rules for `data-divider`, `data-width`, `data-reverse`, `data-align="right"`, and the background layers
- Test: `__tests__/lib/funnels/sections/render.test.ts` (extend)

**Interfaces:**
- Consumes: `sectionStyleSchema` with `bg`/`width`/`divider`/`reverse` (Task 3).
- Produces: section wrappers carrying `data-divider`, `data-width`, `data-reverse` and, for image backgrounds only, an inline `style` with a `safeUrl`-validated `background-image`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("new style knobs reach the wrapper", () => {
  it("emits data attributes for divider, width and reverse", () => {
    const html = renderOne({ divider: "angle", width: "narrow", reverse: true })
    expect(html).toContain('data-divider="angle"')
    expect(html).toContain('data-width="narrow"')
    expect(html).toContain('data-reverse="true"')
  })
  it("defaults every new knob so an untouched section is unchanged", () => {
    const html = renderOne({})
    expect(html).toContain('data-divider="none"')
    expect(html).toContain('data-reverse="false"')
  })
  it("supports align right", () => {
    expect(renderOne({ align: "right" })).toContain('data-align="right"')
  })
})

describe("background images are a URL boundary", () => {
  it("renders a safe image background", () => {
    const html = renderOne({ bg: { kind: "image", src: "/uploads/a.png" } })
    expect(html).toContain("background-image")
    expect(html).toContain("/uploads/a.png")
  })
  // safeStyle does NOT stop this — it only drops javascript:/expression(/@import/
  // behavior:/-moz-binding. The renderer is the guard, so this test is the guard's test.
  it.each([
    "javascript:alert(1)",
    'x.png"); background-image: url("https://evil.example/x.png',
    "data:text/html,<script>alert(1)</script>",
    "//evil.example/x.png",
  ])("renders NO background for hostile src %j", (src) => {
    const html = renderOne({ bg: { kind: "image", src } })
    expect(html).not.toContain("evil.example")
    expect(html).not.toContain("javascript:")
    expect(html).not.toContain("background-image")
  })
  it("renders a gradient background from validated hex", () => {
    const html = renderOne({ bg: { kind: "gradient", from: "#111111", to: "#333333" } })
    expect(html).toContain("linear-gradient")
  })
  it("kind none emits no background at all", () => {
    expect(renderOne({ bg: { kind: "none" } })).not.toContain("background-image")
  })
})
```

Write `renderOne(style)` as a local helper that builds a minimal one-section doc with that
`style` and returns `reassemble(doc).html`.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run __tests__/lib/funnels/sections/render.test.ts
```
Expected: FAIL — no new attributes are emitted.

- [ ] **Step 3: Implement**

Extend `resolveStyle` with the four new defaults (`divider: "none"`, `width: undefined`,
`reverse: false`, `bg: {kind:"none"}`) and `sectionOpenTag` to emit them. For `bg`:

- `kind: "image"` — call `safeUrl(src)` (import from `lib/funnels/compile/sanitize.ts`). If it
  returns `undefined`, emit **no** style attribute at all. Never emit a partial background.
- `kind: "gradient"` — values are already hex-validated by Zod; emit a `linear-gradient`.
- The overlay is a second layer in the same declaration, not a child element.

Add the matching CSS to `styles.ts`. `data-width` overrides `--djp-maxw` for that section
only. `data-reverse="true"` flips the two-column grids (`hero.split`, `form.split`,
`cta.split`). Dividers use a pseudo-element so they add no DOM.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run __tests__/lib/funnels/sections/render.test.ts __tests__/lib/funnels/compile
```
Expected: PASS. The compile suite must be green too — the wrapper now carries an inline style
that the frozen sanitizer will see.

- [ ] **Step 5: Mutation-check the URL guard**

Replace the `safeUrl(src)` call with `src` and re-run. Every hostile-src case MUST go red.
Restore. This is the one new place untrusted data reaches CSS.

- [ ] **Step 6: Commit**

```bash
git add lib/funnels/sections/render.ts lib/funnels/sections/styles.ts __tests__/lib/funnels/sections/render.test.ts
git commit -m "feat(builder): render section backgrounds, dividers, width and reversal"
```

---

### Task 7: CSS for the new variants, and media beyond the hero

**Files:**
- Modify: `lib/funnels/sections/styles.ts` — a rule block per new variant from Task 3
- Modify: `lib/funnels/sections/registry.ts` — optional media on `bullets` items, `steps` items, `testimonial` quotes, `pricing` plans, `cta`
- Modify: `lib/funnels/sections/render.ts` — render those media fields
- Test: `__tests__/lib/funnels/sections/styles.test.ts`, `render.test.ts`

**Interfaces:**
- Consumes: the widened variant tuples (Task 3), `safeUrl` discipline (Task 6).
- Produces: every advertised variant has CSS; item-level `media?: { src: string; alt?: string }`.

- [ ] **Step 1: Write the failing test**

```ts
import { SECTION_REGISTRY, SECTION_KINDS } from "@/lib/funnels/sections/registry"
import { SECTION_CSS } from "@/lib/funnels/sections/styles"

// A variant the model is TOLD it may use, with no CSS behind it, renders as an
// unstyled section on a live page. The prompt advertises the registry, so the
// registry and the stylesheet have to agree.
it("has a CSS rule for every variant the registry advertises", () => {
  for (const kind of SECTION_KINDS)
    for (const variant of SECTION_REGISTRY[kind].variants)
      expect(SECTION_CSS[kind], `${kind}.${variant}`).toContain(`djp-v-${variant}`)
})

it("renders item media and drops a hostile one", () => {
  expect(renderBullets({ media: { src: "/uploads/a.png", alt: "A" } })).toContain("/uploads/a.png")
  expect(renderBullets({ media: { src: "javascript:alert(1)" } })).not.toContain("javascript:")
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run __tests__/lib/funnels/sections/styles.test.ts
```
Expected: FAIL, naming each new variant that has no CSS.

- [ ] **Step 3: Implement**

Add a rule block per new variant. Keep them flat and `var(--…)`-only, matching the file's
existing constraints — no nesting, no hardcoded colours, so every new variant inherits the
palette from Task 4 for free. Add the optional `media` fields and render them as `<img>` with
`safeUrl` + `loading="lazy"`.

Watch the CSS size cap: `FUNNEL_STEP_CSS_MAX_LENGTH` is 200,000 and `checkSizeCaps` enforces
it at publish. Measure after adding; the file is ~56 KB today so there is room, but measure
rather than assume.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run __tests__/lib/funnels/sections
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/funnels/sections/styles.ts lib/funnels/sections/registry.ts lib/funnels/sections/render.ts __tests__/lib/funnels/sections
git commit -m "feat(builder): CSS for the new variants and media beyond the hero"
```

---

### Task 8: Tenant brand kit

**Files:**
- Create: `supabase/migrations/00260_business_brand_colors.sql`
- Modify: `lib/db/businesses.ts` — `BusinessSettings` type and its select
- Test: `__tests__/lib/db/businesses.test.ts` (extend or create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `BusinessSettings` gains `brand_color: string | null` and `accent_color: string | null`; Task 9 reads them.

- [ ] **Step 1: Check the migration number is still free**

```bash
ls supabase/migrations/ | tail -3
```
Migration numbers collide silently in this repo — two branches both take the next number and
git merges it clean. If `00260` is taken, use the next free one and say so in the commit.

- [ ] **Step 2: Write the migration**

```sql
-- 00260_business_brand_colors.sql
-- Per-tenant brand colours for the page builder's palette default.
--
-- Nullable with no default on purpose: NULL means "this tenant has not chosen a
-- brand", which is what makes themeCss() fall through to today's var(--primary)
-- behaviour. A default would make every existing tenant claim a brand it never set.
--
-- Two columns, not seven: resolvePalette() derives ink, surface, paper and accent
-- from the brand, so the derived palette is contrast-checked by construction.
--
-- The CHECK mirrors the Zod regex deliberately. These values are interpolated into
-- a CSS custom property, and safeStyle() in the funnel compiler does NOT reject
-- url(...) — so one guard is not enough.
ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS brand_color  text,
  ADD COLUMN IF NOT EXISTS accent_color text;

ALTER TABLE public.business_settings
  DROP CONSTRAINT IF EXISTS business_settings_brand_color_hex;
ALTER TABLE public.business_settings
  ADD CONSTRAINT business_settings_brand_color_hex
  CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9a-fA-F]{6}$');

ALTER TABLE public.business_settings
  DROP CONSTRAINT IF EXISTS business_settings_accent_color_hex;
ALTER TABLE public.business_settings
  ADD CONSTRAINT business_settings_accent_color_hex
  CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9a-fA-F]{6}$');
```

The `DROP CONSTRAINT IF EXISTS` before each `ADD` is required: the applier re-runs migrations
and a bare `ADD CONSTRAINT` is not idempotent.

- [ ] **Step 3: Apply to dev and verify against the real schema**

Apply it (standing instruction: dev migrations are applied automatically). Then confirm the
columns and both constraints exist by querying `pg_constraint` — **not** `information_schema`,
which has reported zero constraints on a table that had three.

Also verify the CHECK actually refuses: attempt an update setting `brand_color` to
`'url(x)'` and confirm it errors.

- [ ] **Step 4: Extend the DAL**

Add both columns to `BusinessSettings` and to the select in `getBusinessSettings`. A column
the DAL does not select is invisible to every reader.

- [ ] **Step 5: Run the DAL tests**

```bash
npx vitest run __tests__/lib/db/businesses.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/00260_business_brand_colors.sql lib/db/businesses.ts __tests__/lib/db
git commit -m "feat(builder): per-tenant brand colours on business_settings"
```

---

### Task 9: Feed the brand kit into the build and preview paths

**Files:**
- Modify: `app/api/admin/funnels/steps/[stepId]/build/route.ts` — read the brand kit, pass to `reassemble`
- Modify: `lib/funnels/preview-render.ts` — same, so preview and publish agree
- Modify: `lib/funnels/compile/` publish path caller — same
- Test: `__tests__/app/api/admin/funnels/build-route.test.ts` (extend)

**Interfaces:**
- Consumes: `getBusinessSettings` (Task 8), `reassemble(doc, { brandKit })` (Task 4).
- Produces: nothing new; this is wiring.

- [ ] **Step 1: Write the failing test**

```ts
it("passes the tenant brand colour through to the rendered CSS", async () => {
  // getBusinessSettings mocked to return brand_color: "#6d28d9"
  const res = await POST(req, ctx)
  expect(cssFrom(res)).toContain("--primary: #6d28d9")
})
// Preview and publish disagreeing about one document is this subsystem's worst
// failure mode, and the reason renderDraftPreview exists at all.
it("preview and publish resolve the same brand kit for the same document", async () => {
  expect(previewCss).toBe(publishCss)
})
it("degrades to today's behaviour when the brand kit cannot be read", async () => {
  // getBusinessSettings throws
  expect(cssFrom(res)).not.toMatch(/--primary:/)
  expect(res.status).toBe(200)
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run __tests__/app/api/admin/funnels/build-route.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

Read the brand kit where the route already resolves page context, and pass it into
`reassemble`. **Wrap the read** — the route's contract is that nothing in it may 500, and a
brand-kit read is exactly the kind of new dependency that would break that. A failed read
degrades to `null`, which is today's behaviour, and must not fail the turn. Follow the
existing `loadCatalogues` degradation pattern in the same file rather than inventing a second
one.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run __tests__/app/api/admin/funnels __tests__/lib/funnels/preview-render.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/funnels lib/funnels/preview-render.ts __tests__/app/api/admin/funnels
git commit -m "feat(builder): resolve the tenant brand kit in build, preview and publish"
```

---

### Task 10: Teach the prompt the new vocabulary, more than one page shape, and variation

**Files:**
- Modify: `lib/funnels/sections/prompt.ts` — Block A's opening, `BUILDER_RULES` rule 6, `LEADGEN_RULES`, new `SECTION_BUILDER_BLOCK_DESIGN`, `buildSystemPrompt`, `buildTurnMessage`, `BuilderTurnInput`
- Modify: `lib/funnels/sections/builder-config.ts` — a design-block ceiling constant
- Modify: `app/api/admin/funnels/steps/[stepId]/build/route.ts` — pass the nonce
- Test: `__tests__/lib/funnels/sections/prompt.test.ts` (extend)

**Interfaces:**
- Consumes: everything from Tasks 3-7.
- Produces: `SECTION_BUILDER_BLOCK_DESIGN`, `PAGE_RECIPES`, and `BuilderTurnInput` gaining `variationSeed: string`.

This is the task that actually changes what the model produces. The schema work above only
makes it *possible*.

- [ ] **Step 1: Measure Block A before touching it**

```bash
npx tsx -e "import {SECTION_BUILDER_BLOCK_A} from './lib/funnels/sections/prompt'; console.log(SECTION_BUILDER_BLOCK_A.length)"
```
Record the number. It was 17,393 against a 17,400 ceiling at the branch point, and Task 3's
widened variant lists will have pushed it over — that is expected and is what Step 4 pays for.

- [ ] **Step 2: Write the failing tests**

```ts
describe("the prompt no longer claims the stylesheet owns the design", () => {
  // Inverted assertions: they pass only once the sentence is GONE, so putting it
  // back goes red. A plain "contains the new text" test would not catch a revert.
  it("has dropped the sentence that caused every page to look the same", () => {
    expect(SECTION_BUILDER_BLOCK_A).not.toContain("already handles every visual decision")
  })
  it("has dropped the absolute that made the model refuse colour requests", () => {
    expect(buildSystemPrompt(input)).not.toContain("no hex or colour field exists")
  })
  it("tells the model it owns the palette", () => {
    expect(buildSystemPrompt(input)).toMatch(/palette/i)
  })
})

describe("page recipes", () => {
  it("offers more than one page shape", () => {
    expect(PAGE_RECIPES.length).toBeGreaterThanOrEqual(6)
  })
  it("names every recipe in the prompt", () => {
    for (const r of PAGE_RECIPES) expect(buildSystemPrompt(input)).toContain(r.name)
  })
  // These rules each exist because a real page shipped broken. Making the SHAPE
  // plural must not make the CONVERSION rules optional.
  it("keeps the universal conversion rules outside the recipes", () => {
    const p = buildSystemPrompt(input)
    expect(p).toContain("ONE OFFER, ONE ACTION")
    expect(p).toMatch(/NEVER USE `faq` WITH `source: "live"` ON A CAMPAIGN PAGE/)
    expect(p).toContain("PROOF GOES NEAR THE TOP")
  })
})

describe("the cached prefix stays cacheable", () => {
  it("is byte-identical across two renders with the same input", () => {
    expect(buildSystemPrompt(input)).toBe(buildSystemPrompt(input))
  })
  it("carries no timestamp and no long digit run", () => {
    const p = buildSystemPrompt(input)
    expect(p).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
    expect(p).not.toMatch(/\b\d{10,}\b/)
  })
  it("keeps the variation seed OUT of the system prompt entirely", () => {
    expect(buildSystemPrompt(input)).not.toContain("seed-abc-123")
    expect(buildTurnMessage({ ...turnInput, variationSeed: "seed-abc-123" })).toContain("seed-abc-123")
  })
  it("two turns with different seeds differ only in Block C", () => {
    const a = buildTurnMessage({ ...turnInput, variationSeed: "one" })
    const b = buildTurnMessage({ ...turnInput, variationSeed: "two" })
    expect(a).not.toBe(b)
    expect(buildSystemPrompt(input)).toBe(buildSystemPrompt(input))
  })
})

describe("size ceilings", () => {
  it("keeps Block A under its ceiling", () => {
    expect(SECTION_BUILDER_BLOCK_A.length).toBeLessThan(SECTION_BUILDER_BLOCK_A_MAX)
  })
  it("keeps the design block under its own", () => {
    expect(SECTION_BUILDER_BLOCK_DESIGN.length).toBeLessThan(SECTION_BUILDER_BLOCK_DESIGN_MAX)
  })
  // The tripwire this ceiling has always existed for.
  it("still blows up if someone inlines a raw JSON Schema", () => {
    expect(SECTION_BUILDER_BLOCK_A.length + 11_119).toBeGreaterThan(SECTION_BUILDER_BLOCK_A_MAX)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

```bash
npx vitest run __tests__/lib/funnels/sections/prompt.test.ts
```
Expected: FAIL, including the existing ceiling test now that Task 3 widened the variants.

- [ ] **Step 4: Implement**

1. **Compact first, raise second.** Cut the `form` description in `registry.ts` (~1,200
   characters, restates the checkout rule three times) to one statement of each rule. Re-measure.
2. Rewrite Block A's opening paragraph: the model owns structure, copy **and** the page's
   visual direction; it still never writes HTML, CSS or a UUID.
3. Rewrite `BUILDER_RULES` rule 6: tones are the **section rhythm** control; the palette is
   the **brand colour** control. Keep `TONE_COLOUR_LEGEND` — owners still name tones by colour.
4. Add `SECTION_BUILDER_BLOCK_DESIGN` describing the palette (preset names + custom brand),
   font, density, width, rhythm, and the four new section knobs. Concatenate it in
   `buildSystemPrompt` **between** Block A and Block B.
5. Re-cut `LEADGEN_RULES` into `PAGE_RECIPES` (the six from spec §6.2) plus a `UNIVERSAL_RULES`
   list carrying the four conversion rules that apply to every recipe.
6. Add `variationSeed` to `BuilderTurnInput`, render it in `buildTurnMessage` **only**, and ask
   for a named design direction in `reply` on a first draft. Generate the seed in the route.
7. Raise `SECTION_BUILDER_BLOCK_A_MAX` only by the measured remainder, with the reason written
   into the test beside the three previous raises — stating what was compacted first and by how
   much, exactly as the 2026-09-08 raise did.

- [ ] **Step 5: Run to verify it passes**

```bash
npx vitest run __tests__/lib/funnels/sections/prompt.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/funnels/sections/prompt.ts lib/funnels/sections/builder-config.ts lib/funnels/sections/registry.ts app/api/admin/funnels __tests__/lib/funnels/sections/prompt.test.ts
git commit -m "feat(builder): teach the prompt the design vocabulary, page recipes and variation"
```

---

### Task 11: The builder UI — theme panel and widened inspector

**Files:**
- Create: `components/admin/funnels/builder/ThemePanel.tsx`
- Modify: `components/admin/funnels/builder/SectionInspector.tsx`
- Modify: `components/admin/funnels/FunnelBuilder.tsx` — mount the panel
- Create: `app/api/admin/businesses/brand/route.ts` — the brand-kit writer
- Test: `__tests__/components/admin/funnels/ThemePanel.test.tsx`

**Interfaces:**
- Consumes: `paletteSchema`, `sectionStyleSchema` (Task 3); `PALETTE_TABLE` (Task 2); brand-kit columns (Task 8).
- Produces: nothing later tasks consume.

- [ ] **Step 1: Write the failing tests**

```ts
it("shows a swatch for every preset", () => {
  render(<ThemePanel theme={theme} onChange={noop} brandKit={null} />)
  for (const name of PALETTE_PRESETS) expect(screen.getByRole("button", { name: new RegExp(name, "i") })).toBeTruthy()
})
it("emits a set_theme op rather than writing the document directly", async () => {
  const onChange = vi.fn()
  render(<ThemePanel theme={theme} onChange={onChange} brandKit={null} />)
  await userEvent.click(screen.getByRole("button", { name: /ember/i }))
  expect(onChange).toHaveBeenCalledWith({ palette: { preset: "ember" } })
})
it("offers the tenant brand colours when the tenant has them", () => {
  render(<ThemePanel theme={theme} onChange={noop} brandKit={{ brand: "#6d28d9" }} />)
  expect(screen.getByText(/my brand/i)).toBeTruthy()
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run __tests__/components/admin/funnels/ThemePanel.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Build `ThemePanel` and extend `SectionInspector` with the four new knobs and the widened
variant lists. Both write through the **existing** op path (`update_section` / `set_theme` via
`patchForPath`) so a hand edit and an AI edit are the same transaction and share one undo
history. Do not add a second write path.

The brand-kit route is admin-only, guarded the way the sibling admin routes are, wrapped in
`withAudit`, and validates both hex values with the same regex as the schema and the CHECK.

Light-only. Follow the existing builder chrome; this is not a table so the `data-table`
house rule does not apply.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run __tests__/components/admin/funnels
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/admin/funnels app/api/admin/businesses __tests__/components/admin/funnels
git commit -m "feat(builder): theme panel and widened section inspector"
```

---

### Task 12: Verify in the real app, and close the loop

**Files:**
- Create: `scripts/capture-builder-design-variety.mjs`
- Create: `screenshots/builder-design-variety/` — annotated PNGs
- Modify: `docs/builder-gaps.md` — flip the closed rows
- Modify: `JOURNAL.md`

**Interfaces:**
- Consumes: everything.
- Produces: the owner-facing evidence.

- [ ] **Step 1: Full targeted verification**

```bash
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"
npx vitest run __tests__/lib/funnels __tests__/app/api/admin/funnels __tests__/components/admin/funnels
npx tsc --noEmit 2>&1 | grep -c "error TS"
```
Expected: no failures against the 56-file / 1354-test baseline; tsc error **file set** compared
against the captured 79-file baseline, not just the count — a falling count hides new errors.

- [ ] **Step 2: Drive the real builder**

Start the dev server on 3050, redirecting to a log file (piping a long-running server to
`head` wedges it and every route then times out). Sign in, then build three pages through the
**real** builder at `/admin/funnels/[id]/edit/[stepId]` from three deliberately different
briefs — a waitlist capture, a long-form sales page, and an event page.

This must be the real route in the real admin. A preview harness or an isolated mount does not
count. Park the pointer away from any control before capturing, or a hovered button reads as a
styling bug that is not there.

- [ ] **Step 3: Capture and annotate**

Screenshot each page on its real `/preview/<slug>` route, and the builder screen itself
showing the theme panel. Burn numbered markers and captions **into** the PNG, composed at the
capture's exact pixel width. Derive marker positions from `boundingBox()` × device scale
factor, and warn loudly if a target is missing rather than silently placing a marker at 0,0.

The point to evidence: **three briefs, three genuinely different-looking pages.** Put them
side by side.

- [ ] **Step 4: Update the gap inventory**

Flip every row this build closed to `closed`. Leave spec §9's rows `open`. The doc is the
tracker the owner asked for; a stale tracker is worse than none.

- [ ] **Step 5: Journal**

Add a dated entry to `JOURNAL.md`, newest first, tagged `[Feature build-out]`, recording what
was built and — the important part — every mistake made and its lesson. **Do not stage
`JOURNAL.md`**; it is local-only and gitignored.

- [ ] **Step 6: Commit**

```bash
git add scripts/capture-builder-design-variety.mjs screenshots/builder-design-variety docs/builder-gaps.md
git commit -m "docs(builder): annotated evidence of design variety, driven in the real admin"
```

---

## Self-Review

**Spec coverage.** §1 gap inventory → Task 1. §3 theme → Tasks 3, 4. §3.1 palette → Tasks 2, 3, 4. §3.2 font, §3.3 density/width → Task 4; rhythm → Task 5. §4 section knobs → Tasks 3, 6. §5.1 variants → Tasks 3, 7. §5.2 media → Task 7. §5.3 Block A budget → Task 10 steps 1 and 4. §6 prompt → Task 10. §7 brand kit → Tasks 8, 9. §7a UI → Task 11. §8 data flow → Tasks 4, 9. §9 non-goals → Task 1 records them as `open`. §10 testing → every task, plus Task 12. §11 risks → each has a task step: stored-draft compatibility (Task 3 step 1), hex boundary (Tasks 3, 6 mutation checks), ceiling (Task 10), cache (Task 10 step 2), live pages unchanged (Task 4 step 5).

**Placeholders.** None. Every code step carries real code; every "implement" step names the
functions, the files and the behaviour.

**Type consistency.** `PaletteTokens` (Task 2) is what `paletteTokens()` returns in Task 4.
`resolvePalette` takes `{brand, accent?, mode?}` in Tasks 2, 4 and 8. `effectiveTone` gains an
optional third parameter in Task 5 and every existing caller keeps compiling. `brandKit` is
`{brand, accent?} | null` in Tasks 4, 8, 9 and 11. `SECTION_BUILDER_BLOCK_A_MAX` and
`SECTION_BUILDER_BLOCK_DESIGN_MAX` both live in `builder-config.ts` (Task 10).

**One known ordering hazard**, called out because a fresh executor will hit it: Task 3 widens
the variant lists, which pushes `SECTION_BUILDER_BLOCK_A` past its existing ceiling and turns
`prompt.test.ts` red. That is expected and is not fixed until Task 10 step 4. Tasks 3 through 9
should treat that single pre-existing ceiling failure as known-red; every other failure is real.
