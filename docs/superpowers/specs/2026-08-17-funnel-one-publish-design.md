# One publish for a funnel, and steps that draft themselves

**Date:** 2026-08-17
**Status:** approved, ready to plan

## The report, verbatim

> "There should be no seperate publish again, if i publish it in the builder it
> should publish it now immidately, the whole funnel, also when its a funnel
> when i click publish you can choose publish all or publish steps. And in the
> builder it should start generating the other steps 2, i dont want to click
> the other one for it to be generate"

Three asks, and the first two are the same defect seen from two sides.

## What is actually true today

### Publishing a funnel takes two clicks on two screens, and the second one lies

`FunnelBuilder.publish` POSTs to `/api/admin/funnels/steps/[stepId]/publish`.
That route writes an immutable version row for **one step**, and — for
`kind === "page"` only — flips `funnels.status` to `published`. Its own comment
says so:

> A LANDING PAGE HAS ONE PUBLISH, NOT TWO. […] Funnels are deliberately
> UNCHANGED: publishing step 1 of a five-step funnel must not put the whole
> funnel live.

That reasoning was sound for the shape the feature had then, and the owner has
now rejected the conclusion. The consequence he met: publish in the builder,
be told "Published version 1", then find a second **Publish funnel** button on
`/admin/funnels/<id>` and a 404 at the public URL until he presses it.

**The second button is worse than redundant — it is unguarded.** It calls
`PATCH /api/admin/funnels/[id]` with `{status: "published"}`, and that route
validates the body and writes. It does not look at the steps. So it will
happily mark a funnel published when three of its four pages have never been
built, producing a live funnel whose second page 404s. Nothing anywhere warns
about it. `StepList` and `StepRail` both compute `live = published_version_id
&& funnel.status === "published"` precisely because this split state is
reachable — the UI was taught to describe the inconsistency rather than the
publish path taught not to create it.

### Steps 2..N do not exist until they are clicked

A template creates every step up front (`lib/funnels/templates.ts` — up to five
rows: Details, Register, Payment, Confirmation…). Only the entry step is
drafted, by the `?start=1` nudge from the create dialog. Every later step is
blank until the owner opens it, at which point
`app/(admin)/admin/funnels/[id]/edit/[stepId]/page.tsx:344` notices `draft.doc
=== null && turns.length === 0` and fires its creation prompt.

So the template names four steps and drafts one, and the owner has to discover
that clicking each card is what builds it. That is the "i dont want to click
the other one for it to be generate".

## Decisions taken

Both were put to the owner and chosen by him.

1. **Publish-all is all-or-nothing.** If any page is unbuilt or has a blocker,
   nothing is published and nothing goes live; the refusal names the pages.
   (Rejected: publish the good ones and skip the rest — that ships a live
   funnel with a dead end in it, which is the exact class of failure this
   change exists to stop.)
2. **Auto-generation chains off step 1.** When the entry step's first draft
   lands, the remaining unbuilt steps draft themselves one at a time in the
   background while the owner keeps editing. (Rejected: fire all steps at
   funnel creation — several concurrent model calls against the builder rate
   limit, and step 2 written without knowing what step 1 said.)

These two compose: by the time the owner reaches Publish, every page has
content, so the all-or-nothing refusal is rare rather than routine.

## Part A — One publish operation, funnel-wide

### A new pure planner

`lib/funnels/publish-plan.ts`

```ts
export interface StepToPublish {
  id: string
  name: string
  slug: string
  position: number
  doc: SectionDoc | null      // the stored draft, parsed; null = not a section doc
  hasPublishedVersion: boolean
}

export interface PagePublishProblem {
  stepId: string
  stepName: string
  problems: string[]
}

export interface FunnelPublishPlan {
  ok: boolean
  /** Steps to write a version row for, in position order. */
  publish: { stepId: string; doc: SectionDoc }[]
  /** Why the funnel cannot be published. Empty iff `ok`. */
  problems: PagePublishProblem[]
}

export function funnelPublishPlan(
  steps: StepToPublish[],
  resolveOne: (doc: SectionDoc) => ResolveResult,
): FunnelPublishPlan
```

The decision logic, stated once, testable with zero mocks:

- **A step with a `SectionDoc`** is resolved and put through the existing
  `publishGate`. Blockers become that page's `problems`.
- **A step with no `SectionDoc` but an existing published version** is left
  alone — not published, not a problem. This is the legacy GrapesJS step
  (`getDraft` reports those as `docInvalid`), and refusing them would freeze
  out every page predating the section editor. It is already serving something
  real; a funnel-wide publish has no document to improve on.
- **A step with neither** is a problem: `"<name> has no content yet."` This is
  the blank page the owner never opened.
- **`ok` is `problems.length === 0`**, and `publish` is only consumed when
  `ok`. A caller that writes `plan.publish` on a plan that is not `ok` is the
  mutant the route tests exist to kill.
- **Order is position order**, so the entry page is written first and a partial
  failure mid-write leaves the funnel more coherent rather than less.
- **`resolveOne` is allowed to throw and the planner does not catch it.**
  `resolveDoc` throws on a document that no longer satisfies `sectionDocSchema`,
  and it throws deliberately so a caller cannot accidentally unblock publish by
  swallowing it into an empty `unresolved`. The planner honours that by letting
  it out; the route's own try/catch turns it into a 422 naming the reason. A
  planner that caught per-step and reported "no blockers" would be the exact
  fail-open this whole subsystem exists to prevent.

### A new route

`POST /api/admin/funnels/[id]/publish`

1. Auth + admin guard, `withAudit({action: "funnel.published", category:
   "admin_write"})`.
2. `getFunnelById`, `listSteps`, and `getDraft` per step.
3. `loadCatalogues()` **once** for the whole funnel, and the page list
   (`steps.map(({slug, name}) => …)`) once. Both are funnel-wide facts; reading
   them per step would be N times the work and could produce a funnel where
   page 1 and page 4 were gated against different catalogues.
4. `funnelPublishPlan(...)` with `resolveOne = (doc) => resolveDoc(doc,
   catalogues, pages)`.
5. **Not ok → 422**, body `{error, pages: PagePublishProblem[]}`. Nothing
   written. The funnel's status is not touched.
6. Ok → `reassemble(doc, {funnelBasePath})` + `publishStep(...)` for each entry
   in `plan.publish`, then `updateFunnel(id, {status: "published"})`.

**Every page is gated before any page is written.** With an all-or-nothing
refusal, a design that gated and wrote page by page would produce the worst
outcome available: three pages published, the fourth refused, the funnel still
a draft, and no single screen able to say what state anything is in.

**It fails closed**, for the reason the step route already gives at length: a
`loadCatalogues` throw is persistent (`assertNotTruncated` throws on *every*
call once a table passes 1000 rows), so failing open would switch the gate off
permanently on the day a table grows. A throw is a 422 naming the reason.

**The funnel row is flipped last.** If a `publishStep` throws mid-way the funnel
stays a draft, which is the recoverable state — pages carrying an unreferenced
version row are invisible, a half-live funnel is not.

**Every step with a doc is republished, including unchanged ones.** Not an
oversight: `getVersionNumber`'s comment explains why "has this changed?" cannot
be answered cheaply or safely (`jsonb` does not preserve key order, and the
stored doc is the *resolved* one, so a renamed program reads as an edit). A
spare version row is cheap; a skipped publish that should have happened is a
stale live page.

### The builder's control

For `funnelKind === "funnel"`, Publish becomes a split button:

```
[ Publish funnel ▾ ]      ▾ → Publish this page only
```

- **Publish funnel** (primary, the default click) → the new funnel route. One
  click, whole funnel live. This is "if i publish it in the builder it should
  publish it now immidately, the whole funnel".
- **Publish this page only** → the existing step route, behaviour completely
  unchanged. This is "publish steps".

`funnelKind === "page"` keeps exactly the single button it has now — a landing
page has one page, and a dropdown offering to publish it two ways would be
noise. The existing one-click-publishes rule
(`FunnelBuilder`'s "PUBLISH PUBLISHES. ONE CLICK, ALWAYS.") is preserved for
both: neither path opens a confirmation.

`canPublish` gates the whole control. The blocker list it is derived from
describes *this* page, which is correct for both actions: a page with an
unresolved CTA cannot be published alone, and cannot be part of a funnel
publish either.

### The refusal

The 422's `pages[]` goes into the chat through the existing `reportRefusal`
path, which is already the repo's rule for this class ("in a chat builder an
error the AI can fix must never be a dead-end toast").

Problems about the page being edited read exactly as they do today. Problems
about **another** page carry that page's name and a link to it, so the owner
lands on the thing that needs fixing rather than being told a name and left to
find it. A page whose only problem is `has no content yet` also offers
**Generate it now**, which enqueues it through Part B's queue — the machinery
is already mounted, and a refusal that can fix itself should.

### The detail screen

`FunnelStatusControl`'s publish button calls the **same** new funnel route
instead of `PATCH {status}`. Unpublish still PATCHes to `draft`.

So there is exactly one funnel-publish operation with two doorways, and neither
can produce the "funnel published, pages are not" split. The button is not
removed — after publishing from the builder the funnel is already live, so what
the owner sees on that screen is `published` + Unpublish, which is what his
screenshot shows and is not a second publish. What is removed is the *only*
path that could take a funnel live without checking its pages.

`kind === "page"` keeps `PATCH` — a landing page's single step is already
gated by the step route, and routing it through a funnel-wide planner would
add a code path with no second page to justify it.

## Part B — Steps that draft themselves

### Where the queue lives

`ConnectionsProvider` (`components/admin/funnels/connections-context.tsx`),
mounted by the edit **layout**. Next keeps a layout mounted while navigating
between its `[stepId]` children, which is the entire reason this works: the
queue survives the owner clicking from page 1 to page 3 and back, and a
generation started on page 1 keeps running while page 3 is on screen.

New state on the context:

```ts
type DraftPhase = "idle" | "queued" | "writing" | "done" | "failed"

interface ContextValue {
  // …existing
  draftPhase: (stepId: string) => DraftPhase
  /** Draft every step that has never been built, oldest position first. */
  startAutoDraft: () => void
  /** Draft one named step now (the refusal's "Generate it now"). */
  draftStep: (stepId: string) => void
}
```

### What it does

`FunnelBuilder` calls `startAutoDraft()` once, when its own **first** draft
lands — the turn that follows `initialPrompt`, not every turn. The provider
then walks the steps needing a draft in position order, **one at a time**,
POSTing `/api/admin/funnels/steps/<id>/build` and consuming the SSE stream.
Each finished document is written into the provider's `docs`, so the rail's
arrows appear as the pages are made.

Sequential rather than parallel: it stays inside
`SECTION_BUILDER_RATE_LIMIT_MAX`, and step N is drafted after step N−1 exists,
which is what makes the prompt's "the full sequence is…" line and
`resolveDoc`'s page list true rather than aspirational.

"Needs a draft" is the same condition the step page already uses — no stored
document and no turns — computed by the layout, which reads both anyway.

### The double-fire this must prevent

If the owner clicks into step 2 while the queue is drafting it,
`[stepId]/page.tsx:344`'s `wantsFirstDraft` is still true (no doc, no turns
yet: the build route writes its turn last), so the builder would fire a
**second** build for the same step. Two concurrent builds on one step race the
optimistic lock and burn a model call.

`FunnelBuilder` therefore asks the provider before sending its initial prompt:
if `draftPhase(stepId)` is `queued` or `writing`, it does not send, and shows
the in-progress state instead. The provider outlives the navigation, so it is
the one thing on the client that knows.

Outside a provider (tests, the draft-preview harness) `draftPhase` returns
`"idle"` and the builder behaves exactly as it does today — the context is
nullable by deliberate design and every consumer degrades.

Cross-tab double-fire is **not** addressed. It is possible today by the same
route, needs a server-side claim to fix properly, and is out of scope; recorded
here so the next reader knows it was seen rather than missed.

### The prompt

`creationPrompt()` currently lives in and is exported from
`app/(admin)/admin/funnels/[id]/edit/[stepId]/page.tsx`. The layout now needs
it too, for every unbuilt step.

It moves to `lib/funnels/creation-prompt.ts` unchanged, and both the layout and
the step page import it. Restating it in the layout is not an option: this repo
has shipped three defects from restating a rule instead of importing it, and a
second copy would let the background draft and the click-through draft write
different pages from the same template.

The layout computes a prompt per unbuilt step (it already reads the funnel and
every step) and hands them to the provider. No new query, no new server action.

### Failure and interruption

- **A failed build** marks that step `failed` and the queue moves on. One model
  refusal must not strand the pages behind it. The rail shows it; opening that
  page still offers the normal creation path.
- **Closing the tab** stops the queue. Nothing is half-written — the build
  route appends its turn last, so an interrupted step still satisfies "no doc,
  no turns" and is picked up on the next open.
- **Nothing here may break the editor.** A queue that throws logs and stops;
  the owner's page is unaffected.

## What is NOT in scope

- **Server-side / durable generation.** The queue is client-side and dies with
  the tab. A job-backed queue survives, and needs a table, a worker and a
  progress channel — a bigger feature than this report asks for. The resume-on-
  open behaviour above is what makes the cheap version acceptable.
- **Publishing a funnel from the funnels *list*.** One doorway per screen the
  owner is actually on.
- **`html`/`css` trust in the step route.** The existing route's header already
  records that the client's markup is not re-derived from the gated document.
  The new funnel route does not have that hole — it reassembles server-side
  from the stored doc — but closing it for the step route is a separate change.

## Testing

**`lib/funnels/publish-plan.ts` — pure, zero mocks.** A blank step is a
problem; a blank step that already has a published version is not; a step whose
CTA does not resolve carries that blocker under its own name; `ok` is false iff
`problems` is non-empty; `publish` is in position order.

**The route.** Real `resolveDoc` / `publishGate` / `loadCatalogues` over mocked
DAL reads, matching `__tests__/app/api/admin/funnels/publish-route.test.ts`:

- one blank page refuses → 422, `publishStep` never called, `updateFunnel`
  never called (three separate assertions — "nothing was written" is the claim,
  and a test asserting only the status code cannot see a partial write)
- an unresolved CTA on page 3 refuses and names page 3
- the happy path publishes every page **and** flips the row
- a catalogue that throws refuses (driven by a real 1000-row read, not a
  `mockRejectedValue`, so it exercises the real fail-closed path)
- a legacy step with a published version and no doc does not block the publish

**The builder.** The split button renders for a funnel and not for a page; the
primary click hits the funnel route; "Publish this page only" hits the step
route; a 422 naming another page renders a link to it.

**The provider.** Drafts unbuilt steps in position order; skips built ones;
does not start a second build for a step already `writing`; a failed step does
not stop the queue.

**The guard.** `FunnelBuilder` does not send its initial prompt when the
provider reports that step as `writing`.

Every new test is mutated before it counts — this repo's dominant defect class
is a test that cannot fail, and the last two funnel stages produced five.

Verification is targeted suites plus `npm run build` and a `tsc --noEmit` count
against the 258 baseline, not a full-suite run.
