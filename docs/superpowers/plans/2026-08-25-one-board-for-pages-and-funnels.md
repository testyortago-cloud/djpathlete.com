# One Board For Landing Pages And Funnels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete `FunnelBoard` and render both `/admin/pages` and `/admin/funnels` from `FunnelList` + `FunnelCard`, so a control can never again exist on one board and not the other.

**Architecture:** `FunnelList` and `FunnelCard` gain a `kind` prop covering the six behaviours that today live only in `FunnelBoard`. Each screen keeps its own route — only the component is shared. No migration; `funnels.kind` stays exactly as it is.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, Vitest + Testing Library, Playwright for the real-app capture.

**Spec:** `docs/superpowers/specs/2026-08-25-one-board-for-pages-and-funnels-design.md`

## Global Constraints

- **`funnels.kind` is NOT changed and there is NO migration.** The model is sound; the confusion was presentational. (Spec §5)
- **Landing pages keep NO detail screen.** All three routes into it stay closed: the editor's back link, the ⚙ button on the card, and the URL. (Spec §0, §4)
- **The two screens keep separate routes.** `/admin/pages` and `/admin/funnels` are distinct URLs because the sidebar highlights by path prefix. Build every admin link with `adminFunnelBase` / `adminStepHref` from `lib/funnels/admin-path.ts`. (Spec §0)
- **A funnel is a container with no single goal.** The goal badge is page-only. (Spec §3)
- **House table rule does not apply here.** These boards are the documented `PreviewCard` exception.
- **Stage by pathspec, never `git add -A`.** A peer session shares this checkout and has in-flight edits in `app/api/ask/`, `lib/lead-engine/chat/` and `.env.example`.
- **`tsc --noEmit` baseline is 251 errors.** A falling count hides new errors too — compare exactly.
- **Every test mutation-checked before it is believed.**
- **Absence assertions need a presence control** in the same test file.

---

### Task 1: `FunnelCard` learns which kind of row it is

**Files:**
- Modify: `components/admin/funnels/FunnelCard.tsx`
- Test: `__tests__/components/admin/funnel-card-kind.test.tsx` (create)

**Interfaces:**
- Consumes: `FunnelCardProps` (existing), `QuizByStepId` (existing, added 2026-08-25)
- Produces: `FunnelCardProps.kind?: FunnelKind` — defaults to `funnel.kind`, so callers need not pass it. `FunnelCard` renders the goal badge and Convert control only for `"page"`, and the ⚙ settings button only for `"funnel"`.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/admin/funnel-card-kind.test.tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { FunnelCard } from "@/components/admin/funnels/FunnelCard"
import type { Funnel, FunnelStep } from "@/types/database"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const funnel = (over: Partial<Funnel> = {}): Funnel =>
  ({
    id: "f1", slug: "free-trial", name: "Free Trial", description: null,
    status: "draft", kind: "page", goal: "leads",
    created_by: null, created_at: "", updated_at: "", ...over,
  }) as Funnel

const step = (over: Partial<FunnelStep> = {}): FunnelStep =>
  ({
    id: "s1", funnel_id: "f1", slug: "index", name: "Landing page", position: 0,
    is_entry: true, published_version_id: null, project_data: null,
    created_at: "", updated_at: "", ...over,
  }) as FunnelStep

const card = (f: Funnel, steps: FunnelStep[] = [step()]) =>
  render(<FunnelCard funnel={f} steps={steps} leadCount={0} onDelete={() => {}} />)

describe("FunnelCard, per kind", () => {
  it("shows the goal badge on a landing page", () => {
    card(funnel({ kind: "page", goal: "leads" }))
    expect(screen.getByText("Collect leads")).toBeTruthy()
  })

  it("shows NO goal badge on a funnel, which has no single goal", () => {
    // Presence control above: the same badge renders for a page, so this
    // absence is about the kind and not about nothing having rendered.
    card(funnel({ kind: "funnel", goal: "leads" }))
    expect(screen.queryByText("Collect leads")).toBeNull()
  })

  it("offers the settings screen on a funnel", () => {
    card(funnel({ kind: "funnel" }))
    expect(screen.getByLabelText("Free Trial settings")).toBeTruthy()
  })

  it("offers NO settings screen on a landing page, which has none", () => {
    // /admin/pages/<id> redirects to the list. A button whose only outcome is
    // a bounce back to the screen you are on is the dead end the redirect fixed.
    card(funnel({ kind: "page" }))
    expect(screen.queryByLabelText("Free Trial settings")).toBeNull()
  })

  it("offers Convert to funnel on a landing page only", () => {
    card(funnel({ kind: "page" }))
    expect(screen.getByRole("button", { name: /convert/i })).toBeTruthy()
  })

  it("offers no Convert control on something already a funnel", () => {
    card(funnel({ kind: "funnel" }))
    expect(screen.queryByRole("button", { name: /convert/i })).toBeNull()
  })

  it("calls a landing page a landing page when renaming it", () => {
    card(funnel({ kind: "page" }))
    expect(screen.getByLabelText("Rename Free Trial")).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run __tests__/components/admin/funnel-card-kind.test.tsx`
Expected: FAIL — the goal badge, Convert control and kind-conditional settings button do not exist yet.

- [ ] **Step 3: Implement in `FunnelCard.tsx`**

Add the import and derive the kind:

```tsx
import { ConvertToFunnelDialog } from "./ConvertToFunnelDialog"
import { FUNNEL_GOALS } from "@/lib/validators/funnel"
```

Inside the component, above `return`:

```tsx
  // `funnel.kind` IS THE FACT, never the screen's. A row's own kind decides how
  // it is administered, so a page listed anywhere still behaves like a page.
  const isPage = funnel.kind === "page"

  // A FUNNEL HAS NO SINGLE GOAL — its steps do — so showing one on the
  // container would invent a fact. Only a landing page, which IS one page,
  // carries a goal worth naming.
  const goalLabel = isPage ? FUNNEL_GOALS.find((option) => option.value === funnel.goal)?.label : undefined
```

Pass the badge through to `PreviewCard`:

```tsx
        goalLabel={goalLabel}
```

Replace the `secondaryAction` block's settings button so it is funnel-only, and add Convert:

```tsx
        secondaryAction={
          <>
            {quizOnThisFunnel ? (
              <Button asChild variant="outline" size="sm" title={`Edit ${quizOnThisFunnel.name}`}>
                <Link href={`/admin/funnels/quizzes/${quizOnThisFunnel.id}`}>
                  <ListChecks className="size-4 shrink-0" aria-hidden />
                  Quiz
                </Link>
              </Button>
            ) : null}
            <FunnelGoLiveButton funnelId={funnel.id} status={funnel.status} kind={funnel.kind} canGoLive={entryPublished} />
            {/* A PAGE OUTGROWS ITSELF the moment it needs a thank-you step.
                Explicit, never derived from step count: deriving it would move
                a live page between screens with no warning and no undo. */}
            {isPage ? <ConvertToFunnelDialog funnelId={funnel.id} funnelName={funnel.name} /> : null}
            {/* FUNNEL ONLY. `/admin/pages/<id>` redirects to the list by design,
                so this button on a page is a control whose only outcome is a
                bounce back to the screen the owner is already looking at. */}
            {isPage ? null : (
              <Button asChild variant="outline" size="sm" aria-label={`${funnel.name} settings`}>
                <Link href={adminFunnelHref(funnel.kind, funnel.id)}>
                  <Settings2 className="size-4" />
                </Link>
              </Button>
            )}
          </>
        }
```

Add the `adminFunnelHref` import alongside the existing `adminStepHref` usage, and make the rename noun follow the kind:

```tsx
              noun={isPage ? "landing page" : "funnel"}
```

- [ ] **Step 4: Run the test and the existing card tests**

Run: `npx vitest run __tests__/components/admin/funnel-card-kind.test.tsx __tests__/components/admin/funnel-card-quiz.test.tsx __tests__/components/admin/funnel-list.test.tsx`
Expected: PASS.

Note: `funnel-card-quiz.test.tsx` uses `kind: "funnel"`, so its `getByLabelText("Performance Gap Map settings")` assertion still holds.

- [ ] **Step 5: Mutate each new assertion**

Apply each mutation, run, confirm the named test fails, revert:
1. `const isPage = false` → the page-only tests fail.
2. `const isPage = true` → the funnel-only tests fail.
3. `goalLabel` unconditional → "shows NO goal badge on a funnel" fails.

- [ ] **Step 6: Commit**

```bash
git add components/admin/funnels/FunnelCard.tsx __tests__/components/admin/funnel-card-kind.test.tsx
git commit -m "feat(funnels): the card knows whether its row is a page or a funnel"
```

---

### Task 2: The nested step list appears only when there is a sequence

**Files:**
- Modify: `components/admin/funnels/FunnelCard.tsx`
- Test: `__tests__/components/admin/funnel-card-kind.test.tsx` (append)

**Interfaces:**
- Consumes: Task 1's `isPage`
- Produces: no new exports. `FunnelCard` renders `[data-testid="funnel-step-list"]` only when `steps.length >= 2`.

- [ ] **Step 1: Write the failing test (append to the same file)**

```tsx
describe("FunnelCard's step list", () => {
  it("lists the steps of a multi-step funnel", () => {
    card(funnel({ kind: "funnel" }), [
      step({ id: "s1", name: "Signup", slug: "index", is_entry: true }),
      step({ id: "s2", name: "Thank you", slug: "thank-you", is_entry: false, position: 1 }),
    ])
    expect(screen.getByTestId("funnel-step-list")).toBeTruthy()
    expect(screen.getAllByTestId("funnel-step-row")).toHaveLength(2)
  })

  it("shows no step list for a one-step row, whose single step IS the card", () => {
    // A bordered box holding one row that repeats the card's own title is the
    // "emptier copy" problem the landing-page detail screen was deleted over.
    card(funnel({ kind: "page" }), [step({ name: "Landing page" })])
    expect(screen.queryByTestId("funnel-step-list")).toBeNull()
  })

  it("shows no step list for a ONE-STEP FUNNEL either — it is the count that decides", () => {
    // Not `isPage`. A quiz funnel is kind="funnel" with exactly one step, and
    // it has no sequence to draw any more than a landing page does.
    card(funnel({ kind: "funnel" }), [step({ name: "Quiz" })])
    expect(screen.queryByTestId("funnel-step-list")).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and confirm the last two fail**

Run: `npx vitest run __tests__/components/admin/funnel-card-kind.test.tsx -t "step list"`
Expected: the two "shows no step list" tests FAIL — today the box renders whenever `ordered.length > 0`.

- [ ] **Step 3: Implement**

In `FunnelCard.tsx`, change the `extra` guard from `ordered.length === 0` to:

```tsx
        extra={
          // TWO OR MORE, not "any". A one-step row's single step IS this card:
          // a bordered box repeating the card's own title is exactly the
          // "emptier copy" the landing-page detail screen was deleted over, and
          // it lands identically on a one-step FUNNEL such as a quiz funnel —
          // so the count decides, not the kind.
          ordered.length < 2 ? null : (
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run __tests__/components/admin/funnel-card-kind.test.tsx __tests__/components/admin/funnel-list.test.tsx`
Expected: PASS. If a `funnel-list.test.tsx` case asserts a step list on a one-step fixture, give that fixture a second step — the guarantee is "a sequence is listed", not "a box always exists".

- [ ] **Step 5: Mutate**

Change `ordered.length < 2` to `ordered.length < 1`; confirm both "shows no step list" tests fail. Revert.

- [ ] **Step 6: Commit**

```bash
git add components/admin/funnels/FunnelCard.tsx __tests__/components/admin/funnel-card-kind.test.tsx
git commit -m "feat(funnels): a one-step row has no sequence to draw"
```

---

### Task 3: `FunnelList` learns which board it is

**Files:**
- Modify: `components/admin/funnels/FunnelList.tsx`
- Test: `__tests__/components/admin/funnel-list-kind.test.tsx` (create)

**Interfaces:**
- Consumes: Task 1's kind-aware `FunnelCard`
- Produces: `FunnelListProps.kind?: FunnelKind` (default `"funnel"`). Drives the search placeholder, which create dialog renders, and `BoardEmptyState`'s kind.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/admin/funnel-list-kind.test.tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { FunnelList } from "@/components/admin/funnels/FunnelList"
import type { Funnel, FunnelStep } from "@/types/database"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const funnel = (over: Partial<Funnel> = {}): Funnel =>
  ({
    id: "f1", slug: "free-trial", name: "Free Trial", description: null,
    status: "draft", kind: "page", goal: "leads",
    created_by: null, created_at: "", updated_at: "", ...over,
  }) as Funnel

const step = (over: Partial<FunnelStep> = {}): FunnelStep =>
  ({
    id: "s1", funnel_id: "f1", slug: "index", name: "Landing page", position: 0,
    is_entry: true, published_version_id: null, project_data: null,
    created_at: "", updated_at: "", ...over,
  }) as FunnelStep

const board = (kind: "page" | "funnel", rows = [{ funnel: funnel({ kind }), steps: [step()] }]) =>
  render(<FunnelList funnels={rows} leadCounts={{}} kind={kind} />)

describe("FunnelList, per board", () => {
  it("searches pages on the pages board", () => {
    board("page")
    expect(screen.getByPlaceholderText("Search pages…")).toBeTruthy()
  })

  it("searches funnels and pages on the funnels board", () => {
    board("funnel")
    expect(screen.getByPlaceholderText("Search funnels and pages…")).toBeTruthy()
  })

  it("offers New page on the pages board and not New funnel", () => {
    board("page")
    expect(screen.getByRole("button", { name: /new page/i })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /new funnel/i })).toBeNull()
  })

  it("offers New funnel on the funnels board and not New page", () => {
    board("funnel")
    expect(screen.getByRole("button", { name: /new funnel/i })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /new page/i })).toBeNull()
  })

  it("uses the landing-page empty state on an empty pages board", () => {
    render(<FunnelList funnels={[]} leadCounts={{}} kind="page" />)
    expect(screen.getByText(/landing page/i)).toBeTruthy()
  })

  it("defaults to the funnels board when no kind is given", () => {
    // Every existing caller omits it; the default must not silently turn
    // /admin/funnels into a pages board.
    render(<FunnelList funnels={[{ funnel: funnel({ kind: "funnel" }), steps: [step()] }]} leadCounts={{}} />)
    expect(screen.getByPlaceholderText("Search funnels and pages…")).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run __tests__/components/admin/funnel-list-kind.test.tsx`
Expected: FAIL — `FunnelList` takes no `kind` and always renders `CreateFunnelDialog`.

- [ ] **Step 3: Implement in `FunnelList.tsx`**

```tsx
import { CreatePageDialog } from "./CreatePageDialog"
import type { Funnel, FunnelStep, FunnelKind } from "@/types/database"
```

Add to `FunnelListProps`:

```tsx
  /**
   * Which board this is. Drives the copy, the create dialog and the empty
   * state — and NOTHING about how a card behaves: a row's own `funnel.kind`
   * decides that, so a page listed anywhere still behaves like a page.
   *
   * DEFAULTS TO `"funnel"` because every caller before /admin/pages moved here
   * was the funnels board, and a default of `"page"` would have turned it into
   * one silently.
   */
  kind?: FunnelKind
```

Signature and body:

```tsx
export function FunnelList({ funnels, leadCounts, quizByStepId = {}, kind = "funnel" }: FunnelListProps) {
```

Toolbar:

```tsx
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={kind === "page" ? "Search pages…" : "Search funnels and pages…"}
          className="sm:max-w-xs"
        />
        <div className="flex flex-1 gap-2 sm:justify-end">
          {kind === "page" ? (
            <CreatePageDialog takenSlugs={funnels.map(({ funnel }) => funnel.slug)} />
          ) : (
            <CreateFunnelDialog takenSlugs={funnels.map(({ funnel }) => funnel.slug)} ownExamples={ownExamples} />
          )}
        </div>
```

Empty state:

```tsx
          <BoardEmptyState kind={kind} />
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run __tests__/components/admin/funnel-list-kind.test.tsx __tests__/components/admin/funnel-list.test.tsx __tests__/components/admin/funnel-card-quiz.test.tsx`
Expected: PASS.

- [ ] **Step 5: Mutate**

1. Default `kind = "page"` → "defaults to the funnels board" fails.
2. Always `CreateFunnelDialog` → "offers New page…" fails.
3. Placeholder always "Search pages…" → "searches funnels and pages…" fails.

- [ ] **Step 6: Commit**

```bash
git add components/admin/funnels/FunnelList.tsx __tests__/components/admin/funnel-list-kind.test.tsx
git commit -m "feat(funnels): one board component, two vocabularies"
```

---

### Task 4: `/admin/pages` renders the shared board; `FunnelBoard` is deleted

**Files:**
- Modify: `app/(admin)/admin/pages/page.tsx`
- Delete: `components/admin/funnels/FunnelBoard.tsx`
- Modify: `__tests__/components/admin/funnel-board-quiz.test.tsx`
- Modify: `__tests__/components/admin/landing-page-has-no-detail-screen.test.tsx`
- Modify: `__tests__/components/admin/funnel-create-assist.test.tsx`

**Interfaces:**
- Consumes: `FunnelList` with `kind`, `FunnelWithSteps` from `FunnelList`, `ownExamplesFromGroups` from `own-examples.ts`
- Produces: nothing new. `BoardPage`, `deriveOwnExamples`, `titlesTheFunnelRow` and `cardTitle` cease to exist.

- [ ] **Step 1: Retarget the three test files first, and watch them fail**

In all three, replace the import and the render target:

```tsx
// was: import { FunnelBoard } from "@/components/admin/funnels/FunnelBoard"
import { FunnelList } from "@/components/admin/funnels/FunnelList"
```

`funnel-board-quiz.test.tsx` and `landing-page-has-no-detail-screen.test.tsx` render `<FunnelBoard kind pages funnels leadCounts quizByStepId />`. Replace each with:

```tsx
render(
  <FunnelList
    kind="page"
    funnels={[{ funnel: funnel(), steps: [step()] }]}
    leadCounts={{}}
    quizByStepId={quizByStepId}
  />,
)
```

In `funnel-create-assist.test.tsx`, replace `deriveOwnExamples(pages)` with `ownExamplesFromGroups(groups)`:

```tsx
import { ownExamplesFromGroups } from "@/components/admin/funnels/own-examples"
```

and convert each fixture from `[{ step, funnel }, …]` to `[{ funnel, steps: [step, …] }, …]`. The ordering guarantee — most-stepped first — is unchanged; only the input shape is.

Run: `npx vitest run __tests__/components/admin/funnel-board-quiz.test.tsx __tests__/components/admin/landing-page-has-no-detail-screen.test.tsx __tests__/components/admin/funnel-create-assist.test.tsx`
Expected: they now exercise `FunnelList`. Any failure here is a REAL gap in Tasks 1–3 — fix the component, never the assertion, unless the assertion names something the spec deliberately changed.

- [ ] **Step 2: Point `/admin/pages` at the shared board**

Replace the import and the render in `app/(admin)/admin/pages/page.tsx`:

```tsx
import { FunnelList, type FunnelWithSteps } from "@/components/admin/funnels/FunnelList"
```

Replace the `pages: BoardPage[]` flatMap with the per-funnel shape, keeping the quiz map exactly as it is (it is keyed by step and needs every step):

```tsx
  const withSteps: FunnelWithSteps[] = funnels.map((funnel, index) => ({
    funnel,
    steps: stepsPerFunnel[index],
  }))

  const quizUses = quizUsesInSteps(stepsPerFunnel.flat())
```

and the render:

```tsx
      <FunnelList kind="page" funnels={withSteps} leadCounts={leadCounts} quizByStepId={quizByStepId} />
```

- [ ] **Step 3: Delete `FunnelBoard` and prove nothing imports it**

```bash
rm components/admin/funnels/FunnelBoard.tsx
grep -rn "FunnelBoard\|BoardPage\|deriveOwnExamples\|titlesTheFunnelRow\|cardTitle" --include="*.ts" --include="*.tsx" app components lib __tests__ scripts
```

Expected: no results other than prose in comments. A comment mentioning the deleted component by name is fine and worth keeping where it explains history; an import is not.

- [ ] **Step 4: Run the full admin + funnels suites and the typecheck**

```bash
npx vitest run __tests__/components/admin/ __tests__/lib/funnels/ __tests__/app/
npx tsc --noEmit 2>&1 | grep -c "error TS"
```

Expected: tests pass except the 8 pre-existing failures in `bookkeeping/SetupPanel.test.tsx` (localStorage undefined in `beforeEach`) and `funnel-island-traits.test.ts`. `tsc` count is exactly **251**.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/pages/page.tsx" components/admin/funnels/FunnelBoard.tsx \
  __tests__/components/admin/funnel-board-quiz.test.tsx \
  __tests__/components/admin/landing-page-has-no-detail-screen.test.tsx \
  __tests__/components/admin/funnel-create-assist.test.tsx
git commit -m "refactor(funnels): one board serves both screens; FunnelBoard is deleted"
```

---

### Task 5: Prove it against the real app

**Files:**
- Create: `scripts/capture-one-board.ts`
- Create: `screenshots/one-board/` (2 PNGs + `index.html`)

**Interfaces:**
- Consumes: the running dev server on port 3050 and `.env.local` (the dev clone, ref `anjvztjiokcgiyhobknq`)
- Produces: annotated screenshots of BOTH boards.

- [ ] **Step 1: Build, because a screenshot of a stale bundle proves nothing**

```bash
npm run build
```
Expected: "Compiled successfully".

- [ ] **Step 2: Write the capture script**

Copy the harness from `scripts/capture-quiz-on-the-funnel-card.ts` verbatim — `loadEnv`, `must`, `hideDevChrome`, `shoot`, `markerAt`, `launchChromium`, `signInAsAdmin`, the `CLONE_REF` guard and the `finally` cleanup. It already carries every trap this repo has paid for. Then assert, on `/admin/pages`:

```ts
// The SAME card component as the funnels board, which is the whole change.
must((await page.locator('[data-testid="funnel-card"]').count()) > 0, "the pages board is not rendering funnel cards")
// A landing page has no detail screen, so no control may offer one.
must(
  (await page.locator('a[href^="/admin/pages/"][href$="/edit"]').count()) === 0 &&
    (await page.locator(`a[href="/admin/pages/${pageFunnelId}"]`).count()) === 0,
  "a landing page card offers a settings screen that redirects to this list",
)
// The goal badge is a page-only fact.
must((await page.getByText("Collect leads").count()) > 0, "no goal badge on the pages board")
```

and on `/admin/funnels`, the mirror: cards present, a ⚙ settings link present, and no `Collect leads` badge.

- [ ] **Step 3: Run it**

```bash
APP=http://localhost:3050 npx tsx scripts/capture-one-board.ts .env.local
```
Expected: "All assertions passed." and two PNGs written.

- [ ] **Step 4: LOOK at both PNGs**

Open each and check the card layout — button rows inside the card, nothing clipped by `overflow-hidden`, no empty bordered box on a one-step row. **jsdom has no layout; two card-layout bugs this session were invisible to green tests and obvious in a screenshot.** Fix and re-shoot rather than shipping a known-ugly frame.

- [ ] **Step 5: Write the review sheet**

`screenshots/one-board/index.html`, same shape as `screenshots/quiz-on-the-funnel-card/index.html`: what was asserted in the DOM before each shot, then a `<figure>` per PNG.

- [ ] **Step 6: Commit**

```bash
git add scripts/capture-one-board.ts screenshots/one-board
git commit -m "test(funnels): both boards, driven in the real app"
```

---

### Task 6: Hand back

**Files:**
- Modify: `JOURNAL.md` (never committed — it is in `.gitignore`)
- Modify: the memory directory

- [ ] **Step 1: Journal entry** — dated, `[Feature build-out]`, newest first. Record: the model was sound and the confusion was presentational; the ⚙ button was the first bug the merge would have introduced and the spec caught it before the code; and that an earlier draft of the design proposed giving landing pages a detail screen, which would have reverted a settled, tested decision.

- [ ] **Step 2: Memory** — update `[[live-in-means-architecture-not-styling]]` if this round adds a sighting. Do NOT record anything the repo already states.

- [ ] **Step 3: STOP. Do not merge, do not push, do not deploy.** The standing rule is that outward-facing actions wait for the owner. Leave the branch green and report: what shipped, what was decided autonomously, and the two open items — `deleteFunnel` orphaning a quiz, and white-labelling's `SINGLETON_BUSINESS_ID` blocker.

---

## Self-Review

**Spec coverage:** §1 → Tasks 3–4. §2 (card choice, `titlesTheFunnelRow` and chips disappearing) → Task 4 Step 3's grep proves the helpers are gone; the step-list rule → Task 2. §3's six behaviours → goal badge, Convert, rename noun in Task 1; placeholder, create dialog, empty state in Task 3. §4 (⚙ funnel-only) → Task 1. §5 (no migration) → Global Constraints. §6 (deletion scope) → Task 4. §7 (testing) → every task's mutate step, plus Task 5. §8 risk 2 (permissions registry) → no route changes, so nothing to add; asserted by Task 4 Step 4's suite run over `__tests__/app/`.

**Placeholder scan:** none. Every code step carries real code; every run step carries a real command and an expected result.

**Type consistency:** `kind?: FunnelKind` on both `FunnelCardProps` and `FunnelListProps`, defaulting to `funnel.kind` and `"funnel"` respectively. `FunnelWithSteps` (existing) is the shape `/admin/pages` builds in Task 4 and the shape the retargeted tests use in Task 4 Step 1. `quizByStepId` keeps its existing `Record<string, { id: string; name: string }>` type throughout.
