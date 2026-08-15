# AI Page Review Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the AI page builder writes a page, a review stage finds its layout, formatting and copy defects and fixes them — deterministically where it can, with a panel of critics where it cannot.

**Architecture:** A pure `auditDoc()` catches the mechanical defects with no model in the loop. Three critics with deliberately non-overlapping lenses run in parallel on the document plus those findings. One Opus reviser turns the merged findings into `SectionOp[]` through the imported `opSchema`, they are applied with the real transactional `applyOps`, and `auditDoc()` runs again as a gate. The whole stage runs *after* the build turn has committed, as its own appended turn, so it can never cost the owner the page and its changes have their own one-click undo.

**Tech Stack:** TypeScript, Zod 4.3, Vitest, Next.js 16 App Router, `@ai-sdk/anthropic` via `lib/ai/anthropic.ts#callAgent`, Supabase Postgres.

**Spec:** `docs/superpowers/specs/2026-08-15-ai-page-review-pipeline-design.md`

## Global Constraints

- **Never restate a schema or a rule that already has an owner.** Import `opSchema` from `lib/funnels/sections/apply.ts`; derive copy-length caps from the registry schemas; read effective tone through `sectionForPage` in `lib/funnels/sections/doc.ts`. This repo has shipped three separate bugs from restating instead of importing.
- **`lib/funnels/sections/review/findings.ts` must stay a leaf.** It is imported by `build-stream.ts`, which is imported by the browser bundle. It may import `zod` and nothing else. No `lib/ai/*`, no `lib/supabase`, no `lib/db/*`.
- **`SECTION_BUILDER_BLOCK_A` must remain a module-level const and reference-identical across reads.** Nothing in this work may interpolate into it. `prompt.test.ts` pins this with `toBe`.
- **Style knob attributes are `data-h` / `data-align` / `data-tone` / `data-pad`.** Never `data-djp-*` — `filterAttrs` in `lib/funnels/compile/sanitize.ts` strips that prefix before its plain `data-*` passthrough runs, silently.
- **The divider colour must be an explicit token per tone, never `currentColor`.** `render.test.ts`'s tone-contrast harness resolves by token; `currentColor` is unmodelled by it and would pass while being invisible.
- **Review is strictly non-fatal.** No failure path in this work may emit a `fail` stream event or throw out of `runTurn`.
- **Do not run the full test suite.** Targeted runs plus `npm run build`. The repo has ~88 pre-existing failures in unrelated subsystems.
- **Commit staging is explicit paths only.** `git add -A` is unsafe here — the working tree permanently holds untracked bank CSVs. Never stage `JOURNAL.md`.

---

### Task 1: The `Finding` type and merge

**Files:**
- Create: `lib/funnels/sections/review/findings.ts`
- Test: `__tests__/lib/funnels/sections/review/findings.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Finding`, `Severity`, `FindingSource`, `AUDIT_CODES`, `AuditCode`, `findingSchema`, `criticFindingsSchema`, `mergeFindings(lists: Finding[][], max: number): Finding[]`, `SEVERITY_ORDER`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/funnels/sections/review/findings.test.ts
import { describe, expect, it } from "vitest"
import { mergeFindings, findingSchema, type Finding } from "@/lib/funnels/sections/review/findings"

function f(over: Partial<Finding> = {}): Finding {
  return {
    code: "tone-run",
    severity: "high",
    sectionIds: ["a", "b"],
    issue: "issue",
    suggestion: "suggestion",
    source: "audit",
    ...over,
  }
}

describe("mergeFindings", () => {
  it("dedupes on code + section set regardless of section order", () => {
    const merged = mergeFindings([[f({ sectionIds: ["a", "b"] })], [f({ sectionIds: ["b", "a"], source: "art" })]], 24)
    expect(merged).toHaveLength(1)
  })

  it("keeps the highest severity when deduping", () => {
    const merged = mergeFindings([[f({ severity: "low" })], [f({ severity: "high", source: "art" })]], 24)
    expect(merged[0].severity).toBe("high")
  })

  it("orders high before medium before low", () => {
    const merged = mergeFindings(
      [[f({ code: "c-low", severity: "low" }), f({ code: "c-high", severity: "high" }), f({ code: "c-med", severity: "medium" })]],
      24,
    )
    expect(merged.map((x) => x.code)).toEqual(["c-high", "c-med", "c-low"])
  })

  it("truncates to max, dropping the LEAST severe", () => {
    const merged = mergeFindings([[f({ code: "keep", severity: "high" }), f({ code: "drop", severity: "low" })]], 1)
    expect(merged.map((x) => x.code)).toEqual(["keep"])
  })

  it("is a leaf: importing it pulls in no AI SDK", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("lib/funnels/sections/review/findings.ts", "utf8"),
    )
    expect(source).not.toMatch(/from "@\/lib\/(ai|db|supabase)/)
  })
})

describe("findingSchema", () => {
  it("rejects an empty issue", () => {
    expect(findingSchema.safeParse(f({ issue: "" })).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/funnels/sections/review/findings.test.ts`
Expected: FAIL — cannot resolve `@/lib/funnels/sections/review/findings`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/funnels/sections/review/findings.ts — one shape, four producers, one consumer.
//
// A LEAF. `build-stream.ts` carries a `finding` event and is imported by the
// builder UI, so this file follows it into the browser bundle. It may import
// `zod` and nothing else. `builder-config.ts` documents what happens when a
// "leaf" quietly acquires the Anthropic SDK: it made `reassemble()`
// un-importable in the browser and forced a whole stage through a server action.

import { z } from "zod"

export const SEVERITIES = ["high", "medium", "low"] as const
export type Severity = (typeof SEVERITIES)[number]

/** Lower sorts first. */
export const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 }

export const FINDING_SOURCES = ["audit", "art", "copy", "conversion"] as const
export type FindingSource = (typeof FINDING_SOURCES)[number]

/**
 * The deterministic auditor's closed code set. Critics are NOT limited to
 * these — they emit their own kebab-case codes — because a critic constrained
 * to twelve pre-named problems can only ever find the twelve problems someone
 * already thought of, which defeats the point of asking a model at all.
 */
export const AUDIT_CODES = [
  "tone-run",
  "pad-monotony",
  "align-thrash",
  "headline-scale",
  "markdown-leak",
  "proof-below-fold",
  "cta-divergence",
  "live-faq-on-campaign",
  "copy-echo",
  "headline-punctuation",
  "length-strain",
  "section-count",
] as const
export type AuditCode = (typeof AUDIT_CODES)[number]

export const findingSchema = z.object({
  code: z.string().min(1).max(60),
  severity: z.enum(SEVERITIES),
  sectionIds: z.array(z.string().max(40)).max(24),
  issue: z.string().min(1).max(300),
  suggestion: z.string().min(1).max(300),
  source: z.enum(FINDING_SOURCES),
})

export type Finding = z.infer<typeof findingSchema>

/**
 * What a critic returns. `source` is stamped by the CALLER, not the model — a
 * model asked to label its own lens will occasionally label it as another
 * critic's, and then dedupe silently merges two independent observations.
 */
export const criticFindingsSchema = z.object({
  findings: z
    .array(findingSchema.omit({ source: true }))
    .max(12),
})

export type CriticFindings = z.infer<typeof criticFindingsSchema>

/** Order-insensitive identity of a finding: what makes two of them the same. */
function key(finding: Finding): string {
  return `${finding.code}::${[...finding.sectionIds].sort().join(",")}`
}

/**
 * Flatten, dedupe, sort by severity, truncate.
 *
 * Truncation drops the LEAST severe, which is why the sort has to happen
 * before the slice. A merge that truncated in arrival order would let three
 * chatty low-severity copy notes push a `cta-divergence` off the list.
 */
export function mergeFindings(lists: Finding[][], max: number): Finding[] {
  const byKey = new Map<string, Finding>()
  for (const list of lists) {
    for (const finding of list) {
      const existing = byKey.get(key(finding))
      if (!existing) {
        byKey.set(key(finding), finding)
        continue
      }
      if (SEVERITY_ORDER[finding.severity] < SEVERITY_ORDER[existing.severity]) {
        byKey.set(key(finding), finding)
      }
    }
  }
  return [...byKey.values()]
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, max)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/funnels/sections/review/findings.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/funnels/sections/review/findings.ts __tests__/lib/funnels/sections/review/findings.test.ts
git commit -m "feat(funnels): the Finding type every reviewer speaks"
```

---

### Task 2: Review configuration constants

**Files:**
- Modify: `lib/funnels/sections/builder-config.ts` (append)
- Test: `__tests__/lib/funnels/sections/builder-config.test.ts` (extend)

**Interfaces:**
- Consumes: `MODEL_SONNET` from `@/lib/ai/models` (already imported there).
- Produces: `SECTION_REVIEW_MAX_ROUNDS`, `SECTION_REVIEW_CRITIC_MODEL`, `SECTION_REVIEW_CRITIC_MAX_TOKENS`, `SECTION_REVIEW_REVISER_MAX_TOKENS`, `SECTION_REVIEW_TIMEOUT_MS`, `SECTION_REVIEW_MAX_FINDINGS`.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/lib/funnels/sections/builder-config.test.ts`:

```ts
import {
  SECTION_REVIEW_MAX_ROUNDS,
  SECTION_REVIEW_MAX_FINDINGS,
  SECTION_REVIEW_REVISER_MAX_TOKENS,
  SECTION_REVIEW_TIMEOUT_MS,
  SECTION_BUILDER_MAX_TOKENS_CEILING,
  SECTION_BUILDER_MAX_OPS,
} from "@/lib/funnels/sections/builder-config"

describe("review configuration", () => {
  it("ships with exactly one revise round", () => {
    expect(SECTION_REVIEW_MAX_ROUNDS).toBe(1)
  })

  it("keeps the reviser budget under the non-streaming ceiling", () => {
    expect(SECTION_REVIEW_REVISER_MAX_TOKENS).toBeLessThan(SECTION_BUILDER_MAX_TOKENS_CEILING)
  })

  it("cannot ask for more findings than a document has ops to fix them with", () => {
    expect(SECTION_REVIEW_MAX_FINDINGS).toBeLessThanOrEqual(SECTION_BUILDER_MAX_OPS)
  })

  it("allows the whole stage more wall clock than one model call", () => {
    expect(SECTION_REVIEW_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/funnels/sections/builder-config.test.ts`
Expected: FAIL — the new exports are undefined.

- [ ] **Step 3: Write minimal implementation**

Append to `lib/funnels/sections/builder-config.ts`:

```ts
// ---------------------------------------------------------------------------
// THE REVIEW STAGE
//
// Runs after a build turn has already committed. Every constant here is sized
// on the assumption that the stage can be abandoned at any point with no cost
// beyond the tokens already spent — the owner's page is saved before the first
// critic is called.
// ---------------------------------------------------------------------------

/**
 * How many times the reviser may run against a fresh set of findings.
 *
 * ONE, DELIBERATELY, AND THE SPEC ARGUES FOR IT RATHER THAN ASSUMING IT.
 * Subjective copy tends to oscillate between rounds rather than converge: the
 * second reviser reads the first's output as a new page with new problems, and
 * "make it punchier" applied twice produces a headline with no verbs. Raising
 * this to 2 is a one-line change and should be made against evidence — the
 * gate records which findings survived, which is exactly that evidence.
 *
 * `0` disables the review stage entirely, which is the kill switch this
 * feature has instead of a flag.
 */
export const SECTION_REVIEW_MAX_ROUNDS = 1

/**
 * The critics' model.
 *
 * SONNET, NOT OPUS, and not because critique is easy. A critic emits FINDINGS —
 * prose in a fixed envelope. Nothing it returns has to satisfy `opSchema`, and
 * nothing it returns can reject a batch. The reviser is the call that must
 * produce structurally valid ops against a 10-kind registry, and that is where
 * the Opus budget goes. Mirrors `lib/agents/self-critique.ts`, which runs a
 * cheap second-pass critic behind an expensive main call.
 */
export const SECTION_REVIEW_CRITIC_MODEL = MODEL_SONNET

/** maxTokens for ONE critic. A findings list, not a document. */
export const SECTION_REVIEW_CRITIC_MAX_TOKENS = 2_000

/**
 * maxTokens for the reviser.
 *
 * Matched to `SECTION_BUILDER_EDIT_MAX_TOKENS` and for the same reason: a
 * reviser acting on a page-wide rhythm finding may legitimately emit an
 * `update_section` for every section, and on `claude-opus-5` `max_tokens` buys
 * thinking and output from the same purse. Sizing this to "a few ops" is the
 * mistake that dead-ends the turn.
 */
export const SECTION_REVIEW_REVISER_MAX_TOKENS = 14_000

/**
 * Wall-clock budget for the WHOLE stage — critics, reviser, apply and re-audit.
 *
 * The route already sets `maxDuration = 300`, and the build turn that precedes
 * this has typically spent 30s of it. 90s leaves the parallel critic fan-out
 * (~15s) plus a reviser (~30s) plus a retry comfortably inside the budget while
 * still guaranteeing the owner sees a result rather than a hung stream.
 */
export const SECTION_REVIEW_TIMEOUT_MS = 90_000

/**
 * How many findings reach the reviser after merge.
 *
 * Bounded by `SECTION_BUILDER_MAX_OPS` (24): a findings list longer than the
 * batch that could act on it guarantees the reviser silently ignores the tail,
 * and a list that long is a page that should be rebuilt, not polished.
 */
export const SECTION_REVIEW_MAX_FINDINGS = 24
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/funnels/sections/builder-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/funnels/sections/builder-config.ts __tests__/lib/funnels/sections/builder-config.test.ts
git commit -m "feat(funnels): review-stage tunables, with the round count argued down to one"
```

---

### Task 3: The deterministic auditor

This is the task that fixes the owner's three reported complaints. It has no model in it.

**Files:**
- Create: `lib/funnels/sections/review/audit.ts`
- Create: `__tests__/lib/funnels/sections/review/fixtures/production-consultation-page.json`
- Test: `__tests__/lib/funnels/sections/review/audit.test.ts`

**Interfaces:**
- Consumes: `Finding`, `AuditCode`, `AUDIT_CODES` (Task 1); `SectionDoc`, `Section`, `SECTION_REGISTRY` from `@/lib/funnels/sections/registry`; `effectiveTone` (added to `doc.ts` in this task).
- Produces: `auditDoc(doc: SectionDoc): Finding[]`.

- [ ] **Step 1: Save the production fixture**

Write `__tests__/lib/funnels/sections/review/fixtures/production-consultation-page.json` with the exact document read from `funnel_steps.project_data` for step `d4b1633b-478d-42f2-bab4-705fc06c8c7d` on 2026-08-15. It is an 8-section consultation page: `hero` (dark/roomy/center/xl), `proof` (no tone/normal/center), `what-you-get` bullets (no tone/normal/left/lg), `how` steps (muted/normal/left/lg), `voices` testimonial live (no tone/normal/center), `questions` faq inline (no tone/normal/left/lg), `book` cta (accent/roomy/center/lg), `footer` (no tone/tight/center). Theme is `{tone:"light", accent:"accent", radius:"soft"}`.

Do not hand-edit it to make a test pass. It is evidence.

- [ ] **Step 2: Write the failing test**

```ts
// __tests__/lib/funnels/sections/review/audit.test.ts
//
// THE FIRST TWO SUITES ARE THE POINT OF THIS FILE.
//
// An auditor that returns nothing on the page that motivated the work is
// worthless, and an auditor that fires all twelve codes on every page is
// equally worthless while being much harder to notice. So the fixture is
// asserted in BOTH directions: exactly these codes fired, and exactly those
// did not.
import { describe, expect, it } from "vitest"
import { auditDoc } from "@/lib/funnels/sections/review/audit"
import { sectionDocSchema, type SectionDoc } from "@/lib/funnels/sections/registry"
import fixture from "./fixtures/production-consultation-page.json"

const PROD_DOC: SectionDoc = sectionDocSchema.parse(fixture)

function codes(doc: SectionDoc): string[] {
  return auditDoc(doc).map((f) => f.code)
}

describe("the real production page", () => {
  it("is a valid SectionDoc — the fixture is real, not hand-written", () => {
    expect(PROD_DOC.sections).toHaveLength(8)
  })

  it("fires exactly the four codes it violates", () => {
    const found = codes(PROD_DOC).sort()
    expect(found).toEqual(["align-thrash", "pad-monotony", "tone-run", "tone-run"].sort())
  })

  it("names BOTH same-tone seams, by section id", () => {
    const runs = auditDoc(PROD_DOC).filter((f) => f.code === "tone-run")
    expect(runs.map((f) => f.sectionIds)).toEqual([
      ["proof", "what-you-get"],
      ["voices", "questions"],
    ])
  })

  it("does NOT fire the four codes the page satisfies", () => {
    const found = codes(PROD_DOC)
    expect(found).not.toContain("cta-divergence")
    expect(found).not.toContain("live-faq-on-campaign")
    expect(found).not.toContain("proof-below-fold")
    expect(found).not.toContain("section-count")
  })

  it("does not flag the repeated CTA label as copy-echo — one offer, one action", () => {
    expect(codes(PROD_DOC)).not.toContain("copy-echo")
  })
})

describe("a well-made page", () => {
  const good: SectionDoc = {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [
      {
        id: "hero",
        kind: "hero",
        variant: "centered",
        style: { headline: "xl", align: "center", tone: "dark", pad: "roomy" },
        props: { headline: "Rebuild your sprint speed in eight weeks", primaryCta: { label: "Start now", target: { kind: "booking" } } },
      },
      { id: "proof", kind: "proof", variant: "stats", style: { align: "center", pad: "tight" }, props: { items: [{ value: "500+", label: "athletes" }, { value: "12 yrs", label: "coaching" }] } },
      { id: "what", kind: "bullets", variant: "cards", style: { headline: "lg", align: "left", tone: "muted", pad: "roomy" }, props: { heading: "What you get", items: [{ title: "Assessment" }, { title: "Programming" }] } },
      { id: "how", kind: "steps", variant: "numbered", style: { headline: "lg", align: "left", pad: "normal" }, props: { heading: "How it works", steps: [{ title: "Assess" }, { title: "Build" }] } },
      { id: "faq", kind: "faq", variant: "stack", style: { headline: "lg", align: "left", tone: "muted", pad: "normal" }, props: { heading: "Questions", source: "inline", items: [{ q: "Cost?", a: "Free." }] } },
      { id: "book", kind: "cta", variant: "band", style: { headline: "lg", align: "center", tone: "accent", pad: "roomy" }, props: { headline: "Start this week", cta: { label: "Start now", target: { kind: "booking" } } } },
      { id: "footer", kind: "footer", variant: "simple", style: { align: "center", pad: "tight" }, props: { businessName: "DJP Athlete", lines: [], links: [] } },
    ],
  }

  it("raises no high-severity findings — the metric discriminates", () => {
    expect(auditDoc(good).filter((f) => f.severity === "high")).toEqual([])
  })
})

describe("effective tone", () => {
  it("sees a dark THEME promoting untoned sections into a run", () => {
    const doc: SectionDoc = {
      v: 1,
      engine: "sections",
      theme: { tone: "dark", accent: "accent", radius: "soft" },
      sections: [
        { id: "a", kind: "cta", variant: "band", style: { pad: "roomy" }, props: { headline: "One", cta: { label: "Go", target: { kind: "booking" } } } },
        { id: "b", kind: "cta", variant: "band", style: { pad: "tight" }, props: { headline: "Two", cta: { label: "Go", target: { kind: "booking" } } } },
      ],
    }
    // Neither section sets a tone. On a LIGHT page they would both be
    // "default" and still be a run; the point of this test is that they are
    // both DARK here, which is only visible through `sectionForPage`.
    const run = auditDoc(doc).find((f) => f.code === "tone-run")
    expect(run?.issue).toContain("dark")
  })
})

describe("individual rules", () => {
  function docOf(sections: SectionDoc["sections"], tone: "light" | "dark" = "light"): SectionDoc {
    return { v: 1, engine: "sections", theme: { tone, accent: "accent", radius: "soft" }, sections }
  }
  const cta = (id: string, style: Record<string, string> = {}, headline = "Headline here") => ({
    id, kind: "cta" as const, variant: "band" as const, style,
    props: { headline, cta: { label: "Go", target: { kind: "booking" as const } } },
  })

  it("markdown-leak catches bold markers in copy", () => {
    const doc = docOf([cta("a", { tone: "accent" }, "This is **important**")])
    expect(codes(doc)).toContain("markdown-leak")
  })

  it("markdown-leak catches a leading list dash", () => {
    const doc = docOf([cta("a", { tone: "accent" }, "- first thing")])
    expect(codes(doc)).toContain("markdown-leak")
  })

  it("headline-punctuation catches a trailing period", () => {
    const doc = docOf([cta("a", { tone: "accent" }, "This is a headline.")])
    expect(codes(doc)).toContain("headline-punctuation")
  })

  it("cta-divergence fires when the page offers two different actions", () => {
    const doc = docOf([
      cta("a", { tone: "accent" }),
      { id: "b", kind: "cta", variant: "band", style: { tone: "dark" }, props: { headline: "Other", cta: { label: "Buy", target: { kind: "url", href: "/shop" } } } },
    ])
    expect(codes(doc)).toContain("cta-divergence")
  })

  it("live-faq-on-campaign fires on a live FAQ", () => {
    const doc = docOf([
      cta("a", { tone: "accent" }),
      { id: "q", kind: "faq", variant: "stack", style: { tone: "muted" }, props: { source: "live", pageKey: "home" } },
    ])
    expect(codes(doc)).toContain("live-faq-on-campaign")
  })

  it("proof-below-fold fires when the only proof is in the last third", () => {
    const doc = docOf([
      cta("a", { tone: "accent" }), cta("b", { tone: "dark" }), cta("c", { tone: "muted" }),
      cta("d", { tone: "accent" }), cta("e", { tone: "dark" }),
      { id: "p", kind: "proof", variant: "stats", style: { tone: "muted" }, props: { items: [{ value: "1", label: "x" }, { value: "2", label: "y" }] } },
    ])
    expect(codes(doc)).toContain("proof-below-fold")
  })

  it("copy-echo fires on a repeated prose line", () => {
    const doc = docOf([cta("a", { tone: "accent" }, "The same sentence"), cta("b", { tone: "dark" }, "The same sentence")])
    expect(codes(doc)).toContain("copy-echo")
  })

  it("section-count fires below six sections", () => {
    expect(codes(docOf([cta("a", { tone: "accent" })]))).toContain("section-count")
  })

  it("every code it can emit is in AUDIT_CODES", async () => {
    const { AUDIT_CODES } = await import("@/lib/funnels/sections/review/findings")
    for (const finding of auditDoc(PROD_DOC)) {
      expect(AUDIT_CODES).toContain(finding.code)
    }
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/funnels/sections/review/audit.test.ts`
Expected: FAIL — cannot resolve `@/lib/funnels/sections/review/audit`.

- [ ] **Step 4: Export `effectiveTone` from `doc.ts`**

`sectionForPage` in `lib/funnels/sections/doc.ts:103` is module-private and returns a whole `Section`. The auditor needs only the resolved tone, and must not re-derive it. Add beside it, and change `sectionForPage` to call it so there is one implementation:

```ts
/**
 * The tone a section will ACTUALLY render at, after the page theme has had its
 * say. Exported for the review auditor.
 *
 * This is `sectionForPage`'s rule and nothing else — the two must not drift.
 * An auditor reading `section.style.tone` directly sees four distinct
 * `undefined`s on a dark page and reports a page with no tone runs, while the
 * page renders as four identical dark bands. That is the entire class of bug
 * `ask_the_validator_never_restate_it` names.
 */
export function effectiveTone(section: Section, theme: SectionDocTheme): "default" | "muted" | "accent" | "dark" {
  const own = section.style.tone
  if (own !== undefined && own !== "default") return own
  return theme.tone === "dark" ? "dark" : "default"
}

function sectionForPage(section: Section, theme: SectionDocTheme): Section {
  const tone = effectiveTone(section, theme)
  if (tone === section.style.tone) return section
  if (theme.tone !== "dark") return section
  return { ...section, style: { ...section.style, tone } }
}
```

- [ ] **Step 5: Run the existing doc + render suites to prove nothing moved**

Run: `npx vitest run __tests__/lib/funnels/sections/doc.test.ts __tests__/lib/funnels/sections/render.test.ts`
Expected: PASS, unchanged counts. If anything goes red here, `effectiveTone` and `sectionForPage` disagree — fix `effectiveTone`, never the test.

- [ ] **Step 6: Write the auditor**

```ts
// lib/funnels/sections/review/audit.ts — the deterministic half of review.
//
// No model, no IO, no randomness: `auditDoc` is a pure function of the
// document. That is not a stylistic preference. Every finding here is a
// property of the page that can be decided by looking at it, and a model asked
// to decide "do sections 2 and 3 share a tone" will occasionally say no.
//
// The three complaints that motivated this file — "boring", "formatting
// issues", "spacing looks off" — are ALL in here. The critics exist for the
// half that genuinely needs judgement, not for this half.

import { effectiveTone } from "@/lib/funnels/sections/doc"
import { SECTION_REGISTRY, type Section, type SectionDoc } from "@/lib/funnels/sections/registry"
import type { Finding } from "@/lib/funnels/sections/review/findings"

function finding(
  code: string,
  severity: Finding["severity"],
  sectionIds: string[],
  issue: string,
  suggestion: string,
): Finding {
  return { code, severity, sectionIds, issue, suggestion, source: "audit" }
}

// ---------------------------------------------------------------------------
// Copy extraction
//
// PROSE FIELDS ONLY, AND CTA LABELS ARE DELIBERATELY EXCLUDED. The production
// page uses "Book your consultation" as both the hero and the closing CTA
// label, and that repetition is REQUIRED by the one-offer-one-action rule in
// `LEADGEN_RULES`. A naive same-string-twice check would flag a page for
// obeying the prompt.
// ---------------------------------------------------------------------------

const PROSE_KEYS = new Set(["headline", "sub", "heading", "intro", "body", "blurb", "eyebrow", "legal", "q", "a", "title", "footnote"])

/** Every prose string in a section, with the path that produced it. */
function proseOf(section: Section): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = []
  function walk(value: unknown, path: string, key: string | null): void {
    if (typeof value === "string") {
      if (key !== null && PROSE_KEYS.has(key)) out.push({ path, text: value })
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, null))
      return
    }
    if (value !== null && typeof value === "object") {
      // `cta`, `primaryCta`, `secondaryCta`, `links` all carry a `label` that
      // is an ACTION, not prose. Never descend into them.
      for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
        if (childKey === "cta" || childKey === "primaryCta" || childKey === "secondaryCta" || childKey === "links") continue
        walk(child, path === "" ? childKey : `${path}.${childKey}`, childKey)
      }
    }
  }
  walk(section.props, "", null)
  return out
}

/** Headline-ish fields: the ones a trailing period reads wrong on. */
const HEADLINE_KEYS = new Set(["headline", "heading", "eyebrow"])

function headlinesOf(section: Section): string[] {
  const props = section.props as Record<string, unknown>
  return [...HEADLINE_KEYS]
    .map((key) => props[key])
    .filter((value): value is string => typeof value === "string" && value.length > 0)
}

// ---------------------------------------------------------------------------
// Copy-length caps, DERIVED from the registry.
//
// Same move as `UUID_FIELD_PATHS` in prompt.ts: a hand-typed table of maximums
// is a second copy of the schema, and it goes stale the day a bound changes
// without anything going red.
// ---------------------------------------------------------------------------

function maxLengthsFor(kind: Section["kind"]): Map<string, number> {
  const out = new Map<string, number>()
  const json = SECTION_REGISTRY[kind].propsSchema as unknown as { _zod?: unknown }
  // z.toJSONSchema is the same route prompt.ts already trusts for this.
  const schema = jsonSchemaOf(SECTION_REGISTRY[kind].propsSchema)
  collectMaxLengths(schema, "", out)
  void json
  return out
}

interface JsonNode {
  type?: string
  properties?: Record<string, JsonNode>
  items?: JsonNode
  maxLength?: number
  anyOf?: JsonNode[]
  oneOf?: JsonNode[]
  allOf?: JsonNode[]
}

function jsonSchemaOf(schema: unknown): JsonNode {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { z } = require("zod") as typeof import("zod")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return z.toJSONSchema(schema as any, { io: "input", unrepresentable: "any" }) as JsonNode
}

function collectMaxLengths(node: JsonNode, key: string, out: Map<string, number>): void {
  if (node.maxLength !== undefined && key !== "") {
    const existing = out.get(key)
    if (existing === undefined || node.maxLength > existing) out.set(key, node.maxLength)
  }
  for (const [childKey, child] of Object.entries(node.properties ?? {})) collectMaxLengths(child, childKey, out)
  if (node.items) collectMaxLengths(node.items, key, out)
  for (const member of [...(node.anyOf ?? []), ...(node.oneOf ?? []), ...(node.allOf ?? [])]) {
    collectMaxLengths(member, key, out)
  }
}

// ---------------------------------------------------------------------------
// CTA targets
// ---------------------------------------------------------------------------

/** A stable string identity for a CTA target, for counting distinct actions. */
function targetKey(target: Record<string, unknown>): string {
  const kind = String(target.kind)
  switch (kind) {
    case "url": return `url:${String(target.href)}`
    case "step": return `step:${String(target.stepSlug)}`
    case "anchor": return "" // an anchor is navigation WITHIN the page, not a second offer
    case "booking": return "booking"
    default: return `${kind}:${String(target.ref ?? "")}`
  }
}

function ctaTargetsOf(section: Section): string[] {
  const out: string[] = []
  function walk(value: unknown): void {
    if (Array.isArray(value)) { value.forEach(walk); return }
    if (value === null || typeof value !== "object") return
    const record = value as Record<string, unknown>
    if (record.label !== undefined && record.target !== null && typeof record.target === "object") {
      const key = targetKey(record.target as Record<string, unknown>)
      if (key !== "") out.push(key)
      return
    }
    for (const child of Object.values(record)) walk(child)
  }
  walk(section.props)
  return out
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

const MARKDOWN_PATTERNS: Array<{ pattern: RegExp; what: string }> = [
  { pattern: /\*\*/, what: "bold markers (**)" },
  { pattern: /(^|\s)__[^_]/, what: "underscore emphasis (__)" },
  { pattern: /`/, what: "a backtick" },
  { pattern: /^\s*#{1,6}\s/, what: "a markdown heading (#)" },
  { pattern: /^\s*[-*]\s+\S/, what: "a markdown list dash" },
  { pattern: /^\s*\d+\.\s+\S/, what: "a markdown numbered list" },
]

const HEADLINE_RANK: Record<string, number> = { sm: 0, md: 1, lg: 2, xl: 3 }

export function auditDoc(doc: SectionDoc): Finding[] {
  const findings: Finding[] = []
  const sections = doc.sections
  const tones = sections.map((section) => effectiveTone(section, doc.theme))

  // --- tone-run: the cause of "the spacing looks off" ---------------------
  // Two adjacent sections at the same tone paint as ONE band with a doubled
  // gap floating in it, because there is no rule between sections. Reported
  // per SEAM rather than per run, so a three-section run names both seams and
  // the reviser can fix either.
  for (let index = 1; index < sections.length; index += 1) {
    if (tones[index] !== tones[index - 1]) continue
    findings.push(
      finding(
        "tone-run",
        "high",
        [sections[index - 1].id, sections[index].id],
        `"${sections[index - 1].id}" and "${sections[index].id}" both render at the ${tones[index]} tone, so they paint as one continuous band with a doubled gap in the middle and no visible boundary between them.`,
        `Give one of them a different style.tone so the page has a seam there — muted next to default, or accent to mark a turn in the argument.`,
      ),
    )
  }

  // --- pad-monotony: the cause of "boring" -------------------------------
  let runStart = 0
  for (let index = 1; index <= sections.length; index += 1) {
    const same = index < sections.length && sections[index].style.pad === sections[runStart].style.pad
    if (same) continue
    const length = index - runStart
    if (length >= 4) {
      findings.push(
        finding(
          "pad-monotony",
          "medium",
          sections.slice(runStart, index).map((section) => section.id),
          `${length} sections in a row use pad "${sections[runStart].style.pad ?? "normal"}", so the middle of the page has no rhythm — every band is the same height and the eye has nothing to catch on.`,
          `Vary style.pad: roomy for the sections that carry the argument, tight for the connective ones. Padding is the page's pacing.`,
        ),
      )
    }
    runStart = index
  }

  // --- align-thrash: the cause of "formatting issues" --------------------
  const aligns = sections.map((section) => section.style.align ?? "left")
  const changes = aligns.reduce((count, align, index) => (index > 0 && align !== aligns[index - 1] ? count + 1 : count), 0)
  if (changes >= 3) {
    findings.push(
      finding(
        "align-thrash",
        "medium",
        [],
        `Text alignment changes ${changes} times down the page. Each flip is defensible alone; together they read as inconsistency rather than intent.`,
        `Pick one alignment as the page's default and change away from it only to mark something — a centred hero and a centred closing CTA around a left-aligned body is a pattern; alternating is not.`,
      ),
    )
  }

  // --- headline-scale ----------------------------------------------------
  const heroIndex = sections.findIndex((section) => section.kind === "hero")
  if (heroIndex !== -1) {
    const heroRank = HEADLINE_RANK[sections[heroIndex].style.headline ?? "md"]
    const bigger = sections.filter(
      (section, index) => index !== heroIndex && HEADLINE_RANK[section.style.headline ?? "md"] > heroRank,
    )
    if (bigger.length > 0) {
      findings.push(
        finding(
          "headline-scale",
          "medium",
          [sections[heroIndex].id, ...bigger.map((section) => section.id)],
          `The hero's headline is not the largest on the page — ${bigger.map((s) => `"${s.id}"`).join(", ")} outrank it.`,
          `Raise the hero's style.headline above every other section's, or lower theirs. The first screen has to win.`,
        ),
      )
    }
  }

  // --- markdown-leak, headline-punctuation, length-strain ----------------
  for (const section of sections) {
    const caps = maxLengthsFor(section.kind)
    for (const { path, text } of proseOf(section)) {
      for (const { pattern, what } of MARKDOWN_PATTERNS) {
        if (!pattern.test(text)) continue
        findings.push(
          finding(
            "markdown-leak",
            "high",
            [section.id],
            `"${section.id}" has ${what} in its copy ("${text.slice(0, 60)}"). The renderer escapes text, so this ships to a live page as literal characters.`,
            `Write plain prose. Emphasis is the stylesheet's job, and a list is the bullets or steps section kind.`,
          ),
        )
        break
      }
      const key = path.split(".").pop()?.replace(/\[\d+\]$/, "") ?? ""
      const cap = caps.get(key)
      if (cap !== undefined && text.length > cap * 0.95) {
        findings.push(
          finding(
            "length-strain",
            "low",
            [section.id],
            `"${section.id}" fills ${text.length} of the ${cap} characters allowed for ${key}, so it will read as a wall of text and any edit will overflow.`,
            `Cut it to roughly two thirds of the limit. The bound is a ceiling, not a target.`,
          ),
        )
      }
    }
    for (const headline of headlinesOf(section)) {
      if (!/[.]$/.test(headline.trim())) continue
      findings.push(
        finding(
          "headline-punctuation",
          "low",
          [section.id],
          `"${section.id}" ends its headline with a full stop ("${headline.slice(0, 60)}"). Headlines are labels, not sentences.`,
          `Drop the trailing period. Keep question marks — they are doing work.`,
        ),
      )
    }
  }

  // --- copy-echo ---------------------------------------------------------
  const seen = new Map<string, string>()
  for (const section of sections) {
    for (const { text } of proseOf(section)) {
      const normalised = text.trim().toLowerCase().replace(/\s+/g, " ")
      if (normalised.length < 20) continue
      const first = seen.get(normalised)
      if (first !== undefined && first !== section.id) {
        findings.push(
          finding(
            "copy-echo",
            "medium",
            [first, section.id],
            `"${first}" and "${section.id}" say the same thing word for word ("${text.slice(0, 60)}").`,
            `Cut one or rewrite it. A repeated line tells the reader they have already read this part of the page.`,
          ),
        )
      } else if (first === undefined) {
        seen.set(normalised, section.id)
      }
    }
  }

  // --- cta-divergence ----------------------------------------------------
  const targets = new Set(sections.flatMap(ctaTargetsOf))
  if (targets.size > 1) {
    findings.push(
      finding(
        "cta-divergence",
        "high",
        [],
        `The page offers ${targets.size} different actions (${[...targets].join(", ")}). A page that asks for a waitlist and a consultation and a purchase converts on none of them.`,
        `Pick one action and point every button at it. A genuine second option belongs in the footer as a link, not as a competing button.`,
      ),
    )
  }

  // --- live-faq-on-campaign ----------------------------------------------
  for (const section of sections) {
    if (section.kind !== "faq") continue
    if ((section.props as { source?: string }).source !== "live") continue
    findings.push(
      finding(
        "live-faq-on-campaign",
        "high",
        [section.id],
        `"${section.id}" pulls the site-wide FAQ, which answers "what is DJP Athlete" for a stranger — not the objections someone has while deciding about THIS offer.`,
        `Switch to source "inline" and write the objections to this specific thing: cost, time, whether it suits their level, what happens if they are injured, how to cancel.`,
      ),
    )
  }

  // --- proof-below-fold --------------------------------------------------
  const proofIndex = sections.findIndex((section) => section.kind === "proof" || section.kind === "testimonial")
  if (proofIndex === -1 || proofIndex > Math.floor(sections.length / 2)) {
    findings.push(
      finding(
        "proof-below-fold",
        "high",
        proofIndex === -1 ? [] : [sections[proofIndex].id],
        proofIndex === -1
          ? `The page has no proof section and no testimonial at all.`
          : `The first proof on the page is at position ${proofIndex + 1} of ${sections.length}. Social proof that far down is read by people who had already decided.`,
        `Put a proof strip directly under the first screen, or a testimonial before the halfway point.`,
      ),
    )
  }

  // --- section-count -----------------------------------------------------
  if (sections.length < 6 || sections.length > 9) {
    findings.push(
      finding(
        "section-count",
        "low",
        [],
        `The page has ${sections.length} sections. A capture page wants six to nine: fewer has nothing to believe, more gives the reader more chances to leave.`,
        sections.length < 6 ? `Add the missing beat — proof, objection handling, or a how-it-works.` : `Cut the sections you cannot justify. Length is not thoroughness.`,
      ),
    )
  }

  return findings
}
```

- [ ] **Step 7: Run the test**

Run: `npx vitest run __tests__/lib/funnels/sections/review/audit.test.ts`
Expected: PASS. If the production fixture assertion fails, **fix the auditor, never the fixture** — the fixture is the evidence the work exists for.

- [ ] **Step 8: Commit**

```bash
git add lib/funnels/sections/review/audit.ts lib/funnels/sections/doc.ts __tests__/lib/funnels/sections/review/
git commit -m "feat(funnels): the deterministic auditor, proven against the real page"
```

---

### Task 4: The audit ↔ prompt cross-reference

**Files:**
- Test: `__tests__/lib/funnels/sections/review/audit-prompt-agreement.test.ts`

**Interfaces:**
- Consumes: `AUDIT_CODES` (Task 1), `LEADGEN_RULES` and `BUILDER_RULES` from `@/lib/funnels/sections/prompt`.
- Produces: nothing — a guard.

- [ ] **Step 1: Write the test**

```ts
// __tests__/lib/funnels/sections/review/audit-prompt-agreement.test.ts
//
// Three audit codes are code restatements of prose that already lives in
// LEADGEN_RULES. Prose cannot generate code, so the duplication is
// unavoidable — but it must be DETECTABLE. Without this file, deleting or
// rewriting a prompt rule leaves an enforcement rule silently arguing with
// the instruction that produced it, and nothing goes red.
import { describe, expect, it } from "vitest"
import { LEADGEN_RULES } from "@/lib/funnels/sections/prompt"
import { AUDIT_CODES } from "@/lib/funnels/sections/review/findings"

/** Each enforced code -> the LEADGEN_RULES entry it enforces, and a keyword
 *  from that rule that must survive any rewrite of it. */
const ENFORCED: Record<string, { index: number; keyword: RegExp }> = {
  "cta-divergence": { index: 1, keyword: /ONE OFFER, ONE ACTION/ },
  "live-faq-on-campaign": { index: 2, keyword: /source: "live"/ },
  "proof-below-fold": { index: 3, keyword: /PROOF GOES NEAR THE TOP/ },
  "section-count": { index: 4, keyword: /Six to nine/ },
}

describe("the auditor and the prompt agree", () => {
  it.each(Object.entries(ENFORCED))("%s still has its prompt rule", (code, { index, keyword }) => {
    expect(AUDIT_CODES).toContain(code)
    expect(LEADGEN_RULES[index]).toBeDefined()
    expect(LEADGEN_RULES[index]).toMatch(keyword)
  })

  it("does not enforce a rule the prompt never states", () => {
    for (const code of Object.keys(ENFORCED)) {
      expect(AUDIT_CODES).toContain(code)
    }
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run __tests__/lib/funnels/sections/review/audit-prompt-agreement.test.ts`
Expected: PASS. If an index is wrong, read `LEADGEN_RULES` in `prompt.ts` and correct the index in the test — not the rule.

- [ ] **Step 3: Commit**

```bash
git add __tests__/lib/funnels/sections/review/audit-prompt-agreement.test.ts
git commit -m "test(funnels): the auditor and the prompt cannot drift apart silently"
```

---

### Task 5: The section boundary in the stylesheet

**Files:**
- Modify: `lib/funnels/sections/styles.ts` (the `THEME_CSS` pad/tone block)
- Test: `__tests__/lib/funnels/sections/review/section-boundary.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: four CSS rules in `THEME_CSS`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/funnels/sections/review/section-boundary.test.ts
//
// Two adjacent sections at the same tone had NO boundary of any kind — no
// border, no adjacent-sibling rule, nothing. They painted as one continuous
// band with 6rem of dead space floating in the middle. That is what the owner
// reported as "the spacing looks off".
//
// The selectors are asserted against markup `renderSection` ACTUALLY EMITS,
// not against a hand-written attribute string: a rule matching
// `[data-tone="default"]` is worthless if the renderer omits the attribute
// when no tone was set. (It does not — it resolves defaults and always emits
// — and this test is what keeps that true.)
import { describe, expect, it } from "vitest"
import { THEME_CSS } from "@/lib/funnels/sections/styles"
import { renderSection } from "@/lib/funnels/sections/render"
import type { Section } from "@/lib/funnels/sections/registry"

const TONES = ["default", "muted", "accent", "dark"] as const

function ctaSection(id: string, tone?: string): Section {
  return {
    id, kind: "cta", variant: "band",
    style: tone ? { tone: tone as Section["style"]["tone"] } : {},
    props: { headline: "Headline", cta: { label: "Go", target: { kind: "booking" } } },
  }
}

describe("the same-tone section boundary", () => {
  it.each(TONES)("has an adjacent-sibling rule for %s", (tone) => {
    expect(THEME_CSS).toMatch(new RegExp(`\\[data-tone="${tone}"\\]\\s*\\+\\s*\\.djp-s\\[data-tone="${tone}"\\]`))
  })

  it("does not use currentColor — the tone-contrast harness cannot see it", () => {
    const boundaryRules = THEME_CSS.split("\n").filter((line) => line.includes("+ .djp-s[data-tone="))
    expect(boundaryRules.length).toBeGreaterThan(0)
    const block = THEME_CSS.slice(THEME_CSS.indexOf(boundaryRules[0]))
    expect(block.slice(0, 600)).not.toContain("currentColor")
  })

  it("matches markup the renderer actually emits for an UNSET tone", () => {
    // The renderer resolves defaults, so a section with `style: {}` still
    // carries data-tone="default" and the selector above can match it.
    const html = renderSection(ctaSection("a"), { editable: false } as never).html
    expect(html).toContain('data-tone="default"')
  })
})
```

Note: if `renderSection`'s signature differs, read `lib/funnels/sections/render.ts` and call it the way `render.test.ts` does. The assertion that matters is `data-tone="default"` appearing in real output.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/funnels/sections/review/section-boundary.test.ts`
Expected: FAIL on the four selector assertions.

- [ ] **Step 3: Add the rules to `THEME_CSS`**

Immediately after the existing tone knob block in `lib/funnels/sections/styles.ts`:

```
/* SECTION BOUNDARY — the fix for "the spacing looks off".
   Two adjacent sections at the same tone had nothing between them: no border,
   no adjacent-sibling rule anywhere in this file. They painted as one
   continuous band with both sections' padding-block stacked into a single
   6rem void, so the reader could not tell where one idea ended.

   The auditor (review/audit.ts, `tone-run`) stops the model CREATING these.
   This is the safety net for when one slips through, and the only fix
   available to the two pages already published — a version row freezes HTML
   AND CSS, so nothing live repaints; they take this up on next publish.

   EXPLICIT TOKEN PER TONE, NEVER `currentColor`. render.test.ts's
   tone-contrast harness resolves colours BY TOKEN; a currentColor divider is
   unmodelled by it and would pass the suite while being invisible to the only
   test that checks tone rendering. Each rule mixes the tone's OWN paired
   foreground, so the divider survives a scope flip for the same reason the
   tone pass swaps pairs instead of picking a lightness. */
${ROOT} .djp-s[data-tone="default"] + .djp-s[data-tone="default"] {
  border-top: 1px solid color-mix(in oklch, var(--foreground) 10%, transparent);
}
${ROOT} .djp-s[data-tone="muted"] + .djp-s[data-tone="muted"] {
  border-top: 1px solid color-mix(in oklch, var(--foreground) 14%, transparent);
}
${ROOT} .djp-s[data-tone="accent"] + .djp-s[data-tone="accent"] {
  border-top: 1px solid color-mix(in oklch, var(--accent-foreground) 22%, transparent);
}
${ROOT} .djp-s[data-tone="dark"] + .djp-s[data-tone="dark"] {
  border-top: 1px solid color-mix(in oklch, var(--primary-foreground) 22%, transparent);
}
```

- [ ] **Step 4: Run the new test AND the existing render + leadgen suites**

Run: `npx vitest run __tests__/lib/funnels/sections/review/section-boundary.test.ts __tests__/lib/funnels/sections/render.test.ts __tests__/lib/funnels/sections/leadgen.test.ts __tests__/lib/funnels/css-scope.test.ts`
Expected: all PASS. `css-scope` is in the list because every rule added to `THEME_CSS` must carry the `${ROOT}` scope prefix, and that suite is what enforces it.

- [ ] **Step 5: Commit**

```bash
git add lib/funnels/sections/styles.ts __tests__/lib/funnels/sections/review/section-boundary.test.ts
git commit -m "fix(funnels): two sections at one tone had no boundary between them"
```

---

### Task 6: Migration 00209 and the `review` turn source

**Files:**
- Create: `supabase/migrations/00209_funnel_review_turns.sql`
- Modify: `lib/db/funnel-builder.ts:75` (`TurnSource`)
- Test: `__tests__/lib/db/funnel-builder.test.ts` (extend)

**Interfaces:**
- Consumes: nothing.
- Produces: `TurnSource` gains `"review"`.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/lib/db/funnel-builder.test.ts`:

```ts
import fs from "node:fs"
import path from "node:path"

describe("the review turn source", () => {
  it("is allowed by a migration, not just by TypeScript", () => {
    const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/00209_funnel_review_turns.sql"), "utf8")
    expect(sql).toContain("funnel_step_turns_source_check")
    expect(sql).toMatch(/'review'/)
    // Every pre-existing source must survive the widening: dropping one would
    // orphan every turn already written with it.
    for (const source of ["ai", "inspector", "revert"]) {
      expect(sql).toMatch(new RegExp(`'${source}'`))
    }
  })

  it("is in the TypeScript union too", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "lib/db/funnel-builder.ts"), "utf8")
    expect(source).toMatch(/export type TurnSource =[^\n]*"review"/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/db/funnel-builder.test.ts`
Expected: FAIL — the migration file does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/00209_funnel_review_turns.sql
--
-- The review stage appends its changes as their OWN turn rather than folding
-- them into the build turn. That is what makes full authority over copy safe:
-- `revertToRevision` already powers "Go back to here" on every restorable
-- turn, so undoing only the polish — and keeping the page the builder made —
-- is one click. Folding review into the build turn would make the two
-- inseparable.
--
-- Additive and backwards compatible: every source already written stays legal.

alter table funnel_step_turns drop constraint if exists funnel_step_turns_source_check;

alter table funnel_step_turns add constraint funnel_step_turns_source_check
  check (source = any (array['ai'::text, 'inspector'::text, 'revert'::text, 'review'::text]));
```

- [ ] **Step 4: Widen `TurnSource`**

In `lib/db/funnel-builder.ts`, replace line 75:

```ts
/**
 * Who wrote this turn.
 *
 * `review` is the AI review stage (lib/funnels/sections/review/), which runs
 * AFTER an `ai` turn has already committed and appends its improvements
 * separately. Kept distinct from `ai` on purpose: the transcript has to be
 * able to say "the builder made this, then the reviewer changed that", and
 * "Go back to here" has to be able to undo the second without the first.
 * Constrained in the database by `funnel_step_turns_source_check` (00209).
 */
export type TurnSource = "ai" | "inspector" | "revert" | "review"
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run __tests__/lib/db/funnel-builder.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/00209_funnel_review_turns.sql lib/db/funnel-builder.ts __tests__/lib/db/funnel-builder.test.ts
git commit -m "feat(funnels): a review turn is its own turn, so undoing it is one click"
```

**DO NOT apply this migration to production by hand.** Pushing to `main` auto-applies it via CI.

---

### Task 7: The critic panel

**Files:**
- Create: `lib/funnels/sections/review/critics.ts`
- Test: `__tests__/lib/funnels/sections/review/critics.test.ts`

**Interfaces:**
- Consumes: `Finding`, `criticFindingsSchema` (Task 1); `SECTION_REVIEW_CRITIC_MODEL`, `SECTION_REVIEW_CRITIC_MAX_TOKENS` (Task 2); `callAgent` from `@/lib/ai/anthropic`.
- Produces: `CRITICS` (the three lens definitions), `runCritics(doc: SectionDoc, auditFindings: Finding[]): Promise<Finding[]>`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/funnels/sections/review/critics.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest"

const callAgent = vi.fn()
vi.mock("@/lib/ai/anthropic", () => ({ callAgent: (...args: unknown[]) => callAgent(...args) }))

import { runCritics, CRITICS } from "@/lib/funnels/sections/review/critics"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

const DOC: SectionDoc = {
  v: 1, engine: "sections", theme: { tone: "light", accent: "accent", radius: "soft" },
  sections: [{ id: "hero", kind: "hero", variant: "centered", style: {}, props: { headline: "Hi", primaryCta: { label: "Go", target: { kind: "booking" } } } }],
}

function ok(code: string) {
  return { content: { findings: [{ code, severity: "medium", sectionIds: ["hero"], issue: "i", suggestion: "s" }] }, usage: {} }
}

beforeEach(() => { callAgent.mockReset() })

describe("runCritics", () => {
  it("runs all three lenses", async () => {
    callAgent.mockImplementation(() => Promise.resolve(ok("x")))
    await runCritics(DOC, [])
    expect(callAgent).toHaveBeenCalledTimes(3)
  })

  it("stamps the source from the CALLER, not the model", async () => {
    callAgent.mockImplementation(() => Promise.resolve(ok("x")))
    const found = await runCritics(DOC, [])
    expect(new Set(found.map((f) => f.source))).toEqual(new Set(["art", "copy", "conversion"]))
  })

  it("survives one critic throwing", async () => {
    callAgent
      .mockImplementationOnce(() => Promise.reject(new Error("boom")))
      .mockImplementation(() => Promise.resolve(ok("x")))
    const found = await runCritics(DOC, [])
    expect(found.length).toBeGreaterThan(0)
  })

  it("returns an empty list — never throws — when all three fail", async () => {
    callAgent.mockImplementation(() => Promise.reject(new Error("boom")))
    await expect(runCritics(DOC, [])).resolves.toEqual([])
  })

  it("runs them in parallel, not in series", async () => {
    let inFlight = 0
    let peak = 0
    callAgent.mockImplementation(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      return ok("x")
    })
    await runCritics(DOC, [])
    expect(peak).toBe(3)
  })

  it("gives the critics the deterministic findings so they do not rediscover them", async () => {
    callAgent.mockImplementation(() => Promise.resolve(ok("x")))
    await runCritics(DOC, [{ code: "tone-run", severity: "high", sectionIds: ["a", "b"], issue: "seam", suggestion: "fix", source: "audit" }])
    const userMessage = callAgent.mock.calls[0][1] as string
    expect(userMessage).toContain("tone-run")
  })

  it("has three lenses that do not overlap", () => {
    expect(CRITICS).toHaveLength(3)
    expect(new Set(CRITICS.map((c) => c.source)).size).toBe(3)
    // Distinct prompts, not one prompt with the name swapped: three critics
    // sharing a brief report the same finding three times and feel thorough.
    expect(new Set(CRITICS.map((c) => c.system)).size).toBe(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/funnels/sections/review/critics.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/funnels/sections/review/critics.ts — three lenses, run in parallel.
//
// THE LENSES ARE THE DESIGN. Three critics sharing one brief would report the
// same finding three times and feel thorough while adding nothing. Each one
// below is given a question the other two cannot answer, and is told what the
// others cover so it does not stray into their territory.
//
// They run on Sonnet, not because critique is easy but because a critic emits
// FINDINGS — prose in a fixed envelope. Nothing it returns has to satisfy
// `opSchema`. The Opus budget goes to the reviser, which must. Same shape as
// `lib/agents/self-critique.ts`.

import { callAgent } from "@/lib/ai/anthropic"
import { SECTION_REVIEW_CRITIC_MAX_TOKENS, SECTION_REVIEW_CRITIC_MODEL } from "@/lib/funnels/sections/builder-config"
import type { SectionDoc } from "@/lib/funnels/sections/registry"
import { criticFindingsSchema, type Finding, type FindingSource } from "@/lib/funnels/sections/review/findings"

const SHARED_ENVELOPE = `
You are reviewing a landing page for a strength-and-conditioning coaching
business. The page is a TYPED DOCUMENT, not HTML: each section has a kind, a
variant, four style knobs (headline size, align, tone, pad) and typed props.

Return findings only. You do not fix anything — a separate editor acts on what
you report, and it can only act on what you make specific.

Each finding needs:
  code        a short kebab-case slug for the KIND of problem ("vague-headline")
  severity    "high" when it costs the page conversions or credibility,
              "medium" when it makes the page worse, "low" for polish
  sectionIds  the section ids it concerns; [] for a whole-page problem
  issue       ONE sentence naming what is wrong, quoting the copy if it is copy
  suggestion  ONE sentence naming what to do instead, concretely

Rules that make a finding useful:
- Name the section. "The copy is weak" is unactionable; "the hero headline
  'Train smarter' could describe any gym" is actionable.
- Never suggest a section kind that is not already on the page unless you say
  which of the ten kinds it is: hero, proof, bullets, steps, testimonial,
  pricing, faq, form, cta, footer.
- If the page is genuinely good in your area, return an empty list. A critic
  that always finds three things is a critic nobody can trust.
- Say nothing about anything outside your lens. Two other reviewers are
  reading this page at the same time and their notes are merged with yours.
`.trim()

export interface CriticLens {
  source: Exclude<FindingSource, "audit">
  label: string
  system: string
}

export const CRITICS: readonly CriticLens[] = [
  {
    source: "art",
    label: "Art director",
    system: `${SHARED_ENVELOPE}

YOUR LENS: how the page LOOKS as you scroll it. Nobody else is looking at this.

Ask: where does the page go flat? A landing page needs a rhythm — bands that
alternate, sections that breathe differently, a shape the eye can follow. Look
for tone that never changes, padding that never changes, variants chosen by
default rather than for a reason, alignment that flips without meaning, and a
page whose whole middle is interchangeable.

Also look for the opposite failure: a page so busy with alternating tones that
nothing stands out, or a hero that has to compete with the section under it.

The other two reviewers cover the words and the offer. Say nothing about either
except where the LAYOUT is what makes them fail — a testimonial buried in the
middle of five identical bands is your finding; a badly written testimonial is
not.`,
  },
  {
    source: "copy",
    label: "Copywriter",
    system: `${SHARED_ENVELOPE}

YOUR LENS: the words. Nobody else is reading them closely.

Ask of every headline: could this sit on any competitor's page unchanged? If
yes, it says nothing. Look for abstraction where a number belongs, hedging,
throat-clearing openers, three sections that make the same point in different
words, industry jargon a parent booking for their teenager would not use, and
subheads that restate the headline instead of advancing it.

This is a coach who works with real athletes in Tampa Bay. The voice is direct
and specific and slightly blunt — "we tell you what we'd do in your position",
not "we leverage evidence-based methodologies". Flag anything that sounds like
a brochure.

The other two reviewers cover the layout and the offer. Judge the writing.`,
  },
  {
    source: "conversion",
    label: "Conversion strategist",
    system: `${SHARED_ENVELOPE}

YOUR LENS: whether a visitor who wants this can actually act. Nobody else is
asking.

Ask: what is this page's ONE job, and does every part serve it? Look for an
offer that is never stated plainly, a price or a commitment the page hides, an
objection a real person would have that nothing on the page answers (cost,
time, "am I fit enough", injury, cancellation, what happens after I click),
proof that arrives too late to matter, a form asking for more than it needs,
and a call to action whose label describes the button rather than the outcome
("Submit" instead of "Book my call").

Consider what is MISSING as hard as what is present. A page with no answer to
"what does it cost" has a hole in it even though nothing on the page is wrong.

The other two reviewers cover the layout and the prose. Judge the offer.`,
  },
]

function findingsBlock(findings: Finding[]): string {
  if (findings.length === 0) return "(A structural check found nothing mechanical.)"
  return findings
    .map((finding) => `- [${finding.severity}] ${finding.code} (${finding.sectionIds.join(", ") || "whole page"}): ${finding.issue}`)
    .join("\n")
}

function userMessage(doc: SectionDoc, auditFindings: Finding[]): string {
  return `## The page

${JSON.stringify(doc, null, 2)}

## Already found by a structural check — do NOT repeat these

${findingsBlock(auditFindings)}

Report what your lens finds. Return JSON only.`
}

/**
 * All three lenses, concurrently.
 *
 * NEVER THROWS. A critic that fails is a critic whose findings are missing,
 * not a turn that dies: the review stage runs after the owner's page has
 * already been saved, and there is no failure here worth showing them an
 * error for. `Promise.allSettled`, not `Promise.all` — one rejection with
 * `all` would discard the two that succeeded.
 */
export async function runCritics(doc: SectionDoc, auditFindings: Finding[]): Promise<Finding[]> {
  const message = userMessage(doc, auditFindings)

  const settled = await Promise.allSettled(
    CRITICS.map((critic) =>
      callAgent(critic.system, message, criticFindingsSchema, {
        model: SECTION_REVIEW_CRITIC_MODEL,
        maxTokens: SECTION_REVIEW_CRITIC_MAX_TOKENS,
      }).then((result) =>
        // `source` is stamped HERE, not read from the model. A model asked to
        // label its own lens occasionally labels it as another critic's, and
        // dedupe then silently merges two independent observations into one.
        result.content.findings.map((finding): Finding => ({ ...finding, source: critic.source })),
      ),
    ),
  )

  const out: Finding[] = []
  for (const [index, result] of settled.entries()) {
    if (result.status === "fulfilled") {
      out.push(...result.value)
      continue
    }
    console.error(`[funnels/review] critic "${CRITICS[index].source}" failed:`, result.reason)
  }
  return out
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run __tests__/lib/funnels/sections/review/critics.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/funnels/sections/review/critics.ts __tests__/lib/funnels/sections/review/critics.test.ts
git commit -m "feat(funnels): three critics with lenses that do not overlap"
```

---

### Task 8: The reviser

**Files:**
- Create: `lib/funnels/sections/review/reviser.ts`
- Test: `__tests__/lib/funnels/sections/review/reviser.test.ts`

**Interfaces:**
- Consumes: `opSchema` from `@/lib/funnels/sections/apply`; `Finding` (Task 1); `SECTION_REVIEW_REVISER_MAX_TOKENS` (Task 2); `SECTION_BUILDER_BLOCK_A` from `@/lib/funnels/sections/prompt`.
- Produces: `reviseResultSchema`, `runReviser(doc: SectionDoc, findings: Finding[]): Promise<{ summary: string; ops: SectionOp[] }>`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/funnels/sections/review/reviser.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest"

const callAgent = vi.fn()
vi.mock("@/lib/ai/anthropic", () => ({ callAgent: (...args: unknown[]) => callAgent(...args) }))

import { runReviser, reviseResultSchema, REVISER_SYSTEM } from "@/lib/funnels/sections/review/reviser"
import { opSchema } from "@/lib/funnels/sections/apply"
import { SECTION_BUILDER_BLOCK_A } from "@/lib/funnels/sections/prompt"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

const DOC: SectionDoc = {
  v: 1, engine: "sections", theme: { tone: "light", accent: "accent", radius: "soft" },
  sections: [{ id: "hero", kind: "hero", variant: "centered", style: {}, props: { headline: "Hi", primaryCta: { label: "Go", target: { kind: "booking" } } } }],
}

beforeEach(() => { callAgent.mockReset() })

describe("reviseResultSchema", () => {
  it("uses the REAL op grammar, not a copy of it", () => {
    // An op the builder would reject must be rejected here identically.
    const bad = { summary: "x", ops: [{ op: "update_section", id: "hero" }] }
    expect(reviseResultSchema.safeParse(bad).success).toBe(opSchema.safeParse(bad.ops[0]).success)
    expect(reviseResultSchema.safeParse(bad).success).toBe(false)
  })

  it("accepts a valid op", () => {
    const good = { summary: "Retoned the seam.", ops: [{ op: "update_section", id: "hero", style: { tone: "muted" } }] }
    expect(reviseResultSchema.safeParse(good).success).toBe(true)
  })
})

describe("the reviser prompt", () => {
  it("reuses the builder's frozen block rather than re-describing the registry", () => {
    expect(REVISER_SYSTEM).toContain(SECTION_BUILDER_BLOCK_A)
  })

  it("does not mutate the frozen block", () => {
    const before = SECTION_BUILDER_BLOCK_A
    expect(SECTION_BUILDER_BLOCK_A).toBe(before)
  })
})

describe("runReviser", () => {
  it("passes the findings to the model", async () => {
    callAgent.mockResolvedValue({ content: { summary: "s", ops: [] }, usage: {} })
    await runReviser(DOC, [{ code: "tone-run", severity: "high", sectionIds: ["a"], issue: "seam here", suggestion: "retone", source: "audit" }])
    expect(callAgent.mock.calls[0][1]).toContain("seam here")
  })

  it("asks for the reviser token budget, never the default", async () => {
    callAgent.mockResolvedValue({ content: { summary: "s", ops: [] }, usage: {} })
    await runReviser(DOC, [])
    expect(callAgent.mock.calls[0][3]).toMatchObject({ maxTokens: 14_000 })
  })

  it("returns no ops when there is nothing to fix, rather than inventing work", async () => {
    callAgent.mockResolvedValue({ content: { summary: "Nothing needed.", ops: [] }, usage: {} })
    const result = await runReviser(DOC, [])
    expect(result.ops).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/funnels/sections/review/reviser.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/funnels/sections/review/reviser.ts — the one call that changes the page.
//
// It reuses `SECTION_BUILDER_BLOCK_A` VERBATIM. That block already describes
// the ten kinds, the op grammar, the eight application rules and the leadgen
// craft rules, and it is a module-level const built once at import — so
// reusing it costs nothing and keeps the reviser and the builder describing
// ONE registry. Re-describing the section kinds here would be a second copy
// of the thing the whole registry design exists to prevent.
//
// `opSchema` is IMPORTED, never restated. This repo has shipped three bugs
// from restating a schema instead of importing it.

import { z } from "zod"
import { callAgent } from "@/lib/ai/anthropic"
import { opSchema, type SectionOp } from "@/lib/funnels/sections/apply"
import { SECTION_BUILDER_MAX_OPS, SECTION_REVIEW_REVISER_MAX_TOKENS } from "@/lib/funnels/sections/builder-config"
import { SECTION_BUILDER_MODEL } from "@/lib/funnels/sections/builder-config"
import { SECTION_BUILDER_BLOCK_A } from "@/lib/funnels/sections/prompt"
import type { SectionDoc } from "@/lib/funnels/sections/registry"
import type { Finding } from "@/lib/funnels/sections/review/findings"

export const reviseResultSchema = z.object({
  /** Plain prose for the transcript. What changed and why, in the owner's terms. */
  summary: z.string().min(1).max(600),
  ops: z.array(opSchema).max(SECTION_BUILDER_MAX_OPS),
})

export type ReviseResult = z.infer<typeof reviseResultSchema>

export const REVISER_SYSTEM = `${SECTION_BUILDER_BLOCK_A}

---

## You are now the EDITOR, not the author

The page above already exists. Three reviewers and a structural check have read
it and reported what is wrong. Your job is to fix exactly what they found and
nothing else.

- Act on the findings. Do not go looking for new problems; the reviewers were
  thorough and a fourth opinion applied silently is how a page drifts away from
  what its owner asked for.
- Prefer \`update_section\` over \`set_page\` in every case. \`set_page\` is a
  rewrite, it is REPORTED to the owner as one, and it throws away section ids
  that anchors point at.
- A finding you disagree with is a finding you skip. Say so in the summary.
  Emitting an op you think is wrong to satisfy a reviewer is worse than leaving
  the page alone.
- Rhythm findings are usually fixed with \`style\`, not \`props\`: a tone seam
  needs one section's \`style.tone\` changed, not its copy rewritten.
- If the findings are all low severity and the page reads well, return an empty
  ops array and say the page is in good shape. That is a valid, good outcome.

\`summary\` is shown to the owner in their chat transcript. Plain prose, no
markdown, past tense, one short paragraph: what you changed and why.`

function findingsBlock(findings: Finding[]): string {
  if (findings.length === 0) return "(Nothing was found. Return an empty ops array.)"
  return findings
    .map(
      (finding, index) =>
        `${index + 1}. [${finding.severity}] ${finding.code} — ${finding.sectionIds.join(", ") || "whole page"}\n   Problem: ${finding.issue}\n   Suggested: ${finding.suggestion}`,
    )
    .join("\n\n")
}

export async function runReviser(doc: SectionDoc, findings: Finding[]): Promise<ReviseResult> {
  const message = `## The page as it stands

${JSON.stringify(doc, null, 2)}

## What the reviewers found

${findingsBlock(findings)}

Emit the ops that fix these. Return JSON only.`

  const { content } = await callAgent(REVISER_SYSTEM, message, reviseResultSchema, {
    model: SECTION_BUILDER_MODEL,
    maxTokens: SECTION_REVIEW_REVISER_MAX_TOKENS,
    // NOT cached. The system string embeds the findings-shaped tail after the
    // frozen block, and a cache breakpoint on a string whose tail changes
    // every turn is a full cache WRITE every turn, forever, with no error
    // anywhere. See prompt.ts's note on why Block A is a const.
  })
  return content
}

export type { SectionOp }
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run __tests__/lib/funnels/sections/review/reviser.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/funnels/sections/review/reviser.ts __tests__/lib/funnels/sections/review/reviser.test.ts
git commit -m "feat(funnels): the reviser edits through the builder's own op grammar"
```

---

### Task 9: The pipeline

**Files:**
- Create: `lib/funnels/sections/review/pipeline.ts`
- Test: `__tests__/lib/funnels/sections/review/pipeline.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-8, plus `applyOps` from `@/lib/funnels/sections/apply`.
- Produces: `reviewDoc(input: ReviewInput): Promise<ReviewOutcome>` where

```ts
interface ReviewInput { doc: SectionDoc; onFinding?: (finding: Finding) => void }
interface ReviewOutcome {
  changed: boolean
  doc: SectionDoc          // the revised doc, or the input doc when nothing changed
  ops: SectionOp[]
  summary: string
  findings: Finding[]      // everything found, pre-revision
  surviving: Finding[]     // what the gate still sees afterwards
  receipt: DiffReceipt | null
  error: string | null     // set when the stage gave up; never thrown
}
```

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/funnels/sections/review/pipeline.test.ts
//
// The contract this file pins is NEGATIVE: the review stage must never throw,
// never return a document worse than the one it was given, and never take the
// turn down. It runs after the owner's page is already saved, so every failure
// mode here has exactly one correct behaviour — give the page back unchanged.
import { describe, expect, it, vi, beforeEach } from "vitest"

const runCritics = vi.fn()
const runReviser = vi.fn()
vi.mock("@/lib/funnels/sections/review/critics", () => ({ runCritics: (...a: unknown[]) => runCritics(...a), CRITICS: [] }))
vi.mock("@/lib/funnels/sections/review/reviser", () => ({ runReviser: (...a: unknown[]) => runReviser(...a) }))

import { reviewDoc } from "@/lib/funnels/sections/review/pipeline"
import { sectionDocSchema, type SectionDoc } from "@/lib/funnels/sections/registry"
import fixture from "./fixtures/production-consultation-page.json"

const PROD: SectionDoc = sectionDocSchema.parse(fixture)

beforeEach(() => { runCritics.mockReset(); runReviser.mockReset() })

describe("reviewDoc", () => {
  it("fixes the real page's tone seam end to end", async () => {
    runCritics.mockResolvedValue([])
    runReviser.mockResolvedValue({
      summary: "Retoned two seams.",
      ops: [
        { op: "update_section", id: "what-you-get", style: { tone: "muted" } },
        { op: "update_section", id: "questions", style: { tone: "muted" } },
      ],
    })
    const out = await reviewDoc({ doc: PROD })
    expect(out.changed).toBe(true)
    expect(out.error).toBeNull()
    // The gate proves it worked: the two tone-run findings are gone.
    expect(out.surviving.filter((f) => f.code === "tone-run")).toEqual([])
    expect(out.findings.filter((f) => f.code === "tone-run")).toHaveLength(2)
  })

  it("returns the page UNCHANGED when the reviser throws", async () => {
    runCritics.mockResolvedValue([])
    runReviser.mockRejectedValue(new Error("model down"))
    const out = await reviewDoc({ doc: PROD })
    expect(out.changed).toBe(false)
    expect(out.doc).toBe(PROD)
    expect(out.error).toContain("model down")
  })

  it("returns the page UNCHANGED when the ops are rejected", async () => {
    runCritics.mockResolvedValue([])
    runReviser.mockResolvedValue({ summary: "s", ops: [{ op: "remove_section", id: "does-not-exist" }] })
    const out = await reviewDoc({ doc: PROD })
    expect(out.changed).toBe(false)
    expect(out.doc).toBe(PROD)
    expect(out.error).not.toBeNull()
  })

  it("never throws, whatever fails", async () => {
    runCritics.mockRejectedValue(new Error("boom"))
    runReviser.mockRejectedValue(new Error("boom"))
    await expect(reviewDoc({ doc: PROD })).resolves.toBeDefined()
  })

  it("still reviews using deterministic findings alone when every critic fails", async () => {
    runCritics.mockResolvedValue([])
    runReviser.mockResolvedValue({ summary: "s", ops: [{ op: "update_section", id: "questions", style: { tone: "muted" } }] })
    const out = await reviewDoc({ doc: PROD })
    expect(runReviser).toHaveBeenCalled()
    const passed = runReviser.mock.calls[0][1] as Array<{ code: string }>
    expect(passed.some((f) => f.code === "tone-run")).toBe(true)
  })

  it("streams each finding as it is found", async () => {
    runCritics.mockResolvedValue([])
    runReviser.mockResolvedValue({ summary: "s", ops: [] })
    const seen: string[] = []
    await reviewDoc({ doc: PROD, onFinding: (f) => seen.push(f.code) })
    expect(seen).toContain("tone-run")
  })

  it("does nothing at all when there is nothing to fix", async () => {
    const clean: SectionDoc = {
      v: 1, engine: "sections", theme: { tone: "light", accent: "accent", radius: "soft" },
      sections: [
        { id: "hero", kind: "hero", variant: "centered", style: { headline: "xl", align: "center", tone: "dark", pad: "roomy" }, props: { headline: "Rebuild your sprint speed in eight weeks", primaryCta: { label: "Start", target: { kind: "booking" } } } },
        { id: "proof", kind: "proof", variant: "stats", style: { align: "center", pad: "tight" }, props: { items: [{ value: "500+", label: "athletes" }, { value: "12 yrs", label: "coaching" }] } },
        { id: "what", kind: "bullets", variant: "cards", style: { headline: "lg", align: "left", tone: "muted", pad: "roomy" }, props: { heading: "What you get", items: [{ title: "Assessment" }, { title: "Programming" }] } },
        { id: "how", kind: "steps", variant: "numbered", style: { headline: "lg", align: "left", pad: "normal" }, props: { heading: "How it works", steps: [{ title: "Assess" }, { title: "Build" }] } },
        { id: "faq", kind: "faq", variant: "stack", style: { headline: "lg", align: "left", tone: "muted", pad: "normal" }, props: { heading: "Questions", source: "inline", items: [{ q: "Cost?", a: "Free." }] } },
        { id: "book", kind: "cta", variant: "band", style: { headline: "lg", align: "center", tone: "accent", pad: "roomy" }, props: { headline: "Start this week", cta: { label: "Start", target: { kind: "booking" } } } },
        { id: "footer", kind: "footer", variant: "simple", style: { align: "center", pad: "tight" }, props: { businessName: "DJP Athlete", lines: [], links: [] } },
      ],
    }
    runCritics.mockResolvedValue([])
    runReviser.mockResolvedValue({ summary: "Nothing needed.", ops: [] })
    const out = await reviewDoc({ doc: clean })
    expect(out.changed).toBe(false)
    expect(out.error).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/funnels/sections/review/pipeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/funnels/sections/review/pipeline.ts — audit, critique, revise, gate.
//
// THE WHOLE FILE IS BUILT AROUND ONE PROMISE: this stage runs AFTER the
// owner's page has been saved, so nothing in here is allowed to fail loudly.
// Every catch below returns the input document unchanged. `reviewDoc` has no
// throwing path at all — its `error` field is how it reports trouble, and its
// caller in the route treats a non-null `error` as "no review turn", not as a
// failed request.

import { applyOps, type DiffReceipt, type SectionOp } from "@/lib/funnels/sections/apply"
import {
  SECTION_REVIEW_MAX_FINDINGS,
  SECTION_REVIEW_MAX_ROUNDS,
  SECTION_REVIEW_TIMEOUT_MS,
} from "@/lib/funnels/sections/builder-config"
import type { SectionDoc } from "@/lib/funnels/sections/registry"
import { auditDoc } from "@/lib/funnels/sections/review/audit"
import { runCritics } from "@/lib/funnels/sections/review/critics"
import { mergeFindings, type Finding } from "@/lib/funnels/sections/review/findings"
import { runReviser } from "@/lib/funnels/sections/review/reviser"

export interface ReviewInput {
  doc: SectionDoc
  /** Called as each finding lands, so the route can stream it. */
  onFinding?: (finding: Finding) => void
}

export interface ReviewOutcome {
  changed: boolean
  /** The revised document, or REFERENCE-IDENTICAL to the input when nothing changed. */
  doc: SectionDoc
  ops: SectionOp[]
  summary: string
  /** Everything found before revision. */
  findings: Finding[]
  /** What the gate still sees afterwards — the evidence for whether this worked. */
  surviving: Finding[]
  receipt: DiffReceipt | null
  /** Set when the stage gave up. NEVER thrown. */
  error: string | null
}

function unchanged(doc: SectionDoc, findings: Finding[], error: string | null): ReviewOutcome {
  return { changed: false, doc, ops: [], summary: "", findings, surviving: findings, receipt: null, error }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Rejects after `ms`, so a hung provider cannot hold the stream open. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

export async function reviewDoc(input: ReviewInput): Promise<ReviewOutcome> {
  const { doc, onFinding } = input

  if (SECTION_REVIEW_MAX_ROUNDS < 1) return unchanged(doc, [], null)

  try {
    return await withTimeout(runReview(doc, onFinding), SECTION_REVIEW_TIMEOUT_MS, "review")
  } catch (error) {
    // Includes the timeout. The page the builder made stands.
    console.error("[funnels/review] stage abandoned:", error)
    return unchanged(doc, [], message(error))
  }
}

async function runReview(doc: SectionDoc, onFinding?: (finding: Finding) => void): Promise<ReviewOutcome> {
  // --- 1. The deterministic pass. Free, and it cannot fail. --------------
  const auditFindings = auditDoc(doc)
  for (const finding of auditFindings) onFinding?.(finding)

  // --- 2. The panel. Never throws; a total failure is an empty list. -----
  let criticFindings: Finding[] = []
  try {
    criticFindings = await runCritics(doc, auditFindings)
    for (const finding of criticFindings) onFinding?.(finding)
  } catch (error) {
    // `runCritics` already swallows individual failures; this is belt and
    // braces for a throw from the fan-out itself. The deterministic findings
    // alone are still a review worth doing.
    console.error("[funnels/review] critic panel failed wholesale:", error)
  }

  const findings = mergeFindings([auditFindings, criticFindings], SECTION_REVIEW_MAX_FINDINGS)

  if (findings.length === 0) {
    return { changed: false, doc, ops: [], summary: "", findings, surviving: [], receipt: null, error: null }
  }

  // --- 3. The reviser. -------------------------------------------------
  let revision: { summary: string; ops: SectionOp[] }
  try {
    revision = await runReviser(doc, findings)
  } catch (error) {
    console.error("[funnels/review] reviser failed:", error)
    return unchanged(doc, findings, message(error))
  }

  if (revision.ops.length === 0) {
    // A reviser that read the findings and decided the page is fine is a
    // GOOD outcome, not a failure. No turn is appended for it.
    return { changed: false, doc, ops: [], summary: revision.summary, findings, surviving: findings, receipt: null, error: null }
  }

  // --- 4. Apply, transactionally, through the real applier. ------------
  const applied = applyOps(doc, revision.ops)
  if (!applied.ok) {
    console.error("[funnels/review] ops rejected:", applied.errors)
    return unchanged(doc, findings, `ops rejected: ${applied.errors.join("; ")}`)
  }

  // --- 5. The gate. ----------------------------------------------------
  // A reviser that fixed one tone seam by creating another is caught here.
  // Surviving findings are REPORTED, not hidden: a gate that quietly drops
  // what it could not fix reads as a gate that found nothing.
  const surviving = auditDoc(applied.doc)

  return {
    changed: true,
    doc: applied.doc,
    ops: revision.ops,
    summary: revision.summary,
    findings,
    surviving,
    receipt: applied.receipt,
    error: null,
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run __tests__/lib/funnels/sections/review/pipeline.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/funnels/sections/review/pipeline.ts __tests__/lib/funnels/sections/review/pipeline.test.ts
git commit -m "feat(funnels): the review pipeline, with no throwing path at all"
```

---

### Task 10: Stream phases and the `finding` event

**Files:**
- Modify: `lib/funnels/sections/build-stream.ts`
- Test: `__tests__/lib/funnels/sections/build-stream.test.ts` (extend)

**Interfaces:**
- Consumes: `Finding` (Task 1).
- Produces: `BUILD_PHASES` gains `"reviewing"` and `"polishing"`; `BuildStreamEvent` gains `{ type: "finding"; finding: Finding }` and `{ type: "review"; turn: unknown }`.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/lib/funnels/sections/build-stream.test.ts`:

```ts
import { BUILD_PHASES, BUILD_PHASE_LABELS, encodeBuildStreamEvent, createBuildStreamDecoder } from "@/lib/funnels/sections/build-stream"

describe("the review phases", () => {
  it("adds reviewing and polishing, in order, after checking", () => {
    expect(BUILD_PHASES.slice(-2)).toEqual(["reviewing", "polishing"])
  })

  it("labels every phase — a missing label is a blank pill, not an error", () => {
    for (const phase of BUILD_PHASES) {
      expect(BUILD_PHASE_LABELS[phase]).toBeTruthy()
    }
  })
})

describe("the finding event", () => {
  it("round-trips through the encoder and decoder", () => {
    const finding = { code: "tone-run", severity: "high" as const, sectionIds: ["a", "b"], issue: "i", suggestion: "s", source: "audit" as const }
    const decode = createBuildStreamDecoder()
    const events = decode(encodeBuildStreamEvent({ type: "finding", finding }))
    expect(events).toEqual([{ type: "finding", finding }])
  })

  it("survives an issue containing newlines — the frame stays one line", () => {
    const finding = { code: "x", severity: "low" as const, sectionIds: [], issue: "line one\nline two", suggestion: "s", source: "copy" as const }
    const frame = encodeBuildStreamEvent({ type: "finding", finding })
    expect(frame.split("\n").filter((l) => l.startsWith("data:"))).toHaveLength(1)
    expect(createBuildStreamDecoder()(frame)[0]).toEqual({ type: "finding", finding })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/funnels/sections/build-stream.test.ts`
Expected: FAIL on the phase assertions.

- [ ] **Step 3: Modify `build-stream.ts`**

```ts
import type { Finding } from "./review/findings"

export const BUILD_PHASES = ["reading", "planning", "writing", "checking", "reviewing", "polishing"] as const
export type BuildPhase = (typeof BUILD_PHASES)[number]

export const BUILD_PHASE_LABELS: Record<BuildPhase, string> = {
  reading: "Reading your brief",
  planning: "Planning the page",
  writing: "Writing sections",
  checking: "Checking links and layout",
  reviewing: "Reviewing the page",
  polishing: "Applying improvements",
}
```

And add to the `BuildStreamEvent` union, with this comment:

```ts
  /**
   * One thing the review stage found, streamed as it lands.
   *
   * This exists for a UX reason, not a data one: the panel adds 30-40 seconds
   * to a first draft, and streaming what it catches is the difference between
   * dead air and watching six specific problems get named. The decoder drops
   * frames it cannot parse, so an older client meets this event and ignores it.
   */
  | { type: "finding"; finding: Finding }
  /**
   * The review appended its own turn. Sent AFTER `result`, so a client that
   * only understands `result` still ends up with the built page — it just
   * misses the polish until it refetches.
   */
  | { type: "review"; turn: unknown }
```

`findings.ts` is a leaf importing only `zod`, so this import cannot pull the AI SDK into the browser bundle. Task 1's leaf test is what keeps that true.

- [ ] **Step 4: Run the test plus the builder component suite**

Run: `npx vitest run __tests__/lib/funnels/sections/build-stream.test.ts __tests__/components/admin/funnel-builder.test.tsx`
Expected: PASS. If the component suite goes red on an exhaustive `switch` over `BuildPhase` or `BuildStreamEvent`, that is the type system doing its job — handle the new cases.

- [ ] **Step 5: Commit**

```bash
git add lib/funnels/sections/build-stream.ts __tests__/lib/funnels/sections/build-stream.test.ts
git commit -m "feat(funnels): stream what the review finds, as it finds it"
```

---

### Task 11: Wire the review into the build route

**Files:**
- Modify: `app/api/admin/funnels/steps/[stepId]/build/route.ts` (in `runTurn`, after the assistant `appendTurn` at ~line 1266)
- Test: `__tests__/api/funnels/build-review.test.ts`

**Interfaces:**
- Consumes: `reviewDoc` (Task 9), `TurnSource` (Task 6), stream events (Task 10).
- Produces: nothing new exported.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/api/funnels/build-review.test.ts
//
// The route contract: a review runs only on a REWRITE, appends its own turn,
// and cannot take the build turn down.
import { describe, expect, it, vi, beforeEach } from "vitest"

const reviewDoc = vi.fn()
vi.mock("@/lib/funnels/sections/review/pipeline", () => ({ reviewDoc: (...a: unknown[]) => reviewDoc(...a) }))

import { shouldReview } from "@/lib/funnels/sections/review/pipeline"

beforeEach(() => { reviewDoc.mockReset() })

describe("shouldReview", () => {
  it("runs on a first draft — every word is the model's own", () => {
    expect(shouldReview({ isRewrite: true, requested: false })).toBe(true)
  })

  it("does not run on an ordinary edit turn", () => {
    expect(shouldReview({ isRewrite: false, requested: false })).toBe(false)
  })

  it("runs on an ordinary turn when the owner pressed Polish", () => {
    expect(shouldReview({ isRewrite: false, requested: true })).toBe(true)
  })
})
```

- [ ] **Step 2: Add `shouldReview` to `pipeline.ts`**

```ts
/**
 * Whether a turn earns a review.
 *
 * A REWRITE (`set_page` — a first draft or an explicit start-over) is reviewed
 * automatically, because every word on the page is the model's own and there
 * is nothing of the owner's to overwrite. An ordinary edit turn is not: the
 * owner just told the builder exactly what they wanted, and a reviewer that
 * second-guesses that on every keystroke is a reviewer they will turn off.
 * `requested` is the Polish button.
 */
export function shouldReview(input: { isRewrite: boolean; requested: boolean }): boolean {
  return input.requested || input.isRewrite
}
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run __tests__/api/funnels/build-review.test.ts`
Expected: PASS.

- [ ] **Step 4: Wire it into `runTurn`**

In `app/api/admin/funnels/steps/[stepId]/build/route.ts`, immediately after `if (!assistantTurn.ok) return emitAppendFailure(emit, assistantTurn)` and BEFORE the `const response: TurnResponse = {` block, insert:

```ts
  // -------------------------------------------------------------------------
  // THE REVIEW STAGE.
  //
  // Runs only after the assistant turn above has COMMITTED. That ordering is
  // the whole safety argument: the owner's page is saved, the revision has
  // advanced, and everything below can fail in any way it likes without
  // costing them the page the builder just made. `reviewDoc` has no throwing
  // path — it reports trouble in `error` — so there is no try/catch here to
  // paper over.
  //
  // The `result` event is emitted FIRST, carrying the built page, and the
  // review's own `review` event follows. A client that only understands
  // `result` therefore still ends up correct, just without the polish.
  // -------------------------------------------------------------------------
  emit({ type: "result", turn: response })

  if (!shouldReview({ isRewrite: outcome.receipt.isRewrite, requested: args.review === true })) return

  emit({ type: "phase", phase: "reviewing" })
  const review = await reviewDoc({
    doc: resolution.doc,
    onFinding: (finding) => emit({ type: "finding", finding }),
  })
  if (!review.changed) return

  emit({ type: "phase", phase: "polishing" })
  const reviewResolution = resolveSafely(review.doc, catalogues, catalogueError)
  const reviewCompile = compileDoc(reviewResolution.doc, context.funnelBasePath)

  const reviewTurn = await appendTurn({
    stepId,
    expectedRevision: assistantTurn.revision,
    role: "assistant",
    source: "review",
    status: "complete",
    message: review.summary,
    ops: review.ops,
    doc: reviewResolution.doc,
    compileStatus: compileStatus(reviewCompile),
    compileProblems: { problems: reviewCompile.problems, warnings: reviewCompile.warnings },
    unresolved: unresolvedForStorage(reviewResolution),
    model: SECTION_BUILDER_MODEL,
    latencyMs: Date.now() - startTime,
    createdBy: userId,
  })

  // A LOST RACE IS NOT AN ERROR. It means the owner edited the page while the
  // review was running, and their edit wins: a background improvement must
  // never beat a human who was typing at the same moment. The build turn they
  // already have is correct and already emitted.
  if (!reviewTurn.ok) {
    console.warn("[funnels/build] review turn lost the race; owner edit wins")
    return
  }

  emit({
    type: "review",
    turn: {
      revision: reviewTurn.revision,
      doc: reviewResolution.doc,
      reply: review.summary,
      blocked: false,
      receipt: review.receipt,
      compile: reviewCompile,
      unresolved: reviewResolution.unresolved,
      danglingAnchors: reviewResolution.danglingAnchors,
      resolutionError: reviewResolution.error,
      source: "review",
    } satisfies TurnResponse,
  })
```

Then DELETE the original `emit({ type: "result", turn: response })` at the end of `runTurn` — it has moved above. Add `review?: boolean` to the request body schema and thread it into `BuildArgs` / `TurnRunArgs` as `args.review`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "funnels/(sections|steps)" || echo "clean"`
Expected: `clean`.

- [ ] **Step 6: Run the route's own suite**

Grep first — a page's own suite has sat red on `main` before, and picking test paths by guessing is how that went unnoticed:

Run: `grep -rl "steps/\[stepId\]/build\|handleBuild\|runTurn" __tests__/ --exclude-dir=.worktrees`
Then run every file it names.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "app/api/admin/funnels/steps/[stepId]/build/route.ts" lib/funnels/sections/review/pipeline.ts __tests__/api/funnels/build-review.test.ts
git commit -m "feat(funnels): review a first draft automatically, after it is safely saved"
```

---

### Task 12: The Polish page button

**Files:**
- Modify: `components/admin/funnels/FunnelBuilder.tsx`
- Test: `__tests__/components/admin/funnel-builder-polish.test.tsx`

**Interfaces:**
- Consumes: the `review: true` request field (Task 11), `BUILD_PHASE_LABELS` (Task 10).
- Produces: nothing exported.

- [ ] **Step 1: Read the component first**

`FunnelBuilder.tsx` owns the chat input, the stream decoder and the turn list. Read how it posts a turn and how it handles `result` before adding anything — the Polish press is the same POST with `review: true` and an empty message, not a new endpoint.

- [ ] **Step 2: Write the failing test**

```tsx
// __tests__/components/admin/funnel-builder-polish.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

// Follow the existing funnel-builder.test.tsx setup for mocks and props.

describe("the Polish page button", () => {
  it("is hidden until the page has a document to polish", async () => {
    // render with doc = null
    expect(screen.queryByRole("button", { name: /polish/i })).toBeNull()
  })

  it("posts review:true and no message", async () => {
    // render with a document, click Polish
    await waitFor(() => {
      const body = JSON.parse((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[1] as string)
      expect(body.review).toBe(true)
    })
  })

  it("is disabled while a turn is in flight", async () => {
    // start a turn, assert the button is disabled
  })

  it("renders a finding event in the transcript as it arrives", async () => {
    // feed a `finding` event through the decoder, assert the issue text shows
  })
})
```

Fill each body in following the patterns already in `__tests__/components/admin/funnel-builder.test.tsx`. Do not leave a test with an empty body — an empty test passes and proves nothing.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run __tests__/components/admin/funnel-builder-polish.test.tsx`
Expected: FAIL — no such button.

- [ ] **Step 4: Add the button and the finding display**

A secondary button beside the chat input, labelled "Polish page", disabled while `isStreaming` or when there is no document. On click, POST the same build endpoint with `{ message: "", review: true }`. Render incoming `finding` events as a compact list under the active turn — code, severity dot, and `issue`.

- [ ] **Step 5: Run the builder suites**

Run: `npx vitest run __tests__/components/admin/funnel-builder.test.tsx __tests__/components/admin/funnel-builder-polish.test.tsx __tests__/components/admin/funnel-builder-initial-prompt.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/admin/funnels/FunnelBuilder.tsx __tests__/components/admin/funnel-builder-polish.test.tsx
git commit -m "feat(funnels): a Polish page button, and the findings shown as they land"
```

---

### Task 13: Verification and the build gate

**Files:** none.

- [ ] **Step 1: Run every suite this work touched**

```bash
npx vitest run __tests__/lib/funnels/sections/ __tests__/lib/db/funnel-builder.test.ts __tests__/components/admin/funnel-builder.test.tsx __tests__/components/admin/funnel-builder-polish.test.tsx __tests__/api/funnels/
```

- [ ] **Step 2: Build**

A green `tsc` is not a green deploy in this repo, and `build | tail` reports tail's exit code, so redirect and capture:

```bash
npm run build > /tmp/build.log 2>&1; echo "exit=$?"; grep -nE "error|Error" /tmp/build.log | head -40
```
Expected: `exit=0`.

If it reports "Cannot find module" for a file created in this work while `tsc` is clean, delete `.next` and `tsconfig.tsbuildinfo` and rebuild — a stale build info file has produced exactly that false alarm here before.

- [ ] **Step 3: Confirm the leaf boundary held**

```bash
grep -rn "@/lib/ai\|@/lib/db\|@/lib/supabase" lib/funnels/sections/review/findings.ts && echo "LEAF BROKEN" || echo "leaf intact"
```
Expected: `leaf intact`.

---

## Deployment note

Migration `00209_funnel_review_turns.sql` is applied automatically by CI when this
lands on `main`. It is additive — every existing `source` value stays legal — so
it does not have to be sequenced ahead of the deploy. Do not apply it by hand.
