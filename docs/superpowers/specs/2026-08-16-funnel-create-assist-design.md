# Helping the owner fill the New funnel dialog

**Date:** 2026-08-16
**Status:** Approved (design)
**Branch:** `funnel-create-assist`
**Follows:** `2026-08-16-funnel-create-templates-design.md`

## Problem

The template redesign gave the dialog a step plan and conditional intake. It did
not answer the question that comes before all of it: *what should I type?*

An owner opening it for the first time sees six template names and a blank
Describe it box whose contents seed the first draft of every step. The
difference between "summer camp" and a real brief is the difference between a
usable first draft and one that gets rewritten — and nothing in the dialog says
so, or shows what a good one looks like.

Separately, the builder's progress overlay occupies a 448px card in a ~1260px
pane, so the moment the page is actually being written is mostly empty space.

## What we are building

Three things, independent enough to ship in any order.

1. **Ask AI** — an interview that turns a sentence into a filled-in plan.
2. **Examples** — worked examples per template, plus the owner's own funnels.
3. **A progress overlay that fills the preview pane** and is shaped like a page.

## Design

### 1. Ask AI

Two calls, no conversation state, no new table.

| | Endpoint | Model | Returns |
| --- | --- | --- | --- |
| 1 | `POST /api/admin/funnels/ai/interview` `{ brief }` | Haiku | 3-5 questions tailored to the brief |
| 2 | `POST /api/admin/funnels/ai/plan` `{ brief, answers[] }` | Sonnet | the filled plan |

Haiku for the questions because it is an interactive click and the work is easy;
Sonnet for the plan because that is the judgment call. The same split the
strategy agents already use for critique vs reason.

Both call `callAgent` from `lib/ai/anthropic.ts` — structured output, `pRetry`,
and the `jsonTool` workaround for schemas carrying `.min()`/`.max()`. No new AI
plumbing.

`lib/ai/funnel-interview.ts` holds the two prompts and the two schemas, beside
the other single-purpose helpers (`hook-suggestion.ts` is the shape).

#### The sanitiser is the load-bearing part

`lib/funnels/ai-plan.ts` — **pure, no I/O, its own tests** — takes the model's
raw plan and returns one the dialog can accept, or nothing:

- `template` is a Zod enum **derived from `FUNNEL_TEMPLATES`**, so the model
  cannot name a template that does not exist.
- Step slugs are `slugify`'d, de-duplicated, the first forced to
  `ENTRY_STEP_SLUG`, the list capped at `MAX_FUNNEL_STEPS`.
- Every intake field is filtered through the chosen template's **`asks`** array.
  A model that returns dates for a `leads` funnel has them dropped here, because
  `createFunnelSchema` would refuse them and `asks` is already the one authority
  on that question.
- Step `goal` values are checked against `FUNNEL_GOALS`; anything else becomes
  null rather than failing the whole plan.

So the model meets exactly the constraints a human does, and no rule is
restated — the sanitiser imports the same registry the dialog and the validator
read. This repo has three logged bugs from restating a rule
(`ask_the_validator_never_restate_it`); a fourth introduced by an AI-shaped
side door would be the same bug wearing a new hat.

#### The offer is the one that can do real damage

`offer.ref` is dropped unless it **exactly matches a live entry** in
`loadCatalogues().offer`, compared case-insensitively on the trimmed name.

An invented product name would otherwise pass every other check — it is just a
string — and land as a `ref` that `resolve.ts` cannot resolve, producing a
disabled placeholder button on a page the owner believes is finished. Matching
against the catalogue means the plan either names something real or names
nothing. The match happens in the **route**, not the pure sanitiser, because it
needs the catalogue; the sanitiser takes the allowed names as an argument so it
stays pure and testable.

#### Nothing is applied silently

The plan renders in a review card inside the Ask AI dialog — template, steps,
audience, offer, description — with **Use this** and **Discard**. Discard leaves
the create dialog untouched. Use this fills the fields, and every one is still
editable before Create funnel.

#### Failure is a shrug

Any error at either step shows "Could not draft a plan — carry on filling this
in yourself" and closes. `loadCatalogues` throwing (it does, on a truncated
read, and its own comment requires every caller to wrap it) degrades to "no
offer matched" rather than failing the plan.

No feature flag: admin-only, opt-in per click, costs nothing until pressed.

### 2. Examples

`lib/funnels/examples.ts` — a typed const beside `templates.ts`, one worked
example per template: name, slug, step plan, audience, description, and a
one-line **why it works**.

It is code rather than data for the same reason the template registry is: an
example naming a template or goal that does not exist should be a compile error.
`examples.test.ts` asserts every example's `template` resolves via `getTemplate`
and its step plan matches that template's shape, so an example cannot drift from
the template it claims to demonstrate.

Below the curated set, **the owner's own funnels**, when there are any. No new
endpoint and no new query: `app/(admin)/admin/funnels/page.tsx` already loads
`funnels` plus `stepsPerFunnel` and hands `FunnelBoard` both. `FunnelBoard`
derives the list and passes it to `CreateFunnelDialog` as a prop.

Each own-funnel row shows its name, step count and live/draft state. **Start
from this** on a curated example fills the dialog exactly as Ask AI does — same
apply path, so there is one way for anything to write to those fields. **Copy
this structure** on an own funnel copies the step plan and template only, never
the name or slug, which must stay unique.

The two sections stack in one scrollable modal. When the owner has no funnels
the second section is absent — not an empty state, because the curated set above
it is already the answer to "show me one".

### 3. The progress overlay fills the pane

[`FunnelBuilder.tsx:1391`](../../../components/admin/funnels/FunnelBuilder.tsx)
wraps `GenerationStage` in `h-fit w-full max-w-md`. That 448px cap is what
leaves the pane mostly empty while the page is being written.

- The wrapper becomes full-width with a generous cap (`max-w-5xl`) and stretches
  to the pane's height, so the overlay reads as the page taking shape in the
  place the page will appear — which is what its own comment says it is for.
- `GenerationStage`'s skeleton sections take **page-like proportions** rather
  than uniform bars: a wide hero block, a three-up proof row, a stacked steps
  list. The section kinds are already known (`section.kind` drives the label
  today), so the shape can follow the kind instead of being one generic card.
- The overlay keeps its scrim and stays scrollable — a long plan must not
  overflow the pane — and keeps `motion-reduce` on every animation.

**The byte-identity guarantee is untouched.** This is the editor's overlay, not
the render path; `render-editable.test.ts` asserts published markup is identical
with and without `editable`, and nothing here goes near `render.ts`.

## Out of scope

- Persisting interviews or plans. A plan is applied or discarded, never stored.
- Ask AI on `CreatePageDialog`. Landing pages keep their flow, as before.
- Editing or adding curated examples from the admin UI.
- Any change to publishing, compilation or the `/go/` renderer.

## Testing

| Test | Guards |
| --- | --- |
| Sanitiser: template not in the registry is rejected | The model naming a fiction |
| Sanitiser: dates on a `leads` plan are dropped | The `asks` filter, AI side |
| Sanitiser: duplicate/blank/over-cap step slugs repaired | A plan the server would 400 |
| Sanitiser: first step forced to `index` | A funnel with no front door |
| Sanitiser: unknown step goal becomes null, plan survives | Failing soft on one bad field |
| Route: offer ref not in the catalogue is dropped | The dead-CTA path |
| Route: catalogue read throwing still returns a plan | `loadCatalogues` contract |
| Examples: every example's template resolves and matches its step plan | Examples drifting from templates |
| Dialog: Use this fills the fields; Discard leaves them untouched | Nothing applied silently |
| Overlay: fills its container and keeps the scrim | The reported problem |

Every test must be able to fail for the reason it claims, and any test that
passes on its first run gets its implementation mutated to prove it
(`tests_that_cannot_fail`).
