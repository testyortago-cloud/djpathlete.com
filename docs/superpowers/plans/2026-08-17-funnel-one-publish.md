# One Funnel Publish + Self-Drafting Steps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publishing from the funnel builder takes the whole funnel live in one click (with "this page only" still available), and steps 2..N draft themselves in the background instead of waiting to be clicked.

**Architecture:** A pure all-or-nothing planner (`lib/funnels/publish-plan.ts`) decides what a funnel-wide publish would write and why it would refuse; a new `POST /api/admin/funnels/[id]/publish` composes it with the existing resolver, gate and compiler and writes every version row before flipping the funnel row. On the client, the draft queue lives in `ConnectionsProvider` — mounted by the edit *layout*, so it survives navigating between steps — and drafts unbuilt steps one at a time off the back of step 1's first draft.

**Tech Stack:** Next.js 16 App Router, TypeScript, Zod 4, Supabase, Vitest + Testing Library, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-08-17-funnel-one-publish-design.md`

## Global Constraints

- **Targeted tests only.** `npx vitest run <path>` per suite. NEVER the full suite. A build (`npm run build`) is the separate "did I break compilation" gate.
- **`tsc --noEmit` baseline is 258 errors.** Introduce zero. Read the number before committing — do not chain the count to the commit with `&&`.
- **Every new test must be mutated before it counts.** Break the implementation in the specific way the test claims to catch, watch it fail, revert. Name the mutant in a comment. Running the mutation is what establishes the comment, not a formality confirming it.
- **`null` and `[]` are different answers** for a page list. `null` = "not checked", `[]` = "this funnel has no pages". Never `?? []`.
- **Publish paths fail CLOSED.** A read that throws refuses the publish; it never publishes anyway.
- **No hardcoded hex.** Semantic Tailwind classes (`text-muted-foreground`, `bg-surface`, `var(--warning)`) only.
- **Do not commit `JOURNAL.md`.** It is gitignored; never stage it.
- Existing uncommitted working-tree files (`.gitignore`, `scripts/ghl-export.mjs`) are unrelated — **never stage them.**

---

## File Structure

**Create:**
- `lib/funnels/publish-plan.ts` — the pure all-or-nothing planner. Leaf: imports only types.
- `lib/funnels/creation-prompt.ts` — `creationPrompt()`, moved out of the route file so the layout and the step page share one definition.
- `app/api/admin/funnels/[id]/publish/route.ts` — the funnel-wide publish.
- `__tests__/lib/funnels/publish-plan.test.ts`
- `__tests__/app/api/admin/funnels/funnel-publish-route.test.ts`
- `__tests__/components/admin/funnels/draft-queue.test.tsx`
- `__tests__/components/admin/funnel-publish-all.test.tsx`

**Modify:**
- `app/(admin)/admin/funnels/[id]/edit/[stepId]/page.tsx` — import `creationPrompt` instead of declaring it.
- `app/(admin)/admin/funnels/[id]/edit/layout.tsx` — pass per-step draft jobs to the provider.
- `components/admin/funnels/connections-context.tsx` — the draft queue.
- `components/admin/funnels/FunnelBuilder.tsx` — split publish control, funnel-wide publish, per-page refusal, initial-prompt guard, `startAutoDraft` trigger.
- `components/admin/funnels/StepRail.tsx` — per-page draft status.
- `components/admin/funnels/FunnelStatusControl.tsx` — publish through the new route.
- `__tests__/app/funnel-creation-prompt.test.ts` — import from the new module.

---

## Task 1: The pure publish planner

**Files:**
- Create: `lib/funnels/publish-plan.ts`
- Test: `__tests__/lib/funnels/publish-plan.test.ts`

**Interfaces:**
- Consumes: `SectionDoc` (type only) from `@/lib/funnels/sections/registry`.
- Produces:
  ```ts
  export interface StepToPublish { id: string; name: string; position: number; doc: SectionDoc | null; hasPublishedVersion: boolean }
  export interface PagePublishProblem { stepId: string; stepName: string; problems: string[]; blank: boolean }
  export interface FunnelPublishPlan { ok: boolean; publish: { stepId: string; stepName: string; doc: SectionDoc }[]; problems: PagePublishProblem[] }
  export function funnelPublishPlan(steps: StepToPublish[], gate: (doc: SectionDoc) => { ok: boolean; blockers: string[] }): FunnelPublishPlan
  ```

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/funnels/publish-plan.test.ts`:

```ts
// __tests__/lib/funnels/publish-plan.test.ts
//
// EVERY TEST NAMES THE MUTANT IT KILLS. Zero mocks: the planner is a leaf that
// takes its gate as a parameter precisely so its decisions can be driven
// directly rather than through a catalogue.

import { describe, it, expect } from "vitest"
import { funnelPublishPlan, type StepToPublish } from "@/lib/funnels/publish-plan"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

const DOC = { v: 1, engine: "sections", theme: { tone: "light", accent: "accent", radius: "soft" }, sections: [] } as unknown as SectionDoc

function step(overrides: Partial<StepToPublish> = {}): StepToPublish {
  return { id: "s1", name: "Signup", position: 0, doc: DOC, hasPublishedVersion: false, ...overrides }
}

/** Everything publishes. */
const CLEAN = () => ({ ok: true, blockers: [] })

describe("funnelPublishPlan", () => {
  it("publishes every step that has a document", () => {
    const plan = funnelPublishPlan(
      [step({ id: "a", position: 0 }), step({ id: "b", name: "Thanks", position: 1 })],
      CLEAN,
    )
    expect(plan.ok).toBe(true)
    expect(plan.problems).toEqual([])
    // MUTANT: returning only the first step. Asserting a COUNT would let a
    // planner that publishes one page pass if it also invented a second entry,
    // so the ids themselves are the assertion.
    expect(plan.publish.map((entry) => entry.stepId)).toEqual(["a", "b"])
  })

  it("orders the publish list by position, not by input order", () => {
    const plan = funnelPublishPlan(
      [step({ id: "late", position: 2 }), step({ id: "first", position: 0 }), step({ id: "mid", position: 1 })],
      CLEAN,
    )
    // MUTANT: dropping the sort. The entry page must be written first.
    expect(plan.publish.map((entry) => entry.stepId)).toEqual(["first", "mid", "late"])
  })

  it("REFUSES when a step has never been built", () => {
    const plan = funnelPublishPlan(
      [step({ id: "a" }), step({ id: "b", name: "Checkout", doc: null, hasPublishedVersion: false })],
      CLEAN,
    )
    // MUTANT: treating a blank page as publishable (skip-and-continue). This is
    // the all-or-nothing decision the owner made, and the whole reason the
    // route exists — so `ok` AND `publish` are both asserted: a planner that
    // reports the problem and still hands back page "a" to write would ship a
    // live funnel with a dead end in it.
    expect(plan.ok).toBe(false)
    expect(plan.publish).toEqual([])
    expect(plan.problems).toEqual([
      { stepId: "b", stepName: "Checkout", problems: ["Checkout has no content yet."], blank: true },
    ])
  })

  it("does NOT refuse a legacy step that has no document but is already published", () => {
    const plan = funnelPublishPlan(
      [step({ id: "a" }), step({ id: "legacy", name: "Old page", doc: null, hasPublishedVersion: true })],
      CLEAN,
    )
    // MUTANT: `if (!step.doc) problem(...)` without the published-version arm.
    // A GrapesJS step predating the section editor has no SectionDoc and is
    // serving something real; refusing it freezes out every funnel older than
    // migration 00203.
    expect(plan.ok).toBe(true)
    expect(plan.problems).toEqual([])
    // ...and it is not republished either — there is no document to render.
    expect(plan.publish.map((entry) => entry.stepId)).toEqual(["a"])
  })

  it("carries a blocked page's blockers under that page's own name", () => {
    const gate = (doc: SectionDoc) =>
      doc === DOC ? { ok: false, blockers: ["A button points at a program that no longer exists."] } : { ok: true, blockers: [] }
    const plan = funnelPublishPlan([step({ id: "b", name: "Offer" })], gate)
    // MUTANT: flattening every page's blockers into one list. The owner has to
    // know WHICH page to open, and a bare blocker string does not say.
    expect(plan.problems).toEqual([
      {
        stepId: "b",
        stepName: "Offer",
        problems: ["A button points at a program that no longer exists."],
        blank: false,
      },
    ])
    expect(plan.ok).toBe(false)
  })

  it("reports every bad page, not just the first", () => {
    const plan = funnelPublishPlan(
      [step({ id: "a", name: "One", doc: null }), step({ id: "b", name: "Two", doc: null, position: 1 })],
      CLEAN,
    )
    // MUTANT: an early `return` on the first problem. Being sent back twice to
    // fix one page at a time is the friction this feature exists to remove.
    expect(plan.problems.map((problem) => problem.stepId)).toEqual(["a", "b"])
  })

  it("is ok on a funnel with no steps at all", () => {
    // Not a problem to report and nothing to write. The route still refuses it
    // (see Task 2) — but that is the ROUTE's rule about funnels, not the
    // planner's about pages, and putting it here would make `problems` mean two
    // different things.
    expect(funnelPublishPlan([], CLEAN)).toEqual({ ok: true, publish: [], problems: [] })
  })

  it("lets a throwing gate escape", () => {
    const boom = () => { throw new Error("catalogue truncated") }
    // MUTANT: a try/catch per step that degrades to `{ok:true}`. `resolveDoc`
    // throws deliberately so a caller cannot accidentally unblock publish;
    // swallowing it here is the exact fail-open the gate exists to prevent.
    expect(() => funnelPublishPlan([step()], boom)).toThrow("catalogue truncated")
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run __tests__/lib/funnels/publish-plan.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/funnels/publish-plan"`.

- [ ] **Step 3: Write the implementation**

Create `lib/funnels/publish-plan.ts`:

```ts
// lib/funnels/publish-plan.ts — what a funnel-wide publish would write, and
// why it would refuse.
//
// ---------------------------------------------------------------------------
// A LEAF, ON PURPOSE. It imports one TYPE and nothing else.
// ---------------------------------------------------------------------------
// The gate arrives as a parameter rather than being imported, because the real
// one (`publishGate(resolveDoc(doc, await loadCatalogues(), pages))`) needs
// three database reads. Injecting it keeps every decision below testable with
// no mocks at all, and keeps this module out of any bundle that would drag the
// DAL along behind it.
//
// ---------------------------------------------------------------------------
// ALL OR NOTHING, AND THAT IS THE OWNER'S DECISION RATHER THAN A DEFAULT.
// ---------------------------------------------------------------------------
// Asked what should happen when one page of a funnel is not ready, he chose:
// refuse the whole publish and name the pages. The alternative — publish the
// good pages and skip the rest — puts a funnel live with a 404 in the middle
// of it, which is the failure this whole feature exists to stop. So `publish`
// is EMPTY whenever `ok` is false: a caller cannot half-honour the plan even
// by ignoring the flag.

import type { SectionDoc } from "@/lib/funnels/sections/registry"

/** One step, as the planner needs it. */
export interface StepToPublish {
  id: string
  name: string
  position: number
  /** The stored draft, already parsed. `null` = not a section document. */
  doc: SectionDoc | null
  /** Already serving a compiled version row. */
  hasPublishedVersion: boolean
}

export interface PagePublishProblem {
  stepId: string
  stepName: string
  problems: string[]
  /**
   * The page was never built — as opposed to built and blocked.
   *
   * The UI branches on this to offer "Generate it now", which is a real fix
   * for a blank page and nonsense for a dead CTA. Derived here rather than by
   * the UI matching on the message text, because a message the UI parses is a
   * message nobody can reword.
   */
  blank: boolean
}

export interface FunnelPublishPlan {
  /** True iff every page can be published. */
  ok: boolean
  /** Steps to write a version row for, in position order. EMPTY unless `ok`. */
  publish: { stepId: string; stepName: string; doc: SectionDoc }[]
  /** Why the funnel cannot be published. Empty exactly when `ok`. */
  problems: PagePublishProblem[]
}

/**
 * Plans a funnel-wide publish.
 *
 * `gate` is allowed to THROW and is deliberately not caught. `resolveDoc`
 * throws on a document that no longer satisfies `sectionDocSchema`, and it
 * throws so that a caller cannot accidentally unblock publishing by swallowing
 * the failure into an empty `unresolved` list. Catching it per step and
 * reporting "no blockers" would be exactly that fail-open. The route's own
 * try/catch turns it into a 422 that names the reason.
 */
export function funnelPublishPlan(
  steps: StepToPublish[],
  gate: (doc: SectionDoc) => { ok: boolean; blockers: string[] },
): FunnelPublishPlan {
  // POSITION ORDER, not input order. The entry page is written first, so a
  // write that dies half way leaves the funnel more coherent rather than less.
  const ordered = [...steps].sort((a, b) => a.position - b.position)

  const publish: FunnelPublishPlan["publish"] = []
  const problems: PagePublishProblem[] = []

  for (const step of ordered) {
    if (!step.doc) {
      // A legacy GrapesJS step: no `SectionDoc`, but a real compiled version
      // already live. There is nothing to render it from and nothing wrong
      // with it. Left alone — neither published nor a problem.
      if (step.hasPublishedVersion) continue
      problems.push({
        stepId: step.id,
        stepName: step.name,
        problems: [`${step.name} has no content yet.`],
        blank: true,
      })
      continue
    }

    const verdict = gate(step.doc)
    if (!verdict.ok) {
      problems.push({ stepId: step.id, stepName: step.name, problems: verdict.blockers, blank: false })
      continue
    }
    publish.push({ stepId: step.id, stepName: step.name, doc: step.doc })
  }

  // EVERY page is inspected before this line — the loop above never returns
  // early. Being sent back to fix one page, then told about the next, is the
  // friction this feature exists to remove.
  const ok = problems.length === 0
  // `publish` is emptied rather than returned alongside the problems, so a
  // caller that forgets to check `ok` writes nothing instead of writing half a
  // funnel. The flag and the payload cannot disagree.
  return { ok, publish: ok ? publish : [], problems }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run __tests__/lib/funnels/publish-plan.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Mutate each test**

For each test, apply the named mutant to `lib/funnels/publish-plan.ts`, run the suite, confirm **that** test fails, revert. Specifically:
1. `return { ok, publish, problems }` (drop the `ok ?` guard) → the blank-step test must fail on `publish`.
2. Remove `[...steps].sort(...)` → the ordering test must fail.
3. Remove `if (step.hasPublishedVersion) continue` → the legacy test must fail.
4. `continue` → `break` in the blank arm → the "every bad page" test must fail.
5. Wrap `gate(step.doc)` in `try { } catch { verdict = {ok:true,blockers:[]} }` → the throwing-gate test must fail.

If a mutant does NOT fail its test, the comment is wrong — fix the test, not the comment.

- [ ] **Step 6: Verify types and commit**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` — read the number, confirm it is 258.

```bash
git add lib/funnels/publish-plan.ts __tests__/lib/funnels/publish-plan.test.ts
git commit -m "feat(funnels): a pure planner for publishing a whole funnel at once"
```

---

## Task 2: The funnel-wide publish route

**Files:**
- Create: `app/api/admin/funnels/[id]/publish/route.ts`
- Test: `__tests__/app/api/admin/funnels/funnel-publish-route.test.ts`

**Interfaces:**
- Consumes: `funnelPublishPlan`, `StepToPublish` (Task 1); `getFunnelById`, `listSteps`, `publishStep`, `updateFunnel` from `@/lib/db/funnels`; `getDraft` from `@/lib/db/funnel-builder`; `loadCatalogues`, `resolveDoc`, `publishGate` from `@/lib/funnels/sections/resolve`; `reassemble` from `@/lib/funnels/sections/doc`.
- Produces: `POST /api/admin/funnels/[id]/publish`.
  - 200 `{ published: number; pages: { stepId: string; stepName: string; version: number }[]; warnings: string[] }`
  - 422 `{ error: string; pages: PagePublishProblem[] }`
  - 400 `{ error }` (funnel has no pages), 403, 404, 500.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/app/api/admin/funnels/funnel-publish-route.test.ts`. Mirror the mocking style of `__tests__/app/api/admin/funnels/publish-route.test.ts` — real `resolveDoc` / `publishGate` / `loadCatalogues` over mocked DAL reads:

```ts
// __tests__/app/api/admin/funnels/funnel-publish-route.test.ts
//
// THE DEFECT THIS FILE EXISTS FOR: taking a funnel live used to be
// `PATCH /api/admin/funnels/[id]` with `{status:"published"}`, which validates
// the body and writes. It never looked at the steps — so a funnel whose second
// page had never been built went live with a 404 behind its own button, and
// nothing anywhere said so.
//
// EVERY TEST NAMES THE MUTANT IT KILLS.
//
// NOT MOCKED: `resolveDoc`, `publishGate` and `loadCatalogues` run for real
// over mocked DAL reads. Mocking the resolver would replace the machinery the
// gate is made of with a restatement of what it is assumed to do.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/funnels", () => ({
  getFunnelById: vi.fn(),
  listSteps: vi.fn(),
  publishStep: vi.fn(),
  updateFunnel: vi.fn(),
}))
vi.mock("@/lib/db/funnel-builder", () => ({ getDraft: vi.fn() }))
vi.mock("@/lib/db/programs", () => ({ getPrograms: vi.fn(), getAllPrograms: vi.fn() }))
vi.mock("@/lib/db/session-pack-products", () => ({ listActiveProducts: vi.fn(), listAllProducts: vi.fn() }))
vi.mock("@/lib/db/events", () => ({ getEvents: vi.fn(), getPublishedEvents: vi.fn() }))
vi.mock("@/lib/db/faqs", () => ({ getFaqCountsByPage: vi.fn() }))

import { POST } from "@/app/api/admin/funnels/[id]/publish/route"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { getFunnelById, listSteps, publishStep, updateFunnel } from "@/lib/db/funnels"
import { getDraft } from "@/lib/db/funnel-builder"
import { getAllPrograms, getPrograms } from "@/lib/db/programs"
import { listActiveProducts, listAllProducts } from "@/lib/db/session-pack-products"
import { getEvents, getPublishedEvents } from "@/lib/db/events"
import { getFaqCountsByPage } from "@/lib/db/faqs"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const FUNNEL_ID = "ffffffff-1111-4222-8333-444444444444"
const ADMIN_ID = "aaaaaaaa-1111-4222-8333-444444444444"
const PROGRAM_ID = "11111111-2222-4333-8444-555555555555"
const PROGRAM_NAME = "Comeback Code"
const DEAD_REF = "Winter Throwing Intensive"

const FUNNEL = { id: FUNNEL_ID, slug: "free-trial-week", name: "Free Trial Week", kind: "funnel", status: "draft" }

/** A one-hero page whose only CTA points at `ref`. */
function docWithCta(ref: string): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [
      {
        id: "hero",
        kind: "hero",
        variant: "centered",
        style: { headline: "lg", align: "center" },
        props: {
          headline: "Rotational power in eight weeks",
          sub: "Eight weeks of programming built from your numbers.",
          cta: { label: "Join", target: { kind: "program", ref } },
        },
      },
    ],
  } as unknown as SectionDoc
}

function stepRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    funnel_id: FUNNEL_ID,
    name: "Signup",
    slug: "index",
    position: 0,
    is_entry: true,
    published_version_id: null,
    ...overrides,
  }
}

function request() {
  return new Request(`http://localhost/api/admin/funnels/${FUNNEL_ID}/publish`, { method: "POST" })
}
const ctx = { params: Promise.resolve({ id: FUNNEL_ID }) }

beforeEach(() => {
  vi.clearAllMocks()
  mock(auth).mockResolvedValue({ user: { id: ADMIN_ID, role: "admin" } })
  mock(canAccessAdminPath).mockResolvedValue(true)
  mock(getFunnelById).mockResolvedValue(FUNNEL)
  mock(publishStep).mockImplementation(async ({ stepId }: { stepId: string }) => ({
    ok: true,
    version: { id: `v-${stepId}`, version: 1 },
    warnings: [],
  }))
  mock(updateFunnel).mockResolvedValue({ ...FUNNEL, status: "published" })
  // The catalogue reads the REAL `loadCatalogues` makes.
  mock(getPrograms).mockResolvedValue([{ id: PROGRAM_ID, name: PROGRAM_NAME, slug: "comeback-code" }])
  mock(getAllPrograms).mockResolvedValue([{ id: PROGRAM_ID, name: PROGRAM_NAME, slug: "comeback-code" }])
  mock(listActiveProducts).mockResolvedValue([])
  mock(listAllProducts).mockResolvedValue([])
  mock(getEvents).mockResolvedValue([])
  mock(getPublishedEvents).mockResolvedValue([])
  mock(getFaqCountsByPage).mockResolvedValue({})
})

describe("POST /api/admin/funnels/[id]/publish", () => {
  it("publishes every page AND takes the funnel live", async () => {
    mock(listSteps).mockResolvedValue([stepRow(), stepRow({ id: "s2", name: "Thank you", slug: "thank-you", position: 1, is_entry: false })])
    mock(getDraft).mockResolvedValue({ doc: docWithCta(PROGRAM_NAME), docInvalid: false, revision: 1 })

    const response = await POST(request(), ctx)
    expect(response.status).toBe(200)
    // MUTANT: publishing only the entry step. The ids are asserted, not the
    // count — a route that writes one page twice would pass a count check.
    expect(mock(publishStep).mock.calls.map((call) => call[0].stepId)).toEqual(["s1", "s2"])
    expect(mock(updateFunnel)).toHaveBeenCalledWith(FUNNEL_ID, { status: "published" })
  })

  it("REFUSES when a page has never been built, and writes NOTHING", async () => {
    mock(listSteps).mockResolvedValue([stepRow(), stepRow({ id: "s2", name: "Thank you", slug: "thank-you", position: 1, is_entry: false })])
    mock(getDraft).mockImplementation(async (stepId: string) =>
      stepId === "s1"
        ? { doc: docWithCta(PROGRAM_NAME), docInvalid: false, revision: 1 }
        : { doc: null, docInvalid: false, revision: 0 },
    )

    const response = await POST(request(), ctx)
    const body = await response.json()
    expect(response.status).toBe(422)
    expect(body.pages).toEqual([
      { stepId: "s2", stepName: "Thank you", problems: ["Thank you has no content yet."], blank: true },
    ])
    // THREE SEPARATE ASSERTIONS, because "nothing was written" is the claim and
    // a test that only checks the status code cannot see a partial write.
    // MUTANT: writing `plan.publish` before checking `plan.ok`.
    expect(mock(publishStep)).not.toHaveBeenCalled()
    // MUTANT: flipping the funnel row anyway — which is the exact defect that
    // `PATCH {status}` has today and this route exists to replace.
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })

  it("REFUSES on an unresolved CTA and names the page it is on", async () => {
    mock(listSteps).mockResolvedValue([stepRow(), stepRow({ id: "s2", name: "Offer", slug: "offer", position: 1, is_entry: false })])
    mock(getDraft).mockImplementation(async (stepId: string) => ({
      doc: docWithCta(stepId === "s2" ? DEAD_REF : PROGRAM_NAME),
      docInvalid: false,
      revision: 1,
    }))

    const response = await POST(request(), ctx)
    const body = await response.json()
    expect(response.status).toBe(422)
    // MUTANT: gating only the entry step, or flattening blockers so the owner
    // is told what is wrong but not where.
    expect(body.pages).toHaveLength(1)
    expect(body.pages[0].stepId).toBe("s2")
    expect(body.pages[0].stepName).toBe("Offer")
    expect(body.pages[0].blank).toBe(false)
    expect(body.pages[0].problems.join(" ")).toContain(DEAD_REF)
    expect(mock(publishStep)).not.toHaveBeenCalled()
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })

  it("FAILS CLOSED when the catalogue cannot be read", async () => {
    mock(listSteps).mockResolvedValue([stepRow()])
    mock(getDraft).mockResolvedValue({ doc: docWithCta(PROGRAM_NAME), docInvalid: false, revision: 1 })
    // The REAL `loadCatalogues` throws when a recognition read comes back at
    // PostgREST's 1000-row cap. Driven through the real path rather than a
    // `mockRejectedValue`, which would prove only that try/catch catches.
    mock(getAllPrograms).mockResolvedValue(
      Array.from({ length: 1000 }, (_, index) => ({ id: PROGRAM_ID, name: `p${index}`, slug: `p${index}` })),
    )

    const response = await POST(request(), ctx)
    expect(response.status).toBe(422)
    // MUTANT: catching the throw and publishing anyway. The trigger is
    // PERSISTENT — once a table crosses 1000 rows it throws on every call — so
    // failing open would switch the gate off permanently, on the day a table
    // grows, with nothing saying so.
    expect(mock(publishStep)).not.toHaveBeenCalled()
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })

  it("does not refuse a legacy step that has no document but is already live", async () => {
    mock(listSteps).mockResolvedValue([
      stepRow(),
      stepRow({ id: "s2", name: "Old page", slug: "old", position: 1, is_entry: false, published_version_id: "v-old" }),
    ])
    mock(getDraft).mockImplementation(async (stepId: string) =>
      stepId === "s1"
        ? { doc: docWithCta(PROGRAM_NAME), docInvalid: false, revision: 1 }
        // What `getDraft` reports for legacy GrapesJS state.
        : { doc: null, docInvalid: true, revision: 0 },
    )

    const response = await POST(request(), ctx)
    expect(response.status).toBe(200)
    // MUTANT: refusing every doc-less step. That freezes out every funnel
    // created before the section editor.
    expect(mock(publishStep).mock.calls.map((call) => call[0].stepId)).toEqual(["s1"])
    expect(mock(updateFunnel)).toHaveBeenCalledWith(FUNNEL_ID, { status: "published" })
  })

  it("refuses a funnel with no pages", async () => {
    mock(listSteps).mockResolvedValue([])
    const response = await POST(request(), ctx)
    // MUTANT: publishing an empty funnel — `funnelPublishPlan([])` is legitimately
    // `ok`, so without this the route would take an empty funnel live and serve
    // a 404 at its own public URL.
    expect(response.status).toBe(400)
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })

  it("refuses a non-admin", async () => {
    mock(canAccessAdminPath).mockResolvedValue(false)
    const response = await POST(request(), ctx)
    expect(response.status).toBe(403)
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })

  it("does not flip the funnel row when a page fails to compile", async () => {
    mock(listSteps).mockResolvedValue([stepRow(), stepRow({ id: "s2", name: "Thanks", slug: "thanks", position: 1, is_entry: false })])
    mock(getDraft).mockResolvedValue({ doc: docWithCta(PROGRAM_NAME), docInvalid: false, revision: 1 })
    mock(publishStep).mockImplementation(async ({ stepId }: { stepId: string }) =>
      stepId === "s2" ? { ok: false, errors: [{ message: "too big" }] } : { ok: true, version: { id: "v1", version: 1 }, warnings: [] },
    )

    const response = await POST(request(), ctx)
    expect(response.status).toBe(422)
    // MUTANT: flipping the row regardless of the write results. A half-written
    // funnel that says "published" is the state with no way to reason about it.
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run __tests__/app/api/admin/funnels/funnel-publish-route.test.ts`
Expected: FAIL — cannot resolve `@/app/api/admin/funnels/[id]/publish/route`.

- [ ] **Step 3: Write the implementation**

Create `app/api/admin/funnels/[id]/publish/route.ts`:

```ts
// app/api/admin/funnels/[id]/publish/route.ts — taking a whole funnel live.
//
// ---------------------------------------------------------------------------
// THIS REPLACES AN UNGUARDED WRITE, AND THAT IS THE POINT OF IT.
// ---------------------------------------------------------------------------
// Taking a funnel live was `PATCH /api/admin/funnels/[id]` with
// `{status:"published"}` — a route that validates the body and writes. It does
// not read the steps, so it will mark a funnel published while three of its
// four pages have never been built, producing a live funnel whose own buttons
// 404. `StepList` and `StepRail` both compute `live = published_version_id &&
// funnel.status === "published"` precisely because that split state is
// reachable: the UI was taught to describe the inconsistency instead of the
// publish path being taught not to create it.
//
// So this endpoint does BOTH halves in one operation, and refuses unless every
// page can be published.
//
// ---------------------------------------------------------------------------
// ALL OR NOTHING, AND EVERY PAGE IS GATED BEFORE ANY PAGE IS WRITTEN.
// ---------------------------------------------------------------------------
// The owner chose all-or-nothing over "publish the good ones and skip the
// rest", because the latter ships a funnel with a dead end in it. Given that,
// gating and writing page by page would produce the worst outcome available:
// three pages published, the fourth refused, the funnel still a draft, and no
// single screen able to say what state anything is in. `funnelPublishPlan`
// therefore inspects everything first and empties `publish` unless `ok`.
//
// ---------------------------------------------------------------------------
// IT FAILS CLOSED, for the reason the step route states at length.
// ---------------------------------------------------------------------------
// `loadCatalogues` throws when a recognition read comes back at PostgREST's
// 1000-row cap, and `resolveDoc` throws on a document that no longer satisfies
// `sectionDocSchema`. Both land in the catch below as a 422 naming the reason.
// The trigger is PERSISTENT, not transient: fail-open would not mean "one
// publish slipped through during an outage", it would mean the gate switches
// itself off permanently on the day a table grows.
//
// THE FUNNEL ROW IS FLIPPED LAST. If a `publishStep` throws part way through,
// the funnel stays a draft — pages carrying an unreferenced version row are
// invisible and harmless, a half-live funnel is not.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { withAudit } from "@/lib/audit/with-audit"
import { getFunnelById, listSteps, publishStep, updateFunnel } from "@/lib/db/funnels"
import { getDraft } from "@/lib/db/funnel-builder"
import { reassemble } from "@/lib/funnels/sections/doc"
import { loadCatalogues, publishGate, resolveDoc } from "@/lib/funnels/sections/resolve"
import { funnelPublishPlan, type StepToPublish } from "@/lib/funnels/publish-plan"

export const maxDuration = 300

export const POST = withAudit(
  { action: "funnel.published", category: "admin_write" },
  async (_request, ctx) => {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const { id } = await ctx.params

    try {
      const funnel = await getFunnelById(id)
      if (!funnel) return NextResponse.json({ error: "Not found" }, { status: 404 })

      const steps = await listSteps(id)
      if (steps.length === 0) {
        // `funnelPublishPlan([])` is legitimately `ok` — it has no page to
        // object to. Publishing an empty funnel would serve a 404 at its own
        // public URL, so the refusal belongs here: it is a rule about FUNNELS,
        // and putting it in the planner would make `problems` (a list of bad
        // pages) mean two different things.
        return NextResponse.json({ error: "This funnel has no pages to publish." }, { status: 400 })
      }

      // READ ONCE FOR THE WHOLE FUNNEL. Both are funnel-wide facts, and
      // re-reading them per page would not only cost N times the work but
      // could gate page 1 and page 4 against different catalogues.
      const [catalogues, drafts] = await Promise.all([
        loadCatalogues(),
        Promise.all(steps.map((step) => getDraft(step.id))),
      ])
      // `[]` is correct here and `null` would be wrong: these ARE the funnel's
      // pages, freshly read. `null` means "could not be checked", and a failed
      // read has already thrown into the catch below.
      const pages = steps.map((step) => ({ slug: step.slug, name: step.name }))

      const toPublish: StepToPublish[] = steps.map((step, index) => ({
        id: step.id,
        name: step.name,
        position: step.position,
        doc: drafts[index]?.doc ?? null,
        hasPublishedVersion: Boolean(step.published_version_id),
      }))

      const plan = funnelPublishPlan(toPublish, (doc) => publishGate(resolveDoc(doc, catalogues, pages)))

      if (!plan.ok) {
        return NextResponse.json(
          { error: "This funnel could not be published.", pages: plan.problems },
          { status: 422 },
        )
      }

      const funnelBasePath = `/go/${funnel.slug}`
      const published: { stepId: string; stepName: string; version: number }[] = []
      const warnings: string[] = []

      for (const entry of plan.publish) {
        const rendered = reassemble(entry.doc, { funnelBasePath })
        if (rendered.problems.length > 0) {
          // A size cap. `compileFunnelStep` would report `ok` on this page —
          // oversized markup is still valid markup — so the check has to be
          // here, on `reassemble`'s own verdict, exactly as the builder's
          // `compile.ok` note explains.
          return NextResponse.json(
            {
              error: "This funnel could not be published.",
              pages: [
                {
                  stepId: entry.stepId,
                  stepName: entry.stepName,
                  problems: rendered.problems.map((problem) => problem.message),
                  blank: false,
                },
              ],
            },
            { status: 422 },
          )
        }

        const result = await publishStep({
          stepId: entry.stepId,
          html: rendered.html,
          css: rendered.css,
          projectData: entry.doc,
          publishedBy: session.user.id,
        })
        if (!result.ok) {
          return NextResponse.json(
            {
              error: "This funnel could not be published.",
              pages: [
                {
                  stepId: entry.stepId,
                  stepName: entry.stepName,
                  problems: result.errors.map((compileError) => compileError.message),
                  blank: false,
                },
              ],
            },
            { status: 422 },
          )
        }
        published.push({ stepId: entry.stepId, stepName: entry.stepName, version: result.version.version })
        warnings.push(...result.warnings.map((warning) => warning.message))
      }

      // LAST, and only on a clean sweep — see the header.
      await updateFunnel(funnel.id, { status: "published" })

      return NextResponse.json({ published: published.length, pages: published, warnings })
    } catch (error) {
      console.error("[POST /api/admin/funnels/:id/publish]", error)
      // FAILS CLOSED as a 422 carrying the reason, never a 500 and never a
      // publish. The message lands in the UI the owner is already looking at.
      return NextResponse.json(
        {
          error: "This funnel could not be published.",
          pages: [
            {
              stepId: "",
              stepName: "This funnel",
              problems: [`Its pages could not be checked, so nothing was published: ${(error as Error).message}`],
              blank: false,
            },
          ],
        },
        { status: 422 },
      )
    }
  },
)
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run __tests__/app/api/admin/funnels/funnel-publish-route.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Mutate each test**

1. Move `updateFunnel` above the publish loop → "does not flip the funnel row when a page fails to compile" must fail.
2. Change `if (!plan.ok)` to `if (false)` → the blank-page test must fail on `publishStep`.
3. Remove the `steps.length === 0` guard → the empty-funnel test must fail.
4. Wrap `loadCatalogues()` in `.catch(() => EMPTY_CATALOGUES)` → the fail-closed test must fail.
5. Gate only `toPublish[0]` → the unresolved-CTA test must fail.

Revert after each. Any mutant that does not fail its test means the test is wrong.

- [ ] **Step 6: Verify and commit**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` — confirm 258.

```bash
git add "app/api/admin/funnels/[id]/publish/route.ts" __tests__/app/api/admin/funnels/funnel-publish-route.test.ts
git commit -m "feat(funnels): one endpoint publishes every page and takes the funnel live"
```

---

## Task 3: Move `creationPrompt` into a shared module

**Files:**
- Create: `lib/funnels/creation-prompt.ts`
- Modify: `app/(admin)/admin/funnels/[id]/edit/[stepId]/page.tsx` (delete the local `creationPrompt`, import it)
- Modify: `__tests__/app/funnel-creation-prompt.test.ts` (import path only)

**Interfaces:**
- Produces: `export function creationPrompt(funnel: Funnel, step: FunnelStep, siblings: FunnelStep[]): string | null`

This is a **pure move**. The function body does not change by one character. The layout (Task 4) needs it, and restating it there is not an option — this repo has shipped three defects from restating a rule instead of importing it, and a second copy would let the background draft and the click-through draft write different pages from the same template.

- [ ] **Step 1: Point the existing test at the new module**

In `__tests__/app/funnel-creation-prompt.test.ts`, change:

```ts
import { creationPrompt } from "@/app/(admin)/admin/funnels/[id]/edit/[stepId]/page"
```

to:

```ts
import { creationPrompt } from "@/lib/funnels/creation-prompt"
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run __tests__/app/funnel-creation-prompt.test.ts`
Expected: FAIL — cannot resolve `@/lib/funnels/creation-prompt`.

- [ ] **Step 3: Create the module**

Create `lib/funnels/creation-prompt.ts` containing the file header comment and the `creationPrompt` function **copied verbatim** from `app/(admin)/admin/funnels/[id]/edit/[stepId]/page.tsx:50-119`, plus its imports:

```ts
// lib/funnels/creation-prompt.ts — the first instruction a never-touched step
// gets.
//
// IT LIVES HERE, NOT IN THE ROUTE, BECAUSE TWO CALLERS NEED IT.
// `[stepId]/page.tsx` composes it when the owner opens a blank page, and the
// edit LAYOUT composes it for every step the background draft queue is about
// to build. Those two must write the same page from the same template, and the
// only way to guarantee that is one definition — this repo has already shipped
// three defects from restating a rule instead of importing it.

import { FUNNEL_GOALS } from "@/lib/validators/funnel"
import type { Funnel, FunnelStep } from "@/types/database"

// ...the JSDoc and body of `creationPrompt`, unchanged.
```

- [ ] **Step 4: Replace the copy in the page**

In `app/(admin)/admin/funnels/[id]/edit/[stepId]/page.tsx`:
- Delete the `creationPrompt` function and its JSDoc.
- Add `import { creationPrompt } from "@/lib/funnels/creation-prompt"`.
- Remove the now-unused `FUNNEL_GOALS` import and the `Funnel` / `FunnelStep` type imports **only if nothing else in the file uses them** — check before deleting.
- Re-export it so any straggling importer still resolves — actually **do not**: grep first.

Run: `grep -rn "creationPrompt" app components lib __tests__` and update every hit. There should be exactly two after this task (the module and the page's import) plus the test.

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx vitest run __tests__/app/funnel-creation-prompt.test.ts`
Expected: PASS, all existing cases green with no changes to their bodies.

- [ ] **Step 6: Verify and commit**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` — confirm 258.

```bash
git add lib/funnels/creation-prompt.ts "app/(admin)/admin/funnels/[id]/edit/[stepId]/page.tsx" __tests__/app/funnel-creation-prompt.test.ts
git commit -m "refactor(funnels): one definition of the step creation prompt"
```

---

## Task 4: The background draft queue

**Files:**
- Modify: `components/admin/funnels/connections-context.tsx`
- Modify: `app/(admin)/admin/funnels/[id]/edit/layout.tsx`
- Test: `__tests__/components/admin/funnels/draft-queue.test.tsx`

**Interfaces:**
- Consumes: `readTurnStream` from `@/components/admin/funnels/builder/stream`; `creationPrompt` (Task 3).
- Produces, on the connections context:
  ```ts
  export type DraftPhase = "idle" | "queued" | "writing" | "done" | "failed"
  export interface DraftJob { stepId: string; prompt: string; revision: number }
  // added to ContextValue:
  draftPhase: (stepId: string) => DraftPhase
  startAutoDraft: () => void
  draftStep: (stepId: string) => void
  ```
  and on `ConnectionsProviderProps`: `draftJobs: DraftJob[]`.
- Also produces the exported hook `useDraftQueue(): Pick<ContextValue, "draftPhase" | "startAutoDraft" | "draftStep">` — a no-op outside a provider, matching `usePublishStepConnections`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/components/admin/funnels/draft-queue.test.tsx`:

```tsx
// __tests__/components/admin/funnels/draft-queue.test.tsx
//
// The queue that answers "i dont want to click the other one for it to be
// generate". It lives in the PROVIDER, which the edit layout mounts, because
// Next keeps a layout mounted across `[stepId]` navigations — so a draft
// started while page 1 is on screen keeps running when the owner clicks to
// page 3. Anywhere else it would die on the first navigation.
//
// EVERY TEST NAMES THE MUTANT IT KILLS.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, act } from "@testing-library/react"
import {
  ConnectionsProvider,
  useConnections,
  type DraftJob,
} from "@/components/admin/funnels/connections-context"

const JOBS: DraftJob[] = [
  { stepId: "s2", prompt: "Build step 2", revision: 0 },
  { stepId: "s3", prompt: "Build step 3", revision: 0 },
]

const PAGES = [
  { id: "s1", name: "Signup", slug: "index", position: 0, isEntry: true, live: false, published: false },
  { id: "s2", name: "Thanks", slug: "thanks", position: 1, isEntry: false, live: false, published: false },
  { id: "s3", name: "Done", slug: "done", position: 2, isEntry: false, live: false, published: false },
]

/** A build response carrying one `result` event, as the route streams it. */
function streamResponse(doc: unknown = null) {
  const payload =
    `data: ${JSON.stringify({ type: "result", turn: { revision: 1, doc, reply: "ok", blocked: false, receipt: null, compile: { ok: true, problems: [], warnings: [] }, unresolved: [], danglingAnchors: [], resolutionError: null } })}\n\n`
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload))
      controller.close()
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } })
}

/** Reads the queue out of the context and exposes a way to start it. */
function Probe({ auto = true }: { auto?: boolean }) {
  const context = useConnections()
  if (!context) return null
  return (
    <div>
      <button onClick={() => context.startAutoDraft()}>start</button>
      {!auto ? null : null}
      <span data-testid="s2">{context.draftPhase("s2")}</span>
      <span data-testid="s3">{context.draftPhase("s3")}</span>
    </div>
  )
}

function mount(jobs: DraftJob[] = JOBS) {
  return render(
    <ConnectionsProvider
      funnelId="f1"
      funnelSlug="free-trial-week"
      funnelKind="funnel"
      pages={PAGES}
      initialDocs={PAGES.map((page) => ({ ...page, doc: null }))}
      draftJobs={jobs}
    >
      <Probe />
    </ConnectionsProvider>,
  )
}

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { vi.restoreAllMocks() })

describe("the draft queue", () => {
  it("drafts nothing until it is started", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    mount()
    // MUTANT: kicking the queue off in a mount effect. Step 1 is still being
    // written at that moment, and a second concurrent model call is both a
    // rate-limit hazard and a step 2 that does not know what step 1 said.
    await waitFor(() => expect(screen.getByTestId("s2")).toHaveTextContent("idle"))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("drafts the queued steps ONE AT A TIME, in order", async () => {
    const seen: string[] = []
    let release: (() => void) | null = null
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      seen.push(String(url))
      if (seen.length === 1) {
        // Hold the first call open. If the queue were parallel, the second
        // fetch would already have happened by the time we look.
        await new Promise<void>((resolve) => { release = resolve })
      }
      return streamResponse()
    })

    mount()
    act(() => { screen.getByText("start").click() })

    await waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0]).toContain("/api/admin/funnels/steps/s2/build")
    // MUTANT: `jobs.map(run)` instead of an await-in-loop. Parallel drafting
    // fires every step at the builder rate limit at once, and writes step 3
    // without step 2 existing — which is what the prompt's "the full sequence
    // is..." line and `resolveDoc`'s page list both depend on.
    expect(seen).toHaveLength(1)
    await waitFor(() => expect(screen.getByTestId("s2")).toHaveTextContent("writing"))
    expect(screen.getByTestId("s3")).toHaveTextContent("queued")

    act(() => { release?.() })
    await waitFor(() => expect(seen).toHaveLength(2))
    expect(seen[1]).toContain("/api/admin/funnels/steps/s3/build")
    await waitFor(() => expect(screen.getByTestId("s2")).toHaveTextContent("done"))
  })

  it("keeps going after one step fails", async () => {
    const seen: string[] = []
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      seen.push(String(url))
      if (seen.length === 1) return new Response("{}", { status: 500, headers: { "content-type": "application/json" } })
      return streamResponse()
    })

    mount()
    act(() => { screen.getByText("start").click() })

    await waitFor(() => expect(screen.getByTestId("s2")).toHaveTextContent("failed"))
    // MUTANT: a `throw` that escapes the loop, or a `return` on failure. One
    // model refusal must not strand every page behind it.
    await waitFor(() => expect(seen).toHaveLength(2))
    await waitFor(() => expect(screen.getByTestId("s3")).toHaveTextContent("done"))
  })

  it("cannot be started twice", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => streamResponse())
    mount()
    act(() => { screen.getByText("start").click() })
    act(() => { screen.getByText("start").click() })
    await waitFor(() => expect(screen.getByTestId("s3")).toHaveTextContent("done"))
    // MUTANT: no `started` ref. `FunnelBuilder` calls this from an effect that
    // can re-run, and a second pass would draft every page a second time —
    // over the top of the first pass's work, at full model cost.
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("publishes each finished document into the graph", async () => {
    const doc = { v: 1, engine: "sections", theme: { tone: "light", accent: "accent", radius: "soft" }, sections: [] }
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => streamResponse(doc))
    const seenDocs: unknown[] = []
    function DocProbe() {
      const context = useConnections()
      seenDocs.push(context?.docFor("s2") ?? null)
      return <button onClick={() => context?.startAutoDraft()}>start</button>
    }
    render(
      <ConnectionsProvider
        funnelId="f1" funnelSlug="free-trial-week" funnelKind="funnel"
        pages={PAGES} initialDocs={PAGES.map((p) => ({ ...p, doc: null }))} draftJobs={JOBS}
      >
        <DocProbe />
      </ConnectionsProvider>,
    )
    act(() => { screen.getByText("start").click() })
    // MUTANT: dropping the `publishStepConnections` call on completion. The
    // rail would keep drawing "leads nowhere" for a page that has just been
    // written — the "collected and then ignored" failure this area has shipped
    // twice already.
    await waitFor(() => expect(seenDocs.at(-1)).toEqual(doc))
  })
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run __tests__/components/admin/funnels/draft-queue.test.tsx`
Expected: FAIL — `draftJobs` is not a prop, `draftPhase` is not on the context.

- [ ] **Step 3: Implement the queue in the provider**

In `components/admin/funnels/connections-context.tsx`, add:

```tsx
/**
 * How far along a never-built step's background draft is.
 *
 * `failed` is terminal for this session and deliberately not retried: a model
 * refusal repeated automatically is the same refusal at twice the cost.
 * Opening the page still offers the normal creation path.
 */
export type DraftPhase = "idle" | "queued" | "writing" | "done" | "failed"

/** One step the queue may draft, composed by the layout from stored columns. */
export interface DraftJob {
  stepId: string
  /** `creationPrompt(funnel, step, siblings)` — the same string the step page would send. */
  prompt: string
  /** The step's `doc_revision`, for the build route's optimistic lock. */
  revision: number
}
```

Inside `ConnectionsProvider`:

```tsx
  const [phases, setPhases] = useState<Record<string, DraftPhase>>({})
  // A REF, not state. `startAutoDraft` is called from an effect in
  // `FunnelBuilder` that can legitimately re-run, and a state flag would not
  // be visible to the second call in the same tick — so the queue would run
  // twice, drafting every page over the top of itself at full model cost.
  const running = useRef(false)

  const setPhase = useCallback((stepId: string, phase: DraftPhase) => {
    setPhases((current) => (current[stepId] === phase ? current : { ...current, [stepId]: phase }))
  }, [])

  /**
   * Draft one step, and hand the finished document to the graph.
   *
   * Returns rather than throws. The queue below must survive one page
   * refusing — stranding every page behind it would be a worse failure than
   * the one it is reporting.
   */
  const runJob = useCallback(
    async (job: DraftJob): Promise<void> => {
      setPhase(job.stepId, "writing")
      try {
        const response = await fetch(`/api/admin/funnels/steps/${job.stepId}/build`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: job.prompt, revision: job.revision }),
        })
        const isStream = (response.headers.get("content-type") ?? "").includes("text/event-stream")
        if (!isStream || !response.ok) {
          setPhase(job.stepId, "failed")
          return
        }
        // The SAME reader the builder uses. A second implementation of the
        // framing would be a second thing to keep in step with the route.
        const outcome = await readTurnStream(response, () => {})
        if (outcome.type !== "result") {
          setPhase(job.stepId, "failed")
          return
        }
        const doc = (outcome.review ?? outcome.turn).doc as SectionDoc | null
        // INTO THE GRAPH IMMEDIATELY, so the rail's arrows appear as the pages
        // are made rather than at the next refresh.
        publishStepConnections(job.stepId, doc)
        setPhase(job.stepId, doc ? "done" : "failed")
      } catch (error) {
        // Never takes the editor down. The owner came here to edit a page.
        console.error("[funnels/draft-queue] could not draft a step:", error)
        setPhase(job.stepId, "failed")
      }
    },
    [publishStepConnections, setPhase],
  )

  /**
   * Draft every unbuilt step, one at a time, in the order the layout gave.
   *
   * SEQUENTIAL, NOT PARALLEL, for two reasons that both bite: several
   * concurrent builds run straight into `SECTION_BUILDER_RATE_LIMIT_MAX`, and
   * step N is written knowing step N-1 exists — which is what makes the
   * prompt's "the full sequence is..." line and `resolveDoc`'s page list true
   * rather than aspirational.
   */
  const startAutoDraft = useCallback(() => {
    if (running.current || draftJobs.length === 0) return
    running.current = true
    for (const job of draftJobs) setPhase(job.stepId, "queued")
    void (async () => {
      for (const job of draftJobs) await runJob(job)
    })()
  }, [draftJobs, runJob, setPhase])

  /** One named step, now — the publish refusal's "Generate it now". */
  const draftStep = useCallback(
    (stepId: string) => {
      const job = draftJobs.find((entry) => entry.stepId === stepId)
      if (!job) return
      if (phasesRef.current[stepId] === "writing" || phasesRef.current[stepId] === "queued") return
      void runJob(job)
    },
    [draftJobs, runJob],
  )

  const draftPhase = useCallback((stepId: string): DraftPhase => phases[stepId] ?? "idle", [phases])
```

Keep a `phasesRef` in step with `phases` (`useEffect(() => { phasesRef.current = phases }, [phases])`) so `draftStep`'s guard reads the current value without re-creating the callback on every phase change.

Add `draftPhase`, `startAutoDraft`, `draftStep` to `ContextValue` and to the `useMemo` value; add `draftJobs: DraftJob[]` to `ConnectionsProviderProps` with a `= []` default so existing test mounts keep compiling. Import `useRef` and `readTurnStream`.

Add the degrading hook beside the existing ones:

```tsx
/**
 * The draft queue, or inert no-ops outside a provider.
 *
 * Same contract as `usePublishStepConnections`: `FunnelBuilder` renders under
 * this provider in the funnel route and standalone in tests and the preview
 * harness, so a hook that threw would make the builder untestable in isolation.
 * `draftPhase` answering "idle" everywhere means the builder behaves exactly as
 * it did before this feature.
 */
export function useDraftQueue() {
  const context = useContext(ConnectionsContext)
  return useMemo(
    () => ({
      draftPhase: context?.draftPhase ?? (() => "idle" as DraftPhase),
      startAutoDraft: context?.startAutoDraft ?? (() => {}),
      draftStep: context?.draftStep ?? (() => {}),
    }),
    [context],
  )
}
```

- [ ] **Step 4: Feed the queue from the layout**

In `app/(admin)/admin/funnels/[id]/edit/layout.tsx`, after `ordered` is computed:

```tsx
  // WHICH STEPS THE QUEUE MAY DRAFT: the ones that have never been touched.
  //
  // The same condition `[stepId]/page.tsx` uses to fire its own creation
  // prompt — no stored document — minus the turn check, which needs a per-step
  // query this layout deliberately does not make. The builder's own guard
  // (`draftPhase !== "idle"`) covers the overlap, and a step with turns but no
  // document is a step whose build failed, which is exactly a step worth
  // retrying.
  //
  // ONLY FOR A FUNNEL. A landing page has one step and it is drafted by the
  // create dialog's `?start=1`.
  const draftJobs: DraftJob[] =
    funnel.kind !== "funnel"
      ? []
      : ordered
          .filter((step) => !sectionDocSchema.safeParse(step.project_data).success)
          .map((step) => ({
            stepId: step.id,
            prompt: creationPrompt(funnel, step, ordered) ?? "",
            revision: step.doc_revision ?? 0,
          }))
          // A step with no goal and no template composes no prompt. Sending an
          // empty message would be a 400 from the build route's own validator.
          .filter((job) => job.prompt !== "")
```

Pass `draftJobs={draftJobs}` to `ConnectionsProvider`. Import `creationPrompt` and the `DraftJob` type.

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx vitest run __tests__/components/admin/funnels/draft-queue.test.tsx`
Expected: PASS, 5 tests.

Then the neighbouring suite, which mounts the same provider:
Run: `npx vitest run __tests__/components/admin/funnels/step-rail.test.tsx`
Expected: PASS, unchanged.

- [ ] **Step 6: Mutate each test**

1. Call `startAutoDraft()` from a mount effect → "drafts nothing until it is started" must fail.
2. `draftJobs.map((job) => runJob(job))` instead of the await loop → the one-at-a-time test must fail.
3. `throw` instead of `setPhase(...,"failed")` in `runJob`'s catch → "keeps going after one step fails" must fail.
4. Remove the `running.current` guard → "cannot be started twice" must fail.
5. Remove the `publishStepConnections(job.stepId, doc)` call → the graph test must fail.

Revert after each.

- [ ] **Step 7: Verify and commit**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` — confirm 258.

```bash
git add components/admin/funnels/connections-context.tsx "app/(admin)/admin/funnels/[id]/edit/layout.tsx" __tests__/components/admin/funnels/draft-queue.test.tsx
git commit -m "feat(funnels): steps 2..n draft themselves instead of waiting to be clicked"
```

---

## Task 5: The split publish control and the initial-prompt guard

**Files:**
- Modify: `components/admin/funnels/FunnelBuilder.tsx`
- Test: `__tests__/components/admin/funnel-publish-all.test.tsx`

**Interfaces:**
- Consumes: `useDraftQueue` (Task 4); `POST /api/admin/funnels/[id]/publish` (Task 2).
- Produces: no new exports. Behavioural surface: a `Publish funnel` primary button with a `Publish this page only` menu item for `funnelKind === "funnel"`; the existing single `Publish` for `funnelKind === "page"`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/components/admin/funnel-publish-all.test.tsx`. Mirror the harness in `__tests__/components/admin/funnel-builder.test.tsx` (read it first for the prop fixture and the `renderForPublish` stub). Tests:

```tsx
// __tests__/components/admin/funnel-publish-all.test.tsx
//
// THE REPORT: "There should be no seperate publish again, if i publish it in
// the builder it should publish it now immidately, the whole funnel, also when
// its a funnel when i click publish you can choose publish all or publish
// steps."
//
// EVERY TEST NAMES THE MUTANT IT KILLS.

describe("publishing a funnel from the builder", () => {
  it("publishes the WHOLE FUNNEL on the primary click", async () => {
    // Render with funnelKind="funnel", a clean doc, no blockers.
    // Click "Publish funnel".
    // MUTANT: pointing the primary button at the per-step route. That is the
    // two-click, two-screen behaviour the owner rejected — the page would
    // publish and the funnel would stay a draft behind a 404.
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/admin/funnels/f1/publish",
      expect.objectContaining({ method: "POST" }),
    )
    // and NOT the step route
    expect(fetchSpy.mock.calls.map((call) => call[0])).not.toContain(
      "/api/admin/funnels/steps/s1/publish",
    )
  })

  it("offers 'Publish this page only', which uses the step route", async () => {
    // Open the menu, click the item.
    // MUTANT: dropping the menu, or wiring both to the same route. This is the
    // "publish steps" half of the request.
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/admin/funnels/steps/s1/publish",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("shows ONE publish button, with no menu, for a landing page", async () => {
    // Render with funnelKind="page".
    // MUTANT: rendering the split control unconditionally. A landing page is
    // one page; offering to publish it two ways is noise, and "Publish funnel"
    // on a landing page is the wrong-screen wording the owner has already
    // objected to once.
    expect(screen.queryByRole("button", { name: /publish this page only/i })).toBeNull()
  })

  it("routes a 422 naming ANOTHER page into the chat, with a link to it", async () => {
    // fetch -> 422 { pages: [{ stepId: "s2", stepName: "Thank you",
    //                          problems: ["Thank you has no content yet."], blank: true }] }
    // MUTANT: rendering the problems as bare strings. The owner is told a page
    // name and left to find it — and this repo's own rule is that in a chat
    // builder an error the AI can fix must never be a dead end.
    expect(await screen.findByText(/Thank you has no content yet/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Thank you/ })).toHaveAttribute(
      "href",
      "/admin/funnels/f1/edit/s2",
    )
  })

  it("offers 'Generate it now' for a page that is merely blank", async () => {
    // Same 422 with blank: true, and a draftStep spy on the context.
    // MUTANT: offering it for every problem. "Generate it now" is a real fix
    // for an empty page and nonsense for a dead CTA — which is exactly why
    // `blank` is computed by the planner rather than sniffed from the message.
    await userEvent.click(screen.getByRole("button", { name: /generate it now/i }))
    expect(draftStep).toHaveBeenCalledWith("s2")
  })

  it("does NOT fire its creation prompt for a step the queue is already writing", async () => {
    // Mount with initialPrompt set, initialDoc null, and a provider whose
    // draftPhase("s1") is "writing".
    // MUTANT: dropping the guard. `[stepId]/page.tsx` still computes
    // `wantsFirstDraft` as true while the queue is mid-build (the build route
    // writes its turn LAST), so clicking into a page being drafted would start
    // a SECOND build on the same step — racing the optimistic lock and burning
    // a model call.
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/build"),
      expect.anything(),
    )
  })
})
```

Write these out in full against the real harness — the assertions above are the contract; the setup comes from the existing builder test file.

- [ ] **Step 2: Run and verify they fail**

Run: `npx vitest run __tests__/components/admin/funnel-publish-all.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement in `FunnelBuilder.tsx`**

**3a. Split `publish` into two callbacks.** Keep the existing one, renamed `publishThisPage`, byte-for-byte apart from its name. Add:

```tsx
  /**
   * PUBLISH THE WHOLE FUNNEL — the primary action, and one click.
   *
   * The owner published a page, was told it worked, and found a second
   * "Publish funnel" button on the next screen with a 404 behind it until he
   * pressed it: "There should be no seperate publish again, if i publish it in
   * the builder it should publish it now immidately, the whole funnel."
   *
   * It does NOT send this tab's document. The route reads every page's stored
   * draft, gates all of them, and writes only if all pass — so what it
   * publishes is what is SAVED, which is the only thing it could honestly
   * publish for the four pages this tab is not holding. `canPublish` already
   * requires this page to be saved and clean, and `upToDate` stops a no-op.
   */
  const publishFunnel = useCallback(async () => {
    if (!doc || !canPublish) return
    setBusy("publishing")
    try {
      const response = await fetch(`/api/admin/funnels/${props.funnelId}/publish`, { method: "POST" })
      const body = (await response.json().catch(() => null)) as {
        published?: number
        pages?: PagePublishProblem[]
        warnings?: string[]
        error?: string
      } | null

      if (response.status === 422 && body?.pages?.length) {
        // Same treatment as the step route's 422 — `setServerBlockers` FIRST
        // so the gate stays shut, then the way out. See `reportRefusal`.
        setServerBlockers(body.pages.flatMap((page) => page.problems))
        reportPageRefusal(body.pages)
        return
      }
      if (!response.ok || !body?.published) {
        toast.error(body?.error ?? "Could not publish. The live funnel is unchanged.")
        return
      }

      setPublishResult({ version: 0, warnings: body.warnings ?? [], notLive: false, pages: body.published })
      setPublishedRevision(revision)
      setMode("edit")
      toast.success(`Published ${body.published} page${body.published === 1 ? "" : "s"}. The funnel is live.`)
    } catch {
      toast.error("Could not publish. The live funnel is unchanged.")
    } finally {
      setBusy("idle")
    }
  }, [canPublish, doc, props.funnelId, reportPageRefusal, revision])
```

Extend `PublishResult` with `pages?: number` and make the strip say "N pages published — the funnel is live" when `pages` is set, keeping the existing "Published version N" wording for the per-page path. Leave `notLive` untouched — a funnel-wide publish always takes the funnel live, so `notLive: false` is a fact rather than an assumption.

**3b. `reportPageRefusal`** — a sibling of `reportRefusal` that keeps the page identity:

```tsx
  /**
   * A funnel-wide refusal, routed into the chat WITH the page it is about.
   *
   * `reportRefusal` flattens to strings, which is right when every problem is
   * about the page on screen. A funnel publish reports on four pages at once,
   * and a bare "Thank you has no content yet." leaves the owner to find Thank
   * you themselves. So each problem carries a link, and a merely-blank page
   * carries the fix as well.
   */
  const reportPageRefusal = useCallback((pages: PagePublishProblem[]) => {
    setMessages((prev) => [
      ...prev,
      {
        id: nextLocalId("pages"),
        role: "pages",
        text: "This funnel was not published.",
        pages,
      },
    ])
    setMode("edit")
    setTab("chat")
  }, [])
```

Add a `pages` variant to `BuilderMessage` in `components/admin/funnels/builder/types.ts` and render it in `ChatPane`: one block per page, headed by a link to `adminStepHref(props.funnelKind, props.funnelId, page.stepId)`, its problems beneath, and — when `page.blank` — a `Generate it now` button calling `draftStep(page.stepId)`. A problem whose `stepId` is `""` (the fail-closed catch) renders without a link.

**3c. The control.** Replace the single publish `<Button>` with, for `funnelKind === "funnel"`, a split button: a primary `Publish funnel` calling `publishFunnel`, and a `DropdownMenu` trigger (chevron, `aria-label="More publish options"`) whose one item is `Publish this page only` calling `publishThisPage`. Use `components/ui/dropdown-menu`. Both are disabled by the existing `!canPublish`. For `funnelKind === "page"`, render exactly what is there today.

**3d. The initial-prompt guard.** In the `initialPromptFired` effect:

```tsx
  const { draftPhase, startAutoDraft } = useDraftQueue()

  useEffect(() => {
    if (initialPromptFired.current) return
    if (!props.initialPrompt) return
    // THE QUEUE MAY ALREADY BE ON THIS PAGE. `[stepId]/page.tsx` computes
    // `wantsFirstDraft` from "no document and no turns", and the build route
    // writes its turn LAST — so for the whole ~30s of a background draft both
    // are still true, and clicking into that page would start a SECOND build
    // on the same step: two writers racing one optimistic lock, one of them
    // wasted. The provider outlives the navigation, so it is the only thing on
    // the client that knows.
    const phase = draftPhase(props.stepId)
    if (phase === "queued" || phase === "writing") return
    if (props.initialDoc !== null) return
    if (props.initialMessages.length > 0) return
    initialPromptFired.current = true
    void send(props.initialPrompt)
  }, [props.initialPrompt, props.initialDoc, props.initialMessages, props.stepId, draftPhase, send])
```

(Keep whatever guards the existing effect already has; add the phase check above them.)

**3e. Kick the queue off.** In `applyTurn`, or in an effect watching `doc`, call `startAutoDraft()` once when **this** step's first draft has landed — that is, when `props.initialPrompt` was non-null and `doc` has just become non-null for the first time. Guard with a ref so it fires once:

```tsx
  const autoDraftKicked = useRef(false)
  useEffect(() => {
    if (autoDraftKicked.current) return
    // Only off the back of a FIRST draft. A funnel whose pages are all written
    // has nothing queued anyway (the layout composes no jobs for them), but
    // firing this on every turn would mean re-entering `startAutoDraft` on
    // every edit for the whole session.
    if (!props.initialPrompt || doc === null) return
    autoDraftKicked.current = true
    startAutoDraft()
  }, [doc, props.initialPrompt, startAutoDraft])
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run __tests__/components/admin/funnel-publish-all.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the neighbouring builder suites**

Run: `npx vitest run __tests__/components/admin/funnel-builder.test.tsx __tests__/components/admin/funnel-builder-polish.test.tsx __tests__/components/admin/funnel-builder-initial-prompt.test.tsx __tests__/components/admin/funnel-build-overlay.test.tsx __tests__/components/admin/funnel-preview-pane.test.tsx`
Expected: PASS. Any failure here is a regression in the control's wiring — fix the component, not the old test, unless the old test asserts the two-click behaviour that was just deliberately replaced (in which case update it and say so in the commit).

- [ ] **Step 6: Mutate each test**

1. Point the primary button at the step route → the whole-funnel test must fail.
2. Delete the dropdown → the "publish this page only" test must fail.
3. Render the split control unconditionally → the landing-page test must fail.
4. Render `page.problems` without the link → the cross-page link test must fail.
5. Offer `Generate it now` regardless of `blank` → that test must fail.
6. Delete the `phase === "queued" || phase === "writing"` guard → the double-fire test must fail.

Revert after each.

- [ ] **Step 7: Verify and commit**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` — confirm 258.

```bash
git add components/admin/funnels/FunnelBuilder.tsx components/admin/funnels/builder/ __tests__/components/admin/funnel-publish-all.test.tsx
git commit -m "feat(funnels): publish in the builder takes the whole funnel live"
```

---

## Task 6: The rail's draft status, and one publish operation everywhere

**Files:**
- Modify: `components/admin/funnels/StepRail.tsx`
- Modify: `components/admin/funnels/FunnelStatusControl.tsx`
- Test: extend `__tests__/components/admin/funnels/step-rail.test.tsx`
- Test: extend `__tests__/components/admin/funnel-go-live.test.tsx` (read it first — it covers `FunnelStatusControl`)

**Interfaces:**
- Consumes: `useDraftQueue` (Task 4), `POST /api/admin/funnels/[id]/publish` (Task 2).

- [ ] **Step 1: Write the failing tests**

In `__tests__/components/admin/funnels/step-rail.test.tsx`, add:

```tsx
  it("says which pages are being written", () => {
    // Provider with draftJobs and a queue mid-run: draftPhase("s2") === "writing".
    // MUTANT: no status at all. The queue's whole promise to the owner is that
    // he does not have to click each page — and a queue with no visible
    // progress is indistinguishable from one that is not running.
    expect(screen.getByText(/writing/i)).toBeInTheDocument()
  })

  it("does not call a queued page 'never published'", () => {
    // MUTANT: leaving `StatusPill` alone. "never published" beside a page that
    // is being written right now reads as a failure.
  })
```

In `__tests__/components/admin/funnel-go-live.test.tsx`, add:

```tsx
  it("publishes a FUNNEL through the funnel-wide route, not PATCH status", async () => {
    // MUTANT: leaving the PATCH. That route writes `status` without reading a
    // single step, which is how a funnel goes live with three unbuilt pages
    // behind it — the defect this whole feature exists to close.
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/admin/funnels/f1/publish",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("still PATCHes for a landing page", async () => {
    // MUTANT: routing pages through the funnel planner too. A landing page's
    // single step is already gated by the step route, and its publish already
    // flips the row — a second path with no second page to justify it.
  })

  it("reports a refusal instead of claiming success", async () => {
    // fetch -> 422 { pages: [...] }
    // MUTANT: `toast.success` regardless of status. The screen would say the
    // funnel is live while it is not.
    expect(await screen.findByText(/could not be published/i)).toBeInTheDocument()
  })

  it("unpublishes through PATCH, unchanged", async () => {
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/admin/funnels/f1",
      expect.objectContaining({ method: "PATCH" }),
    )
  })
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx vitest run __tests__/components/admin/funnels/step-rail.test.tsx __tests__/components/admin/funnel-go-live.test.tsx`
Expected: FAIL on the new cases only.

- [ ] **Step 3: Implement**

**`StepRail.tsx`** — in `StatusPill`, take the draft phase into account:

```tsx
function StatusPill({ page, phase }: { page: RailPage; phase: DraftPhase }) {
  // A PAGE BEING WRITTEN IS NOT "never published". The queue drafts pages the
  // owner never opened, and the old label would sit beside a progress state
  // reading as a failure.
  if (phase === "writing") return <span className="...">writing…</span>
  if (phase === "queued") return <span className="...">queued</span>
  if (phase === "failed") return <span className="text-[var(--warning)] ...">draft failed</span>
  // ...existing live / draft / never published logic, unchanged.
}
```

Read the phase in `StepRail` via `useDraftQueue()` and pass it per row. Keep the classes in the existing vocabulary (`bg-surface text-muted-foreground`, `var(--warning)`); no new colours.

**`FunnelStatusControl.tsx`** — publish routes through the new endpoint for a funnel:

```tsx
  /**
   * ONE FUNNEL-PUBLISH OPERATION, TWO DOORWAYS.
   *
   * This used to `PATCH {status:"published"}`, which writes the row without
   * reading a single step — the unguarded path that lets a funnel go live with
   * unbuilt pages behind it. It now calls the same endpoint the builder's
   * primary Publish calls, so neither surface can produce the "funnel
   * published, pages are not" split.
   *
   * A LANDING PAGE KEEPS THE PATCH. Its single step is already gated by the
   * step publish route, whose own comment explains that publishing a page
   * takes the row live; routing it through a funnel-wide planner would add a
   * code path with no second page to justify it.
   */
  async function publish() {
    if (kind === "page") return setStatus("published")
    const response = await fetch(`/api/admin/funnels/${funnelId}/publish`, { method: "POST" })
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      const pages = (body?.pages ?? []) as { stepName: string; problems: string[] }[]
      toast.error(
        pages.length > 0
          // NAMES THE PAGE. "Could not publish" alone sends the owner to look
          // at four pages to find the one that is wrong.
          ? `This funnel could not be published. ${pages.map((page) => `${page.stepName}: ${page.problems.join(" ")}`).join(" ")}`
          : (body?.error ?? "Could not publish this funnel."),
      )
      return
    }
    setCurrent("published")
    toast.success("Funnel is live.")
    startTransition(() => router.refresh())
  }
```

Wire the publish button to `publish()`; leave Unpublish on `setStatus("draft")`.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run __tests__/components/admin/funnels/step-rail.test.tsx __tests__/components/admin/funnel-go-live.test.tsx`
Expected: PASS.

- [ ] **Step 5: Mutate each new test**

1. Revert `StatusPill` to ignore the phase → both rail tests must fail.
2. Restore the `PATCH` for funnels → the funnel-route test must fail.
3. Route `kind === "page"` through the funnel endpoint → the landing-page test must fail.
4. `toast.success` before the `response.ok` check → the refusal test must fail.

Revert after each.

- [ ] **Step 6: Verify and commit**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` — confirm 258.

```bash
git add components/admin/funnels/StepRail.tsx components/admin/funnels/FunnelStatusControl.tsx __tests__/components/admin/funnels/step-rail.test.tsx __tests__/components/admin/funnel-go-live.test.tsx
git commit -m "feat(funnels): the rail shows drafting, and one publish path takes a funnel live"
```

---

## Final verification

- [ ] **Targeted suites**

```bash
npx vitest run __tests__/lib/funnels __tests__/app/api/admin/funnels __tests__/app/funnel-creation-prompt.test.ts __tests__/components/admin/funnels __tests__/components/admin/funnel-publish-all.test.tsx __tests__/components/admin/funnel-builder.test.tsx __tests__/components/admin/funnel-builder-polish.test.tsx __tests__/components/admin/funnel-builder-initial-prompt.test.tsx __tests__/components/admin/funnel-go-live.test.tsx __tests__/components/admin/funnel-build-overlay.test.tsx __tests__/components/admin/funnel-publish-actions.test.ts
```

Expected: all green. **Not** the full suite — 7 failures in `__tests__/components/admin/bookkeeping/SetupPanel.test.tsx` are known pre-existing and unrelated.

- [ ] **Compilation gate**

```bash
rm -rf .next && npm run build
```

Expected: exit 0. Then `npx tsc --noEmit 2>&1 | grep -c "error TS"` — read the number, confirm 258. Do not chain the count to a commit with `&&`.

- [ ] **Requesting code review**

Use `superpowers:requesting-code-review` on the full branch diff before merging anything.

---

## Self-review notes

**Spec coverage:** Part A → Tasks 1, 2, 5, 6. Part B → Tasks 3, 4, 5 (guard + kick-off), 6 (rail status). Testing section → the test steps in every task plus Final verification. "Not in scope" items are absent from the plan by design.

**Known cross-task type contracts:**
- `PagePublishProblem` is defined in Task 1 and consumed by name in Tasks 2, 5, 6. `FunnelBuilder` imports it from `@/lib/funnels/publish-plan` — a type-only import, so the leaf stays a leaf.
- `DraftPhase` / `DraftJob` are defined in Task 4 and consumed in Tasks 5 and 6.
- `startAutoDraft` / `draftStep` / `draftPhase` keep those exact names in every task.
