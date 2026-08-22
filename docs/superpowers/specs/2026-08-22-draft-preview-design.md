# Full-screen draft preview for landing pages and funnels

**Date:** 2026-08-22
**Status:** approved (chat, "lgtm")

## The problem, in the owner's words

> "in the landing page and funnels, can you create me a preview page, because the
> live page needs for it to publish first before appearing but i want to preview it
> in full screen and test run it without publishing it first"

Two distinct complaints, and they have different causes.

**"I want to see it full screen."** A draft preview already exists and is already
correct — `app/(funnel)/funnel-preview/[stepId]/page.tsx` compiles the draft
through the same `loadCatalogues → resolveDoc → publishGate → reassemble →
compileFunnelStep` sequence publish runs. It is only ever mounted inside the
builder's scaled-down iframe (`PreviewPane`), and nothing links to it at full
size. Meanwhile every "open the page" affordance in the admin points at `/go/…`,
which reads published version rows only:

| Surface | Line | Behaviour when unpublished |
|---|---|---|
| Builder header "Live page" | `FunnelBuilder.tsx:1912` | links to a 404 |
| Funnel detail step cards | `StepList.tsx:93` | `previewUrl={null}` → "No preview yet" |
| Funnels list cards | `FunnelCard.tsx:190` | same |
| Funnels board | `FunnelBoard.tsx:264` | same |

**"I want to test run it."** Currently impossible, and not by oversight.
`/api/funnels/submit` reads the field list from `getPublishedFormConfig(stepId,
formKey)`, which returns `null` when the step has no `published_version_id`
(`lib/db/funnels.ts:584`). On a draft the endpoint answers *"This form is no
longer available."* That is the route's security model, not a bug: the browser
never gets to say what the form contained, so a tampered payload cannot inject
columns and an unpublished form key cannot submit. It must not be weakened.

## Decisions taken, and what was rejected

### 1. A separate preview-submit endpoint that writes nothing

**Rejected: an `is_test` column on `funnel_submissions`.** It was the owner's
first instinct and it is the more dangerous option. `funnel_submissions` has
seven read sites (`lib/db/funnel-leads.ts` ×5, `lib/db/funnels.ts` ×2) plus lead
counts on three card surfaces plus the content-attribution join. Every one would
need a new filter, and the write path does far more than insert a row — it
upserts a lead user, feeds `captureContactFromSubmission` into the contact spine,
files an SMS consent row, emails the coach, and can open a Stripe checkout
session. One missed filter puts fake leads in a real count or a real export.

This repo has already been bitten by exactly this shape: *"name the reader before
writing a column"* is a standing lesson with three prior sightings.

**Taken:** `/api/funnels/preview-submit` performs **zero writes**. It reads the
form config from the DRAFT (`funnel_steps.project_data`), runs byte-identical
required/email validation, and returns the outcome the visitor would have seen —
success message, or the next draft step to walk to. It echoes back the values it
*would* have captured, which is strictly more useful for testing a form than a
hidden flagged row would have been.

The owner's stated requirement was "never pollutes your real leads list". Writing
nothing satisfies that by construction rather than by a filter that has to be
maintained.

### 2. `/preview/<slug>/<step>` — a new route mirroring `/go`

The full-screen preview must walk step to step. `renderCtaTarget`'s `step` case
builds `` `${ctx.funnelBasePath}/${stepSlug}` `` (`render.ts:463`), so a preview
that mirrors `/go`'s **path shape** gets every in-funnel button rewritten for
free, with no renderer change:

```
/go/<slug>/<step>         published version rows   (unchanged)
/preview/<slug>/<step>    the DRAFT, admin-gated   (new)
/funnel-preview/<stepId>  builder iframe           (unchanged)
```

`/funnel-preview/[stepId]` stays exactly as it is. It is keyed by step id because
the builder knows the id and not the slug, and it carries `?edit=1`, which must
never be reachable from a slug-addressed URL.

**Why `/preview` and not `/admin-preview`.** `/go` already established a short
reserved top-level prefix for builder-owned pages, for the stated reason that it
keeps them from colliding with the ~40 hand-coded marketing routes. A second
prefix under the same rationale is consistent. It is not under `/admin` because
the marketing chrome escape is what makes it a true full-screen render — the
`(funnel)` route group exists precisely to drop the navbar, footer and sticky
CTA, and `(admin)` would wrap it in the dashboard shell instead.

### 3. The render is extracted, not duplicated

`/funnel-preview/[stepId]/page.tsx` currently owns ~120 lines of resolve, gate,
reassemble, compile, fail-soft and banner logic. Both routes must produce
identical output for the same document. That file's own header names the failure
this avoids:

> "Preview and publish disagreeing about the same document is a silent, perfectly
> plausible wrong answer, which is the worst failure mode this feature has."

A second hand-rolled copy of the sequence is that failure with a new coat. The
logic moves to `lib/funnels/preview-render.ts`; both routes call it.

### 4. One context field, not two

`FunnelRenderContext` gains a single optional field:

```ts
/**
 * Set ONLY by the full-screen draft preview. Its presence means both "post to
 * the preview-submit endpoint" and "rewrite in-funnel redirects onto basePath".
 * Absent everywhere else, so /go is byte-identical to what it was.
 */
testRun?: { basePath: string }
```

One field rather than a `testRun: boolean` beside a `previewBasePath: string`,
because two fields that must agree eventually disagree. The builder already
learned this: `editable` is passed to `reassemble` and to the island context from
one source for exactly this reason (`funnel-preview/[stepId]/page.tsx`, the
`editable` comment).

### 5. A dismissible pill, not a banner

The existing preview deliberately renders bare — "the preview is supposed to look
exactly like the published page". Full-screen in its own tab that becomes a
liability: the page is then indistinguishable from the live site, which is how a
`/preview` link gets sent to a client by mistake. A small pill, bottom-right,
dismissible for the session, naming the state and offering "Open the live page".
Not a top banner, which would push the fold and change the very layout being
judged.

## Architecture

```
/preview/<slug>/<step>  (server component, (funnel) group)
  ├─ auth() gate: admin|staff else notFound()      ← fail closed, 404 not redirect
  ├─ resolve slug → funnel, step slug → step row
  └─ renderDraftPreview()          lib/funnels/preview-render.ts   [EXTRACTED]
       ├─ getDraft(stepId)                    → doc | docInvalid | null
       ├─ loadCatalogues() + listSteps()      → catalogues, pages   [fail soft]
       ├─ resolveDoc(doc, …)                  → resolution
       ├─ publishGate(resolution)             → blockers
       ├─ reassemble(doc, { funnelBasePath }) → html, css, problems
       └─ compileFunnelStep(…)                → nodes, css
  └─ <NodeRenderer context={{ …, isPreview: true, testRun: { basePath } }} />
       └─ FormIsland → FunnelForm
            └─ submit → POST /api/funnels/preview-submit    [NO WRITES]
```

`funnelBasePath` is `/preview/<slug>` here and `/go/<slug>` in the builder
iframe, which is the whole of the step-walking difference.

## Data flow: a test submission

1. `FunnelForm.handleSubmit` sees `context.testRun` → posts to
   `/api/funnels/preview-submit` with `{ stepId, formKey, values }`.
2. The endpoint gates `admin|staff`. A non-admin gets 404, matching the page.
3. It reads `getDraft(stepId)`, finds the form island in the **draft doc** by
   `formKey`, and parses its props with `funnelFormFieldSchema` — the same
   schema the live route uses.
4. It applies the same required / email-format rules and returns either
   `{ ok: false, error }` or `{ ok: true, captured, next }`.
5. `next` is the redirect target already rewritten onto `/preview/<slug>/…`, so
   the browser walks to the next draft step. The client never rewrites a URL the
   server did not produce — the same rule `FunnelForm` already applies to
   `sessionUrl`.
6. Nothing is written. No submission row, no lead user, no contact, no consent
   row, no email, no Stripe session.

## The three success modes, in a test run

`successMode` has three values and a test run must answer for all of them. Only
the first walks the funnel; the other two report rather than act, because both
would otherwise take the owner out of an admin-gated preview to somewhere they
cannot come back from.

| `successMode` | Live behaviour | Test-run behaviour |
|---|---|---|
| `message` | shows `successMessage` | identical — shows `successMessage` |
| `redirect`, internal `/go/<slug>/<step>` | navigates | navigates to the rewritten `/preview/<slug>/<step>` — **this is the funnel walk** |
| `redirect`, external `https://…` | navigates | reports "would send you to `<url>`", with the URL as a clickable link the owner may follow deliberately |
| `checkout` | opens a Stripe session | reports "would start a checkout for `<product>`". **No Stripe session is created.** |

The rewrite happens on the SERVER, in `preview-submit`, never in the browser.
`FunnelForm` already refuses to navigate to a URL the server did not produce
(the `sessionUrl` scheme check), and a client-side string replace on
`redirectUrl` would be exactly the second, drifting implementation this design
exists to avoid.

A `redirect` whose target is a step that has **never been drafted** reports
"the next page has no draft yet" rather than walking to an empty preview. The
owner is testing a journey; a blank page at the end of it is a finding, not a
crash.

## Error handling

Inherited from the existing preview and deliberately unchanged:

- **Fails soft.** A catalogue read that throws still renders the draft, with the
  banner saying publishing will refuse it until the links can be checked — which
  is true, because both publish gates fail closed on the same throw.
- **The publish-gate banner** sits above the page rather than replacing it.
- **`docInvalid` / no draft / won't compile** each render their own notice, never
  `notFound()` — "this step does not exist" is a different and wrong statement.
- **The gate is fail-closed** and answers 404, so the route does not confirm that
  a funnel slug exists to someone who may not see it.
- **`robots: noindex, nofollow`** on the route.

## Testing

| Area | What is pinned |
|---|---|
| `preview-render.ts` | Both routes produce identical output for one document — the drift guard that is the reason for the extraction |
| `/preview/[slug]` route | admin/staff pass; client, anonymous, and unknown role each get 404; unknown slug 404s; `noindex` present |
| Step walking | A `step` CTA renders `/preview/<slug>/<next>`, not `/go/…`, and the live route still renders `/go/…` |
| `preview-submit` | draft config is read (not published); required + email rules match the live route's; **the Supabase client is never asked to write** — asserted, not assumed |
| `FunnelForm` | `testRun` posts to preview-submit; absent `testRun` still posts to `/api/funnels/submit`; `editable` still short-circuits before either |
| Entry points | Cards render a draft preview instead of "No preview yet"; builder header shows Preview |

Plus annotated screenshots of the real route at full screen, per the house rule.

## Explicitly out of scope

- Any change to `/api/funnels/submit`, `/go`, or the publish path.
- Any migration. This feature adds no column and no table.
- Caching. `/preview` is dynamic for the same reasons `/go` is.
- Sharing a preview with someone who is not admin or staff. A signed public
  preview link is a different feature with a different threat model.
