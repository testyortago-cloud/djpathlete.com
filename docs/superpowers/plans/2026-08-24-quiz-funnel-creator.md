# Quiz funnel creator — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Run a quiz" a template in the funnel creator, so an owner creates a working quiz funnel from the New Funnel dialog and can then add and delete questions in the quiz editor.

**Architecture:** A seventh `FUNNEL_TEMPLATES` entry whose new `quiz` ask carries one field, `copyFrom`. The create route clones the chosen source into a new `quizzes` row via `createQuizFrom`, builds the entry step's `SectionDoc` from `lib/funnels/quiz-funnel-doc.ts`, and hands both to `createFunnel` so the page and the step are one insert. Separately, `saveQuizDefinition` grows inserts and deletes under one rule: nothing anyone has answered is ever destroyed.

**Tech Stack:** Next.js 16 App Router, TypeScript, Zod 4, Supabase (service-role), Vitest + Testing Library, Playwright for the screenshots.

**Spec:** `docs/superpowers/specs/2026-08-24-quiz-funnel-creator-design.md`

## Global Constraints

- **Branch:** `feat/quiz-funnel-creator`, worktree `.claude/worktrees/quiz-funnel-creator`, forked from `feat/athlete-quiz` at `c0c49c51`. Never commit to `feat/athlete-quiz`.
- **tsc baseline is 251 errors.** `npx tsc --noEmit 2>&1 | grep -c "error TS"` must stay at 251. A falling count hides new errors too — compare the number, and grep the output for your own files.
- **Pre-existing test failures at base: 14**, across SetupPanel (7), report-shell, receipt-row-editor and funnel-island-traits. Do not attribute them to this work.
- **Targeted test runs only.** `npx vitest run <path>`. No full-suite runs.
- **No Claude attribution** in any commit message.
- **Never commit `JOURNAL.md`.** It is gitignored; keep it that way.
- **Admin UI is light-only.** `.dark` is a class variant the admin components were never built against.
- **Tables use `components/ui/data-table.tsx`.** Not relevant to the files here, but do not hand-roll one if you reach for it.
- **`SECTION_BUILDER_BLOCK_A` is under a size ceiling** that `__tests__/lib/funnels/sections/prompt.test.ts` guards, and it was breached once already on the parent branch. Nothing in this plan touches the section prompt; if you find yourself editing `lib/funnels/sections/prompt.ts`, stop — you have gone off-plan.
- **Copy rule for anything an owner reads:** plain words, no jargon. "Copy questions from", not "Source quiz definition".

---

## The trap this plan exists to avoid

`getQuizDefinition` filters out inactive questions (`lib/db/quizzes.ts`, the `.filter((row) => row.is_active !== false)` inside `assemble`). The editor page reads through it. So:

- a question added **inactive** would vanish from the editor on reload, and
- a question **retired** by the delete rule would vanish too, with no way back.

Both are silent. Task 1 therefore adds `getQuizDefinitionForEditor`, and the editor and the PATCH route's response read through it. `getQuizDefinition` itself is left exactly as it is — it is what the public walk and the scorer use, and its filter is a safety property.

`quizGate` does its own `isActive` filtering (`lib/quizzes/gate.ts:42`), so handing it a definition that includes inactive questions is safe and changes no verdict.

---

## File structure

**Create:**
- `lib/funnels/quiz-funnel-doc.ts` — builds the three-section `SectionDoc` for a quiz funnel's entry step. Pure; imports types only.
- `lib/quizzes/sources.ts` — the `copyFrom` vocabulary shared by the dialog and the validator. Pure; no runtime client.
- `__tests__/lib/quizzes/quiz-create.test.ts` — `createQuizFrom` + `getQuizDefinitionForEditor`.
- `__tests__/lib/funnels/quiz-funnel-doc.test.ts`
- `__tests__/lib/quizzes/quiz-structural-save.test.ts` — add/delete in `saveQuizDefinition`.
- `__tests__/api/admin-quiz-structural.test.ts` — the PATCH route's refuse/retire behaviour.
- `__tests__/api/funnels/create-quiz-funnel.test.ts` — the create route's orchestration.

**Modify:**
- `lib/db/quizzes.ts` — `assemble` gains an option; `getQuizDefinitionForEditor`, `createQuizFrom`, `answeredIds`; `QuizSaveInput` + `saveQuizDefinition` gain inserts and deletes.
- `lib/funnels/templates.ts` — `TemplateAsk` gains `"quiz"`; a seventh template.
- `lib/validators/funnel.ts` — `quiz` field + both directions of the required ask.
- `lib/db/funnels.ts` — `CreateFunnelInput` planned steps carry an optional `projectData`.
- `app/api/admin/funnels/route.ts` — the clone-then-create orchestration and the compensating delete.
- `components/admin/funnels/CreateFunnelDialog.tsx` — the "Copy questions from" picker.
- `app/api/admin/quizzes/[id]/route.ts` — structural payload, refusal, retirement report, editor-shaped response.
- `app/(admin)/admin/funnels/quizzes/[id]/page.tsx` — read through `getQuizDefinitionForEditor`.
- `components/admin/quizzes/QuizEditor.tsx` — add/delete/restore controls and the split save payload.
- `__tests__/lib/funnels/templates.test.ts` — the seventh template's own assertions.

---

### Task 1: `createQuizFrom` and the editor read

**Files:**
- Modify: `lib/db/quizzes.ts`
- Test: `__tests__/lib/quizzes/quiz-create.test.ts`

**Interfaces:**
- Consumes: `QuizDefinition` from `@/lib/quizzes/types`; `slugify` from `@/lib/funnels/slug`; `SINGLETON_BUSINESS_ID` from `@/lib/lead-engine/constants`.
- Produces:
  ```ts
  export async function getQuizDefinitionForEditor(quizId: string): Promise<QuizDefinition | null>
  export async function createQuizFrom(input: { source: QuizDefinition; name: string }): Promise<{ id: string; key: string }>
  ```

- [ ] **Step 1: Write the failing tests**

Copy the mock-client harness from `__tests__/lib/quizzes/quiz-dal.test.ts` (it applies the filters it is asked for — that is the point of it), and extend it so `insert(rows).select(...)` resolves to the rows it was handed with a generated id, and so `delete()` records the call. Then:

```ts
describe("createQuizFrom", () => {
  it("remaps every cross-reference onto the CLONE, never the source", async () => {
    const source = await getQuizDefinition("q1")
    const { id } = await createQuizFrom({ source: source!, name: "Rotational Reboot" })
    const branchInserts = inserted("quiz_branches")
    const optionInserts = inserted("quiz_options")
    // MUTANT: drop the branch remap and let routes_to_branch_id pass through.
    // Every routed option must name a branch this clone owns.
    const cloneBranchIds = new Set(branchInserts.map((r) => r.id))
    for (const option of optionInserts) {
      if (option.routes_to_branch_id) expect(cloneBranchIds.has(option.routes_to_branch_id)).toBe(true)
    }
    expect(optionInserts.some((o) => o.routes_to_branch_id === "br1")).toBe(false)
    expect(inserted("quizzes")[0].id).toBe(id)
  })

  it("remaps profile votes onto the clone's own profiles", async () => {
    const source = await getQuizDefinition("q1")
    await createQuizFrom({ source: source!, name: "Rotational Reboot" })
    const cloneProfileIds = new Set(inserted("quiz_profiles").map((r) => r.id))
    for (const option of inserted("quiz_options")) {
      if (option.profile_id) expect(cloneProfileIds.has(option.profile_id)).toBe(true)
    }
  })

  it("suffixes the key until it does not collide", async () => {
    const source = await getQuizDefinition("q1")
    // TABLES.quizzes already holds key "rpi-athlete-quiz".
    const { key } = await createQuizFrom({ source: source!, name: "RPI Athlete Quiz" })
    expect(key).toBe("rpi-athlete-quiz-2")
  })

  it("carries the seed marker rather than laundering a guess into a decision", async () => {
    const source = await getQuizDefinition("q1")
    await createQuizFrom({ source: source!, name: "Copy" })
    expect(inserted("quizzes")[0].seed_marker).toBe("reconstructed-from-ghl-export-2026-08-23")
  })

  it("is a draft even when its source is active", async () => {
    const source = await getQuizDefinition("q1")
    expect(source!.status).toBe("active")
    await createQuizFrom({ source: source!, name: "Copy" })
    expect(inserted("quizzes")[0].status).toBe("draft")
  })

  it("produces a clone that passes the gate when its source does", async () => {
    const source = toDefinition(RPI_ATHLETE_QUIZ)
    await createQuizFrom({ source, name: "Copy" })
    const rebuilt = rebuildDefinitionFromInserts()   // helper in this file
    expect(quizGate(rebuilt).blockers).toEqual([])
  })
})

describe("getQuizDefinitionForEditor", () => {
  it("includes a question the public read filters out", async () => {
    expect((await getQuizDefinition("q1"))!.questions.map((q) => q.id)).not.toContain("quOff")
    expect((await getQuizDefinitionForEditor("q1"))!.questions.map((q) => q.id)).toContain("quOff")
  })

  it("still refuses another quiz's rows", async () => {
    const def = await getQuizDefinitionForEditor("q1")
    expect(def!.questions.map((q) => q.id)).not.toContain("quX")
  })
})
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run __tests__/lib/quizzes/quiz-create.test.ts`
Expected: FAIL — `createQuizFrom is not a function`.

- [ ] **Step 3: Implement**

In `lib/db/quizzes.ts`, thread an option through the private assembler and add the two exports:

```ts
async function assemble(quizRow: Row, opts: { includeInactive?: boolean } = {}): Promise<QuizDefinition> {
  // …unchanged, except:
  const questionRows = ((questionsRes.data ?? []) as Row[])
    .filter((row) => opts.includeInactive || row.is_active !== false)
    .sort((a, b) => num(a.position) - num(b.position))
```

```ts
/**
 * The editor's read. IDENTICAL TO `getQuizDefinition` EXCEPT THAT IT KEEPS
 * INACTIVE QUESTIONS, and that difference is the reason it exists as its own
 * function rather than an options bag on the other one.
 *
 * A retired question is invisible to `getQuizDefinition` by design — the walk
 * must not offer it — but invisible in the EDITOR means the owner cannot see
 * what they retired or bring it back, and a newly added (inactive) question
 * disappears the moment the page reloads. Both are silent.
 *
 * Named rather than parameterised so that a caller on the public path cannot
 * reach it by forgetting an argument.
 */
export async function getQuizDefinitionForEditor(quizId: string): Promise<QuizDefinition | null> {
  const { data, error } = await getClient().from("quizzes").select("*").eq("id", quizId).maybeSingle()
  if (error) throw error
  if (!data) return null
  return assemble(data as Row, { includeInactive: true })
}
```

```ts
/**
 * Inserts a NEW quiz that is a copy of `source`.
 *
 * IT TAKES A DEFINITION, NOT A SOURCE ID, so the same function serves both
 * things the create dialog offers: a quiz already in the database
 * (`getQuizDefinition`) and the built-in blueprint
 * (`toDefinition(RPI_ATHLETE_QUIZ)`). It performs no read of its own to
 * discover what it is copying.
 *
 * THE REMAPPING IS THE WHOLE JOB. Options carry `routes_to_branch_id` and
 * `profile_id`; questions carry `branch_id`. Letting any of them through
 * unmapped produces a clone whose own branches are unreachable — which the
 * gate does catch, but only when somebody tries to activate it, which is long
 * after the copy looked like it worked.
 */
export async function createQuizFrom(input: { source: QuizDefinition; name: string }): Promise<{ id: string; key: string }> {
  const supabase = getClient()
  const key = await uniqueQuizKey(supabase, slugify(input.name) || "quiz")

  const { data: quizRow, error: quizError } = await supabase
    .from("quizzes")
    .insert({
      business_id: SINGLETON_BUSINESS_ID,
      key,
      name: input.name,
      // A COPY IS A DRAFT, even from an active source. Going live stays a
      // deliberate act that runs the gate.
      status: "draft",
      intro_headline: input.source.introHeadline,
      intro_body: input.source.introBody,
      gate_headline: input.source.gateHeadline,
      gate_body: input.source.gateBody,
      result_headline: input.source.resultHeadline,
      // CARRIED, NOT CLEARED. The marker means "these numbers were
      // reconstructed, not recovered". A copy inherits the invented weights, so
      // it inherits the warning; clearing it here would launder a guess into a
      // decision. It clears the way it always did — the first human save.
      seed_marker: input.source.seedMarker,
    })
    .select("id")
    .single()
  if (quizError) throw quizError
  const quizId = str((quizRow as Row).id)

  const branchIds = await insertMapped(supabase, "quiz_branches", input.source.branches, (b) => ({
    quiz_id: quizId, key: b.key, name: b.name, description: b.description, position: b.position,
  }))
  const profileIds = await insertMapped(supabase, "quiz_profiles", input.source.profiles, (p) => ({
    quiz_id: quizId, key: p.key, name: p.name, description: p.description, position: p.position,
  }))
  const questionIds = await insertMapped(supabase, "quiz_questions", input.source.questions, (q) => ({
    quiz_id: quizId,
    branch_id: q.branchId ? branchIds.get(q.branchId) ?? null : null,
    position: q.position, prompt: q.prompt, help_text: q.helpText, is_active: q.isActive,
  }))
  const options = input.source.questions.flatMap((q) => q.options)
  await insertMapped(supabase, "quiz_options", options, (o) => ({
    question_id: questionIds.get(o.questionId),
    position: o.position, label: o.label, weight: o.weight,
    routes_to_branch_id: o.routesToBranchId ? branchIds.get(o.routesToBranchId) ?? null : null,
    profile_id: o.profileId ? profileIds.get(o.profileId) ?? null : null,
  }))
  await insertMapped(supabase, "quiz_tiers", input.source.tiers, (t) => ({
    quiz_id: quizId, key: t.key, position: t.position,
    min_score: t.minScore, max_score: t.maxScore,
    headline: t.headline, body: t.body, cta_label: t.ctaLabel, cta_href: t.ctaHref,
  }))

  return { id: quizId, key }
}
```

with two private helpers in the same file — `uniqueQuizKey` (reads existing keys for the business and suffixes `-2`, `-3`, … ) and `insertMapped` (inserts rows built by the mapper, returns `Map<oldId, newId>` keyed on the source array's order, throwing if the returned row count does not match what was sent, because a short insert that is not noticed is a half-copied quiz).

- [ ] **Step 4: Run to green**

Run: `npx vitest run __tests__/lib/quizzes/quiz-create.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutate before believing**

For each test, apply the mutation named in its comment (drop the branch remap; drop the profile remap; return `slugify(name)` unsuffixed; pass `seedMarker: null`; write `status: input.source.status`) and confirm the specific test goes red. Revert each.

- [ ] **Step 6: Commit**

```bash
git add lib/db/quizzes.ts __tests__/lib/quizzes/quiz-create.test.ts
git commit -m "feat(quiz): a quiz can be created at all, and the editor can see what it retired"
```

---

### Task 2: the quiz funnel's page

**Files:**
- Create: `lib/funnels/quiz-funnel-doc.ts`
- Test: `__tests__/lib/funnels/quiz-funnel-doc.test.ts`

**Interfaces:**
- Produces: `export function buildQuizFunnelDoc(input: { quizId: string; heading: string }): SectionDoc`

- [ ] **Step 1: Write the failing test**

```ts
import { buildQuizFunnelDoc } from "@/lib/funnels/quiz-funnel-doc"
import { sectionDocSchema } from "@/lib/funnels/sections/registry"

it("validates against the section grammar", () => {
  const doc = buildQuizFunnelDoc({ quizId: "5f2b…", heading: "The Athlete Quiz" })
  expect(sectionDocSchema.safeParse(doc).success).toBe(true)
})

it("points the quiz section at the quiz it was given", () => {
  const doc = buildQuizFunnelDoc({ quizId: "5f2b…", heading: "x" })
  const quiz = doc.sections.find((s) => s.kind === "quiz")!
  expect((quiz.props as { quizId: string }).quizId).toBe("5f2b…")
})

it("anchors the hero CTA to a section that is actually on the page", () => {
  // MUTANT: change the anchor's sectionId to "quiz". A hero pointing at a
  // section id the page does not contain is a dead button on a live page.
  const doc = buildQuizFunnelDoc({ quizId: "5f2b…", heading: "x" })
  const hero = doc.sections.find((s) => s.kind === "hero")!
  const target = (hero.props as { primaryCta: { target: { kind: string; sectionId: string } } }).primaryCta.target
  expect(target.kind).toBe("anchor")
  expect(doc.sections.map((s) => s.id)).toContain(target.sectionId)
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run __tests__/lib/funnels/quiz-funnel-doc.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/funnels/quiz-funnel-doc.ts — what a quiz funnel's page IS.
//
// THE SAME THREE SECTIONS `scripts/seed-athlete-quiz-funnel.ts` PUBLISHES.
// That script's own header explains why it runs the real publish sequence
// rather than hand-writing a node tree: a page assembled a different way from
// the real one proves nothing about the real one. The same argument applies to
// having two definitions of what a quiz page is, so this module is the one.
//
// A LEAF: types only. The create route is a server route and the tests are
// pure, and neither should drag a database client in to ask what a page is.
//
// Spec: docs/superpowers/specs/2026-08-24-quiz-funnel-creator-design.md §4
import type { SectionDoc } from "@/lib/funnels/sections/registry"

const QUIZ_SECTION_ID = "quiz1"

export function buildQuizFunnelDoc(input: { quizId: string; heading: string }): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [
      {
        id: "hero1",
        kind: "hero",
        variant: "centered",
        style: {},
        props: {
          eyebrow: "A few minutes",
          headline: input.heading,
          sub: "Answer a few questions and get a readout of where the gaps are.",
          // ANCHORED TO THE CONSTANT, not to a typed-out copy of it.
          primaryCta: { label: "Start the quiz", target: { kind: "anchor", sectionId: QUIZ_SECTION_ID } },
        },
      },
      {
        id: QUIZ_SECTION_ID,
        kind: "quiz",
        variant: "boxed",
        style: {},
        props: { heading: input.heading, quizId: input.quizId, submitLabel: "See my result" },
      },
      {
        id: "foot1",
        kind: "footer",
        variant: "simple",
        style: {},
        props: { businessName: "DJP Athlete", lines: [], links: [], legal: "All rights reserved." },
      },
    ],
  }
}
```

- [ ] **Step 4: Run to green, then mutate**

Run: `npx vitest run __tests__/lib/funnels/quiz-funnel-doc.test.ts` → PASS. Then set `sectionId: "quiz"` and confirm the anchor test goes red.

- [ ] **Step 5: Commit**

```bash
git add lib/funnels/quiz-funnel-doc.ts __tests__/lib/funnels/quiz-funnel-doc.test.ts
git commit -m "feat(quiz): one definition of what a quiz funnel's page is"
```

---

### Task 3: the template and the required ask

**Files:**
- Create: `lib/quizzes/sources.ts`
- Modify: `lib/funnels/templates.ts`, `lib/validators/funnel.ts`
- Test: `__tests__/lib/funnels/templates.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // lib/quizzes/sources.ts
  export const BUILTIN_QUIZ_SOURCE = "builtin:rpi"
  export const BUILTIN_QUIZ_LABEL = "Athlete Quiz — the original"
  export function isBuiltinQuizSource(value: string): boolean
  ```
  `TemplateAsk` gains `"quiz"`. `createFunnelSchema` accepts `quiz?: { copyFrom: string } | null`.

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/lib/funnels/templates.test.ts`:

```ts
describe("the quiz template", () => {
  const quiz = FUNNEL_TEMPLATES.find((t) => t.value === "quiz")!

  it("is one step, and that step is the front door", () => {
    // MUTANT: add a thank-you step. The result is a page a visitor never
    // reaches — the runner walks intro, gate and result inside the one island.
    expect(quiz.steps).toHaveLength(1)
    expect(quiz.steps[0].slug).toBe(ENTRY_STEP_SLUG)
  })

  it("asks for a quiz and for nothing that has no reader", () => {
    expect(quiz.asks).toContain("quiz")
    // The Red/Orange alert goes to business settings' reply_to, not to a
    // funnel's notify_emails, so asking would store an address nothing reads.
    expect(quiz.asks).not.toContain("notify")
    expect(quiz.asks).not.toContain("offer")
    expect(quiz.offerKind).toBeNull()
  })

  it("gives its step no goal, because FunnelGoal values name CTA targets", () => {
    expect(quiz.steps[0].goal).toBeNull()
  })
})

describe("createFunnelSchema and the quiz ask", () => {
  it("refuses a quiz on a template that does not ask for one", () => {
    const result = createFunnelSchema.safeParse({
      slug: "x", name: "X", template: "leads",
      steps: [{ name: "Signup", slug: "index" }],
      quiz: { copyFrom: BUILTIN_QUIZ_SOURCE },
    })
    expect(result.success).toBe(false)
  })

  it("refuses the quiz template with no quiz — the one REQUIRED ask", () => {
    // MUTANT: drop this half. Without it the funnel is created carrying a
    // section whose quizId is "", which fails quizIslandSchema at PUBLISH —
    // the owner finds out at the end instead of at the start.
    const result = createFunnelSchema.safeParse({
      slug: "x", name: "X", template: "quiz",
      steps: [{ name: "Quiz", slug: "index" }],
    })
    expect(result.success).toBe(false)
  })

  it("accepts the quiz template with a quiz", () => {
    const result = createFunnelSchema.safeParse({
      slug: "x", name: "X", template: "quiz",
      steps: [{ name: "Quiz", slug: "index" }],
      quiz: { copyFrom: BUILTIN_QUIZ_SOURCE },
    })
    expect(result.success).toBe(true)
  })

  it("still answers 400, not 500, for an empty steps array", () => {
    // Zod 4 runs superRefine even after .min(1) fails; every refinement that
    // indexes an array in this file needs its guard. Regression pin.
    expect(() =>
      createFunnelSchema.safeParse({ slug: "x", name: "X", template: "quiz", steps: [] }),
    ).not.toThrow()
  })
})
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run __tests__/lib/funnels/templates.test.ts`
Expected: FAIL — no template with value `quiz`.

- [ ] **Step 3: Implement**

`lib/quizzes/sources.ts`:

```ts
// lib/quizzes/sources.ts — the vocabulary of "copy questions from".
//
// A LEAF SHARED BY THE DIALOG AND THE VALIDATOR, for the reason
// `FUNNEL_TEMPLATES` gives for being a const rather than a table: the dialog
// must not be able to offer a source the server refuses.
//
// The built-in is a SENTINEL, not a uuid, because it is not a row — it is
// `RPI_ATHLETE_QUIZ` in `lib/quizzes/seed/rpi-athlete-quiz.ts`. Offering it
// means a quiz funnel can be created on a database that has no quizzes at all,
// which is every database before the seed script has been run.
export const BUILTIN_QUIZ_SOURCE = "builtin:rpi"
export const BUILTIN_QUIZ_LABEL = "Athlete Quiz — the original"

export function isBuiltinQuizSource(value: string): boolean {
  return value === BUILTIN_QUIZ_SOURCE
}
```

`lib/funnels/templates.ts` — widen the type and append the entry:

```ts
export type TemplateAsk = "audience" | "offer" | "dates" | "notify" | "quiz"
```

```ts
{
  value: "quiz",
  label: "Run a quiz",
  hint: "Questions, a score, a routed result",
  // ONE STEP, NOT THREE. The intro, the details gate and the result are all
  // states of the quiz island inside this one page — `QuizRunner` walks them
  // in the browser. A `thank-you` step would be a page nobody reaches.
  //
  // ITS GOAL IS NULL, and that is not an oversight. `FUNNEL_GOALS` is a list
  // where every value except `leads` names a CTA target the section registry
  // resolves; a quiz is not a CTA target. What this step is for is written on
  // the step itself, as a `quiz` section naming its quiz.
  steps: [{ name: "Quiz", slug: ENTRY_STEP_SLUG, goal: null }],
  asks: ["audience", "quiz"],
  offerKind: null,
},
```

`lib/validators/funnel.ts` — add the field and both directions:

```ts
const quizCreateSchema = z.object({
  copyFrom: z.string().min(1).max(120),
})
```

```ts
    quiz: quizCreateSchema.nullable().optional(),
```

and inside `superRefine`, next to the other conditional-field rules:

```ts
    if (value.quiz && !asks("quiz")) {
      ctx.addIssue({ code: "custom", path: ["quiz"], message: "This kind of funnel has no quiz." })
    }
    // THE ONLY REQUIRED ASK IN THIS FILE, and it is required for a reason the
    // others are not. An event funnel with no dates is a funnel somebody dates
    // later. A quiz funnel with no quiz carries a section whose `quizId` is
    // "", which fails `quizIslandSchema` — at PUBLISH, which is after the
    // owner has written the whole page.
    if (!value.quiz && asks("quiz")) {
      ctx.addIssue({ code: "custom", path: ["quiz"], message: "Pick a quiz to copy questions from." })
    }
```

- [ ] **Step 4: Run to green, then mutate**

Run: `npx vitest run __tests__/lib/funnels/templates.test.ts` → PASS. Then delete the `!value.quiz && asks("quiz")` block and confirm the "REQUIRED ask" test goes red. Then add a `thank-you` step and confirm the one-step test goes red.

- [ ] **Step 5: Check the registry biconditional still holds**

Run: `npx vitest run __tests__/lib/funnels/templates.test.ts __tests__/lib/validators` — the existing test asserting `asks("offer") ⟺ offerKind !== null` must still pass with a seventh template present.

- [ ] **Step 6: Commit**

```bash
git add lib/quizzes/sources.ts lib/funnels/templates.ts lib/validators/funnel.ts __tests__/lib/funnels/templates.test.ts
git commit -m "feat(quiz): 'Run a quiz' is a funnel template, and its quiz is not optional"
```

---

### Task 4: creation clones the quiz and writes the page

**Files:**
- Modify: `lib/db/funnels.ts`, `app/api/admin/funnels/route.ts`
- Test: `__tests__/api/funnels/create-quiz-funnel.test.ts`

**Interfaces:**
- Consumes: `createQuizFrom` (Task 1), `buildQuizFunnelDoc` (Task 2), `BUILTIN_QUIZ_SOURCE` / `isBuiltinQuizSource` (Task 3).
- Produces: `CreateFunnelInput["steps"]` entries gain `projectData?: unknown`.

- [ ] **Step 1: Write the failing tests**

```ts
it("creates the quiz and writes it onto the entry step in one insert", async () => {
  const res = await POST(req({ slug: "athlete", name: "Athlete", template: "quiz",
    steps: [{ name: "Quiz", slug: "index" }], quiz: { copyFrom: BUILTIN_QUIZ_SOURCE } }))
  expect(res.status).toBe(200)
  const stepInsert = inserted("funnel_steps")[0]
  const doc = stepInsert.project_data as SectionDoc
  // MUTANT: leave project_data null and PUT the section afterwards. Two writes
  // from one button, and a failure on the second leaves a quiz funnel whose
  // page has no quiz.
  expect(sectionDocSchema.safeParse(doc).success).toBe(true)
  const section = doc.sections.find((s) => s.kind === "quiz")!
  expect((section.props as { quizId: string }).quizId).toBe(inserted("quizzes")[0].id)
})

it("leaves every other template's project_data null, byte for byte as before", async () => {
  await POST(req({ slug: "leads", name: "Leads", template: "leads",
    steps: [{ name: "Signup", slug: "index" }, { name: "Thank you", slug: "thank-you" }] }))
  for (const row of inserted("funnel_steps")) expect(row.project_data ?? null).toBeNull()
  expect(inserted("quizzes")).toHaveLength(0)
})

it("deletes the clone it just made when the funnel insert fails", async () => {
  failNextInsert("funnels")
  const res = await POST(req({ slug: "athlete", name: "Athlete", template: "quiz",
    steps: [{ name: "Quiz", slug: "index" }], quiz: { copyFrom: BUILTIN_QUIZ_SOURCE } }))
  expect(res.status).toBe(500)
  // MUTANT: drop the compensating delete. The list gains a draft quiz nobody
  // asked for, and nothing says where it came from.
  expect(deleted("quizzes")).toContain(inserted("quizzes")[0].id)
})

it("refuses a copyFrom naming a quiz that does not exist", async () => {
  const res = await POST(req({ slug: "athlete", name: "Athlete", template: "quiz",
    steps: [{ name: "Quiz", slug: "index" }],
    quiz: { copyFrom: "11111111-1111-1111-1111-111111111111" } }))
  expect(res.status).toBe(400)
  expect(inserted("funnels")).toHaveLength(0)
})
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run __tests__/api/funnels/create-quiz-funnel.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the DAL half**

In `lib/db/funnels.ts`, the planned-step type gains one optional field and the insert carries it:

```ts
        position: index,
        is_entry: index === 0,
        // SERVER-DERIVED ONLY. `createStepPlanSchema` does not accept a
        // document, so a hand-crafted POST cannot hand one in; the quiz
        // template's route builds it. A client-supplied SectionDoc would walk
        // straight past everything the section grammar exists to enforce.
        //
        // Undefined rather than null when absent, so every other template's
        // insert is the row it has always been.
        ...(step.projectData !== undefined ? { project_data: step.projectData } : {}),
```

- [ ] **Step 4: Implement the route half**

In `app/api/admin/funnels/route.ts`, between validation and `createFunnel`:

```ts
    // THE QUIZ COMES FIRST, because the page cannot name it until it exists —
    // and if the funnel insert then fails, the clone is deleted below. The
    // worst case that leaves is a draft quiz in the list, which is visible and
    // deletable; the other order's worst case is a funnel with a hole in it.
    let createdQuizId: string | null = null
    let entryDoc: unknown
    if (parsed.data.template === "quiz" && parsed.data.quiz) {
      const { copyFrom } = parsed.data.quiz
      const source = isBuiltinQuizSource(copyFrom)
        ? toDefinition(RPI_ATHLETE_QUIZ)
        : await getQuizDefinition(copyFrom)
      if (!source) {
        return NextResponse.json({ error: "That quiz no longer exists." }, { status: 400 })
      }
      const clone = await createQuizFrom({ source, name: parsed.data.name })
      createdQuizId = clone.id
      entryDoc = buildQuizFunnelDoc({ quizId: clone.id, heading: parsed.data.name })
    }
```

wrap the `createFunnel` call so a throw runs the compensating delete:

```ts
    try {
      const { entryStepId, ...funnel } = await createFunnel({ …, steps: plannedSteps })
    } catch (error) {
      if (createdQuizId) {
        // Best effort, and logged when it fails: an orphan draft quiz is a
        // smaller problem than the one we are already reporting.
        await deleteQuiz(createdQuizId).catch((e) => console.error("[POST /api/admin/funnels] orphan quiz", createdQuizId, e))
      }
      throw error
    }
```

`deleteQuiz(quizId)` is a small addition to `lib/db/quizzes.ts` — a single delete on `quizzes` scoped by `business_id`; the five child tables are `ON DELETE CASCADE` from their parent, so one delete is the whole job. Note that in its docblock.

- [ ] **Step 5: Run to green, then mutate**

Run: `npx vitest run __tests__/api/funnels/create-quiz-funnel.test.ts` → PASS. Apply each MUTANT named in the tests and confirm the matching test goes red.

- [ ] **Step 6: Prove the non-quiz path is untouched**

Run: `npx vitest run __tests__/api/funnels __tests__/lib/funnels/templates.test.ts`
Expected: PASS, no new failures.

- [ ] **Step 7: Commit**

```bash
git add lib/db/funnels.ts lib/db/quizzes.ts app/api/admin/funnels/route.ts __tests__/api/funnels/create-quiz-funnel.test.ts
git commit -m "feat(quiz): creating a quiz funnel clones the quiz and writes the page in one insert"
```

---

### Task 5: the picker in the create dialog

**Files:**
- Modify: `components/admin/funnels/CreateFunnelDialog.tsx`
- Test: `__tests__/components/admin/create-funnel-quiz.test.tsx`

**Interfaces:**
- Consumes: `templateAsks(id, "quiz")`, `BUILTIN_QUIZ_SOURCE`, `BUILTIN_QUIZ_LABEL`, `GET /api/admin/quizzes`.

- [ ] **Step 1: Write the failing test**

```tsx
it("shows the picker only for the quiz template", async () => {
  render(<CreateFunnelDialog … />)
  await pickTemplate("Capture leads")
  expect(screen.queryByLabelText("Copy questions from")).toBeNull()
  await pickTemplate("Run a quiz")
  expect(await screen.findByLabelText("Copy questions from")).toBeTruthy()
})

it("offers the built-in even when the database has no quizzes", async () => {
  fetchMock.mockResolvedValueOnce(json({ quizzes: [] }))
  render(<CreateFunnelDialog … />)
  await pickTemplate("Run a quiz")
  // MUTANT: build the options from the fetched list alone. On a database with
  // no quizzes — every database before the seed has run — the picker is empty
  // and a quiz funnel cannot be created at all.
  expect(await screen.findByRole("option", { name: /Athlete Quiz — the original/ })).toBeTruthy()
})

it("sends copyFrom with the create", async () => {
  render(<CreateFunnelDialog … />)
  await pickTemplate("Run a quiz")
  await userEvent.type(screen.getByLabelText("Name"), "Rotational Reboot")
  await userEvent.click(screen.getByRole("button", { name: "Create funnel" }))
  const body = JSON.parse(lastPost().body)
  expect(body.quiz).toEqual({ copyFrom: "builtin:rpi" })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run __tests__/components/admin/create-funnel-quiz.test.tsx`

- [ ] **Step 3: Implement**

Render the field behind `templateAsks(template, "quiz")`, exactly as the audience / dates / offer fields already are. Load the list from `GET /api/admin/quizzes` when the quiz template is first selected, and **always** put the built-in first:

```tsx
const quizOptions = [
  { value: BUILTIN_QUIZ_SOURCE, label: BUILTIN_QUIZ_LABEL },
  ...quizzes.map((q) => ({ value: q.id, label: `Copy of ${q.name}` })),
]
```

Include `quiz: { copyFrom }` in the POST body only when the template asks for it — the server refuses it otherwise, and that symmetry is the point of the `asks` array.

Copy for the field: label **"Copy questions from"**, hint **"Your new quiz starts as a copy of this one. You can change every question afterwards."**

- [ ] **Step 4: Run to green, then mutate**

Run the suite → PASS. Then build `quizOptions` from the fetched list alone and confirm the empty-database test goes red.

- [ ] **Step 5: Commit**

```bash
git add components/admin/funnels/CreateFunnelDialog.tsx __tests__/components/admin/create-funnel-quiz.test.tsx
git commit -m "feat(quiz): the create dialog asks which quiz to copy, and always offers the original"
```

---

### Task 6: `saveQuizDefinition` learns to add and delete

**Files:**
- Modify: `lib/db/quizzes.ts`
- Test: `__tests__/lib/quizzes/quiz-structural-save.test.ts`

**Interfaces:**
- Produces: `QuizSaveInput` gains `addQuestions`, `addOptions`, `deleteQuestionIds`, `deleteOptionIds`. `saveQuizDefinition` returns `Promise<{ retiredQuestionIds: string[] }>` instead of `Promise<void>`, and throws `QuizAnsweredOptionError` when asked to delete an answered option.

- [ ] **Step 1: Write the failing tests**

```ts
it("inserts a new question with its options in one save", async () => {
  await saveQuizDefinition({ quizId: "q1", addQuestions: [{
    id: "new-q", branchId: null, position: 99, prompt: "New?", helpText: null, isActive: false,
    options: [ { id: "new-o1", position: 1, label: "Option 1", weight: 0, routesToBranchId: null, profileId: null },
               { id: "new-o2", position: 2, label: "Option 2", weight: 0, routesToBranchId: null, profileId: null } ],
  }] })
  expect(inserted("quiz_questions")[0]).toMatchObject({ id: "new-q", quiz_id: "q1", is_active: false })
  expect(inserted("quiz_options").map((o) => o.question_id)).toEqual(["new-q", "new-q"])
})

it("hard-deletes a question nobody has answered, and its options with it", async () => {
  await saveQuizDefinition({ quizId: "q1", deleteQuestionIds: ["qu2"] })
  expect(deleted("quiz_options")).toContain("qu2")   // by question_id
  expect(deleted("quiz_questions")).toContain("qu2")
})

it("RETIRES a question somebody has answered instead of destroying it", async () => {
  // TABLES.quiz_attempts holds an attempt whose answers name qu1.
  const result = await saveQuizDefinition({ quizId: "q1", deleteQuestionIds: ["qu1"] })
  // MUTANT: delete it anyway. Past scores survive — raw_score and max_score are
  // frozen on the attempt — but a report can no longer name what was asked.
  expect(deleted("quiz_questions")).not.toContain("qu1")
  expect(updates("quiz_questions").find((u) => u.id === "qu1")?.patch.is_active).toBe(false)
  expect(result.retiredQuestionIds).toEqual(["qu1"])
})

it("refuses to delete an answered option, having written nothing", async () => {
  await expect(saveQuizDefinition({ quizId: "q1", deleteOptionIds: ["o1"],
    quiz: { name: "Should not be written" } })).rejects.toThrow(QuizAnsweredOptionError)
  // MUTANT: run the refuse-check after the writes. The name lands, the save
  // reports failure, and the editor and the database now disagree.
  expect(updates("quizzes")).toHaveLength(0)
})

it("deletes an option nobody picked", async () => {
  await saveQuizDefinition({ quizId: "q1", deleteOptionIds: ["o3"] })
  expect(deleted("quiz_options")).toContain("o3")
})

it("scopes every insert to the quiz being edited", async () => {
  await saveQuizDefinition({ quizId: "q1", addOptions: [
    { id: "x", questionId: "quX", position: 1, label: "Intruder", weight: 9, routesToBranchId: null, profileId: null }] })
  // quX belongs to q2. Nothing may be written.
  expect(inserted("quiz_options")).toHaveLength(0)
})
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run __tests__/lib/quizzes/quiz-structural-save.test.ts`

- [ ] **Step 3: Implement**

Rewrite the docblock — it currently says "UPDATES ONLY", which will no longer be true, and a stale docblock on this function is exactly the kind of thing the next reader trusts:

```ts
/**
 * Applies an editor save: inserts, then updates, then deletes.
 *
 * THE RULE: NOTHING ANYBODY HAS ANSWERED IS EVER DESTROYED. Answers live in
 * `quiz_attempts.answers`, a jsonb array with no foreign keys, so the database
 * will happily let a delete orphan them. What protects a past RESULT is that
 * raw_score, max_score and score are frozen on the attempt — a structural edit
 * can never rewrite what somebody was told in March. What is not protected is
 * NAMING: a report mapping an answer back to its prompt finds a hole.
 *
 *   question, never answered → deleted, with its options
 *   question, answered       → RETIRED (is_active = false) and reported back
 *   option,   never picked   → deleted
 *   option,   picked         → the whole save is REFUSED, naming it
 *
 * The asymmetry is deliberate. A question has a retired state the whole system
 * already honours: the walk skips inactive questions and `quizGate` ignores
 * them. An option has no such column, and adding one to `quiz_options` for
 * this would buy a state nothing else understands.
 *
 * THE REFUSE-CHECK RUNS BEFORE ANY WRITE. Refusing halfway would leave the
 * editor and the database disagreeing about a save the owner was told failed.
 *
 * Ordering: inserts first, so a row added in this save can be edited by the
 * same save; deletes last, so a refusal costs nothing already written.
 *
 * Every insert is scoped to `quizId` the same way every update already is, so
 * a payload naming another quiz's parent writes nothing rather than editing
 * somebody else's page.
 */
```

Add a private `answeredIds(supabase, quizId): Promise<{ questions: Set<string>; options: Set<string> }>` that selects `answers` for this quiz's attempts and scans the jsonb in JS, with a comment naming the cost: *O(attempts), one column, one quiz — cheap at today's volumes; a jsonb GIN index is the fix the day it is not.*

- [ ] **Step 4: Run to green, then mutate**

Run the suite → PASS. Apply each MUTANT named in the tests and confirm the matching test goes red.

- [ ] **Step 5: Commit**

```bash
git add lib/db/quizzes.ts __tests__/lib/quizzes/quiz-structural-save.test.ts
git commit -m "feat(quiz): questions and options can be added and removed, and answered ones survive"
```

---

### Task 7: the route carries the structural payload

**Files:**
- Modify: `app/api/admin/quizzes/[id]/route.ts`, `app/(admin)/admin/funnels/quizzes/[id]/page.tsx`
- Test: `__tests__/api/admin-quiz-structural.test.ts`

**Interfaces:**
- Consumes: Task 6's `QuizSaveInput` and `QuizAnsweredOptionError`; Task 1's `getQuizDefinitionForEditor`.
- Produces: PATCH returns `{ ok: true, gate, quiz, retiredQuestionIds }`, where `quiz` is the editor-shaped definition.

- [ ] **Step 1: Write the failing tests**

```ts
it("answers 400 naming the option when the save deletes an answered one", async () => {
  const res = await PATCH(req({ deleteOptionIds: ["o1"] }), params("q1"))
  expect(res.status).toBe(400)
  expect((await res.json()).error).toMatch(/picked this answer/)
})

it("reports a retirement rather than pretending it was a delete", async () => {
  const res = await PATCH(req({ deleteQuestionIds: ["qu1"] }), params("q1"))
  expect((await res.json()).retiredQuestionIds).toEqual(["qu1"])
})

it("returns the definition the EDITOR needs, inactive questions included", async () => {
  // MUTANT: return getQuizDefinition. The question just retired disappears
  // from the editor with no way back, and a newly added inactive question
  // vanishes the moment it is saved.
  const res = await PATCH(req({ deleteQuestionIds: ["qu1"] }), params("q1"))
  expect((await res.json()).quiz.questions.map((q) => q.id)).toContain("qu1")
})

it("still refuses to activate a quiz its structural edit just broke", async () => {
  const res = await PATCH(req({ quiz: { status: "active" }, deleteQuestionIds: ["router-q"] }), params("q1"))
  expect(res.status).toBe(409)
  expect((await res.json()).blockers.join(" ")).toMatch(/router/)
})

it("is admin only, and answers 404 rather than confirming what exists", async () => {
  mockSession({ role: "client" })
  expect((await PATCH(req({}), params("q1"))).status).toBe(404)
})
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run __tests__/api/admin-quiz-structural.test.ts`

- [ ] **Step 3: Implement**

Extend `bodySchema` with the four structural arrays (uuid ids, the same max caps as their update siblings), pass them through to `saveQuizDefinition`, catch `QuizAnsweredOptionError` into a 400 carrying its message, and change the success response to read through `getQuizDefinitionForEditor`. Leave the existing sequence — write children, re-read, gate, then flip status — exactly as it is; the docblock already explains why it is in that order and structural edits do not change the argument.

Change the editor page to `getQuizDefinitionForEditor`.

- [ ] **Step 4: Run to green, then mutate**

Run the suite → PASS. Apply the MUTANT in the third test (swap back to `getQuizDefinition`) and confirm it goes red.

- [ ] **Step 5: Regression-check the existing route tests**

Run: `npx vitest run __tests__/api/admin-quiz-save.test.ts`
Expected: PASS, unchanged.

- [ ] **Step 6: Commit**

```bash
git add "app/api/admin/quizzes/[id]/route.ts" "app/(admin)/admin/funnels/quizzes/[id]/page.tsx" __tests__/api/admin-quiz-structural.test.ts
git commit -m "fix(quiz): the editor's save can restructure, and its refusals say why"
```

---

### Task 8: the editor's add, delete and restore

**Files:**
- Modify: `components/admin/quizzes/QuizEditor.tsx`
- Test: `__tests__/components/admin/QuizEditor.structural.test.tsx`

**Interfaces:**
- Consumes: Task 7's PATCH contract.

- [ ] **Step 1: Write the failing tests**

```tsx
it("adds a question to the branch tab that is open", async () => {
  render(<QuizEditor initial={definition} />)
  await userEvent.click(screen.getByRole("tab", { name: "Rebuilder" }))
  await userEvent.click(screen.getByRole("button", { name: "Add a question" }))
  // MUTANT: always add to the shared set (branchId null). The owner adds a
  // question while looking at Rebuilder and it appears under Everyone.
  await save()
  expect(lastBody().addQuestions[0].branchId).toBe("br1")
})

it("gives a new question two options so it can pass the gate once turned on", async () => {
  await addQuestion()
  await save()
  expect(lastBody().addQuestions[0].options).toHaveLength(2)
})

it("adds it switched off, so a half-typed question cannot reach a visitor", async () => {
  // MUTANT: isActive true. Editing a LIVE quiz would put a question reading
  // "Option 1" in front of the next person who takes it.
  await addQuestion()
  await save()
  expect(lastBody().addQuestions[0].isActive).toBe(false)
})

it("does not send a delete for a question that was added and removed before saving", async () => {
  await addQuestion()
  await userEvent.click(screen.getAllByRole("button", { name: "Remove question" }).at(-1)!)
  await save()
  const body = lastBody()
  expect(body.addQuestions ?? []).toHaveLength(0)
  expect(body.deleteQuestionIds ?? []).toHaveLength(0)
})

it("shows a retired question as retired, and offers to bring it back", async () => {
  render(<QuizEditor initial={withRetired} />)
  expect(screen.getByText("Retired")).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: "Restore" }))
  await save()
  expect(lastBody().questions.find((q) => q.id === "quOff").isActive).toBe(true)
})

it("says what happened when the server retired instead of deleting", async () => {
  fetchMock.mockResolvedValueOnce(json({ ok: true, quiz: definition, retiredQuestionIds: ["qu1"] }))
  await deleteQuestion("qu1")
  await save()
  expect(await screen.findByText(/has answers, so it was retired/)).toBeTruthy()
})
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run __tests__/components/admin/QuizEditor.structural.test.tsx`

- [ ] **Step 3: Implement**

Track two sets alongside `quiz`:

```tsx
// A NEW ROW REMOVED BEFORE SAVING NEVER EXISTED. Without this pair of
// deletions the editor sends the server an insert and a delete for the same
// id, or worse, a delete for a row that was never inserted.
const [newIds, setNewIds] = useState<{ questions: Set<string>; options: Set<string> }>(…)
const [deletedIds, setDeletedIds] = useState<{ questions: Set<string>; options: Set<string> }>(…)
```

`addQuestion()` mints `crypto.randomUUID()` for the question and both options, appends at `max(position) + 1` across the whole quiz (positions are global, not per branch), sets `branchId` from the open tab (`branchTab === EVERYONE ? null : branchTab`) and `isActive: false`. `removeQuestion(id)` drops it from `quiz` and, if it was not in `newIds`, records it in `deletedIds`.

`save()` splits the payload: new rows into `addQuestions` / `addOptions`, existing rows into the `questions` / `options` update arrays as today, and `deletedIds` minus `newIds` into the delete arrays. On success, adopt `json.quiz` as the new state, clear both sets, and if `json.retiredQuestionIds` is non-empty say so in plain words: **"That question has answers, so it was retired rather than removed. It is no longer shown to anyone."**

Render an inactive question dimmed with a **Retired** badge and a **Restore** button that flips `isActive` back to true — the update path already supports it, and without the button a retirement is a one-way door.

- [ ] **Step 4: Run to green, then mutate**

Run the suite → PASS. Apply each MUTANT named in the tests and confirm the matching test goes red.

- [ ] **Step 5: Commit**

```bash
git add components/admin/quizzes/QuizEditor.tsx __tests__/components/admin/QuizEditor.structural.test.tsx
git commit -m "feat(quiz): add, remove and restore questions in the editor"
```

---

### Task 9: verification and the screenshots

**Files:**
- Create: `screenshots/quiz-funnel-creator/*.png`, `screenshots/quiz-funnel-creator/index.html`
- Create: `scripts/shoot-quiz-funnel-creator.mjs`

- [ ] **Step 1: Compile**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: exactly `251`. Then `npx tsc --noEmit 2>&1 | grep -E "quiz|funnel"` and confirm none of them are in files this plan touched.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: green, with `/admin/funnels/quizzes/[id]` and `/api/admin/funnels` present in the route list.

- [ ] **Step 3: Targeted suites**

Run: `npx vitest run __tests__/lib/quizzes __tests__/lib/funnels __tests__/api/funnels __tests__/api/admin-quiz-save.test.ts __tests__/api/admin-quiz-structural.test.ts __tests__/components/admin`
Expected: green apart from the 14 pre-existing failures listed in Global Constraints.

- [ ] **Step 4: Drive the real app**

Start the dev server on 3050 against the dev clone. Sign in as admin. Then, with Playwright:

1. `/admin/funnels` with the New Funnel dialog open on **Run a quiz**, the picker visible.
2. The created funnel's quiz editor, showing the cloned questions and the seed-marker banner.
3. The editor with a question just added — switched off, two options.
4. The refusal: attempting to remove an answered option.
5. A retired question showing its badge and Restore.
6. The created funnel's page at its real `/go/<slug>` (publish it first), running the cloned quiz.

**The real screens on the real routes.** A preview harness does not count. Annotations burned into the PNGs, composed at the capture's exact CSS width so nothing is upscaled. Admin UI is light-only, so no dark pass for shots 1–5; shot 6 is a public page and gets both if the funnel theme supports it.

- [ ] **Step 5: Write the review sheet**

`screenshots/quiz-funnel-creator/index.html`, referencing sibling PNGs — never one file with everything base64-embedded.

- [ ] **Step 6: Commit**

```bash
git add screenshots/quiz-funnel-creator scripts/shoot-quiz-funnel-creator.mjs
git commit -m "docs(quiz): six screens driven through the real create dialog and editor"
```

---

## Self-review

**Spec coverage:** §1 → Tasks 4, 5. §2 → Task 3. §3 → Task 1. §4 → Tasks 2, 4. §5 → Tasks 6, 7, 8. §6 is exclusions. §7 → the test steps in every task plus Task 9. §8 risk 2 (the non-quiz path unchanged) → Task 4 Step 6.

**One thing the spec did not know:** `getQuizDefinition` filters inactive questions, which silently breaks both inactive-on-arrival and retirement. Task 1 adds `getQuizDefinitionForEditor` and Task 7 wires it; the spec should be amended to say so on review.

**Type consistency:** `createQuizFrom({ source, name })` in Tasks 1 and 4. `buildQuizFunnelDoc({ quizId, heading })` in Tasks 2 and 4. `getQuizDefinitionForEditor` in Tasks 1 and 7. `addQuestions` / `addOptions` / `deleteQuestionIds` / `deleteOptionIds` identical in Tasks 6, 7 and 8. `retiredQuestionIds` in Tasks 6, 7 and 8.
