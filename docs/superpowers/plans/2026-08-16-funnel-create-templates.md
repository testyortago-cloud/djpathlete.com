# Template-Driven Funnel Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner create a whole funnel — N named, pathed, goal-bearing steps — from a template, answering only the intake questions that template actually needs, with each step drafting itself when first opened.

**Architecture:** A typed template registry (`lib/funnels/templates.ts`) declares each template's step plan and its `asks` array. The dialog renders a field iff `asks` lists it; `createFunnelSchema` refuses a field `asks` omits — one array drives both, so they cannot disagree. `createFunnel` gains an optional `steps` input (omitting it preserves today's behaviour exactly). Per-step first drafts compose at read time from stored columns, reusing the builder's existing `initialPrompt` guard.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres, Zod, React Hook Form-free controlled inputs (matching the existing dialogs), Vitest + Testing Library, Firebase `onSchedule`.

**Spec:** `docs/superpowers/specs/2026-08-16-funnel-create-templates-design.md`

## Global Constraints

- **Never restate a validation rule.** Import `FUNNEL_SLUG_PATTERN`, `RESERVED_FUNNEL_SLUGS`, `FUNNEL_NAME_MIN_LENGTH`, `FUNNEL_NAME_MAX_LENGTH` from `lib/validators/funnel.ts`. Three bugs here came from restating one (`ask_the_validator_never_restate_it`).
- **`offer_ref` max 120**, matching `ctaTargetSchema`'s `ref` bound in `lib/funnels/sections/registry.ts`.
- **Step count 1–10.** Entry step slug is always `index`; only the entry row has `is_entry = true`.
- **`@testing-library/user-event` is not a dependency.** Use `fireEvent`.
- **`git add -A` is unsafe in this repo** — the tree permanently holds a bank CSV. Stage explicit paths.
- **Never restructure a source file via read→transform→write in PowerShell** — it double-encodes non-ASCII and every gate stays green. Use the Edit tool.
- **When a component renders N of a thing, scope the query.** An unscoped `getByRole("button", {name: /add/})` has already passed for the wrong reason here.
- **Do not apply the migration to production Supabase.** It ships ready to apply.
- Targeted test runs only: `npx vitest run <path>`. Build (`npm run build`) is the separate "did I break compilation" gate.

---

### Task 1: Migration and types

**Files:**
- Create: `supabase/migrations/00210_funnel_create_intake.sql`
- Modify: `types/database.ts:3173-3185` (`Funnel`), `types/database.ts:3191+` (`FunnelStep`)
- Test: `__tests__/lib/db/funnel-intake-columns.test.ts`

**Interfaces:**
- Produces: `Funnel.template: string | null`, `Funnel.audience: string | null`, `Funnel.offer_kind: OfferKind | null`, `Funnel.offer_ref: string | null`, `Funnel.starts_at: string | null`, `Funnel.ends_at: string | null`, `Funnel.auto_offline_at_end: boolean`, `Funnel.notify_emails: string[] | null`, `FunnelStep.goal: FunnelGoal | null`, and `export type OfferKind = "program" | "session_pack" | "event"`.

- [ ] **Step 1: Write the migration**

```sql
-- 00210_funnel_create_intake.sql
-- Template-driven funnel creation (docs/superpowers/specs/2026-08-16-funnel-create-templates-design.md).

ALTER TABLE funnels
  ADD COLUMN IF NOT EXISTS template            text,
  ADD COLUMN IF NOT EXISTS audience            text,
  ADD COLUMN IF NOT EXISTS offer_kind          text,
  ADD COLUMN IF NOT EXISTS offer_ref           text,
  ADD COLUMN IF NOT EXISTS starts_at           timestamptz,
  ADD COLUMN IF NOT EXISTS ends_at             timestamptz,
  ADD COLUMN IF NOT EXISTS auto_offline_at_end boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_emails       text[];

-- `template` deliberately has NO CHECK constraint: the code registry
-- (lib/funnels/templates.ts) owns that vocabulary, and a CHECK here would mean
-- a migration for every new template — defeating the reason the registry is
-- code rather than a table. Unknown values degrade to no badge, never an error.

ALTER TABLE funnels
  ADD CONSTRAINT funnels_offer_kind_check
    CHECK (offer_kind IS NULL OR offer_kind IN ('program','session_pack','event')),
  -- An offer is a kind AND a ref, or it is neither. Half of one renders a dead CTA.
  ADD CONSTRAINT funnels_offer_paired_check
    CHECK ((offer_kind IS NULL) = (offer_ref IS NULL)),
  ADD CONSTRAINT funnels_run_window_check
    CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at);

ALTER TABLE funnel_steps
  ADD COLUMN IF NOT EXISTS goal text;

ALTER TABLE funnel_steps
  ADD CONSTRAINT funnel_steps_goal_check
    CHECK (goal IS NULL OR goal IN ('leads','booking','program','session_pack','event'));

-- Partial index: the window closer scans only opted-in published funnels.
CREATE INDEX IF NOT EXISTS funnels_auto_offline_idx
  ON funnels (ends_at)
  WHERE auto_offline_at_end AND status = 'published';
```

- [ ] **Step 2: Extend the types**

Add to `Funnel` in `types/database.ts`, each with the comment explaining nullability; add `goal` to `FunnelStep`; export `OfferKind` next to `FunnelGoal`.

- [ ] **Step 3: Write a test asserting the SQL says what the spec says**

The migration cannot be executed in unit tests, so the test reads the file and asserts the load-bearing clauses exist — the paired-offer check, the absent `template` CHECK, and the `funnel_steps.goal` vocabulary matching `FUNNEL_GOALS`.

```ts
import { readFileSync } from "node:fs"
import { FUNNEL_GOALS } from "@/lib/validators/funnel"

const sql = readFileSync("supabase/migrations/00210_funnel_create_intake.sql", "utf8")

it("pairs offer_kind with offer_ref", () => {
  expect(sql).toMatch(/\(offer_kind IS NULL\) = \(offer_ref IS NULL\)/)
})

it("does not constrain template — the registry owns that vocabulary", () => {
  expect(sql).not.toMatch(/template\s+IN\s*\(/)
})

it("lists exactly the goals the validator knows", () => {
  const listed = sql.match(/goal IS NULL OR goal IN \(([^)]+)\)/)![1]
  for (const g of FUNNEL_GOALS) expect(listed).toContain(`'${g.value}'`)
})
```

- [ ] **Step 4: Run** `npx vitest run __tests__/lib/db/funnel-intake-columns.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `supabase/migrations/00210_funnel_create_intake.sql types/database.ts __tests__/lib/db/funnel-intake-columns.test.ts`

---

### Task 2: The template registry

**Files:**
- Create: `lib/funnels/templates.ts`
- Test: `__tests__/lib/funnels/templates.test.ts`

**Interfaces:**
- Consumes: `FunnelGoal`, `OfferKind` from `types/database`.
- Produces: `FUNNEL_TEMPLATES`, `FunnelTemplateId`, `TemplateAsk`, `TemplateStep`, `FunnelTemplate`, `getTemplate(id): FunnelTemplate | null`, `templateAsks(id, ask): boolean`.

- [ ] **Step 1: Write the failing tests first**

```ts
describe("FUNNEL_TEMPLATES", () => {
  it("gives every template a unique id", () => {
    const ids = FUNNEL_TEMPLATES.map((t) => t.value)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("starts every template at the entry slug", () => {
    // MUTANT KILLED: a template whose first step is not `index` creates a
    // funnel whose entry page is unreachable at /go/<slug>.
    for (const t of FUNNEL_TEMPLATES) expect(t.steps[0].slug).toBe("index")
  })

  it("keeps step slugs unique inside each template", () => {
    for (const t of FUNNEL_TEMPLATES) {
      const slugs = t.steps.map((s) => s.slug)
      expect(new Set(slugs).size, t.value).toBe(slugs.length)
    }
  })

  it("only uses slugs the validator would accept", () => {
    for (const t of FUNNEL_TEMPLATES)
      for (const s of t.steps) expect(FUNNEL_SLUG_PATTERN.test(s.slug), `${t.value}/${s.slug}`).toBe(true)
  })

  it("asks for an offer exactly when it names an offer catalogue", () => {
    // MUTANT KILLED: the two halves of the offer rule drifting apart — a
    // template that asks for an offer but names no catalogue renders an
    // unfillable picker; one that names a catalogue but never asks silently
    // ignores it.
    for (const t of FUNNEL_TEMPLATES)
      expect(t.asks.includes("offer"), t.value).toBe(t.offerKind !== null)
  })

  it("stays within the 1-10 step bound the validator enforces", () => {
    for (const t of FUNNEL_TEMPLATES) {
      expect(t.steps.length).toBeGreaterThanOrEqual(1)
      expect(t.steps.length).toBeLessThanOrEqual(MAX_FUNNEL_STEPS)
    }
  })

  it("asks to notify only when it captures a lead", () => {
    for (const t of FUNNEL_TEMPLATES)
      expect(t.asks.includes("notify"), t.value).toBe(t.steps.some((s) => s.goal === "leads"))
  })
})
```

- [ ] **Step 2: Run** `npx vitest run __tests__/lib/funnels/templates.test.ts` — expect FAIL, "Cannot find module '@/lib/funnels/templates'".

- [ ] **Step 3: Write the registry**

```ts
// lib/funnels/templates.ts
//
// What each kind of funnel IS: its step plan, and which follow-up questions it
// needs answered. `asks` is the whole conditional-fields mechanism — the dialog
// renders a field iff it appears here, and `createFunnelSchema` REFUSES a field
// it omits. One array drives both, so a hand-crafted POST cannot put an end date
// on a lead-capture funnel any more than the dialog can.
//
// A const rather than a `funnel_templates` table, deliberately: the dialog must
// not be able to offer a goal the section registry cannot resolve. `satisfies`
// makes that a compile error instead of a runtime dead CTA — the same reason
// FUNNEL_GOALS exists.

import type { FunnelGoal, OfferKind } from "@/types/database"

export const MAX_FUNNEL_STEPS = 10

export type TemplateAsk = "audience" | "offer" | "dates" | "notify"

export interface TemplateStep {
  name: string
  /** The first step is ALWAYS `index` — it is the funnel's own address. */
  slug: string
  goal: FunnelGoal | null
}

export interface FunnelTemplate {
  value: string
  label: string
  hint: string
  steps: readonly TemplateStep[]
  asks: readonly TemplateAsk[]
  /** Which catalogue the offer picker reads. Non-null iff `asks` has "offer". */
  offerKind: OfferKind | null
}

export const FUNNEL_TEMPLATES = [
  {
    value: "leads",
    label: "Capture leads",
    hint: "A form, then a thank-you",
    steps: [
      { name: "Signup", slug: "index", goal: "leads" },
      { name: "Thank you", slug: "thank-you", goal: null },
    ],
    asks: ["audience", "notify"],
    offerKind: null,
  },
  {
    value: "program",
    label: "Sell a program",
    hint: "Pitch, checkout, confirmation",
    steps: [
      { name: "Offer", slug: "index", goal: "program" },
      { name: "Checkout", slug: "checkout", goal: "program" },
      { name: "Confirmation", slug: "thank-you", goal: null },
    ],
    asks: ["audience", "offer"],
    offerKind: "program",
  },
  {
    value: "session_pack",
    label: "Sell a session pack",
    hint: "Pitch, checkout, confirmation",
    steps: [
      { name: "Offer", slug: "index", goal: "session_pack" },
      { name: "Checkout", slug: "checkout", goal: "session_pack" },
      { name: "Confirmation", slug: "thank-you", goal: null },
    ],
    asks: ["audience", "offer"],
    offerKind: "session_pack",
  },
  {
    value: "event",
    label: "Fill an event or camp",
    hint: "Details, register, pay, confirm",
    steps: [
      { name: "Details", slug: "index", goal: "event" },
      { name: "Register", slug: "register", goal: "leads" },
      { name: "Payment", slug: "payment", goal: "event" },
      { name: "Confirmation", slug: "thank-you", goal: null },
    ],
    asks: ["audience", "offer", "dates", "notify"],
    offerKind: "event",
  },
  {
    value: "booking",
    label: "Book a consult",
    hint: "Pitch, pick a time, confirm",
    steps: [
      { name: "Pitch", slug: "index", goal: "booking" },
      { name: "Book a time", slug: "book", goal: "booking" },
      { name: "Confirmation", slug: "thank-you", goal: null },
    ],
    asks: ["audience"],
    offerKind: null,
  },
  {
    value: "scratch",
    label: "Start from scratch",
    hint: "One step, no assumptions",
    steps: [{ name: "Step 1", slug: "index", goal: null }],
    asks: ["audience"],
    offerKind: null,
  },
] as const satisfies readonly FunnelTemplate[]

export type FunnelTemplateId = (typeof FUNNEL_TEMPLATES)[number]["value"]

export function getTemplate(id: string | null | undefined): FunnelTemplate | null {
  if (!id) return null
  return FUNNEL_TEMPLATES.find((t) => t.value === id) ?? null
}

/** Does this template ask for `ask`? Unknown template → no. */
export function templateAsks(id: string | null | undefined, ask: TemplateAsk): boolean {
  return getTemplate(id)?.asks.includes(ask) ?? false
}
```

Note the `booking` template asks no `notify` because none of its steps have goal `leads` — the "asks to notify only when it captures a lead" test enforces that. If the test disagrees with the table, the TEST is right and the data is wrong.

- [ ] **Step 4: Run** `npx vitest run __tests__/lib/funnels/templates.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `lib/funnels/templates.ts __tests__/lib/funnels/templates.test.ts`

---

### Task 3: Validator — intake fields, the step plan, and the conditional refusal

**Files:**
- Modify: `lib/validators/funnel.ts:63-71` (`createFunnelSchema`), `:73-80` (`updateFunnelSchema`)
- Test: `__tests__/lib/validators/funnel-create-intake.test.ts`

**Interfaces:**
- Consumes: `FUNNEL_TEMPLATES`, `getTemplate`, `MAX_FUNNEL_STEPS`, `TemplateAsk` from Task 2.
- Produces: `createFunnelSchema` accepting `{ template?, audience?, offer?: {kind, ref}, starts_at?, ends_at?, auto_offline_at_end?, notify_emails?, steps?: {name, slug, goal}[] }`; `createStepPlanSchema` exported for reuse.

- [ ] **Step 1: Write the failing tests**

```ts
const base = { name: "Camp 2026", slug: "camp-2026", kind: "funnel" as const }

it("refuses dates on a template that does not ask for them", () => {
  // MUTANT KILLED: hiding a field in the UI without refusing it on the server.
  // The dialog hides dates for `leads`; without this, a hand-crafted POST sets
  // a run window the owner can never see or clear.
  const r = createFunnelSchema.safeParse({
    ...base, template: "leads", ends_at: "2026-08-15T00:00:00Z",
  })
  expect(r.success).toBe(false)
})

it("accepts dates on the event template", () => {
  const r = createFunnelSchema.safeParse({
    ...base, template: "event",
    starts_at: "2026-06-01T00:00:00Z", ends_at: "2026-08-15T00:00:00Z",
    offer: { kind: "event", ref: "Summer Camp 2026" },
  })
  expect(r.success).toBe(true)
})

it("refuses an end date at or before the start", () => {
  const r = createFunnelSchema.safeParse({
    ...base, template: "event",
    starts_at: "2026-08-15T00:00:00Z", ends_at: "2026-06-01T00:00:00Z",
    offer: { kind: "event", ref: "Summer Camp 2026" },
  })
  expect(r.success).toBe(false)
})

it("refuses an offer whose kind is not the template's catalogue", () => {
  // MUTANT KILLED: accepting any offer once the template asks for one. A
  // program ref on an event funnel resolves against the wrong table.
  const r = createFunnelSchema.safeParse({
    ...base, template: "event", offer: { kind: "program", ref: "Off-Season Block" },
  })
  expect(r.success).toBe(false)
})

it("refuses duplicate step slugs", () => {
  const r = createFunnelSchema.safeParse({
    ...base, template: "scratch",
    steps: [
      { name: "One", slug: "index", goal: null },
      { name: "Two", slug: "index", goal: null },
    ],
  })
  expect(r.success).toBe(false)
})

it("refuses a first step that is not the entry slug", () => {
  const r = createFunnelSchema.safeParse({
    ...base, template: "scratch",
    steps: [{ name: "One", slug: "start", goal: null }],
  })
  expect(r.success).toBe(false)
})

it(`refuses more than ${MAX_FUNNEL_STEPS} steps`, () => {
  const steps = Array.from({ length: MAX_FUNNEL_STEPS + 1 }, (_, i) => ({
    name: `S${i}`, slug: i === 0 ? "index" : `s-${i}`, goal: null,
  }))
  expect(createFunnelSchema.safeParse({ ...base, template: "scratch", steps }).success).toBe(false)
})

it("still accepts the landing-page body it accepted before", () => {
  // MUTANT KILLED: tightening the schema under CreatePageDialog, which sends
  // no template and no steps and must keep working untouched.
  const r = createFunnelSchema.safeParse({
    name: "Free Trial", slug: "free-trial", kind: "page", goal: "leads",
    description: "A page for high-school athletes.",
  })
  expect(r.success).toBe(true)
})
```

- [ ] **Step 2: Run** `npx vitest run __tests__/lib/validators/funnel-create-intake.test.ts` — expect FAIL (the schema strips unknown keys, so the refusal tests fail while the acceptance ones pass).

- [ ] **Step 3: Extend the schema**

```ts
const templateIdSchema = z.enum(
  FUNNEL_TEMPLATES.map((t) => t.value) as [FunnelTemplateId, ...FunnelTemplateId[]],
)

export const ENTRY_STEP_SLUG = "index"

export const createStepPlanSchema = z.object({
  name: nameSchema,
  slug: slugSchema,
  goal: goalSchema.nullable().default(null),
})

const offerSchema = z.object({
  kind: z.enum(["program", "session_pack", "event"]),
  ref: z.string().min(1).max(120),
})

export const createFunnelSchema = z
  .object({
    slug: slugSchema.refine((s) => !RESERVED_FUNNEL_SLUGS.has(s), "That slug is reserved"),
    name: nameSchema,
    description: z.string().max(500).nullable().optional(),
    kind: kindSchema.default("page"),
    goal: goalSchema.nullable().optional(),
    template: templateIdSchema.nullable().optional(),
    audience: z.string().max(300).nullable().optional(),
    offer: offerSchema.nullable().optional(),
    starts_at: z.string().datetime().nullable().optional(),
    ends_at: z.string().datetime().nullable().optional(),
    auto_offline_at_end: z.boolean().optional(),
    notify_emails: z.array(z.string().email()).max(5).nullable().optional(),
    steps: z.array(createStepPlanSchema).min(1).max(MAX_FUNNEL_STEPS).optional(),
  })
  .superRefine((value, ctx) => {
    // THE CONDITIONAL RULE, SERVER SIDE. The dialog hides a field it must not
    // send; this refuses it. Both read the same `asks` array, so they cannot
    // disagree about what an event funnel is allowed to carry.
    const template = getTemplate(value.template)
    const asks = (ask: TemplateAsk) => template?.asks.includes(ask) ?? false

    const wantsDates = value.starts_at != null || value.ends_at != null || value.auto_offline_at_end === true
    if (wantsDates && !asks("dates")) {
      ctx.addIssue({ code: "custom", path: ["ends_at"], message: "This kind of funnel has no run window." })
    }
    if (value.starts_at && value.ends_at && new Date(value.ends_at) <= new Date(value.starts_at)) {
      ctx.addIssue({ code: "custom", path: ["ends_at"], message: "The end must come after the start." })
    }
    if (value.offer) {
      if (!asks("offer")) {
        ctx.addIssue({ code: "custom", path: ["offer"], message: "This kind of funnel has no offer to link." })
      } else if (template && value.offer.kind !== template.offerKind) {
        ctx.addIssue({ code: "custom", path: ["offer", "kind"], message: "That offer is from the wrong catalogue." })
      }
    }
    if (value.notify_emails?.length && !asks("notify")) {
      ctx.addIssue({ code: "custom", path: ["notify_emails"], message: "This kind of funnel captures no leads." })
    }
    if (value.audience && !asks("audience")) {
      ctx.addIssue({ code: "custom", path: ["audience"], message: "This kind of funnel does not ask that." })
    }
    if (value.steps) {
      if (value.steps[0].slug !== ENTRY_STEP_SLUG) {
        ctx.addIssue({ code: "custom", path: ["steps", 0, "slug"], message: `The first step must be "${ENTRY_STEP_SLUG}".` })
      }
      const seen = new Set<string>()
      value.steps.forEach((step, index) => {
        if (seen.has(step.slug)) {
          ctx.addIssue({ code: "custom", path: ["steps", index, "slug"], message: "Two steps cannot share a path." })
        }
        seen.add(step.slug)
      })
    }
  })
```

`updateFunnelSchema` gains the same intake fields (no `steps`, no template conditionals — an established funnel's window is edited on its own screen, and §"Out of scope" forbids changing a template).

- [ ] **Step 4: Run** `npx vitest run __tests__/lib/validators/` — expect PASS, including the pre-existing validator tests.
- [ ] **Step 5: Commit** `lib/validators/funnel.ts __tests__/lib/validators/funnel-create-intake.test.ts`

---

### Task 4: DAL — create N steps

**Files:**
- Modify: `lib/db/funnels.ts:58-108` (`CreateFunnelInput`, `createFunnel`)
- Test: `__tests__/lib/db/funnel-create-steps.test.ts`

**Interfaces:**
- Consumes: `ENTRY_STEP_SLUG` from Task 3.
- Produces: `createFunnel(input & { steps?: {name, slug, goal}[] })` → `Funnel & { entryStepId: string }`, unchanged return shape.

- [ ] **Step 1: Write the failing tests** (mock `createServiceRoleClient`, following the existing `__tests__/lib/db/funnel-kind.test.ts` shape)

```ts
it("writes one row per planned step, in order", async () => {
  await createFunnel({
    slug: "camp", name: "Camp", kind: "funnel",
    steps: [
      { name: "Details", slug: "index", goal: "event" },
      { name: "Register", slug: "register", goal: "leads" },
      { name: "Payment", slug: "payment", goal: "event" },
    ],
  })
  const rows = stepInsert.mock.calls[0][0]
  expect(rows).toHaveLength(3)
  expect(rows.map((r) => r.position)).toEqual([0, 1, 2])
  expect(rows.map((r) => r.slug)).toEqual(["index", "register", "payment"])
  expect(rows.map((r) => r.goal)).toEqual(["event", "leads", null].slice(0, 3))
})

it("marks only the first step as the entry", () => {
  // MUTANT KILLED: is_entry: true on every row. Two entry steps make
  // /go/<slug> ambiguous and StepList offers two "delete the funnel" buttons.
  const rows = stepInsert.mock.calls[0][0]
  expect(rows.filter((r) => r.is_entry)).toHaveLength(1)
  expect(rows[0].is_entry).toBe(true)
})

it("creates exactly what it created before when given no steps", async () => {
  // MUTANT KILLED: making `steps` required, which breaks CreatePageDialog.
  await createFunnel({ slug: "trial", name: "Trial", kind: "page" })
  const rows = stepInsert.mock.calls[0][0]
  expect(rows).toEqual([
    expect.objectContaining({ slug: "index", name: "Landing page", position: 0, is_entry: true }),
  ])
})

it("still names a funnel's lone entry step 'Step 1' when given no steps", async () => {
  await createFunnel({ slug: "f", name: "F", kind: "funnel" })
  expect(stepInsert.mock.calls[0][0][0].name).toBe("Step 1")
})

it("returns the entry step's id, not the last one's", async () => {
  // MUTANT KILLED: taking the id of whichever row Supabase returns last. The
  // dialog routes into the builder with this — the wrong id opens the wrong step.
  const result = await createFunnel({ slug: "c", name: "C", kind: "funnel", steps: threeSteps })
  expect(result.entryStepId).toBe("step-index-id")
})
```

- [ ] **Step 2: Run** `npx vitest run __tests__/lib/db/funnel-create-steps.test.ts` — expect FAIL.

- [ ] **Step 3: Implement**

The multi-row insert selects `id, slug` and picks the entry by slug rather than by array position — Supabase does not guarantee the returned order matches the inserted order, and "whichever came back first" is exactly the bug the last test names.

```ts
export interface CreateFunnelInput {
  slug: string
  name: string
  description?: string | null
  kind?: FunnelKind
  goal?: FunnelGoal | null
  created_by?: string | null
  template?: string | null
  audience?: string | null
  offer?: { kind: OfferKind; ref: string } | null
  starts_at?: string | null
  ends_at?: string | null
  auto_offline_at_end?: boolean
  notify_emails?: string[] | null
  /**
   * The step plan. OPTIONAL, and that is load-bearing: every caller that
   * predates templates — `CreatePageDialog` above all — sends nothing and must
   * keep getting exactly the single entry step it got before.
   */
  steps?: { name: string; slug: string; goal: FunnelGoal | null }[]
}
```

…then in `createFunnel`, after the funnel insert:

```ts
const planned = input.steps?.length
  ? input.steps
  : [{
      name: input.kind === "funnel" ? "Step 1" : "Landing page",
      slug: ENTRY_STEP_SLUG,
      goal: null,
    }]

const { data: stepRows, error: stepError } = await supabase
  .from("funnel_steps")
  .insert(
    planned.map((step, index) => ({
      funnel_id: funnel.id,
      slug: index === 0 ? ENTRY_STEP_SLUG : step.slug,
      name: step.name,
      goal: step.goal ?? null,
      position: index,
      is_entry: index === 0,
    })),
  )
  .select("id, slug")
if (stepError) throw new Error(`createFunnel(entry step): ${stepError.message}`)

// BY SLUG, NOT BY POSITION IN THE RETURNED ARRAY. Postgres does not promise
// the RETURNING order matches the VALUES order, and the dialog routes the
// owner into whichever step this names.
const entry = (stepRows as { id: string; slug: string }[]).find((r) => r.slug === ENTRY_STEP_SLUG)
if (!entry) throw new Error("createFunnel(entry step): the entry step was not returned")
return { ...funnel, entryStepId: entry.id }
```

- [ ] **Step 4: Run** `npx vitest run __tests__/lib/db/` — expect PASS.
- [ ] **Step 5: Commit** `lib/db/funnels.ts __tests__/lib/db/funnel-create-steps.test.ts`

---

### Task 5: API — pass the intake through, and back the offer picker

**Files:**
- Modify: `app/api/admin/funnels/route.ts:41-49`
- Create: `app/api/admin/funnels/offers/route.ts`
- Test: `__tests__/api/funnels/offers-route.test.ts`

**Interfaces:**
- Produces: `GET /api/admin/funnels/offers?kind=<program|session_pack|event>` → `{ offers: { id: string; name: string; hint: string }[] }`.

- [ ] **Step 1: Write the failing tests**

```ts
it("rejects a kind that is not an offer catalogue", async () => {
  const res = await GET(new NextRequest("http://x/api/admin/funnels/offers?kind=blog"))
  expect(res.status).toBe(400)
})

it("refuses a non-admin", async () => {
  // MUTANT KILLED: shipping a catalogue endpoint with no guard. It lists
  // unpublished products and their prices.
  auth.mockResolvedValueOnce(null)
  const res = await GET(new NextRequest("http://x/api/admin/funnels/offers?kind=program"))
  expect(res.status).toBe(403)
})

it("returns id, name and a hint for each program", async () => { /* … */ })
```

- [ ] **Step 2: Run** — expect FAIL, module not found.

- [ ] **Step 3: Implement.** The POST change is two lines — spread the new fields from `parsed.data` into `createFunnel`, mapping `offer` to `offer_kind` / `offer_ref`. The offers route: `auth()` + `canAccessAdminPath`, switch on `kind` to read `programs` / `session_packs` / `events` via the service-role client, project to `{ id, name, hint }`.

- [ ] **Step 4: Run** `npx vitest run __tests__/api/funnels/` — expect PASS.
- [ ] **Step 5: Commit** the route files and test.

---

### Task 6: The dialog

**Files:**
- Modify: `components/admin/funnels/CreateFunnelDialog.tsx` (substantial rewrite)
- Create: `components/admin/funnels/StepPlanEditor.tsx`
- Modify: `__tests__/components/admin/create-funnel-dialog.test.tsx`
- Test: `__tests__/components/admin/funnel-step-plan-editor.test.tsx`

**Interfaces:**
- Consumes: `FUNNEL_TEMPLATES`, `getTemplate`, `MAX_FUNNEL_STEPS` (Task 2); `ENTRY_STEP_SLUG` (Task 3); the offers endpoint (Task 5).
- Produces: `StepPlanEditor` with props `{ funnelSlug, steps, onChange }` where `steps: {name, slug, goal}[]`.

**`StepPlanEditor` is its own file** because the dialog is already 157 lines and the row editor carries reorder, add, delete, per-row slug derivation and the entry-row pin. Folded in, the dialog becomes a file nobody can hold in context — the spec's own "smaller, well-bounded units" rule.

- [ ] **Step 1: Update the two tests that encode the old decision**

Both currently pass and both must now assert the opposite. They are rewritten, not deleted, and each keeps a comment recording the reversal so the next reader does not "fix" it back:

```ts
it("asks which kind of funnel this is", () => {
  // REVERSED 2026-08-16. This test used to assert the dialog does NOT offer a
  // goal, on the reasoning that a funnel is a container whose steps hold the
  // goals. The reasoning holds; the conclusion did not. The goals belong to the
  // STEPS, and the template is how creation learns what those steps are — so
  // the dialog asks once, per funnel, and writes a goal per step.
  // See docs/superpowers/specs/2026-08-16-funnel-create-templates-design.md §1.
  open()
  expect(screen.getByRole("radio", { name: /fill an event or camp/i })).toBeInTheDocument()
})

it("routes into the entry step's builder so it starts drafting", async () => {
  // REVERSED 2026-08-16. Used to assert a push to the step list, because the
  // owner had not yet decided what the steps were. With a template they have,
  // and the step list would be a screen showing them what they just typed.
  // Steps 2..N draft lazily when opened — spec §4.
  await createWith({ template: "event" })
  expect(push).toHaveBeenCalledWith("/admin/funnels/f9/edit/s9?start=1")
})
```

- [ ] **Step 2: Write the new failing tests**

```ts
it("shows the run window only for a template that asks for it", () => {
  // MUTANT KILLED: rendering every intake field for every template, which is
  // the exact overload this redesign exists to avoid.
  open()
  fireEvent.click(screen.getByRole("radio", { name: /capture leads/i }))
  expect(screen.queryByLabelText(/runs from/i)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("radio", { name: /fill an event or camp/i }))
  expect(screen.getByLabelText(/runs from/i)).toBeInTheDocument()
})

it("swaps the step rows when the template changes", () => {
  open()
  fireEvent.click(screen.getByRole("radio", { name: /capture leads/i }))
  expect(screen.getAllByTestId("step-row")).toHaveLength(2)
  fireEvent.click(screen.getByRole("radio", { name: /fill an event or camp/i }))
  expect(screen.getAllByTestId("step-row")).toHaveLength(4)
})

it("posts the step plan it is showing", async () => {
  // MUTANT KILLED: posting the template id and letting the server expand it,
  // which would silently discard every edit the owner made to the rows.
  open()
  fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Camp 2026" } })
  fireEvent.click(screen.getByRole("radio", { name: /fill an event or camp/i }))
  fireEvent.click(within(screen.getAllByTestId("step-row")[3]).getByRole("button", { name: /remove/i }))
  fireEvent.click(screen.getByRole("button", { name: /create funnel/i }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  const body = JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string)
  expect(body.steps.map((s) => s.slug)).toEqual(["index", "register", "payment"])
})

it("will not let the entry row be removed or re-pathed", () => {
  // MUTANT KILLED: a generic row editor. Deleting row 1 leaves a funnel with
  // no page at /go/<slug>; re-pathing it leaves the address unreachable.
  open()
  const first = screen.getAllByTestId("step-row")[0]
  expect(within(first).queryByRole("button", { name: /remove/i })).not.toBeInTheDocument()
  expect(within(first).getByLabelText(/path/i)).toBeDisabled()
})

it(`stops adding rows at ${MAX_FUNNEL_STEPS}`, () => { /* … */ })
```

Every row query is scoped through `within(...)` — an unscoped `getByRole("button", {name: /remove/i})` across a four-row editor is the "passed for the wrong reason" trap this repo has already hit.

- [ ] **Step 3: Run** — expect FAIL.
- [ ] **Step 4: Implement `StepPlanEditor`, then the dialog.** Field order: name → URL → template radiogroup → step rows → conditional intake (offer, dates, audience, notify) → description. Template selection resets the rows to that template's plan; the description's helper text becomes "Used to write the first draft of every step."
- [ ] **Step 5: Run** `npx vitest run __tests__/components/admin/create-funnel-dialog.test.tsx __tests__/components/admin/funnel-step-plan-editor.test.tsx` — expect PASS.
- [ ] **Step 6: Commit** both components and both test files.

---

### Task 7: Per-step first draft

**Files:**
- Modify: `app/(admin)/admin/funnels/[id]/edit/[stepId]/page.tsx` (`creationPrompt`, and the `initialPrompt` condition ~line 258)
- Test: `__tests__/app/funnel-creation-prompt.test.ts`

**Interfaces:**
- Produces: `creationPrompt(funnel: Funnel, step: FunnelStep): string | null`, exported for test.

- [ ] **Step 1: Write the failing tests**

```ts
it("composes the same prompt as before for a landing page", () => {
  // MUTANT KILLED: rewriting the page prompt while adding the step one.
  // Landing pages are not part of this change and must not shift.
  expect(creationPrompt(pageFunnel, entryStep)).toBe(
    'Build a landing page called "Free Trial".\n' +
      "Its job: capture leads — a form that lands in your inbox.\n" +
      "What it is for: A page for high-school athletes.",
  )
})

it("names the step's position in the sequence", () => {
  const prompt = creationPrompt(eventFunnel, registerStep)!
  expect(prompt).toContain('step 2 of the "Summer Camp 2026" funnel')
  expect(prompt).toContain("Details, Register, Payment, Confirmation")
})

it("prefers the step's goal over the funnel's", () => {
  // MUTANT KILLED: reading funnel.goal for steps too, which would tell the
  // payment step it is a lead form.
  expect(creationPrompt(eventFunnel, paymentStep)).toContain("fill an event")
})

it("returns null for a step with no goal and a funnel with no template", () => {
  // Rows created before any of this open exactly as they always did.
  expect(creationPrompt(legacyFunnel, legacyStep)).toBeNull()
})
```

- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.** `creationPrompt` takes the step, reads `step.goal ?? funnel.goal`, and for a templated funnel prepends the sequence context (position, sibling names) and appends audience and offer lines when present. The firing condition becomes `(start === "1" || funnel.template !== null) && draft.doc === null && turns.length === 0`.
- [ ] **Step 4: Run** `npx vitest run __tests__/app/` — expect PASS.
- [ ] **Step 5: Commit.**

---

### Task 8: Surface the window and the offer

**Files:**
- Modify: `components/admin/funnels/PreviewCard.tsx`, `app/(admin)/admin/funnels/[id]/page.tsx`
- Test: `__tests__/components/admin/funnel-run-window.test.tsx`

- [ ] **Step 1: Write the failing test** — a card with `starts_at`/`ends_at` renders "Runs 1 Jun – 15 Aug"; a card with neither renders no window line at all (the mutant: rendering "Runs — –  —" for every existing funnel).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.** The detail header additionally states whether auto-offline is armed AND whether the job is enabled, per spec §7 — a checkbox whose job is flag-gated must not imply it is running.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit.**

---

### Task 9: The window closer

**Files:**
- Create: `lib/automation/funnel-window-closer.ts`, `app/api/admin/internal/funnel-window/route.ts`
- Modify: `functions/src/index.ts`, `lib/audit/actions.ts`, `lib/automation/automation-health-scanner.ts` (expected-cron list)
- Test: `__tests__/lib/automation/funnel-window-closer.test.ts`

**Interfaces:**
- Produces: `selectFunnelsToClose(rows: Funnel[], now: Date): string[]` — a pure function, so the "does not over-reach" tests need no database.

- [ ] **Step 1: Write the failing tests**

```ts
it("closes only published, opted-in, past-end funnels", () => {
  // MUTANT KILLED: any relaxation here unpublishes a live page nobody asked
  // it to touch. Each excluded row differs from the included one by ONE field.
  const now = new Date("2026-09-01T00:00:00Z")
  expect(selectFunnelsToClose([
    f({ id: "yes",        status: "published", auto: true,  ends: "2026-08-15" }),
    f({ id: "not-opted",  status: "published", auto: false, ends: "2026-08-15" }),
    f({ id: "still-open", status: "published", auto: true,  ends: "2026-09-30" }),
    f({ id: "draft",      status: "draft",     auto: true,  ends: "2026-08-15" }),
    f({ id: "no-end",     status: "published", auto: true,  ends: null }),
  ], now)).toEqual(["yes"])
})

it("does not close a funnel whose end is exactly now", () => {
  // The window includes its final instant; `>` not `>=`, matching the
  // migration's own `ends_at > starts_at`.
  const now = new Date("2026-08-15T00:00:00Z")
  expect(selectFunnelsToClose([f({ id: "edge", status: "published", auto: true, ends: "2026-08-15T00:00:00Z" })], now)).toEqual([])
})
```

- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** the pure function, then the route (bearer `INTERNAL_CRON_TOKEN`, `isCronSkipped({ enabledKey: "cron_funnel_window_enabled", defaultEnabled: false })`, flip status, `recordAudit("funnel.auto_offline", category "automation")`), then the `onSchedule` at `0 4 * * *` mirroring `inboxSlaCron`, then add `funnel-window` to the health scanner's expected list and `funnel.auto_offline` to the audit taxonomy.
- [ ] **Step 4: Run** `npx vitest run __tests__/lib/automation/funnel-window-closer.test.ts` — expect PASS.
- [ ] **Step 5: Commit.**

---

### Task 10: Full verification

- [ ] **Step 1:** `npx vitest run __tests__/lib/funnels/ __tests__/lib/validators/ __tests__/lib/db/ __tests__/components/admin/ __tests__/api/funnels/ __tests__/app/ __tests__/lib/automation/`
- [ ] **Step 2:** `npm run build` — grep the output for the touched files rather than reading it whole.
- [ ] **Step 3:** Fix anything red, re-run only what was red.
- [ ] **Step 4:** Commit.

## Self-Review

**Spec coverage:** §1 registry → Task 2. §2 data model → Task 1. §3 N steps → Tasks 3, 4. §4 lazy draft → Task 7. §5 dialog → Task 6 (+ offers endpoint, Task 5). §6 surfacing → Task 8. §7 auto-offline → Task 9. §8 testing → distributed across every task. No gaps.

**Placeholders:** Task 5 step 3 and Task 8 step 3 describe implementations prose-only rather than in code. Accepted deliberately: both are mechanical applications of a pattern already in the repo (`inbox-sla/route.ts` for the endpoint shape, `PreviewCard`'s existing badge row for the window line), and the tests above them pin the behaviour. Every non-obvious decision — entry-by-slug lookup, the `superRefine` conditionals, the changed firing condition, `>` vs `>=` — is written out in full.

**Type consistency:** `ENTRY_STEP_SLUG` is defined in Task 3 and consumed in Tasks 4 and 6. `MAX_FUNNEL_STEPS` is defined in Task 2 and consumed in Tasks 3 and 6. `OfferKind` is defined in Task 1 and consumed in Tasks 2, 3, 4, 5. `steps: {name, slug, goal}[]` has the same shape in the validator, the DAL and the dialog's POST body. `creationPrompt` is `(funnel, step)` in Task 7 and nowhere else.
