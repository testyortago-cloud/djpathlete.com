# Funnel creation — templates, a real step plan, and conditional intake

**Date:** 2026-08-16
**Status:** Approved (design)
**Branch:** `funnel-create-templates`

## Problem

`CreateFunnelDialog` asks for a name, a URL and a description, then drops the
owner on a step list holding one card called "Step 1". Three things are wrong
with that, and only the first is the one that gets reported.

1. **You cannot say how many steps you want.** A funnel IS a sequence, and the
   dialog that creates one has no way to describe the sequence. Every step after
   the first is added one `AddStepDialog` at a time, afterwards.

2. **The description is collected and thrown away.** `funnels.description` is
   written by the dialog and read by nothing on the funnel path. The placeholder
   literally says "signup, payment, confirmation" — the owner has already
   enumerated their three steps, and the app makes them go add three steps by
   hand. For a landing page the same field seeds the AI builder's first prompt
   ([edit/[stepId]/page.tsx `creationPrompt`](../../../app/\(admin\)/admin/funnels/[id]/edit/[stepId]/page.tsx));
   for a funnel it is dead text.

3. **The two create flows diverged for a reason that has expired.**
   `CreatePageDialog` asks a goal and hands off to the builder;
   `CreateFunnelDialog` is
   [deliberately plainer](../../../components/admin/funnels/CreateFunnelDialog.tsx)
   because "a funnel is a container: the interesting questions belong to its
   steps". That reasoning is sound and this design does not contradict it — it
   takes it seriously. The questions DO belong to the steps. The mistake was
   concluding that creation therefore cannot ask them, when what follows is that
   creation should ask them **per step**.

## What we are building

A template-driven create dialog that produces a whole funnel — N named, pathed,
goal-bearing steps — and asks only the follow-up questions its chosen template
actually needs. Each step then writes its own first draft the first time it is
opened.

Everything rides the existing engine: same `funnels` + `funnel_steps` tables,
same AI section builder, same publish path, same `/go/<slug>` URLs.

## Design

### 1. The template registry

`lib/funnels/templates.ts`. One typed const, no table.

**Why a code registry and not a `funnel_templates` table:** the dialog must not
be able to offer a template, a step goal or a field the server would refuse.
`FUNNEL_GOALS` already exists for exactly that reason
([lib/validators/funnel.ts:44-58](../../../lib/validators/funnel.ts)) and this
repo has three logged bugs from restating a rule instead of importing the one
that decides (`ask_the_validator_never_restate_it`). A row in a table naming a
goal the section registry cannot resolve is a runtime failure; a const that
`satisfies` the `FunnelGoal` union is a compile error. Changing a template is a
deploy, which is the correct cost for changing what the product means by "an
event funnel".

```ts
export interface TemplateStep {
  name: string
  slug: string            // the first is forced to "index" — see §3
  goal: FunnelGoal | null
}

export interface FunnelTemplate {
  value: FunnelTemplateId
  label: string
  hint: string
  steps: readonly TemplateStep[]
  /** Which extra intake fields this template asks for. THE conditional rule. */
  asks: readonly TemplateAsk[]     // "audience" | "offer" | "dates" | "notify"
  /** Which catalogue the offer picker reads, when `asks` includes "offer". */
  offerKind: OfferKind | null      // "program" | "session_pack" | "event"
}
```

| Template | Steps | `asks` | `offerKind` |
| --- | --- | --- | --- |
| `leads` Capture leads | Signup · Thank you | audience, notify | — |
| `program` Sell a program | Offer · Checkout · Confirmation | audience, offer | `program` |
| `session_pack` Sell a session pack | Offer · Checkout · Confirmation | audience, offer | `session_pack` |
| `event` Fill an event or camp | Details · Register · Payment · Confirmation | audience, offer, dates, notify | `event` |
| `booking` Book a consult | Pitch · Book a time · Confirmation | audience, notify | — |
| `scratch` Start from scratch | Step 1 | audience | — |

`asks` is the whole conditional-fields mechanism. The dialog renders a field iff
the selected template lists it; `createFunnelSchema` **rejects** a field the
template does not list. Hiding and refusing come from the same array, so they
cannot disagree — a hand-crafted POST cannot put an end date on a lead-capture
funnel any more than the dialog can.

`offerKind` filters the picker to one catalogue. An event funnel picks from
`events`, never from all three.

### 2. Data model

One migration, `supabase/migrations/00210_funnel_create_intake.sql`.

On `funnels`:

| Column | Type | Notes |
| --- | --- | --- |
| `template` | `text NULL` | Which template created it. **No CHECK constraint** — see below. |
| `audience` | `text NULL` | ≤300. Feeds every step's draft. |
| `offer_kind` | `text NULL` | `CHECK (offer_kind IN ('program','session_pack','event'))` |
| `offer_ref` | `text NULL` | ≤120, matching `ctaTargetSchema`'s `ref` bound. |
| `starts_at` | `timestamptz NULL` | |
| `ends_at` | `timestamptz NULL` | |
| `auto_offline_at_end` | `boolean NOT NULL DEFAULT false` | |
| `notify_emails` | `text[] NULL` | Per-funnel lead push. |

Plus two table constraints:

- `CHECK ((offer_kind IS NULL) = (offer_ref IS NULL))` — an offer is a kind AND
  a ref or it is neither. A half-set offer renders as a dead CTA.
- `CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)`.

On `funnel_steps`:

| Column | Type | Notes |
| --- | --- | --- |
| `goal` | `text NULL` | Same CHECK vocabulary as `funnels.goal`. |

**`funnel_steps.goal` is the load-bearing one.** It is what lets step 3 know it
is the payment step when the builder opens it, and it is the honest home for the
goal the original spec said belongs to steps rather than to the container.

**Why `template` has no CHECK constraint,** breaking the local convention that
`kind`, `goal` and `status` all follow: those are closed unions the app queries
and branches on. `template` is provenance. A CHECK would mean every new template
needs a migration, which defeats the entire reason §1 chose a code registry over
a table. Unknown values degrade to no badge, never to an error.

**No `intent` column.** The per-step build prompt is composed at read time from
stored columns (§4), exactly as the landing-page prompt already is — a stored
prompt is a copy that goes stale the moment the owner renames the funnel.

### 3. Creating N steps

`createFunnel` currently inserts a funnel plus exactly one hard-coded entry
step. It gains an optional `steps` input:

```ts
createFunnel({ ...funnel, steps?: { name, slug, goal }[] })
```

**Optional, not required.** `CreatePageDialog` and every other existing caller
must keep working untouched; omitting `steps` preserves today's behaviour
exactly, including the `kind === "funnel" ? "Step 1" : "Landing page"` naming.

Rules, enforced in `createFunnelSchema` via `superRefine` so the server is the
authority and the dialog is a courtesy:

- 1–10 steps.
- The first step's slug is forced to `index` and it is the only `is_entry` row.
  `AddStepDialog` already refuses `index` for this reason.
- Step slugs must be unique within the funnel, and each must pass
  `FUNNEL_SLUG_PATTERN`. Uniqueness is per funnel, not global.
- Each step's goal must be a `FunnelGoal` or null.
- `dates` / `offer` / `notify` are refused unless the named `template` lists
  them in `asks`, and `offer_kind` must equal the template's `offerKind`.

Steps insert in one `.insert([...])` call with `position` 0..n-1. A partial
insert would leave a funnel whose step list disagrees with what the owner asked
for, so the multi-row insert is the unit of work; the funnel row is already
committed by then, and a step-insert failure surfaces the same way the existing
single-step failure does (`createFunnel(entry step): …`).

`createFunnel` keeps returning `entryStepId` — the dialog still routes into the
builder with it.

### 4. The lazy per-step first draft

After creating, the dialog routes to
`/admin/funnels/<id>/edit/<entryStepId>?start=1` — the same hand-off
`CreatePageDialog` already does, replacing today's push to the step list.

`creationPrompt` grows from `(funnel)` to `(funnel, step)` and composes from
whatever is stored:

```
Build step 2 of the "Summer Camp 2026" funnel, called "Register".
Its job: capture leads — a form that lands in your inbox.
Who it is for: high-school tennis players and their parents.
What the funnel is for: Registration flow for the summer camp…
The offer is the event "Summer Camp 2026".
This step is part of a 4-step sequence: Details, Register, Payment, Confirmation.
```

It falls back to the funnel's own goal when the step has none, so landing pages
compose exactly the prompt they compose today.

**The firing condition changes in one specific way.** Today:

```ts
start === "1" && draft.doc === null && turns.length === 0
```

becomes:

```ts
(start === "1" || funnel.template !== null) && draft.doc === null && turns.length === 0
```

`?start=1` stays a nudge and stays sufficient. The addition is what makes steps
2..N lazy: opening a never-touched step of a templated funnel from the step list
carries no query string, and should still draft. The real guards are unchanged
and are the ones that matter — a step with no document and no turns has nothing
to lose, and `FunnelBuilder`'s own `initialPromptFired` ref plus the same two
conditions still gate the send client-side.

A funnel created before this migration has `template = null` and therefore
behaves exactly as it does today.

### 5. The dialog

`CreateFunnelDialog` gains, in order: template picker → editable step rows →
conditional intake → description.

**Step count is the row list, not a spinner.** A number set to 4 still leaves
four things to name. Rows support rename, re-path, reorder, delete and add, and
the count is whatever survives. Row 1's path is pinned to `/go/<slug>/` and
cannot be edited or deleted — it is the entry step.

Slug derivation, the reserved-slug check and the in-use hint are unchanged and
still import from the validator rather than restating it.

`GET /api/admin/funnels/offers?kind=<program|session_pack|event>` backs the offer
picker: id, name and a one-line label, admin-gated, filtered to sellable rows.
The picker stores `offer_ref` as the **name**, matching the name-not-UUID
mechanism `lib/funnels/sections/resolve.ts` already substitutes into a real id.
Picking from a list rather than letting the model invent a name is the whole
point: `resolve.ts` stops having to guess.

### 6. Surfacing the new fields

- `PreviewCard` / the funnels board show the run window when set
  ("Runs Jun 1 – Aug 15"), alongside the existing badges.
- The funnel detail header shows the window and the linked offer.
- Nothing is shown for funnels that have none of it, which is every existing row.

### 7. Auto-offline when the window closes

`ends_at` + `auto_offline_at_end` are honoured by a scheduled job following the
five existing insights crons exactly: pure function
`lib/automation/funnel-window-closer.ts` → `POST /api/admin/internal/funnel-window`
(bearer `INTERNAL_CRON_TOKEN`) → `onSchedule` in `functions/src/index.ts`, gated
by `cron_funnel_window_enabled` in `system_settings`, **default false**.

Default-false matches every other cron here and is right for a job that takes
live pages offline. The dialog's checkbox therefore records an intent that a
flag has to be turned on to honour — so the checkbox copy says "when the run
ends" and the funnel detail screen states plainly whether the job is active.
Shipping the checkbox with no job behind it at all would have been the lie; a
disclosed, flag-gated job is not.

Daily at 04:00 UTC. It flips `status` to `draft` for published funnels whose
`ends_at` has passed and whose `auto_offline_at_end` is true, and records an
audit row (`funnel.auto_offline`, category `automation`). Added to the
`automation-health-scanner` expected list so a silent failure surfaces.

### 8. Testing

| Test | Guards |
| --- | --- |
| Registry: every template's step slugs unique, first is `index`, goals are valid `FunnelGoal`s | The registry being wrong is every other bug at once |
| Registry: `asks` includes `offer` iff `offerKind` is non-null | The two halves of the offer rule agreeing |
| Validator: rejects dates on a template whose `asks` lacks them | §1's "hiding and refusing come from one array" |
| Validator: rejects `offer_kind` mismatched to the template | Same, other half |
| Validator: rejects duplicate step slugs, >10 steps, bad slug patterns | The step plan |
| DAL: `createFunnel` with `steps` writes N rows, positions 0..n-1, one `is_entry` | The core change |
| DAL: `createFunnel` without `steps` is byte-identical to today | Every existing caller |
| Dialog: switching template swaps step rows and shows/hides intake fields | The conditional rule, in the UI |
| Dialog: row 1 cannot be deleted or re-pathed | Entry-step integrity |
| `creationPrompt`: composes per step; returns today's string for a goal-bearing page | No regression for landing pages |
| Edit page: prompt fires for a templated funnel's untouched step without `?start=1`, and NOT when turns exist | §4's changed condition, both directions |
| Window closer: only published + past `ends_at` + opted-in rows flip | A job that unpublishes must not over-reach |

Every test must be able to fail for the reason it claims — the dominant defect
class in this repo is a test that passes without verifying its own claim
(`tests_that_cannot_fail`).

## Out of scope

- Editing the template of an existing funnel. Templates describe creation.
- A template editor UI, or moving templates to a table.
- Reverse conversion (funnel → page), unchanged from the 2026-08-12 spec.
- Any change to publishing, versioning, compilation or the `/go/` renderer.
- Any change to `CreatePageDialog`. Landing pages keep their flow.

## Deployment note

The migration must be applied to the **production** Supabase project
(`epzuvz…`). `.env.local` points at a stale clone, so a green localhost proves
nothing about prod (`supabase_two_projects_env_split`). **It ships ready to
apply and is not applied as part of this implementation.**

Application code must not deploy ahead of the migration: the DAL selects the new
columns and a missing column would take the funnels screens down.
