# Quiz in the funnel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A funnel that uses a quiz shows that quiz on its own screen, and someone who finishes the quiz appears under that funnel's Leads, marked as a quiz completion rather than a form fill.

**Architecture:** Two independent halves that share nothing but the word "quiz".
(1) READ SIDE: a pure walk over each step's draft `SectionDoc` collects the `quizId`s a
funnel points at; the funnel's settings screen renders them as a panel with an Edit link,
and the top-level "Quizzes" sidebar item is demoted to a link on the funnels board.
(2) WRITE SIDE: `FunnelRenderContext` already carries `funnelId`/`stepId` to every island —
`QuizIsland` passes them to `QuizRunner`, which posts them, and `/api/quiz/submit` files a
`funnel_submissions` row inside its existing non-fatal `handoff`. Two new columns (`kind`,
`quiz_attempt_id`) make the row honest about what it is and point at the score without
copying it.

**Tech Stack:** Next.js 16 App Router, React 19 server components, Zod 4, Supabase
PostgREST (service role), Vitest + Testing Library, Playwright for the real-app check.

**Spec:** `docs/next-session-quiz-in-the-funnel.md` (the brief + the measured facts), read
against `docs/superpowers/specs/2026-08-23-athlete-quiz-funnel-design.md` §2.3/§4.3 and
`docs/superpowers/specs/2026-08-24-quiz-funnel-creator-design.md` §4.

---

## Global Constraints

- `npx tsc --noEmit` must stay at **exactly 251** errors. A falling count hides new errors too.
- **14 tests are red on `main` and none are ours**: SetupPanel (7), report-shell (5),
  receipt-row-editor (1), funnel-island-traits (1). Do not "fix" them, do not count them.
- **Targeted test runs only** — `npx vitest run <path>`. Never the full suite.
- `npm run lint` does not work (Next 16 removed `next lint`). `tsc --noEmit` + `npm run build`
  is the whole gate. **Never run `npm run build` while `npm run dev` is running** — they share
  `.next`.
- **Mutate every test before believing it.** A mutation that edits a comment is not a mutation:
  check the diff moved code before believing the verdict.
- **`testRun` must not write.** `/preview/<slug>` sets `FunnelRenderContext.testRun`; the rule
  for that surface is ZERO writes. `/api/quiz/preview-submit` takes `{quizId, answers}` only and
  a test asserts its source contains no write path. Nothing in this plan may reach it.
- **Colours are semantic classes** (`text-primary`, `bg-accent`, `text-muted-foreground`),
  never hex. Admin UI is light-only.
- **Tables are `components/ui/data-table.tsx`.** Never a hand-rolled `<table>`.
- Work happens in the worktree `.claude/worktrees/quiz-in-funnel` on branch
  `feat/quiz-in-funnel`. The main checkout carries three peer sessions' uncommitted work —
  never stage from there.
- **Never commit `JOURNAL.md`.** Never add a Claude co-author trailer.

---

## Design decisions taken here (not open questions — record, don't re-litigate)

1. **The quiz editor keeps its URL** (`/admin/funnels/quizzes/<id>`). A quiz is a shared
   database entity — two funnels can point at the same one — so nesting its editor under one
   funnel's id would be a lie about ownership. What changes is how you REACH it.
2. **The sidebar item goes; the list page stays reachable.** "Quizzes" is removed from the
   Marketing nav group (both `contentStudioEnabled` branches) and re-surfaces as a link in the
   funnels board's subtitle, next to "How funnels work". Without that link a quiz no funnel
   uses would be reachable only by typing the URL — the exact defect the removed nav line's own
   comment was added to fix.
3. **The panel reads the DRAFT doc**, `funnel_steps.project_data`, because that is what the
   owner edits. A quiz referenced only by an old published version and since removed from the
   draft does not appear. Documented, not fixed.
4. **`payload` stays "what the visitor said".** Migration 00204's comment is explicit that
   mixing our own state into `payload` stops it being a record of what someone said. So the
   quiz submission's payload is `question prompt -> chosen option label`, and the SCORE is not
   copied into it: the row carries `quiz_attempt_id` and the leads screen reads the outcome
   from `quiz_attempts`, which is already the one place a result is stored.
5. **`lead_user_id` stays null on a quiz submission.** The form path mints a `users` row with
   `status:'lead'`; the quiz path already feeds the newer contact spine via
   `recordContactEvent`. Minting a second identity from a second path is a merge problem, not
   a feature. Consequence to state in the report: a quiz lead appears under Leads and under
   Contacts, but NOT under /admin/clients.
6. **No funnel, no submission.** A quiz island rendered outside a funnel page (no `funnelId`)
   writes no submission and logs nothing scary. `funnel_submissions.funnel_id` is NOT NULL and
   there is no honest value to invent.
7. **One completion, one lead** is enforced by a partial unique index on `quiz_attempt_id`,
   mirroring how the pipeline already dedupes on the attempt id.

---

## File structure

**Created**
- `supabase/migrations/00230_funnel_submissions_quiz.sql` — `kind`, `quiz_attempt_id`, the
  CHECK, the two indexes.
- `lib/funnels/quiz-refs.ts` — pure: which quizzes a funnel's steps point at.
- `lib/quizzes/answer-payload.ts` — pure: answers -> `prompt: label` record.
- `components/admin/funnels/FunnelQuizPanel.tsx` — the panel on the funnel screen.
- `__tests__/lib/funnels/quiz-refs.test.ts`
- `__tests__/lib/quizzes/answer-payload.test.ts`
- `__tests__/components/admin/funnel-quiz-panel.test.tsx`
- `__tests__/lib/db/funnel-submission-kind.test.ts` — `createSubmission` writes the new
  columns and survives the pre-00230 schema.
- `__tests__/api/quiz-submit-funnel-lead.test.ts` — the route's submission write.
- `__tests__/components/admin/leads-board-quiz.test.tsx` — the quiz lead reads as a quiz lead.

**Modified**
- `types/database.ts` — `FunnelSubmissionKind`, two fields on `FunnelSubmission`.
- `lib/db/funnels.ts` — `CreateSubmissionInput` + `createSubmission` (new columns, schema
  tolerance, error code preserved).
- `lib/db/quizzes.ts` — `getQuizzesByIds`.
- `lib/db/funnel-leads.ts` — normalise `kind`, expose `getQuizOutcomesForLeads`.
- `app/(admin)/admin/funnels/[id]/page.tsx` — load and render the panel.
- `app/(admin)/admin/funnels/page.tsx` — the "Quizzes" link.
- `components/admin/admin-nav.ts` — drop the two "Quizzes" entries.
- `components/funnels/islands/QuizIsland.tsx` — pass `funnelId`/`stepId` through.
- `components/funnels/islands/QuizRunner.tsx` — props + post them (live branch only).
- `app/api/quiz/submit/route.ts` — accept them, file the submission, audit it.
- `app/(admin)/admin/funnels/leads/page.tsx` — outcome read + copy.
- `components/admin/funnels/LeadsBoard.tsx` — the Quiz badge, the result line, the copy.
- `lib/funnels/leads-csv.ts` — a `Type` column.
- `lib/funnels/sections/render.ts` — the builder note's wording.
- `__tests__/components/admin/admin-nav.test.ts` — the nav is one item lighter.
- `__tests__/components/admin/leads-board-columns.test.tsx` — fixture gains the two fields.

---

### Task 1: Which quizzes a funnel points at (pure)

**Files:**
- Create: `lib/funnels/quiz-refs.ts`
- Test: `__tests__/lib/funnels/quiz-refs.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export interface QuizUse { quizId: string; stepId: string; stepName: string }`
  and `export function quizUsesInSteps(steps: QuizRefStep[]): QuizUse[]`, where
  `export interface QuizRefStep { id: string; name: string; project_data: unknown }`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/funnels/quiz-refs.test.ts
//
// A LEAF WITH NO MOCKS. `quizUsesInSteps` reads `funnel_steps.project_data`, which is
// `jsonb` typed `unknown` end to end and can hold three different things: a real
// SectionDoc, a legacy GrapesJS blob (steps that predate 00203), or null. It must
// answer "no quizzes" for the last two rather than throw on the funnel's own screen.
import { describe, expect, it } from "vitest"
import { quizUsesInSteps } from "@/lib/funnels/quiz-refs"

const QUIZ_A = "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9"
const QUIZ_B = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"

function doc(sections: unknown[]) {
  return { v: 1, engine: "sections", theme: { tone: "light", accent: "accent", radius: "soft" }, sections }
}
function quizSection(id: string, quizId: string) {
  return { id, kind: "quiz", variant: "boxed", style: {}, props: { quizId, submitLabel: "See my result" } }
}
function heroSection() {
  return { id: "h1", kind: "hero", variant: "centered", style: {}, props: { headline: "Hi" } }
}

describe("quizUsesInSteps", () => {
  it("finds the quiz a step's draft points at, with the step it is on", () => {
    const uses = quizUsesInSteps([
      { id: "step-1", name: "Quiz", project_data: doc([heroSection(), quizSection("q1", QUIZ_A)]) },
    ])
    expect(uses).toEqual([{ quizId: QUIZ_A, stepId: "step-1", stepName: "Quiz" }])
  })

  it("returns every step's quiz, in step order", () => {
    const uses = quizUsesInSteps([
      { id: "step-1", name: "Entry", project_data: doc([quizSection("q1", QUIZ_A)]) },
      { id: "step-2", name: "Second", project_data: doc([quizSection("q1", QUIZ_B)]) },
    ])
    expect(uses.map((u) => u.quizId)).toEqual([QUIZ_A, QUIZ_B])
    expect(uses.map((u) => u.stepId)).toEqual(["step-1", "step-2"])
  })

  it("reports the SAME quiz on two steps once, keeping the first step", () => {
    const uses = quizUsesInSteps([
      { id: "step-1", name: "Entry", project_data: doc([quizSection("q1", QUIZ_A)]) },
      { id: "step-2", name: "Retake", project_data: doc([quizSection("q1", QUIZ_A)]) },
    ])
    expect(uses).toEqual([{ quizId: QUIZ_A, stepId: "step-1", stepName: "Entry" }])
  })

  it("ignores a step that has never been built", () => {
    expect(quizUsesInSteps([{ id: "step-1", name: "New", project_data: null }])).toEqual([])
  })

  it("ignores a legacy GrapesJS blob rather than throwing", () => {
    const legacy = { pages: [{ frames: [{ component: { type: "wrapper" } }] }] }
    expect(quizUsesInSteps([{ id: "step-1", name: "Old", project_data: legacy }])).toEqual([])
  })

  it("ignores a quiz block whose quizId is blank — the registry's own default", () => {
    const uses = quizUsesInSteps([
      { id: "step-1", name: "Unset", project_data: doc([quizSection("q1", "")]) },
    ])
    expect(uses).toEqual([])
  })

  it("ignores a quizId that is not a uuid, which no quizzes row can have", () => {
    const uses = quizUsesInSteps([
      { id: "step-1", name: "Junk", project_data: doc([quizSection("q1", "not-a-uuid")]) },
    ])
    expect(uses).toEqual([])
  })

  it("finds a quiz in a document a full schema parse would reject", () => {
    // The panel's job is to say WHICH quiz this funnel points at. A document
    // that fails `sectionDocSchema` somewhere else still points at it, and a
    // whole-document parse would answer "no quiz" for a page that has one.
    const broken = doc([quizSection("q1", QUIZ_A), { id: "x1", kind: "not-a-kind", style: {}, props: {} }])
    expect(quizUsesInSteps([{ id: "step-1", name: "Broken", project_data: broken }])).toEqual([
      { quizId: QUIZ_A, stepId: "step-1", stepName: "Broken" },
    ])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run __tests__/lib/funnels/quiz-refs.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/funnels/quiz-refs"`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/funnels/quiz-refs.ts — which quizzes a funnel's pages point at.
//
// A LEAF: no database client, no Zod. The funnel's settings screen already
// holds its steps, so this answers the question from what is in hand.
//
// WHY THE WALK IS DEFENSIVE RATHER THAN A SCHEMA PARSE. `project_data` is
// `jsonb` typed `unknown` and holds three different things across the table: a
// real SectionDoc, a legacy GrapesJS blob from before 00203, and null for a
// step nobody has built. On top of that, a document can fail
// `sectionDocSchema` in one section and still point at a perfectly real quiz
// in another — and "this funnel has no quiz" is the wrong answer to give the
// person looking for the quiz they can see on their own page.

/** Only what this module reads. `listSteps` rows satisfy it. */
export interface QuizRefStep {
  id: string
  name: string
  project_data: unknown
}

export interface QuizUse {
  quizId: string
  stepId: string
  stepName: string
}

/** The shape `quizIslandSchema` accepts. Anything else names no row. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function sectionsOf(projectData: unknown): Record<string, unknown>[] {
  if (typeof projectData !== "object" || projectData === null) return []
  const sections = (projectData as { sections?: unknown }).sections
  if (!Array.isArray(sections)) return []
  return sections.filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
}

/**
 * Every quiz the funnel's steps point at, deduplicated, in step order.
 *
 * THE FIRST STEP WINS on a repeat. A quiz used twice is one quiz to edit, and
 * naming the step it first appears on is the more useful half of the answer.
 */
export function quizUsesInSteps(steps: QuizRefStep[]): QuizUse[] {
  const out: QuizUse[] = []
  const seen = new Set<string>()

  for (const step of steps) {
    for (const section of sectionsOf(step.project_data)) {
      if (section.kind !== "quiz") continue
      const props = section.props
      if (typeof props !== "object" || props === null) continue
      const quizId = (props as { quizId?: unknown }).quizId
      if (typeof quizId !== "string" || !UUID.test(quizId)) continue
      if (seen.has(quizId)) continue
      seen.add(quizId)
      out.push({ quizId, stepId: step.id, stepName: step.name })
    }
  }

  return out
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run __tests__/lib/funnels/quiz-refs.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Mutate every test, one at a time, and confirm each dies**

Apply each mutation to `lib/funnels/quiz-refs.ts`, re-run the file, revert. Every one must
turn a test RED. `git diff` after each edit to confirm the change moved CODE, not a comment.

| # | Mutation | Must kill |
|---|---|---|
| 1 | `if (section.kind !== "quiz") continue` -> `if (false) continue` | test 1 (a hero would be reported) |
| 2 | delete the `seen.has` guard | "reports the SAME quiz on two steps once" |
| 3 | `!UUID.test(quizId)` -> `false` | "not a uuid" AND "blank quizId" |
| 4 | `if (!Array.isArray(sections)) return []` -> `return []` unconditionally | tests 1 and 2 |
| 5 | drop the `typeof projectData !== "object"` guard | "never been built" (throws on null) |
| 6 | return `{ quizId, stepId: step.id, stepName: step.id }` | test 1 (stepName) |

- [ ] **Step 6: Commit**

```bash
git add lib/funnels/quiz-refs.ts __tests__/lib/funnels/quiz-refs.test.ts
git commit -m "feat(funnels): which quizzes a funnel's pages point at"
```

---

### Task 2: The quiz panel on the funnel's own screen

**Files:**
- Create: `components/admin/funnels/FunnelQuizPanel.tsx`
- Create: `__tests__/components/admin/funnel-quiz-panel.test.tsx`
- Modify: `lib/db/quizzes.ts` (add `getQuizzesByIds` after `listQuizzes`, ~line 234)
- Modify: `app/(admin)/admin/funnels/[id]/page.tsx`

**Interfaces:**
- Consumes: `quizUsesInSteps`, `QuizUse` (Task 1); `QuizListRow`, `getQuizAttemptCounts`
  from `lib/db/quizzes.ts`.
- Produces: `getQuizzesByIds(ids: string[]): Promise<QuizListRow[]>`;
  `FunnelQuizPanel({ items }: { items: FunnelQuizPanelItem[] })` where
  `export interface FunnelQuizPanelItem { quizId: string; stepName: string; quiz: QuizListRow | null; attempts: { total: number; completed: number } }`.

- [ ] **Step 1: Write the failing component test**

```tsx
// __tests__/components/admin/funnel-quiz-panel.test.tsx
//
// The panel exists so the quiz is reachable FROM THE FUNNEL THAT USES IT. The
// assertions are therefore about the link and about the two states that are
// easy to get wrong: a quiz that is still a draft (so the page it is on cannot
// publish) and a quizId whose row is gone.
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { FunnelQuizPanel, type FunnelQuizPanelItem } from "@/components/admin/funnels/FunnelQuizPanel"

const QUIZ_ID = "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9"

function item(over: Partial<FunnelQuizPanelItem> = {}): FunnelQuizPanelItem {
  return {
    quizId: QUIZ_ID,
    stepName: "Athlete Quiz",
    quiz: {
      id: QUIZ_ID,
      key: "rpi_athlete_quiz",
      name: "Athlete Readiness Quiz",
      status: "active",
      seedMarker: null,
      updatedAt: "2026-08-24T10:00:00.000Z",
    },
    attempts: { total: 9, completed: 4 },
    ...over,
  }
}

describe("FunnelQuizPanel", () => {
  it("links the quiz to its editor", () => {
    render(<FunnelQuizPanel items={[item()]} />)
    const link = screen.getByRole("link", { name: /Athlete Readiness Quiz/ })
    expect(link.getAttribute("href")).toBe(`/admin/funnels/quizzes/${QUIZ_ID}`)
  })

  it("names the step the quiz is on", () => {
    render(<FunnelQuizPanel items={[item()]} />)
    expect(screen.getByText("Athlete Quiz")).toBeTruthy()
  })

  it("shows completions and starts as separate numbers", () => {
    // The gap between them IS the drop-off; showing only completions makes an
    // abandoned quiz look like an unused one.
    render(<FunnelQuizPanel items={[item()]} />)
    expect(screen.getByText("4")).toBeTruthy()
    expect(screen.getByText("9")).toBeTruthy()
  })

  it("says a draft quiz is a draft", () => {
    render(<FunnelQuizPanel items={[item({ quiz: { ...item().quiz!, status: "draft" } })]} />)
    expect(screen.getByText("draft")).toBeTruthy()
  })

  it("says so when the quiz this page points at no longer exists", () => {
    render(<FunnelQuizPanel items={[item({ quiz: null })]} />)
    expect(screen.getByText(/no longer exists/i)).toBeTruthy()
    expect(screen.queryByRole("link", { name: /Athlete Readiness Quiz/ })).toBeNull()
  })

  it("renders nothing at all when the funnel uses no quiz", () => {
    const { container } = render(<FunnelQuizPanel items={[]} />)
    expect(container.innerHTML).toBe("")
  })

  it("warns when the scoring was reconstructed rather than recovered", () => {
    render(<FunnelQuizPanel items={[item({ quiz: { ...item().quiz!, seedMarker: "ghl-export" } })]} />)
    expect(screen.getByText(/Unverified scoring/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run __tests__/components/admin/funnel-quiz-panel.test.tsx`
Expected: FAIL — cannot resolve `@/components/admin/funnels/FunnelQuizPanel`.

- [ ] **Step 3: Write the component**

```tsx
// components/admin/funnels/FunnelQuizPanel.tsx — the quiz this funnel uses.
//
// A quiz is a database entity the page's `quiz` block points at BY ID, which
// is what lets one weight edit take effect on every page showing it with no
// re-publish. The cost of that indirection was that the quiz had no home: it
// lived on its own top-level sidebar screen, and nothing on the funnel that
// uses it said it existed. This panel is the way back — you reach the quiz
// from the thing it belongs to.
//
// The editor keeps its own URL. Two funnels can point at one quiz, so nesting
// the editor under a single funnel's id would be a lie about ownership.
//
// House table throughout — never a hand-rolled <table>. See CLAUDE.md.

import Link from "next/link"
import {
  DataTable,
  DataTableBadge,
  DataTableCard,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  DataTableToolbar,
  type DataTableBadgeTone,
} from "@/components/ui/data-table"
import type { QuizListRow } from "@/lib/db/quizzes"

export interface FunnelQuizPanelItem {
  quizId: string
  /** The step whose page shows it — the first, if more than one does. */
  stepName: string
  /** `null` when the block points at an id no `quizzes` row has any more. */
  quiz: QuizListRow | null
  attempts: { total: number; completed: number }
}

const STATUS_TONE: Record<string, DataTableBadgeTone> = {
  active: "success",
  draft: "warning",
  archived: "neutral",
}

export function FunnelQuizPanel({ items }: { items: FunnelQuizPanelItem[] }) {
  // NOTHING, not an empty card. Most funnels have no quiz, and an empty
  // "Quiz" card on every one of them is furniture that teaches the eye to
  // skip the place the real answer appears.
  if (items.length === 0) return null

  return (
    <div className="mb-6">
      <DataTableCard>
        <DataTableToolbar>
          <p className="text-sm text-muted-foreground">
            {items.length === 1 ? "This funnel uses a quiz." : `This funnel uses ${items.length} quizzes.`} Editing it
            changes every page that shows it, straight away — there is nothing to re-publish.
          </p>
        </DataTableToolbar>

        <DataTable>
          <DataTableHeader>
            <DataTableHead>Quiz</DataTableHead>
            <DataTableHead>On</DataTableHead>
            <DataTableHead>Status</DataTableHead>
            <DataTableHead>Completed</DataTableHead>
            <DataTableHead>Started</DataTableHead>
          </DataTableHeader>
          <tbody>
            {items.map((entry) => (
              <DataTableRow key={entry.quizId}>
                <DataTableCell>
                  {entry.quiz ? (
                    <>
                      <Link
                        href={`/admin/funnels/quizzes/${entry.quizId}`}
                        className="font-medium text-primary underline-offset-2 hover:underline"
                      >
                        {entry.quiz.name}
                      </Link>
                      <span className="mt-0.5 block font-mono text-xs text-muted-foreground">{entry.quiz.key}</span>
                      {/* Same warning the quizzes list carries, for the same
                          reason: a seeded quiz's weights and cutoffs were
                          rebuilt from field metadata, not recovered. */}
                      {entry.quiz.seedMarker ? (
                        <DataTableBadge tone="warning" className="mt-1.5">
                          Unverified scoring
                        </DataTableBadge>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <span className="font-medium text-foreground">This quiz no longer exists</span>
                      <span className="mt-0.5 block font-mono text-xs text-muted-foreground">{entry.quizId}</span>
                    </>
                  )}
                </DataTableCell>
                <DataTableCell muted>{entry.stepName}</DataTableCell>
                <DataTableCell>
                  {entry.quiz ? (
                    <DataTableBadge tone={STATUS_TONE[entry.quiz.status] ?? "neutral"}>
                      {entry.quiz.status}
                    </DataTableBadge>
                  ) : (
                    <DataTableBadge tone="danger">missing</DataTableBadge>
                  )}
                </DataTableCell>
                <DataTableCell>{entry.attempts.completed}</DataTableCell>
                <DataTableCell>{entry.attempts.total}</DataTableCell>
              </DataTableRow>
            ))}
          </tbody>
        </DataTable>
      </DataTableCard>
    </div>
  )
}
```

- [ ] **Step 4: Run the component test**

Run: `npx vitest run __tests__/components/admin/funnel-quiz-panel.test.tsx`
Expected: 7 passed.

- [ ] **Step 5: Add the DAL read**

In `lib/db/quizzes.ts`, immediately after `listQuizzes` (which ends ~line 234):

```ts
/**
 * The quizzes named by a set of ids, for a screen that already knows WHICH
 * quizzes it needs — the funnel settings panel reads the ids out of the
 * funnel's own pages and asks for exactly those.
 *
 * An empty input asks nothing: PostgREST's `.in()` with an empty list is a
 * round trip that can only answer "none".
 *
 * A missing id is simply absent from the result, and the caller RENDERS that
 * absence — a block pointing at a deleted quiz is a real state and the person
 * who can fix it is the one looking at this screen.
 */
export async function getQuizzesByIds(ids: string[]): Promise<QuizListRow[]> {
  if (ids.length === 0) return []
  const { data, error } = await getClient()
    .from("quizzes")
    .select("id, key, name, status, seed_marker, updated_at")
    .eq("business_id", SINGLETON_BUSINESS_ID)
    .in("id", ids)
  if (error) throw error
  return ((data ?? []) as Row[]).map((row) => ({
    id: str(row.id),
    key: str(row.key),
    name: str(row.name),
    status: str(row.status),
    seedMarker: strOrNull(row.seed_marker),
    updatedAt: strOrNull(row.updated_at),
  }))
}
```

- [ ] **Step 6: Wire it into the funnel screen**

In `app/(admin)/admin/funnels/[id]/page.tsx`, add the imports:

```ts
import { getQuizAttemptCounts, getQuizzesByIds } from "@/lib/db/quizzes"
import { quizUsesInSteps } from "@/lib/funnels/quiz-refs"
import { FunnelQuizPanel, type FunnelQuizPanelItem } from "@/components/admin/funnels/FunnelQuizPanel"
```

After `const steps = await listSteps(id)`:

```ts
  // THE QUIZ THIS FUNNEL USES, read out of the pages it already loaded. Both
  // reads fail SOFT: a funnel's step list is the reason this screen exists,
  // and losing it because the quizzes table was unreachable would be trading
  // the whole screen for a panel.
  const quizUses = quizUsesInSteps(steps)
  const [quizRows, attemptCounts] = await Promise.all([
    quizUses.length > 0 ? getQuizzesByIds(quizUses.map((use) => use.quizId)).catch(() => []) : [],
    quizUses.length > 0
      ? getQuizAttemptCounts().catch(() => ({}) as Awaited<ReturnType<typeof getQuizAttemptCounts>>)
      : ({} as Awaited<ReturnType<typeof getQuizAttemptCounts>>),
  ])
  const quizItems: FunnelQuizPanelItem[] = quizUses.map((use) => ({
    quizId: use.quizId,
    stepName: use.stepName,
    quiz: quizRows.find((row) => row.id === use.quizId) ?? null,
    attempts: attemptCounts[use.quizId] ?? { total: 0, completed: 0 },
  }))
```

And render it immediately above `<StepList ... />`:

```tsx
      <FunnelQuizPanel items={quizItems} />
```

- [ ] **Step 7: Mutate the component tests**

| # | Mutation | Must kill |
|---|---|---|
| 1 | `href={\`/admin/funnels/quizzes/${entry.quizId}\`}` -> `href="/admin/funnels/quizzes"` | "links the quiz to its editor" |
| 2 | `if (items.length === 0) return null` -> `if (false) return null` | "renders nothing at all" |
| 3 | render the link branch even when `entry.quiz` is null (`{true ? (...)}`) | "no longer exists" |
| 4 | `{entry.attempts.completed}` -> `{entry.attempts.total}` in the Completed cell | "completions and starts as separate numbers" |
| 5 | drop the `seedMarker` badge block | "warns when the scoring was reconstructed" |
| 6 | `<DataTableCell muted>{entry.stepName}</DataTableCell>` -> `{entry.quizId}` | "names the step" |

- [ ] **Step 8: Typecheck and commit**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` -> must print `251`.

```bash
git add components/admin/funnels/FunnelQuizPanel.tsx __tests__/components/admin/funnel-quiz-panel.test.tsx \
        lib/db/quizzes.ts "app/(admin)/admin/funnels/[id]/page.tsx"
git commit -m "feat(funnels): a funnel's own screen shows the quiz it uses"
```

---

### Task 3: Demote the sidebar item, keep every quiz reachable

**Files:**
- Modify: `components/admin/admin-nav.ts` (both "Quizzes" entries, ~lines 86 and 111)
- Modify: `app/(admin)/admin/funnels/page.tsx` (the subtitle)
- Modify: `lib/funnels/sections/render.ts:875` (the builder note's wording)
- Modify: `__tests__/components/admin/admin-nav.test.ts`

**Interfaces:**
- Consumes: nothing. Produces: nothing new — this task only moves a door.

- [ ] **Step 1: Write the failing nav tests**

Add to `__tests__/components/admin/admin-nav.test.ts`:

```ts
  it("does NOT carry a top-level Quizzes item — a quiz is reached from its funnel", () => {
    // The quiz is a database entity a funnel's page points at by id. It now
    // appears on the funnel's own screen (FunnelQuizPanel), and the list of
    // every quiz hangs off the funnels board. A second door in the sidebar
    // made the quiz look like a sibling of Funnels rather than part of one.
    for (const contentStudioEnabled of [false, true]) {
      const nav = getAdminNav({ contentStudioEnabled })
      expect(getAllHrefs(nav)).not.toContain("/admin/funnels/quizzes")
    }
  })

  it("still carries Funnels, which is where a quiz is now reached from", () => {
    for (const contentStudioEnabled of [false, true]) {
      const nav = getAdminNav({ contentStudioEnabled })
      expect(getAllHrefs(nav)).toContain("/admin/funnels")
    }
  })
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run __tests__/components/admin/admin-nav.test.ts`
Expected: FAIL on the first new test — the href is still there.

- [ ] **Step 3: Remove both nav entries**

In `components/admin/admin-nav.ts`, delete BOTH copies of this block (they appear once per
`contentStudioEnabled` branch) — the comment goes with the line it explains:

```ts
        // Same defect class the two comments below name: the Athlete Quiz
        // screen was URL-only on its first pass. A quiz is a database entity
        // the funnel block points at by id, so it has no home under a funnel —
        // without this line the only way to reach it is to type the URL.
        { label: "Quizzes", href: "/admin/funnels/quizzes", icon: ListChecks },
```

Leave the `ListChecks` import only if another entry still uses it — if not, remove it from the
`lucide-react` import or `tsc` will not complain but the linter's unused-import rule would.
Check with `grep -n "ListChecks" components/admin/admin-nav.ts`.

- [ ] **Step 4: Give the quizzes list a door on the funnels board**

In `app/(admin)/admin/funnels/page.tsx`, replace the subtitle paragraph with:

```tsx
          <p className="mt-1 text-sm text-muted-foreground">
            Multi-step sequences sharing one address.{" "}
            <Link href="/admin/funnels/guide" className="underline underline-offset-2 hover:text-primary">
              How funnels work
            </Link>{" "}
            ·{" "}
            {/* A quiz is edited from the funnel that uses it — every funnel's
                own screen lists its quiz. This is the way to the ones no
                funnel uses yet, so that removing the sidebar item cannot
                leave a quiz reachable only by typing its URL. */}
            <Link href="/admin/funnels/quizzes" className="underline underline-offset-2 hover:text-primary">
              All quizzes
            </Link>
          </p>
```

- [ ] **Step 5: Update the builder's note about where a quiz is edited**

In `lib/funnels/sections/render.ts`, the `liveFeedNote` inside `renderQuizSection` (~line 872)
currently says "edit them under Quizzes in the admin". It renders only in the builder canvas
(`liveFeedNote` returns "" unless `ctx.editable`). Replace the string with:

```ts
      "The questions, scoring and result copy are pulled live from the quiz itself, so they " +
        "cannot be retyped here — open the quiz from this funnel's own screen. This section " +
        "chooses which quiz to show.",
```

Do NOT use a backtick or an em dash inside `SECTION_CSS`; this string is not in that file, but
keep the house convention anyway.

- [ ] **Step 6: Run the nav tests plus the funnels-board render**

Run: `npx vitest run __tests__/components/admin/admin-nav.test.ts`
Expected: all green, including the pre-existing duplicate-href and empty-section guards.

- [ ] **Step 7: Mutate**

| # | Mutation | Must kill |
|---|---|---|
| 1 | put `{ label: "Quizzes", href: "/admin/funnels/quizzes", icon: ListChecks }` back in the `contentStudioEnabled: true` branch only | "does NOT carry a top-level Quizzes item" (proves the test checks BOTH branches) |
| 2 | put it back in the `false` branch only | same test |
| 3 | delete the `{ label: "Funnels", href: "/admin/funnels" ... }` entry | "still carries Funnels" |

- [ ] **Step 8: Commit**

```bash
git add components/admin/admin-nav.ts "app/(admin)/admin/funnels/page.tsx" \
        lib/funnels/sections/render.ts __tests__/components/admin/admin-nav.test.ts
git commit -m "feat(admin): the quiz is reached from its funnel, not from the sidebar"
```

---

### Task 4: The visitor's answers as a readable payload (pure)

**Files:**
- Create: `lib/quizzes/answer-payload.ts`
- Test: `__tests__/lib/quizzes/answer-payload.test.ts`

**Interfaces:**
- Consumes: `QuizDefinition` from `lib/quizzes/types`.
- Produces: `export function quizAnswerPayload(definition: QuizDefinition, answers: { questionId: string; optionId: string }[]): Record<string, string>`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/quizzes/answer-payload.test.ts
//
// The leads inbox renders `funnel_submissions.payload` as a definition list of
// key -> value, and 00204's comment is explicit that payload is the VISITOR's
// answers verbatim. So a quiz completion's payload is what they were ASKED and
// what they PICKED — not the score, which is ours and lives on the attempt.
//
// No mocks: types only, like `scoreQuiz` and `quizGate`.
import { describe, expect, it } from "vitest"
import { quizAnswerPayload } from "@/lib/quizzes/answer-payload"
import type { QuizDefinition } from "@/lib/quizzes/types"

const QUIZ_ID = "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9"
const Q1 = "11111111-1111-4111-8111-111111111111"
const Q1_A = "11111111-1111-4111-8111-111111111112"
const Q2 = "22222222-2222-4222-8222-222222222221"
const Q2_A = "22222222-2222-4222-8222-222222222222"
const Q3 = "33333333-3333-4333-8333-333333333331"
const Q3_A = "33333333-3333-4333-8333-333333333332"

function question(id: string, position: number, prompt: string, optionId: string, label: string) {
  return {
    id,
    quizId: QUIZ_ID,
    branchId: null,
    position,
    prompt,
    helpText: null,
    isActive: true,
    options: [{ id: optionId, questionId: id, position: 1, label, weight: 1, routesToBranchId: null, profileId: null }],
  }
}

function definition(questions: ReturnType<typeof question>[]): QuizDefinition {
  return {
    id: QUIZ_ID, key: "rpi_athlete_quiz", name: "RPI", status: "active",
    introHeadline: "", introBody: "", gateHeadline: "", gateBody: "", resultHeadline: "",
    seedMarker: null, branches: [], profiles: [], tiers: [], questions,
  } as QuizDefinition
}

describe("quizAnswerPayload", () => {
  it("keys each answer by the question the visitor was asked", () => {
    const def = definition([question(Q1, 10, "How many sessions a week?", Q1_A, "Three or four")])
    expect(quizAnswerPayload(def, [{ questionId: Q1, optionId: Q1_A }])).toEqual({
      "How many sessions a week?": "Three or four",
    })
  })

  it("orders the entries by question position, not by answer order", () => {
    // A branching quiz's answers arrive in walk order, and the walk revisits
    // shared questions around the branch's own. The transcript should read
    // top to bottom the way the quiz did.
    const def = definition([
      question(Q1, 10, "First", Q1_A, "A"),
      question(Q2, 20, "Second", Q2_A, "B"),
      question(Q3, 30, "Third", Q3_A, "C"),
    ])
    const payload = quizAnswerPayload(def, [
      { questionId: Q3, optionId: Q3_A },
      { questionId: Q1, optionId: Q1_A },
      { questionId: Q2, optionId: Q2_A },
    ])
    expect(Object.keys(payload)).toEqual(["First", "Second", "Third"])
  })

  it("drops an answer whose question is not in the definition", () => {
    const def = definition([question(Q1, 10, "First", Q1_A, "A")])
    expect(quizAnswerPayload(def, [{ questionId: Q2, optionId: Q2_A }])).toEqual({})
  })

  it("drops an answer whose option does not belong to that question", () => {
    const def = definition([question(Q1, 10, "First", Q1_A, "A"), question(Q2, 20, "Second", Q2_A, "B")])
    expect(quizAnswerPayload(def, [{ questionId: Q1, optionId: Q2_A }])).toEqual({})
  })

  it("keeps both answers when two questions share a prompt", () => {
    // Two questions CAN carry the same words — the same question asked of two
    // archetypes is the obvious case. Collapsing them would silently drop one
    // of the visitor's answers from the record of what they said.
    const def = definition([question(Q1, 10, "Same words", Q1_A, "A"), question(Q2, 20, "Same words", Q2_A, "B")])
    const payload = quizAnswerPayload(def, [
      { questionId: Q1, optionId: Q1_A },
      { questionId: Q2, optionId: Q2_A },
    ])
    expect(Object.values(payload).sort()).toEqual(["A", "B"])
    expect(Object.keys(payload)).toHaveLength(2)
  })

  it("includes a question that has since been retired", () => {
    // They answered it. Hiding it because the owner later switched the
    // question off would rewrite the record of the conversation.
    const retired = { ...question(Q1, 10, "Retired one", Q1_A, "A"), isActive: false }
    expect(quizAnswerPayload(definition([retired]), [{ questionId: Q1, optionId: Q1_A }])).toEqual({
      "Retired one": "A",
    })
  })

  it("answers {} for no answers at all", () => {
    expect(quizAnswerPayload(definition([question(Q1, 10, "First", Q1_A, "A")]), [])).toEqual({})
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run __tests__/lib/quizzes/answer-payload.test.ts`
Expected: FAIL — cannot resolve `@/lib/quizzes/answer-payload`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/quizzes/answer-payload.ts — a completed quiz as a readable transcript.
//
// THIS MODULE IMPORTS NOTHING BUT TYPES, the same contract as
// `lib/quizzes/score.ts` and `lib/quizzes/gate.ts`.
//
// WHY THE SCORE IS NOT IN HERE. This becomes `funnel_submissions.payload`,
// which migration 00204 defines as "the VISITOR's answers, verbatim, as they
// typed them" — its comment goes on to say that mixing our own state in means
// the record of what someone said stops being a record of what someone said.
// The score, the tier and the archetype are OURS: they are on the attempt row,
// which the leads screen reads through `quiz_attempt_id`.

import type { QuizDefinition } from "@/lib/quizzes/types"

/**
 * `{ question prompt: chosen option label }`, in the order the quiz asks.
 *
 * TWO QUESTIONS MAY SHARE A PROMPT — the same words asked of two archetypes is
 * the ordinary case — and a bare `Record` would keep only the last of them.
 * A repeat is suffixed ` (2)`, which is visible in the inbox and lossless.
 *
 * An answer naming a question or an option this quiz does not have is dropped,
 * exactly as `sanitiseAnswers` drops it before scoring: the two must agree
 * about what was answered, or the transcript would show a line the score did
 * not count.
 */
export function quizAnswerPayload(
  definition: QuizDefinition,
  answers: { questionId: string; optionId: string }[],
): Record<string, string> {
  const chosen = new Map(answers.map((answer) => [answer.questionId, answer.optionId]))
  const payload: Record<string, string> = {}
  const used = new Map<string, number>()

  const ordered = definition.questions.slice().sort((a, b) => a.position - b.position)
  for (const question of ordered) {
    const optionId = chosen.get(question.id)
    if (!optionId) continue
    const option = question.options.find((candidate) => candidate.id === optionId)
    if (!option) continue

    const seen = (used.get(question.prompt) ?? 0) + 1
    used.set(question.prompt, seen)
    payload[seen === 1 ? question.prompt : `${question.prompt} (${seen})`] = option.label
  }

  return payload
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run __tests__/lib/quizzes/answer-payload.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Mutate**

| # | Mutation | Must kill |
|---|---|---|
| 1 | drop the `.sort((a, b) => a.position - b.position)` and iterate `definition.questions` in the given order, then reorder the fixture array so it differs from position order | "orders the entries by question position" (NOTE: the fixture must list questions out of position order for this to bite — if it does not, the test is not pinning what it claims. Fix the fixture, not the mutation.) |
| 2 | `const option = question.options.find(...)` -> `question.options[0]` | "drops an answer whose option does not belong" |
| 3 | drop the `used` map and always key on `question.prompt` | "keeps both answers when two questions share a prompt" |
| 4 | filter to `question.isActive` before the loop | "includes a question that has since been retired" |
| 5 | `if (!optionId) continue` -> `if (false) continue` | "answers {} for no answers at all" |

- [ ] **Step 6: Commit**

```bash
git add lib/quizzes/answer-payload.ts __tests__/lib/quizzes/answer-payload.test.ts
git commit -m "feat(quiz): a completed quiz as a readable transcript"
```

---

### Task 5: The two columns that make a submission honest about what it is

**Files:**
- Create: `supabase/migrations/00230_funnel_submissions_quiz.sql`
- Modify: `types/database.ts` (`FunnelSubmission`, ~line 3315)
- Modify: `lib/db/funnels.ts` (`CreateSubmissionInput` + `createSubmission`, ~lines 509-545)
- Modify: `lib/db/funnel-leads.ts` (`flatten`)
- Modify: `__tests__/components/admin/leads-board-columns.test.tsx` (fixture)
- Test: `__tests__/lib/db/funnel-submission-kind.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export type FunnelSubmissionKind = "form" | "quiz"`; `FunnelSubmission.kind`
  and `FunnelSubmission.quiz_attempt_id`; `CreateSubmissionInput.kind?` and
  `CreateSubmissionInput.quiz_attempt_id?`.

**BEFORE WRITING THE MIGRATION:** run `ls supabase/migrations | tail -3`. Three peer Claude
sessions share this repository and a migration number collides silently — git merges two
files claiming 00230 clean. If 00230 is taken, take the next free number and update every
reference in this task.

- [ ] **Step 1: Write the migration**

```sql
-- 00230_funnel_submissions_quiz.sql
--
-- A COMPLETED QUIZ IS A LEAD ON THE FUNNEL IT WAS TAKEN ON.
--
-- Until now it was not. A finished quiz wrote a contact, a consent row, a
-- timeline event and a pipeline card — but no `funnel_submissions` row, and
-- the Leads screen reads that table. Somebody who spent three minutes
-- answering thirty-two questions never appeared under the funnel that asked
-- them.
--
-- TWO COLUMNS, both additive, every existing row already correct.
--
-- WHY `kind` IS ITS OWN COLUMN AND NOT "quiz_attempt_id IS NOT NULL".
-- Reading a nullable pointer as a type discriminator makes "we could not link
-- the attempt" indistinguishable from "this was a form fill" — and the row
-- that would be mislabelled is exactly the one something already went wrong
-- for. `kind` is NOT NULL with a default, so it always answers.
--
-- WHY THE SCORE IS NOT COPIED HERE. It is on `quiz_attempts`, which is the row
-- this points at. Copying it would create a second answer to "what did they
-- score" that can drift from the first, and `payload` is defined by 00204 as
-- the visitor's own answers — see lib/quizzes/answer-payload.ts.

ALTER TABLE public.funnel_submissions
  ADD COLUMN IF NOT EXISTS kind            text NOT NULL DEFAULT 'form',
  -- ON DELETE SET NULL, matching quiz_attempts.contact_id: erasing an attempt
  -- must not erase the record that a lead came in.
  ADD COLUMN IF NOT EXISTS quiz_attempt_id uuid REFERENCES public.quiz_attempts(id) ON DELETE SET NULL;

-- A CHECK rather than an enum, the same call 00204 made for `status` and for
-- the same reason: this is a short list that gains a member far less often
-- than altering a Postgres enum costs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'funnel_submissions_kind_check'
  ) THEN
    ALTER TABLE public.funnel_submissions
      ADD CONSTRAINT funnel_submissions_kind_check
      CHECK (kind IN ('form', 'quiz'));
  END IF;
END $$;

-- ONE COMPLETION, ONE LEAD. The pipeline already dedupes on the attempt id
-- (SOURCE_EVENT_ID_KEYS reads `quiz_attempt_id`); without this a resubmitted
-- attempt would open no second card but WOULD file a second lead, and the two
-- surfaces would disagree about how many people took the quiz.
CREATE UNIQUE INDEX IF NOT EXISTS funnel_submissions_quiz_attempt_key
  ON public.funnel_submissions (quiz_attempt_id)
  WHERE quiz_attempt_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS funnel_submissions_kind_idx
  ON public.funnel_submissions (kind, created_at DESC);

COMMENT ON COLUMN public.funnel_submissions.kind IS
  'form = a form island capture; quiz = a completed quiz. Never set by the visitor.';
COMMENT ON COLUMN public.funnel_submissions.quiz_attempt_id IS
  'The attempt this lead completed. The score, tier and archetype live there, not here.';
```

- [ ] **Step 2: Apply it to dev**

The standing instruction in this repo is that migrations are applied to the dev copy
automatically. Run the repo's applier (`ls scripts | grep -i migrat` to find it) and confirm
00230 is recorded in `public.repo_migrations`. `CREATE POLICY` has no `IF NOT EXISTS`, but
this migration creates none, so a re-run is safe. Production applies itself on push to main
via `.github/workflows/apply-migrations.yml` — never by hand.

- [ ] **Step 3: Write the failing DAL test**

```ts
// __tests__/lib/db/funnel-submission-kind.test.ts
//
// TWO CLAIMS, and the second is the one that costs a lead if it is wrong.
//
// 1. A quiz completion is stored AS a quiz completion: `kind: 'quiz'` and the
//    attempt it came from.
// 2. Migrations and Vercel deploys race on merge to main, so for one deploy
//    production can run this code against the pre-00230 schema. PostgREST
//    answers an unknown column with PGRST204 and rejects the WHOLE insert —
//    which would mean the quiz lead is not merely unlabelled, it is GONE.
//    Losing the label is acceptable; losing the lead is not.
import { describe, it, expect, vi, beforeEach } from "vitest"

const inserted: Record<string, unknown>[] = []
let failNextWithUnknownColumn = false

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      insert: (payload: Record<string, unknown>) => {
        inserted.push(payload)
        const unknownColumn = failNextWithUnknownColumn
        failNextWithUnknownColumn = false
        return {
          select: () => ({
            single: async () =>
              unknownColumn
                ? { data: null, error: { code: "PGRST204", message: "Could not find the 'kind' column" } }
                : { data: { id: "sub-1", ...payload }, error: null },
          }),
        }
      },
    }),
  }),
}))

import { createSubmission } from "@/lib/db/funnels"

const BASE = {
  funnel_id: "11111111-1111-4111-8111-111111111111",
  step_id: "22222222-2222-4222-8222-222222222222",
  form_key: "rpi_athlete_quiz",
  payload: { "How many sessions?": "Three" },
}

beforeEach(() => {
  inserted.length = 0
  failNextWithUnknownColumn = false
})

describe("createSubmission", () => {
  it("stores a quiz completion as a quiz completion", async () => {
    await createSubmission({ ...BASE, kind: "quiz", quiz_attempt_id: "33333333-3333-4333-8333-333333333333" })
    expect(inserted[0].kind).toBe("quiz")
    expect(inserted[0].quiz_attempt_id).toBe("33333333-3333-4333-8333-333333333333")
  })

  it("defaults a caller that says nothing to a form fill", async () => {
    await createSubmission(BASE)
    expect(inserted[0].kind).toBe("form")
    expect(inserted[0].quiz_attempt_id).toBeNull()
  })

  it("keeps the lead when the columns do not exist yet, dropping only the label", async () => {
    failNextWithUnknownColumn = true
    const row = await createSubmission({ ...BASE, kind: "quiz", quiz_attempt_id: "33333333-3333-4333-8333-333333333333" })
    expect(inserted).toHaveLength(2)
    expect(Object.keys(inserted[1])).not.toContain("kind")
    expect(Object.keys(inserted[1])).not.toContain("quiz_attempt_id")
    // The visitor's answers and the funnel it happened on survive the retry —
    // a retry that dropped the payload would keep a row and lose the lead.
    expect(inserted[1].payload).toEqual(BASE.payload)
    expect(inserted[1].funnel_id).toBe(BASE.funnel_id)
    expect(row.id).toBe("sub-1")
  })

  it("does not retry an error that is not about a missing column", async () => {
    // A retry on a real failure — a broken FK, a violated CHECK — would send
    // the same doomed insert twice and report the second failure, hiding the
    // first. Only PGRST204 means "this column is not here yet".
    const boom = vi.fn()
    await createSubmission({ ...BASE, kind: "quiz" }).catch(boom)
    expect(inserted).toHaveLength(1)
  })
})
```

Note on the last test: with the mock above it succeeds rather than erroring, so make it fail
for a DIFFERENT reason. Add a second flag `failNextWithOtherError` to the mock, set it, expect
`createSubmission` to REJECT and `inserted` to have length 1.

- [ ] **Step 4: Run and watch it fail**

Run: `npx vitest run __tests__/lib/db/funnel-submission-kind.test.ts`
Expected: FAIL — `kind` is not a property of `CreateSubmissionInput`, and no retry exists.

- [ ] **Step 5: Add the type**

In `types/database.ts`, above `FunnelSubmission`:

```ts
/** What produced a submission (00230). `form` for every row that predates it. */
export type FunnelSubmissionKind = "form" | "quiz"

export const FUNNEL_SUBMISSION_KINDS: readonly FunnelSubmissionKind[] = ["form", "quiz"]
```

and inside `interface FunnelSubmission`, after `status_changed_at`:

```ts
  /** 00230. A quiz completion is a lead too, and reads differently in the inbox. */
  kind: FunnelSubmissionKind
  /** 00230. The completed attempt. The score lives THERE, never copied here. */
  quiz_attempt_id: string | null
```

- [ ] **Step 6: Teach `createSubmission` the columns and the race**

In `lib/db/funnels.ts`, extend the input:

```ts
export interface CreateSubmissionInput {
  // ... existing fields unchanged ...
  /** 00230. Omitted means a form fill, which is what every caller before it was. */
  kind?: FunnelSubmissionKind
  quiz_attempt_id?: string | null
}
```

and rewrite the body:

```ts
/** PostgREST's "column not in the schema cache". See the retry below. */
const POST_00230_COLUMNS = ["kind", "quiz_attempt_id"] as const

function isUnknownColumnError(error: { code?: string; message?: string }): boolean {
  if (error.code === "PGRST204") return true
  return POST_00230_COLUMNS.some((column) => (error.message ?? "").includes(`'${column}'`))
}

export async function createSubmission(input: CreateSubmissionInput): Promise<FunnelSubmission> {
  const supabase = getClient()
  const row = {
    funnel_id: input.funnel_id,
    step_id: input.step_id,
    form_key: input.form_key,
    email: input.email ?? null,
    name: input.name ?? null,
    phone: input.phone ?? null,
    payload: input.payload,
    attribution_session_id: input.attribution_session_id ?? null,
    ip_address: input.ip_address ?? null,
    user_agent: input.user_agent ?? null,
    lead_user_id: input.lead_user_id ?? null,
    kind: input.kind ?? "form",
    quiz_attempt_id: input.quiz_attempt_id ?? null,
  }

  const { data, error } = await supabase.from("funnel_submissions").insert(row).select("*").single()
  if (!error) return data as FunnelSubmission

  // MIGRATIONS AND DEPLOYS RACE ON MERGE TO MAIN. For one deploy this code can
  // be running against the pre-00230 schema, where PostgREST rejects the WHOLE
  // insert over the two columns it has never heard of. Losing the label on a
  // quiz lead is a cosmetic problem; losing the lead is not one, so the retry
  // drops only the new columns and keeps every answer.
  if (!isUnknownColumnError(error)) {
    // The code travels with the message: the house DAL convention throws a raw
    // PostgREST object, which the standard cron shell writes out as the string
    // "[object Object]" — and a caller that wants to tell a duplicate from a
    // real failure has nothing to read.
    throw Object.assign(new Error(`createSubmission: ${error.message}`), { code: error.code })
  }

  const legacy = { ...row } as Record<string, unknown>
  for (const column of POST_00230_COLUMNS) delete legacy[column]
  console.warn("[funnels] funnel_submissions is pre-00230; the lead was kept without its kind")

  const { data: retried, error: retryError } = await supabase
    .from("funnel_submissions")
    .insert(legacy)
    .select("*")
    .single()
  if (retryError) throw Object.assign(new Error(`createSubmission: ${retryError.message}`), { code: retryError.code })
  return retried as FunnelSubmission
}
```

Add `FunnelSubmissionKind` to the `types/database` import at the top of the file.

- [ ] **Step 7: Make the read tolerant too**

In `lib/db/funnel-leads.ts`, `flatten` currently spreads the row through. A row read from the
pre-00230 schema has no `kind` at all, and `FunnelSubmission.kind` is not optional, so normalise
it once, where every read passes:

```ts
function flatten(row: JoinedRow): FunnelLead {
  const { funnels, funnel_steps, ...submission } = row
  return {
    ...submission,
    // NORMALISED, not trusted. A row from before 00230 has no `kind` at all
    // and every one of them IS a form fill; a row with junk in the column
    // cannot have come from this app. Either way the answer is the honest one.
    kind: submission.kind === "quiz" ? "quiz" : "form",
    quiz_attempt_id: submission.quiz_attempt_id ?? null,
    funnel_name: funnels?.name ?? null,
    funnel_slug: funnels?.slug ?? null,
    step_name: funnel_steps?.name ?? null,
  }
}
```

- [ ] **Step 8: Fix the existing fixture**

`__tests__/components/admin/leads-board-columns.test.tsx`'s `lead()` factory will now fail to
typecheck. Add `kind: "form"` and `quiz_attempt_id: null` to it — BEFORE the `...over` spread,
so a test can still override them.

- [ ] **Step 9: Run both suites and mutate**

Run: `npx vitest run __tests__/lib/db/funnel-submission-kind.test.ts __tests__/lib/db/funnel-leads.test.ts __tests__/components/admin/leads-board-columns.test.tsx`

| # | Mutation | Must kill |
|---|---|---|
| 1 | `kind: input.kind ?? "form"` -> `kind: "form"` | "stores a quiz completion as a quiz completion" |
| 2 | `if (!isUnknownColumnError(error)) { throw ... }` -> always throw | "keeps the lead when the columns do not exist yet" |
| 3 | `if (!isUnknownColumnError(error))` -> `if (false)` | "does not retry an error that is not about a missing column" |
| 4 | in the retry, build `legacy` from `{}` instead of `{...row}` | the payload/funnel_id assertions in test 3 |
| 5 | `error.code === "PGRST204"` -> `false` (leaving only the message check) — then confirm the message-based fallback still catches it, and that a mutation deleting BOTH clauses kills test 3 | test 3 (proves neither clause alone is load-bearing by accident) |
| 6 | `flatten`'s `kind: submission.kind === "quiz" ? "quiz" : "form"` -> `kind: "quiz"` | a `funnel-leads` test — if none exists, ADD one asserting a row with no `kind` flattens to `form` |

- [ ] **Step 10: Typecheck and commit**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` -> `251`.

```bash
git add supabase/migrations/00230_funnel_submissions_quiz.sql types/database.ts lib/db/funnels.ts \
        lib/db/funnel-leads.ts __tests__/lib/db/funnel-submission-kind.test.ts \
        __tests__/components/admin/leads-board-columns.test.tsx
git commit -m "feat(leads): a submission says whether it was a form or a quiz"
```

---

### Task 6: The quiz submit route files the lead

**Files:**
- Modify: `app/api/quiz/submit/route.ts`
- Test: `__tests__/api/quiz-submit-funnel-lead.test.ts`

**Interfaces:**
- Consumes: `quizAnswerPayload` (Task 4), `createSubmission` with `kind`/`quiz_attempt_id`
  (Task 5).
- Produces: the route accepts `funnelId?: string (uuid)` and `stepId?: string (uuid)`.

- [ ] **Step 1: Write the failing route test**

```ts
// @vitest-environment node
//
// __tests__/api/quiz-submit-funnel-lead.test.ts
//
// A COMPLETED QUIZ IS A LEAD ON THE FUNNEL IT WAS TAKEN ON.
//
// Mirrors quiz-submit.test.ts: the pure modules run FOR REAL and only the
// writers are mocked, with the assertions on their ARGUMENTS. The claims that
// matter here are the ones that cost something when wrong — a lead filed
// against the wrong funnel, a lead filed for a quiz taken outside any funnel
// (`funnel_id` is NOT NULL, so there is no honest value), and the visitor's
// result being lost because our marketing plumbing failed.
import { describe, it, expect, beforeEach, vi } from "vitest"
import type { QuizDefinition } from "@/lib/quizzes/types"

const QUIZ_ID = "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9"
const ATTEMPT_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
const FUNNEL_ID = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb"
const STEP_ID = "dddddddd-1111-4111-8111-dddddddddddd"
const CONTACT_ID = "cccccccc-1111-4111-8111-cccccccccccc"
const Q_ROUTER = "11111111-1111-4111-8111-111111111111"
const O_TO_A = "11111111-1111-4111-8111-111111111112"
const Q_A1 = "22222222-2222-4222-8222-222222222221"
const O_BEST = "22222222-2222-4222-8222-222222222222"
const BRANCH_A = "44444444-4444-4444-8444-444444444441"

function definition(): QuizDefinition {
  return {
    id: QUIZ_ID, key: "rpi_athlete_quiz", name: "RPI", status: "active",
    introHeadline: "", introBody: "", gateHeadline: "", gateBody: "", resultHeadline: "Your readout",
    seedMarker: null,
    branches: [{ id: BRANCH_A, quizId: QUIZ_ID, key: "ceiling_breaker", name: "Ceiling Breaker", description: null, position: 1 }],
    profiles: [],
    tiers: [
      { id: "t1", quizId: QUIZ_ID, key: "red", position: 1, minScore: 0, maxScore: 49, headline: "Gaps", body: "Fixable.", ctaLabel: null, ctaHref: null },
      { id: "t2", quizId: QUIZ_ID, key: "green", position: 2, minScore: 50, maxScore: 100, headline: "Ready", body: "Precision.", ctaLabel: null, ctaHref: null },
    ],
    questions: [
      { id: Q_ROUTER, quizId: QUIZ_ID, branchId: null, position: 10, prompt: "Which describes you?", helpText: null, isActive: true,
        options: [{ id: O_TO_A, questionId: Q_ROUTER, position: 1, label: "Nearly there", weight: 0, routesToBranchId: BRANCH_A, profileId: null }] },
      { id: Q_A1, quizId: QUIZ_ID, branchId: BRANCH_A, position: 50, prompt: "How is training going?", helpText: null, isActive: true,
        options: [{ id: O_BEST, questionId: Q_A1, position: 1, label: "Great", weight: 4, routesToBranchId: null, profileId: null }] },
    ],
  }
}

const getQuizDefinition = vi.fn()
const getAttempt = vi.fn()
const completeAttempt = vi.fn()
const setAttemptAlert = vi.fn()
const recordContactEvent = vi.fn()
const recordConsent = vi.fn()
const getBusinessSettings = vi.fn()
const applyPipelineEvent = vi.fn()
const sendQuizAlert = vi.fn()
const createSubmission = vi.fn()
const recordAudit = vi.fn()

vi.mock("@/lib/db/quizzes", () => ({
  getQuizDefinition: (...a: unknown[]) => getQuizDefinition(...a),
  getAttempt: (...a: unknown[]) => getAttempt(...a),
  completeAttempt: (...a: unknown[]) => completeAttempt(...a),
  setAttemptAlert: (...a: unknown[]) => setAttemptAlert(...a),
}))
vi.mock("@/lib/db/funnels", () => ({ createSubmission: (...a: unknown[]) => createSubmission(...a) }))
vi.mock("@/lib/db/pipeline", () => ({ applyPipelineEvent: (...a: unknown[]) => applyPipelineEvent(...a) }))
vi.mock("@/lib/quizzes/alert", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/quizzes/alert")>()),
  sendQuizAlert: (...a: unknown[]) => sendQuizAlert(...a),
}))
vi.mock("@/lib/db/contacts", () => ({ recordContactEvent: (...a: unknown[]) => recordContactEvent(...a) }))
vi.mock("@/lib/db/contact-consents", () => ({ recordConsent: (...a: unknown[]) => recordConsent(...a) }))
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: (...a: unknown[]) => getBusinessSettings(...a) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...a) }))

const ANSWERS = [
  { questionId: Q_ROUTER, optionId: O_TO_A },
  { questionId: Q_A1, optionId: O_BEST },
]

let ipCounter = 0
const freshIp = () => `10.7.0.${++ipCounter % 200}`

async function post(extra: Record<string, unknown> = {}, ip = freshIp()) {
  const { POST } = await import("@/app/api/quiz/submit/route")
  return POST(
    new Request("https://www.darrenjpaul.com/api/quiz/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
        "user-agent": "vitest",
        cookie: "djp_attr=sess-abc123",
      },
      body: JSON.stringify({
        quizId: QUIZ_ID, attemptId: ATTEMPT_ID, answers: ANSWERS,
        name: "Sam Athlete", email: "sam@example.com", phone: "0400 000 000",
        elapsedMs: 90_000, funnelId: FUNNEL_ID, stepId: STEP_ID,
        ...extra,
      }),
    }),
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  getQuizDefinition.mockResolvedValue(definition())
  getAttempt.mockResolvedValue({ id: ATTEMPT_ID, quizId: QUIZ_ID, branchId: null, status: "in_progress", answers: [] })
  completeAttempt.mockResolvedValue(undefined)
  recordContactEvent.mockResolvedValue({ contactId: CONTACT_ID, created: true, merged: false })
  recordConsent.mockResolvedValue(undefined)
  getBusinessSettings.mockResolvedValue({ display_name: "DJP Athlete", reply_to: "darren@example.com" })
  setAttemptAlert.mockResolvedValue(undefined)
  applyPipelineEvent.mockResolvedValue({ decision: { kind: "noop", reason: "x" }, opportunityId: null })
  sendQuizAlert.mockResolvedValue({ delivered: true })
  createSubmission.mockResolvedValue({ id: "sub-1" })
})

describe("POST /api/quiz/submit — the funnel lead", () => {
  it("files the completion against the funnel and step it was taken on", async () => {
    await post()
    expect(createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ funnel_id: FUNNEL_ID, step_id: STEP_ID, kind: "quiz", quiz_attempt_id: ATTEMPT_ID }),
    )
  })

  it("carries the person, so the inbox can call them", async () => {
    await post()
    expect(createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Sam Athlete", email: "sam@example.com", phone: "0400 000 000" }),
    )
  })

  it("carries what they were asked and what they picked, not the score", async () => {
    await post()
    const arg = createSubmission.mock.calls[0][0] as { payload: Record<string, string> }
    expect(arg.payload).toEqual({ "Which describes you?": "Nearly there", "How is training going?": "Great" })
    expect(JSON.stringify(arg.payload)).not.toContain("score")
  })

  it("names the quiz in form_key, so the inbox can say which quiz it was", async () => {
    await post()
    expect(createSubmission).toHaveBeenCalledWith(expect.objectContaining({ form_key: "rpi_athlete_quiz" }))
  })

  it("writes NO submission when the quiz was not taken on a funnel", async () => {
    // funnel_submissions.funnel_id is NOT NULL. There is no honest value to
    // invent for a quiz embedded somewhere that is not a funnel page.
    await post({ funnelId: undefined, stepId: undefined })
    expect(createSubmission).not.toHaveBeenCalled()
  })

  it("writes NO submission when only half the pair arrives", async () => {
    await post({ stepId: undefined })
    expect(createSubmission).not.toHaveBeenCalled()
  })

  it("still returns the visitor's result when the lead write throws", async () => {
    // They answered thirty-two questions. A failure in our marketing plumbing
    // is not their problem — the whole handoff is non-fatal by design.
    createSubmission.mockRejectedValue(new Error("boom"))
    const res = await post()
    expect(res.status).toBe(200)
    expect((await res.json()).tier.key).toBe("green")
  })

  it("still records the contact when the lead write throws", async () => {
    // Each step inside the handoff is individually guarded: one failing must
    // not swallow the ones after it.
    createSubmission.mockRejectedValue(new Error("boom"))
    await post()
    expect(recordContactEvent).toHaveBeenCalled()
  })

  it("carries the attribution session from the cookie, joining the lead to first touch", async () => {
    await post()
    expect(createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ attribution_session_id: "sess-abc123" }),
    )
  })

  it("records the audit row the form path records", async () => {
    await post()
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "funnel.submission_received", category: "marketing" }),
    )
  })

  it("writes nothing when the honeypot is filled", async () => {
    await post({ website: "http://spam.example" })
    expect(createSubmission).not.toHaveBeenCalled()
    expect(completeAttempt).not.toHaveBeenCalled()
  })
})
```

Before writing the cookie assertion, confirm the cookie NAME `parseAttrCookie` reads —
`grep -n "export function parseAttrCookie" -A 12 lib/marketing/cookies.ts` — and use it.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run __tests__/api/quiz-submit-funnel-lead.test.ts`
Expected: FAIL — `createSubmission` is never called.

- [ ] **Step 3: Change the route**

In `app/api/quiz/submit/route.ts`:

Add imports:

```ts
import { createSubmission } from "@/lib/db/funnels"
import { quizAnswerPayload } from "@/lib/quizzes/answer-payload"
import { parseAttrCookie } from "@/lib/marketing/cookies"
import { recordAudit } from "@/lib/audit/record"
```

Extend the body schema — both optional, because a quiz island can stand on a page that is not
a funnel step:

```ts
  /**
   * WHERE THE QUIZ WAS TAKEN. `FunnelRenderContext` carries these to every
   * island; `QuizIsland` passes them to the runner and the runner posts them.
   * Optional because a quiz can be rendered outside a funnel — and because a
   * page published before this shipped posts neither.
   */
  funnelId: z.string().uuid().optional(),
  stepId: z.string().uuid().optional(),
```

Update the header comment's numbered list to insert the new step 3 and renumber the rest:

```
//   3. createSubmission — the lead on the funnel, so a completion appears
//      under that funnel's Leads beside its form fills
//   4. recordContactEvent — creates/merges the contact, writes the timeline
//      row, and calls enrollIfTriggered itself
//   5. recordConsent, if a tick was shown and ticked
//   6. pipeline + operator alert, both non-fatally
//   7. return the result
```

Then, as the FIRST block inside `handoff`, before `recordContactEvent`:

```ts
  // 3. THE LEAD ON THE FUNNEL.
  //
  // The Leads screen reads `funnel_submissions`, and until this existed a
  // finished quiz wrote a contact, a consent row, a timeline event and a
  // pipeline card but no submission — so somebody who answered every question
  // never appeared under the funnel that asked them.
  //
  // FIRST IN THE HANDOFF, and individually guarded like everything else here:
  // the lead is the thing this route exists to capture, and it should not be
  // lost because the contact spine or the mailer had a bad minute.
  //
  // NO FUNNEL, NO ROW. `funnel_submissions.funnel_id` is NOT NULL and there is
  // no honest value to invent for a quiz that was not taken on a funnel page.
  //
  // `lead_user_id` STAYS NULL. The form path mints a `users` row with
  // status 'lead'; the quiz feeds the newer contact spine through
  // `recordContactEvent` below. Minting a second identity from a second path
  // is a merge problem, not a feature.
  const sessionId = body.attributionSessionId ?? parseAttrCookie(request.headers.get("cookie")) ?? null
  if (body.funnelId && body.stepId) {
    try {
      await createSubmission({
        funnel_id: body.funnelId,
        step_id: body.stepId,
        // WHICH quiz, in the column that answers "which form". A quiz is the
        // form on that page as far as the inbox is concerned, and `kind` is
        // what says it was a quiz.
        form_key: definition.key,
        kind: "quiz",
        quiz_attempt_id: body.attemptId,
        name: body.name,
        email: body.email,
        phone: body.phone ?? null,
        payload: quizAnswerPayload(definition, input.answers),
        attribution_session_id: sessionId,
        ip: undefined,
      } as Parameters<typeof createSubmission>[0])
      recordAudit({
        action: "funnel.submission_received",
        category: "marketing",
        actor: { id: null, email: body.email, role: "anonymous" },
        metadata: { funnel_id: body.funnelId, form_key: definition.key, kind: "quiz" },
      })
    } catch (error) {
      // A duplicate is not a failure: the partial unique index on
      // `quiz_attempt_id` is what makes one completion one lead, and a
      // resubmitted attempt hitting it means the row is already there.
      if ((error as { code?: string }).code === "23505") {
        console.info("[quiz/submit] lead already recorded for this attempt", correlation)
      } else {
        logFailure("createSubmission", error, correlation)
      }
    }
  }
```

Remove the `ip: undefined` line and the `as Parameters<...>` cast above — they are scaffolding
notes, not code. The real call passes `ip_address: ip === "unknown" ? null : ip` and
`user_agent: request.headers.get("user-agent")`, matching what the form path stores.

Then replace the two later uses of `body.attributionSessionId ?? null` (in
`recordContactEvent`) with `sessionId`, so the contact and the lead agree about which visit
this was. Leave the rest of `handoff` alone.

- [ ] **Step 4: Run and confirm green**

Run: `npx vitest run __tests__/api/quiz-submit-funnel-lead.test.ts __tests__/api/quiz-submit.test.ts`
Expected: both files green. The pre-existing suite must stay green — it posts no
`funnelId`, which is exactly the "not on a funnel" path.

- [ ] **Step 5: Mutate**

| # | Mutation | Must kill |
|---|---|---|
| 1 | `if (body.funnelId && body.stepId)` -> `if (body.funnelId \|\| body.stepId)` | "writes NO submission when only half the pair arrives" |
| 2 | `if (body.funnelId && body.stepId)` -> `if (true)` (with `funnel_id: body.funnelId ?? ""`) | "writes NO submission when the quiz was not taken on a funnel" |
| 3 | `kind: "quiz"` -> `kind: "form"` | "files the completion against the funnel and step" |
| 4 | `quiz_attempt_id: body.attemptId` -> `quiz_attempt_id: null` | same test |
| 5 | `form_key: definition.key` -> `form_key: "quiz"` | "names the quiz in form_key" |
| 6 | `payload: quizAnswerPayload(...)` -> `payload: { score: result.score }` | "carries what they were asked and what they picked" |
| 7 | move the `createSubmission` block AFTER `recordContactEvent` and let it throw uncaught | "still records the contact when the lead write throws" (confirm by `git diff` that the block MOVED — this one is easy to fake with a comment edit) |
| 8 | drop the try/catch around `createSubmission` | "still returns the visitor's result when the lead write throws" |
| 9 | `attribution_session_id: sessionId` -> `null` | "carries the attribution session from the cookie" |
| 10 | delete the `recordAudit` call | "records the audit row the form path records" |

- [ ] **Step 6: Prove the preview path is untouched**

Run: `npx vitest run __tests__/app/api/quiz` and any test whose name mentions preview-submit.
Then read `app/api/quiz/preview-submit/route.ts` and confirm it is byte-identical to `main`:

```bash
git diff main -- app/api/quiz/preview-submit/route.ts   # must print nothing
```

- [ ] **Step 7: Typecheck and commit**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` -> `251`.

```bash
git add app/api/quiz/submit/route.ts __tests__/api/quiz-submit-funnel-lead.test.ts
git commit -m "feat(quiz): a completed quiz is a lead on the funnel it was taken on"
```

---

### Task 7: The island tells the runner where it is standing

**Files:**
- Modify: `components/funnels/islands/QuizIsland.tsx`
- Modify: `components/funnels/islands/QuizRunner.tsx`
- Test: `__tests__/components/funnels/quiz-runner-funnel.test.tsx` (create)

**Interfaces:**
- Consumes: `FunnelRenderContext` (`funnelId`, `stepId`, `isPreview`, `testRun`).
- Produces: `QuizRunnerProps` gains `funnelId?: string` and `stepId?: string`.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/funnels/quiz-runner-funnel.test.tsx
//
// THE CHAIN THIS PINS: FunnelRenderContext already carries funnelId/stepId to
// every island. QuizIsland never passed them on, so the submit body could not
// name the funnel and no lead could be filed against it.
//
// AND THE ONE THAT MUST NOT MOVE: /preview/<slug> sets `testRun`, whose whole
// promise is that it writes nothing. Its body is `{quizId, answers}` and the
// route it posts to accepts nothing else — adding the funnel to it would be a
// step towards a preview that files leads.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { QuizRunner } from "@/components/funnels/islands/QuizRunner"
import type { PublicQuizDefinition } from "@/lib/quizzes/public-definition"

const QUIZ_ID = "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9"
const FUNNEL_ID = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb"
const STEP_ID = "dddddddd-1111-4111-8111-dddddddddddd"
const Q1 = "11111111-1111-4111-8111-111111111111"
const O1 = "11111111-1111-4111-8111-111111111112"

const definition: PublicQuizDefinition = {
  id: QUIZ_ID,
  introHeadline: "Ready?", introBody: "", gateHeadline: "Nearly there", gateBody: "", resultHeadline: "Result",
  questions: [
    { id: Q1, branchId: null, position: 10, prompt: "Only question", helpText: null,
      options: [{ id: O1, position: 1, label: "Yes", routesToBranchId: null }] },
  ],
} as PublicQuizDefinition

const fetchMock = vi.fn()

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as { body: string }).body) as Record<string, unknown>
}

function callTo(path: string) {
  return fetchMock.mock.calls.find((call) => String(call[0]).includes(path))
}

/** Walk the quiz: intro -> the one question -> the details gate -> submit. */
async function complete(props: Record<string, unknown> = {}) {
  render(<QuizRunner definition={definition} submitLabel="See my result" {...props} />)
  fireEvent.click(screen.getByRole("button", { name: /start/i }))
  fireEvent.click(await screen.findByRole("button", { name: "Yes" }))
  fireEvent.change(await screen.findByLabelText(/your name/i), { target: { value: "Sam Athlete" } })
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "sam@example.com" } })
  fireEvent.click(screen.getByRole("button", { name: /see my result/i }))
  await waitFor(() => expect(callTo("/api/quiz/submit") ?? callTo("/api/quiz/preview-submit")).toBeTruthy())
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ score: 50, tier: null, profile: null, branch: null }) })
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe("QuizRunner on a funnel page", () => {
  it("posts the funnel and step it is standing on", async () => {
    await complete({ funnelId: FUNNEL_ID, stepId: STEP_ID })
    const body = bodyOf(callTo("/api/quiz/submit")!)
    expect(body.funnelId).toBe(FUNNEL_ID)
    expect(body.stepId).toBe(STEP_ID)
  })

  it("posts neither when it is not on a funnel page", async () => {
    await complete()
    const body = bodyOf(callTo("/api/quiz/submit")!)
    expect(body.funnelId).toBeUndefined()
    expect(body.stepId).toBeUndefined()
  })

  it("a TEST RUN still posts only the quiz and the answers", async () => {
    await complete({ funnelId: FUNNEL_ID, stepId: STEP_ID, isPreview: true, testRun: true })
    expect(callTo("/api/quiz/submit")).toBeUndefined()
    const body = bodyOf(callTo("/api/quiz/preview-submit")!)
    expect(Object.keys(body).sort()).toEqual(["answers", "quizId"])
  })
})
```

Check the intro button's real accessible name first (`grep -n "phase === \"intro\"" -A 20
components/funnels/islands/QuizRunner.tsx`) and use it verbatim — `getByText` matches the
DOM's own casing, never a CSS `text-transform`.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run __tests__/components/funnels/quiz-runner-funnel.test.tsx`
Expected: FAIL — `funnelId` is undefined in the live body (and TypeScript rejects the prop).

- [ ] **Step 3: Add the props to `QuizRunner`**

```ts
interface QuizRunnerProps {
  // ... existing ...
  /**
   * WHERE THIS QUIZ IS STANDING. `FunnelRenderContext` carries both to every
   * island; posting them is what lets a completion be filed as a lead on the
   * funnel that asked. Absent when the quiz is not on a funnel page, and the
   * route then writes no submission rather than inventing a funnel.
   */
  funnelId?: string
  stepId?: string
}
```

Destructure them, and add them to the LIVE branch of the submit body only:

```ts
            : {
                quizId: definition.id,
                attemptId,
                // THE TEST-RUN BRANCH ABOVE MUST NOT GAIN THESE. Its route
                // accepts `{quizId, answers}` and writes nothing at all; a
                // funnel id in that body is the first half of a preview that
                // files leads.
                funnelId,
                stepId,
                answers: ...,
```

- [ ] **Step 4: Pass them from the island**

In `components/funnels/islands/QuizIsland.tsx`, inside the `<QuizRunner ... />` call:

```tsx
      funnelId={context.funnelId}
      stepId={context.stepId}
```

with a comment above them:

```tsx
      // The context has carried these since the island registry existed and
      // this component simply never passed them on, which is why a finished
      // quiz could not become a lead on the funnel it was taken on.
```

- [ ] **Step 5: Run and mutate**

Run: `npx vitest run __tests__/components/funnels/quiz-runner-funnel.test.tsx`

| # | Mutation | Must kill |
|---|---|---|
| 1 | delete `funnelId` from the live body | "posts the funnel and step it is standing on" |
| 2 | delete `stepId` from the live body | same |
| 3 | add `funnelId` to the TEST-RUN branch of the body | "a TEST RUN still posts only the quiz and the answers" |
| 4 | in `QuizIsland`, pass `funnelId={context.funnelSlug}` | no unit test sees this — ADD an assertion to the island's own test if one exists, otherwise rely on Task 9's real-app check and say so in the report |

Mutation 4 is the honest one to record: if nothing kills it, write that down rather than
inventing a test that pins the mock.

- [ ] **Step 6: Typecheck and commit**

```bash
git add components/funnels/islands/QuizIsland.tsx components/funnels/islands/QuizRunner.tsx \
        __tests__/components/funnels/quiz-runner-funnel.test.tsx
git commit -m "feat(quiz): the quiz island tells the runner which funnel it is on"
```

---

### Task 8: The inbox reads a quiz completion as a quiz completion

**Files:**
- Modify: `lib/db/funnel-leads.ts` (add `getQuizOutcomesForLeads`)
- Modify: `app/(admin)/admin/funnels/leads/page.tsx`
- Modify: `components/admin/funnels/LeadsBoard.tsx`
- Modify: `lib/funnels/leads-csv.ts`
- Test: `__tests__/components/admin/leads-board-quiz.test.tsx` (create)
- Test: `__tests__/lib/funnels/leads-csv.test.ts` (extend)

**Interfaces:**
- Consumes: `FunnelLead.kind`, `FunnelLead.quiz_attempt_id` (Task 5).
- Produces: `export interface QuizLeadOutcome { score: number | null; tierKey: string | null; profileKey: string | null }`
  and `export async function getQuizOutcomesForLeads(attemptIds: string[]): Promise<Record<string, QuizLeadOutcome>>`;
  `LeadsBoardProps` gains `quizOutcomes?: Record<string, QuizLeadOutcome>`.

- [ ] **Step 1: Write the failing board test**

```tsx
// __tests__/components/admin/leads-board-quiz.test.tsx
//
// "Quiz completions should show there alongside form fills, distinguishable
// from them." Distinguishable means visible without opening the row, and
// readable once opened — a coach picking up the phone wants the archetype and
// the tier, not a JSON blob.
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { LeadsBoard } from "@/components/admin/funnels/LeadsBoard"
import type { FunnelLead } from "@/lib/db/funnel-leads"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

const ATTEMPT_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"

function lead(over: Partial<FunnelLead> = {}): FunnelLead {
  return {
    id: "lead-1", funnel_id: "f1", step_id: "s1", form_key: "optin",
    email: "sam@example.com", name: "Sam Athlete", phone: null,
    payload: { sport: "Soccer" }, attribution_session_id: null, ip_address: null,
    user_agent: null, lead_user_id: null, created_at: new Date().toISOString(),
    status: "new", notes: null, status_changed_at: null,
    kind: "form", quiz_attempt_id: null,
    funnel_name: "Athlete Quiz", funnel_slug: "athlete-quiz", step_name: "Quiz",
    ...over,
  }
}

const quizLead = (over: Partial<FunnelLead> = {}) =>
  lead({
    id: "lead-2", kind: "quiz", quiz_attempt_id: ATTEMPT_ID, form_key: "rpi_athlete_quiz",
    payload: { "How many sessions a week?": "Three or four" },
    ...over,
  })

function board(leads: FunnelLead[], quizOutcomes = {}) {
  return render(
    <LeadsBoard
      leads={leads}
      total={leads.length}
      counts={{ new: leads.length, contacted: 0, signed_up: 0 }}
      funnels={[{ id: "f1", name: "Athlete Quiz" }]}
      filters={{ funnelId: "", status: "", days: "", search: "" }}
      exportHref="/api/admin/funnels/leads/export"
      quizOutcomes={quizOutcomes}
    />,
  )
}

describe("LeadsBoard with quiz completions", () => {
  it("marks a quiz completion as one, in the row", () => {
    board([quizLead()])
    expect(screen.getByText("Quiz")).toBeTruthy()
  })

  it("does not mark a form fill as a quiz", () => {
    board([lead()])
    expect(screen.queryByText("Quiz")).toBeNull()
  })

  it("shows the result when the row is opened", () => {
    board([quizLead()], { [ATTEMPT_ID]: { score: 42, tierKey: "red", profileKey: "ceiling_breaker" } })
    fireEvent.click(screen.getByRole("button", { name: /Show Sam Athlete's answers/i }))
    expect(screen.getByText(/42/)).toBeTruthy()
    expect(screen.getByText(/red/i)).toBeTruthy()
    expect(screen.getByText(/Ceiling breaker/i)).toBeTruthy()
  })

  it("opens cleanly when the result could not be read", () => {
    // The outcome read fails soft on the page. A lead whose score is missing
    // must still show WHO they are and WHAT they answered — that is the part
    // somebody makes a phone call from.
    board([quizLead()], {})
    fireEvent.click(screen.getByRole("button", { name: /Show Sam Athlete's answers/i }))
    expect(screen.getByText("Three or four")).toBeTruthy()
  })

  it("still shows a quiz taker's answers under a heading that fits", () => {
    board([quizLead()], {})
    fireEvent.click(screen.getByRole("button", { name: /Show Sam Athlete's answers/i }))
    expect(screen.getByText(/what they answered/i)).toBeTruthy()
  })

  it("tells a first-time owner that quizzes land here too", () => {
    board([])
    expect(screen.getByText(/finishes a quiz/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run __tests__/components/admin/leads-board-quiz.test.tsx`
Expected: FAIL — no `quizOutcomes` prop, no badge.

- [ ] **Step 3: Add the outcome read**

In `lib/db/funnel-leads.ts`:

```ts
/** What a quiz lead scored. The keys are the quiz's own, not display copy. */
export interface QuizLeadOutcome {
  score: number | null
  tierKey: string | null
  profileKey: string | null
}

/**
 * The results behind a page of quiz leads, keyed by attempt id.
 *
 * A SECOND QUERY RATHER THAN AN EMBEDDED JOIN, deliberately. PostgREST rejects
 * an embed naming a column the schema does not have yet, and migrations race
 * deploys on merge to main — an embed would take the WHOLE leads screen down
 * for the deploy in which 00230 has not landed. A separate read has nothing to
 * fail on: no attempt ids, no query.
 *
 * The score is READ here and never copied into the submission, so there is one
 * answer to "what did they score" rather than two that can drift.
 */
export async function getQuizOutcomesForLeads(attemptIds: string[]): Promise<Record<string, QuizLeadOutcome>> {
  if (attemptIds.length === 0) return {}
  const supabase = getClient()
  const { data, error } = await supabase
    .from("quiz_attempts")
    .select("id, score, tier_key, profile_key")
    .in("id", attemptIds)
  if (error) throw new Error(`getQuizOutcomesForLeads: ${error.message}`)

  const out: Record<string, QuizLeadOutcome> = {}
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    out[String(row.id)] = {
      score: typeof row.score === "number" ? row.score : null,
      tierKey: typeof row.tier_key === "string" ? row.tier_key : null,
      profileKey: typeof row.profile_key === "string" ? row.profile_key : null,
    }
  }
  return out
}
```

- [ ] **Step 4: Read it on the leads page**

In `app/(admin)/admin/funnels/leads/page.tsx`, after the `Promise.all` that loads `leads`:

```ts
  // THE RESULTS BEHIND THE QUIZ LEADS ON THIS PAGE, and only them. Fails soft:
  // a lead whose score cannot be read is still a person to call, and taking
  // the inbox down over a missing number would be the wrong trade.
  const attemptIds = leads
    .map((lead) => lead.quiz_attempt_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0)
  const quizOutcomes = attemptIds.length > 0 ? await getQuizOutcomesForLeads(attemptIds).catch(() => ({})) : {}
```

Pass `quizOutcomes={quizOutcomes}` to `<LeadsBoard />`, and update the intro paragraph:

```tsx
            Everyone who filled in a form or finished a quiz on a{" "}
            <Link href="/admin/pages" className="underline underline-offset-2 hover:text-primary">
              landing page
            </Link>
            . They also appear under Contacts — the answers they gave are only here.
```

(The old sentence said "under Clients as leads". That is still true of form fills and NOT of
quiz completions, which feed the contact spine instead — see the decision list. "Contacts" is
the sentence that is true of both.)

- [ ] **Step 5: Change the board**

In `components/admin/funnels/LeadsBoard.tsx`:

- Import `DataTableBadge` from the data-table module and `QuizLeadOutcome` from the DAL.
- Add `quizOutcomes?: Record<string, QuizLeadOutcome>` to `LeadsBoardProps`.
- Thread it to `LeadRows` as `outcome={lead.quiz_attempt_id ? props.quizOutcomes?.[lead.quiz_attempt_id] : undefined}`.
- In the Page cell, after the step name:

```tsx
          {lead.kind === "quiz" ? (
            <DataTableBadge tone="info" className="mt-1">
              Quiz
            </DataTableBadge>
          ) : null}
```

- In the expanded panel, above the answers:

```tsx
                {lead.kind === "quiz" ? (
                  <p className="mb-2 text-sm text-foreground">
                    {outcome ? (
                      <>
                        Scored <strong className="font-semibold">{outcome.score ?? "—"}</strong>
                        {outcome.tierKey ? <> · {humanise(outcome.tierKey)}</> : null}
                        {outcome.profileKey ? <> · {humanise(outcome.profileKey)}</> : null}
                      </>
                    ) : (
                      // Honest about the gap rather than showing a zero.
                      <span className="text-muted-foreground">Their result could not be read.</span>
                    )}
                  </p>
                ) : null}
```

- Change the answers heading to `{lead.kind === "quiz" ? "What they answered" : "What they wrote"}`.
- Change the empty state to:
  `"No leads yet. They appear here the moment someone submits a form or finishes a quiz on a published page."`

- [ ] **Step 6: Add the CSV column**

In `lib/funnels/leads-csv.ts`, add `"Type"` to `COLUMNS` after `"Step"`, and the matching
value `lead.kind === "quiz" ? "Quiz" : "Form"` in the same position of the row array. Extend
`__tests__/lib/funnels/leads-csv.test.ts` with one test asserting the header carries `Type`
and that a quiz lead's row carries `Quiz` in that column. The score is NOT exported — say so
in a comment, because an export that showed it would need the second read the CSV route does
not do.

- [ ] **Step 7: Run and mutate**

Run: `npx vitest run __tests__/components/admin/leads-board-quiz.test.tsx __tests__/components/admin/leads-board-columns.test.tsx __tests__/lib/funnels/leads-csv.test.ts`

| # | Mutation | Must kill |
|---|---|---|
| 1 | `lead.kind === "quiz"` -> `true` on the badge | "does not mark a form fill as a quiz" |
| 2 | `lead.kind === "quiz"` -> `false` on the badge | "marks a quiz completion as one" |
| 3 | render the result line only when `outcome` is undefined (invert) | "shows the result when the row is opened" |
| 4 | `outcome ? ... : <span>could not be read</span>` -> always the outcome branch | "opens cleanly when the result could not be read" (it would throw or print `undefined`) |
| 5 | drop `humanise` from `profileKey` | "Ceiling breaker" assertion (it would read `ceiling_breaker`) |
| 6 | revert the empty-state copy | "tells a first-time owner that quizzes land here too" |
| 7 | `"Type"` header removed from `COLUMNS` but the value kept in the row | the new CSV test (proves it pins the pairing, not just the word) |

- [ ] **Step 8: Typecheck and commit**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` -> `251`.

```bash
git add lib/db/funnel-leads.ts "app/(admin)/admin/funnels/leads/page.tsx" \
        components/admin/funnels/LeadsBoard.tsx lib/funnels/leads-csv.ts \
        __tests__/components/admin/leads-board-quiz.test.tsx __tests__/lib/funnels/leads-csv.test.ts
git commit -m "feat(leads): a quiz completion reads as one in the inbox"
```

---

### Task 9: Drive the real app and prove it

**Files:**
- Create: `scripts/capture-quiz-in-funnel.ts` (modelled on `scripts/capture-quiz-funnel-creator.ts`)
- Create: `screenshots/quiz-in-funnel/*.png` + `index.html`

**This task asserts nothing in a mock. Every claim below is a claim about the running app.**

- [ ] **Step 1: Build, then start the dev server**

NEVER both at once — they share `.next`, and a screenshot taken during a build photographs a
stale bundle. Build first:

Run: `npm run build 2>&1 | tail -30` — must complete. Then `npm run dev` on a port that is NOT
3050 (a peer session owns 3050): `PORT=3051 npm run dev`.

- [ ] **Step 2: Copy the harness's two guards**

Read `scripts/capture-quiz-funnel-creator.ts` and copy, verbatim in spirit:
1. **It refuses any project that is not the dev copy.** Assert the Supabase URL matches the
   dev project ref before doing anything. Production has the quiz tables and NO quiz data, and
   this script signs in and completes a quiz.
2. **It asserts the funnel actually went live**, in the database, rather than trusting a click.
   The first run of that script produced a beautifully annotated 404.

Add a third, from the browser-harness lesson: **assert the session first.** An expired minted
JWT reports as a feature failure that mimics the scariest real bug here.

- [ ] **Step 3: Drive the real flow**

1. Sign in as admin.
2. Open `/admin/funnels/<the athlete quiz funnel id>` and screenshot the quiz panel. Assert the
   Edit link's href in the DOM, not by eye.
3. Click it, and assert the editor for that quiz loads (`/admin/funnels/quizzes/<id>`).
4. Assert the sidebar has NO "Quizzes" item, and that `/admin/funnels` has the "All quizzes"
   link — click it and land on the list.
5. In a fresh context, open `/go/athlete-quiz` and COMPLETE the quiz with a marked test
   identity (`quiz-lead-check+<timestamp>@example.com`). Answer for real; do not shortcut the
   walk. The route rejects a submission under 1500ms, so the harness must not race it.
6. Query the database for the `funnel_submissions` row: it must exist, with `kind = 'quiz'`,
   the right `funnel_id`, the right `step_id`, and a `quiz_attempt_id` naming the attempt.
   **Assert WHICH values, not that a row came back.**
7. Open `/admin/funnels/leads?funnelId=<id>` and screenshot the row with its Quiz badge, then
   the expanded row showing the result and the answers.
8. Open `/preview/athlete-quiz`, complete the quiz there, and assert `funnel_submissions`
   gained NOTHING — same count before and after. This is the test-run promise, and it is the
   one a mock cannot make.

- [ ] **Step 4: Annotate the screenshots**

Numbered markers and captions burned INTO the PNG, composed at the capture's exact pixel width
so nothing is upscaled. Deliver `screenshots/quiz-in-funnel/index.html` referencing sibling
images — never one file with everything base64-embedded.

- [ ] **Step 5: Clean up the test lead**

Delete the rows the capture created (submission, attempt, contact, consent, pipeline card) from
the DEV copy, or leave them and say so explicitly in the report. Do not leave a decision like
that unstated.

- [ ] **Step 6: Final gate**

- `npx tsc --noEmit 2>&1 | grep -c "error TS"` -> `251`
- `npm run build` (dev server STOPPED)
- Every suite this branch touched, in one targeted run.
- `git diff main --stat` — read it, and confirm no file belongs to a peer session's work.

- [ ] **Step 7: Journal + commit**

Add a dated `[Feature build-out]` entry to `JOURNAL.md` — what was built, what was decided,
and every mistake made with its lesson. **Do not stage `JOURNAL.md`.**

```bash
git add scripts/capture-quiz-in-funnel.ts screenshots/quiz-in-funnel
git commit -m "docs(quiz): the quiz reached from its funnel, and the lead it leaves behind"
```

---

## Self-review

**Spec coverage.** The brief has two requirements. (1) "The quiz is edited from its funnel, not
from a separate sidebar screen" -> Tasks 1, 2, 3. (2) "A completed quiz becomes a lead on that
funnel ... distinguishable from form fills" -> Tasks 4, 5, 6, 7, 8. The brief's traps: `testRun`
must not write (Task 6 step 6, Task 7 mutation 3, Task 9 step 3.8); published CSS is frozen (no
`styles.ts` change in this plan — nothing here needs a re-publish); Playwright clicks before
hydration (Task 9 asserts outcomes in the database); do not commit the peer session's work
(Global Constraints + Task 9 step 6).

**Placeholder scan.** Task 6 step 3 contains scaffolding (`ip: undefined`, a cast) that the step
itself instructs the implementer to remove — it is called out rather than left to be discovered.
Task 5 step 3's last test needs a second mock flag, which the step says in full. Task 7
mutation 4 has no killing test and the plan says to record that rather than fake one.

**Type consistency.** `QuizUse {quizId, stepId, stepName}` (Task 1) is what Task 2 maps over.
`FunnelQuizPanelItem.quiz: QuizListRow | null` matches `getQuizzesByIds`'s return element.
`quizAnswerPayload(definition, answers)` (Task 4) is called with `input.answers` in Task 6,
which is the `sanitiseAnswers` output the score was computed from — the transcript and the
score therefore describe the same set of answers. `FunnelSubmissionKind` (Task 5) is the type
of `CreateSubmissionInput.kind`, `FunnelSubmission.kind` and `FunnelLead.kind`, and the string
literal `"quiz"` in Tasks 6 and 8 is a member of it. `QuizLeadOutcome` (Task 8) is keyed by
`quiz_attempt_id`, which Task 6 writes as `body.attemptId` — the same id `completeAttempt`
completes.
