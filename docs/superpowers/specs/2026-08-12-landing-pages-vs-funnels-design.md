# Landing pages vs funnels — separation and a real create experience

**Date:** 2026-08-12
**Status:** Approved (design), implementation pending
**Branch:** `worktree-funnel-improvements`

## Problem

Two complaints, one root cause.

1. Creating a landing page is a bare text input and a button. No explanation, no
   choices, no sense of what you are about to make.
2. "Landing pages" and "funnels" are the same thing wearing one label.

The second causes the first. `createFunnel`
([lib/db/funnels.ts:63-88](../../../lib/db/funnels.ts)) inserts a `funnels` row **and**
an entry step named "Landing page" at slug `index`. Every landing page is a
funnel; every funnel is born as a landing page. Because the two concepts are
collapsed, the create control cannot ask a single useful question — any question
would only apply to one of the two things it might be making. So it asks for a
name and stops.

`FunnelBoard` then flattens funnels × steps back into one card per page and the
screen is titled "Landing pages", which is honest about the common case and
silent about the other one.

## What we are building

A stored distinction between a **landing page** (one focused page) and a
**funnel** (an ordered multi-step sequence), two screens that each speak their
own language, and a creation flow that collects enough intent to start building
the page for you.

Both types keep the same engine: the same `funnels` + `funnel_steps` tables, the
same AI section builder, the same publish/versioning path, the same
`/go/<slug>` URLs. Nothing that is live moves or changes address.

## Design

### 1. Data model

One migration, `supabase/migrations/00205_funnel_kind_goal.sql`, adding two
columns to `funnels`:

| Column | Type | Notes |
| --- | --- | --- |
| `kind` | `text NOT NULL DEFAULT 'page'` | `CHECK (kind IN ('page','funnel'))` |
| `goal` | `text NULL` | `CHECK (goal IN ('leads','booking','program','session_pack','event'))` |

`goal` is nullable in the database but required in the create dialog. Those are
not in conflict: every backfilled row predates the field and has no honest value
to give it, and inventing one would put a wrong badge on an existing page. New
pages must choose; old pages show no goal badge until someone edits them.

A CHECK constraint rather than a Postgres enum, matching how `funnels.status` is
already modelled.

**`kind` is stored, never derived.** Deriving it from step count would mean a
page silently relocates between screens the moment a second step is added, and
would turn every "is this a page?" question into a step-count query. This repo
has already been bitten by making a type derivable
(`role_literals_when_role_becomes_derived`): gates fail closed and ownership
fails open. Stored and explicit.

**Backfill:** `kind = 'funnel'` for funnels with ≥2 steps, `'page'` otherwise.

**`goal` is not decorative.** Its values mirror the CTA targets the section
registry already supports
([lib/funnels/sections/registry.ts:85-90](../../../lib/funnels/sections/registry.ts)) —
`program`, `session_pack`, `event`, `booking`, plus `leads` for a form capture.
A goal chosen at creation therefore seeds a CTA the builder can actually
resolve, instead of being a label nobody reads.

`funnels.description` already exists (`max 500`) and is currently never written
by the board. The create dialog starts writing it.

### 2. Routes and navigation

| Path | Screen | Permission |
| --- | --- | --- |
| `/admin/pages` | Landing pages (`kind='page'`) | `funnels` |
| `/admin/funnels` | Funnels (`kind='funnel'`) | `funnels` |
| `/admin/funnels/[id]/edit/[stepId]` | AI builder — unchanged, shared | `funnels` |
| `/admin/funnels/leads` | Leads inbox — unchanged | `funnels` |
| `/admin/funnels/guide` | How-it-works guide | `funnels` |

`/admin/pages` is a **new admin path and must be added to the permissions
registry** at [lib/permissions/registry.ts:435](../../../lib/permissions/registry.ts):

```ts
{ prefix: "/admin/pages", permission: "funnels" },
```

A path absent from the registry fails closed — staff are bounced to
`NO_ACCESS_PATH` with no error explaining why. This repo has shipped that bug
before (`permissions_registry_traps`), which is why §7 requires a test asserting
the resolution rather than trusting the edit.

No new API namespace. Landing pages and funnels both use `/api/admin/funnels`.
Landing-page cards link into `/admin/funnels/<id>/edit/<stepId>` rather than
duplicating the builder route under `/admin/pages`; both prefixes map to the
same permission, so the cross-link is safe.

Sidebar gains a second entry. Both entries are gated on the same `funnels`
permission, so no permission-map change is needed for existing staff.

### 2a. What happens to `FunnelBoard`

`FunnelBoard` stays one component and gains a `kind` prop rather than being
forked into two near-identical boards. It already renders one card per page and
already filters; the split is a filter plus a vocabulary change, and two copies
would drift.

What varies by `kind`:

| | `page` | `funnel` |
| --- | --- | --- |
| Empty state | teaching copy (§4) | "No funnels yet" + what a funnel is |
| Create dialog | `CreatePageDialog` | `CreateFunnelDialog` |
| Funnel filter chips | hidden (one page each) | shown |
| Goal badge | shown | hidden |
| `⚙` menu | includes "Convert to funnel" | no convert action |

| File | Change |
| --- | --- |
| `app/(admin)/admin/pages/page.tsx` | New. Landing pages screen, `kind='page'`. |
| `app/(admin)/admin/funnels/page.tsx` | Retitled to Funnels, filtered to `kind='funnel'`. |
| `app/(admin)/admin/funnels/guide/page.tsx` | New. |
| `components/admin/funnels/FunnelBoard.tsx` | Gains `kind`; inline create control removed. |
| `components/admin/funnels/CreatePageDialog.tsx` | New. |
| `components/admin/funnels/CreateFunnelDialog.tsx` | New. |
| `components/admin/funnels/ConvertToFunnelDialog.tsx` | New. |
| `components/admin/funnels/PreviewCard.tsx` | Goal badge + description line. |
| `lib/funnels/slug.ts` | New. `slugify` moved out of `FunnelBoard`. |
| `lib/db/funnels.ts` | `listFunnels({ kind })`; `createFunnel` writes kind/goal. |
| `lib/validators/funnel.ts` | §6. |
| `lib/permissions/registry.ts` | `/admin/pages` prefix. |
| `supabase/migrations/00205_funnel_kind_goal.sql` | New. |

### 3. The create experience

`components/admin/funnels/CreatePageDialog.tsx` replaces the inline input and
button in `FunnelBoard`.

Fields:

- **Name** — required, 2–120 chars.
- **URL slug** — auto-derived from the name, editable after the user touches it,
  shown live as `darrenjpaul.com/go/<slug>`.
- **Goal** — one of the five values above. Required.
- **Description** — optional, ≤500 chars, persisted to `funnels.description`.

**Slug validation must not restate the rules.** `RESERVED_FUNNEL_SLUGS` and the
slug regex live in [lib/validators/funnel.ts](../../../lib/validators/funnel.ts)
and are currently module-private. Export them and have the dialog import them.
The dialog additionally checks the slug against the funnels it already has in
props for a fast "already in use" hint. The server's existing 409 remains the
authority — the client check is a courtesy, not a gate. Restating a validation
rule instead of calling the validator has caused three bugs here
(`ask_the_validator_never_restate_it`); a guard and its schema must agree by
construction.

`slugify` currently lives at the bottom of `FunnelBoard.tsx`. Move it to
`lib/funnels/slug.ts` so the dialog and the board share one implementation.

**Hand-off to the builder.** On success the dialog routes to
`/admin/funnels/<id>/edit/<stepId>?start=1`. The edit page composes the first
prompt server-side from the stored name, goal and description, and passes it to
`FunnelBuilder` as `initialPrompt`. The builder fires its existing `send`
callback ([FunnelBuilder.tsx:267](../../../components/admin/funnels/FunnelBuilder.tsx))
exactly once, guarded on `initialDoc === null && initialMessages.length === 0`.

The prompt is rebuilt from stored columns and never travels in the URL. `?start=1`
is only a nudge; the guard is the real condition. A refresh therefore cannot
double-fire (turns now exist) and cannot replay stale text (there is none to
replay).

**Funnel creation** gets its own, deliberately plainer dialog: name, slug,
description. No goal — a sequence's goal belongs to its individual steps, not to
the container.

### 4. Info and description

- A one-line explainer under each screen title.
- A teaching empty state: what a landing page is, and the three steps to ship
  one (name + goal → describe it, AI builds → review, go live).
- Cards show the description line and a goal badge alongside the existing
  live/draft badge.
- Inline hints in the create dialog for the URL and what happens on submit.
- `/admin/funnels/guide`, modelled on the existing `/admin/books/guide`:
  landing page vs funnel, naming and URLs, building with AI, reviewing before
  publish, going live, and where leads land.

### 5. Convert to funnel

A landing page that outgrows itself converts explicitly. A `⚙` menu action on
the card opens a confirm dialog, which states that the URL does not change and
the page stays live, then issues `PATCH /api/admin/funnels/<id>` with
`{ kind: 'funnel' }`. The item moves to the Funnels screen and gains step
management.

There is no automatic conversion and no reverse action in this round. A funnel
with several steps cannot become a page without deciding which steps to destroy;
that is a different feature and is out of scope.

### 6. Validators

- `createFunnelSchema` gains `kind` (default `'page'`) and `goal` (optional).
- `updateFunnelSchema` gains `kind` and `goal`.
- Export `RESERVED_FUNNEL_SLUGS` and the slug regex for client reuse.
- New `FUNNEL_GOALS` const exported for the dialog's option list, so the badge
  labels and the schema cannot drift apart.

### 7. Testing

| Test | Guards |
| --- | --- |
| Validator: `kind`/`goal` accept valid, reject invalid | Schema drift |
| DAL: `createFunnel` persists `kind` and `goal` | Columns actually written |
| Permissions: `/admin/pages` resolves to `funnels` | The fail-closed trap in §2 |
| `CreatePageDialog`: slug derivation, reserved-slug rejection, in-use hint | Client/validator agreement |
| `FunnelBuilder`: `initialPrompt` fires once; never fires when turns exist | Double-send and replay |
| Board: `kind='page'` filter excludes funnels and vice versa | The split itself |

Every test must be able to fail for the reason it claims — the dominant defect
class in this repo is a test that passes without verifying its own claim
(`tests_that_cannot_fail`). In particular the permissions test must assert the
resolved permission for the path, not merely that a registry entry exists.

## Out of scope

- Reverse conversion (funnel → page).
- Template gallery / starter `SectionDoc`s. The AI builder is the starting point.
- Any change to publishing, versioning, compilation or the `/go/` renderer.
- Any change to the leads inbox.

## Deployment note

The migration must be applied to the **production** Supabase project
(`epzuvz…`) via `mcp__supabase__apply_migration`. `.env.local` points at a stale
clone, so a green localhost proves nothing about prod
(`supabase_two_projects_env_split`). The migration is **not** applied as part of
this implementation — it ships ready to apply.

Application code must not be deployed ahead of the migration: the DAL selects
`kind`, and a missing column would take the funnels screens down.
