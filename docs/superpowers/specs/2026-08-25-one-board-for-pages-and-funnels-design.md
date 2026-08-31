# One board for landing pages and funnels — design

**Date:** 2026-08-25
**Status:** approach chosen by the owner in chat ("One board, shared card"); §§1–9
written under the autonomous trigger ("yes do it now goodnight") and flagged for
review on return.
**Branch:** `refactor/one-board-for-pages-and-funnels`, cut from `main` at `45beffb4`.

---

## 0. Why this exists

The owner's report, after finding the Athlete Quiz on the Landing Pages screen
rather than on Funnels:

> "why its in the landing page? can you fix the data model of landing page and
> funnels is too confusing"

The immediate answer is one column. `funnels.kind` is `'page' | 'funnel'`
(migration `00205`), and it decides which admin screen a row appears on. A
landing page and a funnel are **the same row in the same table with the same
`funnel_steps` and the same renderer** — `/go/<slug>` cannot tell them apart.

That flag is branched on in **47 places** across `app/`, `components/` and
`lib/`. The cost is not the branches themselves; it is that the two screens are
two different components that drift.

### The drift, demonstrated

- `FunnelBoard.tsx` (389 lines) serves `/admin/pages`. `FunnelList.tsx` +
  `FunnelCard.tsx` (142 + 318) serve `/admin/funnels`. They render different
  cards with different controls.
- The Quiz button existed on the pages board for a day before the funnels board
  got one, and only because the owner reported the gap. Nothing structural
  would have surfaced it.
- `FunnelBoard`'s own header already admits the endgame: *"The
  `kind === "funnel"` branches are unreached by any screen today; they are left
  in place… because removing them is a separate cleanup with real regression
  surface."* This spec is that cleanup, plus the merge that makes it worth doing.

### What is NOT wrong, and must not be "fixed"

**A landing page has no detail screen, and that is deliberate.**
`/admin/pages/<id>` redirects to the list, pinned by
`__tests__/components/admin/landing-page-has-no-detail-screen.test.tsx`. The
screen it replaced was a step list that repeated the one card the board already
showed, and leaving the editor dropped the owner onto that emptier copy. Every
control it held — go live, public URL, convert, delete — moved onto the card.

An earlier draft of this design proposed giving pages a detail screen "so the
quiz panel is reachable". That reverses a settled decision to solve a problem
already solved a better way: the quiz is reached from the card.

**The two screens having separate URLs is also deliberate.** `admin-path.ts`
records the owner's earlier report — *"IM CREATING A LANDING PAGE WHEN I GO BACK
IM IN THE FUNNEL TAB"* — because the sidebar highlights by path prefix. Sharing
a component must not mean sharing a route.

---

## 1. The decision

**One board component. Two routes. Two vocabularies.**

`/admin/pages` and `/admin/funnels` both render `FunnelList`, which takes a
`kind`. `FunnelBoard` is deleted.

This was chosen over two alternatives the owner was shown:

| Option | Why not |
|---|---|
| Drop `kind` entirely; one screen | Re-creates the "I made a landing page and ended up in the Funnels tab" complaint that produced the split. |
| Derive `kind` from step count | A live page would move tabs by itself when someone adds a step. `ConvertToFunnelDialog`'s own comment already refuses this: *"deriving the type from step count would move a live page between screens with no warning and no undo."* |

---

## 2. Which card survives

**`FunnelCard` — one card per FUNNEL, steps listed inside.**

`FunnelBoard` renders one card per **page** (`BoardPage = { step, funnel }`).
That shape mattered when `/admin/funnels` used it and a three-step funnel was
three loose cards. It serves only `/admin/pages` now, where **one funnel holds
exactly one step**, so per-page and per-funnel are the same card. Nothing is
lost by standardising on per-funnel.

Two things fall out for free:

- **`titlesTheFunnelRow` disappears.** It exists because a landing page's card
  must be titled with the FUNNEL's name (`createFunnel` names the only step
  "Landing page", a label nobody chose, and a list of those read as identical
  rows). `FunnelCard` already titles with `funnel.name` unconditionally, so the
  rule is satisfied by construction rather than by a predicate.
- **The funnel filter chips disappear.** `FunnelBoard` still carries
  `funnelFilter` state; its own comment explains the chips were pointless on the
  pages screen because every funnel holds one page. `FunnelList` has no chips.

### The step list

`FunnelCard`'s nested step list renders only when the funnel has **2 or more**
steps. A landing page has one step, and that step *is* the card — a bordered box
containing a single row repeating the card's own title is the "emptier copy"
problem in miniature.

---

## 3. What moves onto the shared board

Six behaviours exist only on `FunnelBoard` today. Each becomes a `kind`
conditional in one file instead of a difference between two files.

| # | Behaviour | Rule |
|---|---|---|
| 1 | Create dialog | `CreatePageDialog` when `kind === "page"`, else `CreateFunnelDialog` |
| 2 | Goal badge | Rendered only for `kind === "page"`. A funnel is a container; its steps carry goals, so a single goal on the container would invent a fact. |
| 3 | Convert to funnel | `kind === "page"` only |
| 4 | Search placeholder | "Search pages…" / "Search funnels and pages…" |
| 5 | Rename noun | "landing page" / "funnel" |
| 6 | Empty state | `BoardEmptyState` already takes `kind`; pass it through |

---

## 4. The one behaviour change

**The ⚙ settings button becomes funnel-only.**

`FunnelCard` renders it unconditionally today, pointing at
`/admin/funnels/<id>`. On a shared card that would put a control on a landing
page whose only outcome is a redirect back to the list the owner is already
looking at — the exact dead-end the no-detail-screen fix removed.

This is the first bug the merge would have introduced, and naming it here is the
point of writing the spec before the code.

---

## 5. Data model: what is NOT changing

**No migration. `funnels.kind` stays.**

The owner asked to fix a confusing data model. The finding is that the *model*
is sound — one table, one shape, one renderer, one flag — and the confusion was
entirely in the *presentation*: two components that drifted, so the same feature
existed on one screen and not the other.

Dropping the column was offered and declined for the reason in §1. Recording
this explicitly because "fix the data model" invites a migration, and a
migration here would be motion without a defect to fix.

---

## 6. Scope of deletion

- `components/admin/funnels/FunnelBoard.tsx` — deleted (389 lines).
- `deriveOwnExamples`, `titlesTheFunnelRow`, `cardTitle`, `BoardPage` — its
  exported helpers. `deriveOwnExamples` has real tests in
  `funnel-create-assist.test.tsx`; its behaviour is already available as
  `ownExamplesFromGroups(funnels)` in `own-examples.ts`, which `FunnelList`
  uses. The tests retarget onto that.

---

## 7. Testing

Nothing here is a new capability, so every test is a **guarantee that must
survive a component swap**. Three files import `FunnelBoard` and are retargeted
at `FunnelList` with their assertions intact:

| File | Guarantee it protects |
|---|---|
| `funnel-board-quiz.test.tsx` | A page running a quiz offers it from the card |
| `landing-page-has-no-detail-screen.test.tsx` | All three routes into the dead screen stay closed — the editor's back link, the ⚙ button, and the URL |
| `funnel-create-assist.test.tsx` | `deriveOwnExamples` ordering, via `ownExamplesFromGroups` |

New tests:

- The shared board renders the six §3 differences correctly for each `kind`,
  each asserted in BOTH directions. An absence assertion needs a presence
  control: "no goal badge on a funnel" passes just as well when nothing rendered.
- The ⚙ button renders for a funnel and not for a page (§4).
- The step list renders at 2 steps and not at 1 (§2).

Every test mutation-checked before it is believed.

**Verification bar:** targeted suites plus `tsc --noEmit` at the 251 baseline
plus `npm run build`, then BOTH boards driven in the real app with annotated
screenshots. jsdom has no layout — two card-layout bugs this session were
invisible to green tests and obvious in a screenshot.

---

## 8. Risks

1. **`/admin/pages` is a working screen.** Everything here is a refactor of
   something that already works, so the failure mode is silent regression rather
   than a broken build. Mitigated by retargeting the existing tests rather than
   rewriting them, and by screenshotting both boards.
2. **`lib/permissions/registry.ts` maps admin paths**, and unmapped paths are
   denied by default. No route changes here, so no registry change — asserted,
   not assumed.
3. **A peer session shares this checkout.** Stage by pathspec; never `git add -A`.

---

## 9. Out of scope

- Dropping `funnels.kind` (§5).
- `deleteFunnel` orphaning a quiz — tracked separately, destructive, needs the
  owner's explicit call.
- White-labelling the "Quiz"/"Funnel"/"Landing page" nouns. The real blocker is
  `SINGLETON_BUSINESS_ID` in 58 places, which is its own piece of work.
