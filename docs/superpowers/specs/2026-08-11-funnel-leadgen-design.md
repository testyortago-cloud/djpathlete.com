# Funnel builder: streamed generation, lead-gen pages, leads inbox

**Date:** 2026-08-11
**Status:** design approved (owner delegated approval under autonomous mode; the three
scope questions below were answered explicitly before he stepped away)
**Supersedes nothing.** Builds on `2026-08-10-ai-page-builder-sections.md`, whose
architecture — the AI emits a typed `SectionDoc`, never HTML, never CSS, never a UUID —
is load-bearing here and is not reopened.

---

## Why

Three complaints, one screen. The owner drove the shipped AI page builder end to end and
came back with: the wait is boring, the page it produced is not a page that generates
leads, and there is nowhere to see the leads.

All three are true, and each turned out to have a precise cause rather than a taste
disagreement:

1. **The wait is a spinner.** `ChatPane.tsx:112-117` renders `Loader2` + "Working on
   it…" for the ~30s a `callAgent` → `generateObject` round trip takes
   (`build/route.ts:756`). Nothing streams, so there is genuinely nothing to show. The
   owner watched a page get built and was shown a rotating line.

2. **The form is unstyled.** `FunnelForm.tsx:3` declares itself *"deliberately unstyled
   beyond layout: the owner styles the surrounding canvas, and these controls inherit
   from it"* — and `styles.ts:592-595` then gives `.djp-s-form` four rules, none of
   which touch a label, an input, a select, a textarea, the consent line or the submit
   button. Nothing inherits. Every other section kind carries 15-40 lines of styling;
   the one section whose entire job is to capture a lead carries zero, so it renders at
   browser defaults: labels welded to inputs on one line, a submit button that reads as
   body text.

   The theory in that comment was wrong in a specific way worth recording: "inherits
   from the canvas" was true of the GrapesJS era, when the owner really did style the
   surrounding elements by hand. The typed-section builder deleted that canvas. Nobody
   is styling anything by hand any more, so "inherits" now means "gets nothing".

3. **The leads are write-only.** `listSubmissions()` (`lib/db/funnels.ts:382`) is
   imported by **no file in the repo**. The only lead surface is a count badge on the
   funnels board (`admin/funnels/page.tsx:11`). `api/funnels/submit/route.ts` emails
   nobody. Leads land in `funnel_submissions` — name, email, phone, their answers,
   attribution session — and are unreadable. A lead does also create a `users` row with
   `status='lead'`, so a bare name/email shows up under the Lead filter in
   `/admin/clients`; what is invisible is everything that makes the lead actionable:
   which page they came from and what they actually wrote.

---

## Scope

Three tracks, built in this order. They are independent enough to land separately and
are specified separately, but they share one screen and one review.

| Track | What | Blast radius |
|---|---|---|
| A | Streamed generation + wireframe "thinking" stage | build route transport, `lib/ai`, builder UI |
| B | Professional lead-gen page output | registry, render, styles, prompt, resolve, apply |
| C | Leads inbox + email alert + lifecycle | new migration, new DAL, new admin page, submit route |

Track B is the one with real cross-module reach. Track C is the one with a production
migration. Both are called out again in the risk section.

---

## Track A — Watching it think

### A1. The transport decision

The animation must show what the model is **actually writing**, not a timer dressed as
progress. The owner chose that explicitly over a choreographed alternative, and the
reason to honour it is not aesthetic: a timed animation that claims to be showing
section 3 while the model is still on section 1 is a lie the builder tells its owner
every ~30 seconds, and the first time a turn runs long it desynchronises visibly.

So the model call streams.

**`streamAgent<T>()`** joins `callAgent` in `lib/ai/anthropic.ts` — same signature, same
schema, same `providerOptions.anthropic.structuredOutputMode = "jsonTool"`, same
`cacheControl` handling, built on `streamObject` instead of `generateObject`. The
`jsonTool` pin is not optional and is not a style choice: `auto` uses Anthropic
structured outputs, which reject every `minLength`/`maxItems` our Zod schemas compile to
and constrained-decode `z.record(...)` into empty objects. It is the same trap already
documented on `callAgent:93-104`, and the streaming path is one `providerOptions` line
away from stepping in it.

It differs from `callAgent` in exactly one respect, deliberately: **no `pRetry`.**
`callAgent` retries transient 429/5xx around a call that either returns a whole object
or throws. A stream cannot be transparently retried once a consumer has read from it —
the caller has already rendered eight sections when the ninth chunk 529s. Retrying is
therefore the caller's decision, and the build route already owns a two-attempt loop
that handles exactly this. The absence of `pRetry` is a documented property of
`streamAgent`, not an oversight to be "fixed" later.

### A2. What the route returns

`POST /api/admin/funnels/steps/[stepId]/build` becomes an SSE endpoint **on the success
path only.**

Everything that can fail *before* the model is reached keeps its current status code and
JSON body, byte for byte: auth, permission, rate limit, unknown step, `stale_revision`
(409, carrying `currentRevision`), `doc_invalid` (422, carrying `resetToRevision`). That
matters because those codes are load-bearing in the client — `FunnelBuilder.handleErrorResponse`
branches on 409 and 422 to resync the revision and to surface the restore button — and
because a pre-flight failure has, by construction, nothing to stream.

Once the first byte is written the response is 200 and every outcome arrives as an
event, including failure:

| Event | Payload | Meaning |
|---|---|---|
| `phase` | `{phase, label}` | `reading` → `planning` → `writing` → `checking` → `done` |
| `section` | `{key, index, kind, variant, headline}` | one section became identifiable in the streamed JSON |
| `usage` | `{outputTokens}` | throttled to ~4/s, drives the token meter |
| `result` | the existing `TurnResponse`, verbatim | terminal, success |
| `error` | `{error}` | terminal, post-open failure |

`result` carrying the **unchanged** `TurnResponse` shape is what keeps this a transport
change rather than a contract change. Every downstream rule in `FunnelBuilder.applyTurn`
— `compile === null` moves nothing but the revision, `resolutionError !== null` must not
overwrite `unresolved` — survives untouched, because it is handed the same object it
was handed before.

### A3. Where `section` events come from

`streamObject` yields deep-partial objects as tokens arrive. The build result is
`{reply, ops[], blocked}`; for a first draft Block C forces a single `set_page` carrying
the whole page, so `ops[0].doc.sections[]` fills in one element at a time, each becoming
readable roughly in the order the model writes it.

A section is emitted the moment it has a `kind`. `headline` follows a beat later and is
sent as a second event with the same `key`, so the wireframe block appears immediately
and captions itself when the copy arrives. Keyed by `${opIndex}:${sectionIndex}` and
deduped, so a partial that re-reports an already-seen section is dropped rather than
appended.

For an edit turn the same walk covers `update_section` and `insert_section` (each emits
the one section it names) and `set_page` (emits the list).

**Two honest limits, stated here so they are not discovered as bugs:**

- **A retry restreams.** If attempt 1 fails validation and attempt 2 runs, the second
  attempt streams its sections too. The stage *resets* on attempt 2 rather than
  appending, so the owner sees the page rebuild rather than a 16-section page that has
  8 sections.
- **Order is the model's, not the page's.** Sections stream in the order they are
  written, which for `set_page` is document order but for a multi-op edit is op order.
  The stage is a view of the writing, not a preview of the layout. The real preview
  still arrives at `result`.

### A4. `GenerationStage.tsx`

Replaces the "Working on it…" line. Three parts, top to bottom:

- **A phase rail** — four labels, current one lit, completed ones ticked.
- **A wireframe column** — one skeleton block per `section` event, shaped by kind (hero:
  a tall bar, two rules and a pill; bullets: three cards; form: three label/control
  pairs and a pill; steps: numbered rows; and so on), captioned with the real headline
  once it lands. This is the "story" — the page assembling itself out of the model's own
  output.
- **A token meter** — output tokens so far, the visible cost of the thinking.

`prefers-reduced-motion: reduce` removes the shimmer and the block-entry transition;
blocks appear instantly and the phase rail still advances. The stage is `aria-live="polite"`
and announces phase changes only — announcing every section would flood a screen reader
with eight interruptions in twenty seconds.

On `result` the stage unmounts and the existing builder message with its diff receipt
takes its place, so the transcript is unchanged after the fact.

---

## Track B — A page that generates leads

### B1. Style the form (the whole point)

A new `FORM_CSS` block in `styles.ts`, targeting the hooks `FunnelForm` already emits
plus two it will start emitting:

- stacked label above control, never beside it
- controls at a 44px minimum touch target, full width, 1px border, radius from
  `--djp-radius` so it tracks the document's `theme.radius`
- a real focus ring (`--accent`, 2px offset) on every control — currently a keyboard
  user gets whatever the UA gives them over an unstyled input
- the submit button styled as `djp-btn-primary`'s equal, full width on the `split` and
  `boxed` variants, with hover/active/disabled and a "Sending…" state that is visibly
  busy rather than merely relabelled
- consent line, error line and success panel all styled, including the success panel,
  which is the *most* important state on the page and is currently an unstyled `<div>`

`FunnelForm.tsx` gains exactly two attributes, both to avoid brittle selectors:
`data-djp-submit` on the button, and `data-djp-field-type={field.type}` on the field
wrapper (so checkbox rows can be laid out horizontally without depending on `:has()`).
No behaviour change.

**Tone polarity is the trap here**, and it is a documented one. `.djp-s-form.djp-v-boxed`
already gets `background: var(--accent)` at `tone="accent"` and `var(--primary)` at
`tone="dark"`. A form styled only against the default light surface will render a white
input on a white label on an accent band, or invisible placeholder text on the dark one.
Every form rule therefore ships with its `[data-tone="accent"]` and `[data-tone="dark"]`
counterparts, and the tests assert the pairing rather than asserting that a token exists.

### B2. Capture above the fold — the `split` form variant

`FORM_VARIANTS` gains `"split"`: heading and sub on the left with up to four proof
points, the form itself in a card on the right, as a full-width band. `formSectionPropsSchema`
gains `proofPoints?: string[]` (≤4, ≤80 chars each), which renders as ticks and is
ignored by the other two variants.

This is the single highest-leverage change in Track B. The page the owner screenshotted
puts the form at the bottom of a four-screen scroll; a waitlist page's form belongs on
the first screen. No new island, no nesting, no second `formKey` — the existing form
island renders unchanged, just inside a different wrapper.

### B3. A tenth section kind: `proof`

A text-only credential/stat strip — `items: [{value, label}]`, 2 to 5, variants
`strip` and `stats`. Deliberately text-only: a logo bar needs image URLs, and an image
URL is exactly the field the model would hallucinate into a broken `<img>` that compiles
clean with zero warnings (`funnel_compiler_drops_attributes_silently`). "12 years ·
coaching" and "500+ · athletes trained" carry the same trust signal with nothing to
invent.

### B4. Sticky mobile CTA

`SectionDoc` gains an optional top-level `stickyCta?: {label, target}` — not a section,
because it is not in the flow; not on `theme`, because it carries a `CtaTarget` and
`theme` is pure presentation.

Its `CtaTarget` means it must be walked by `resolve.ts` and counted in `unresolved`, or
it becomes a route to publishing a dead button that the compiler reports as `ok: true`.
`apply.ts` gains a `set_sticky_cta` op. It renders after every section and is shown only
under `48rem`.

This is the highest-reach item in the whole spec — registry, apply, resolve, render,
styles, prompt, doc and the publish gate all move — and it is the one to cut first if
anything has to be cut.

### B5. Section polish

Testimonial quotes get card treatment that survives `tone="dark"` (today the dark band
strips the card and leaves three quotes stacked with no separation — visible in the
owner's screenshot). The live-FAQ island's `<details>` gets real chrome instead of the
UA disclosure triangle. Hero vertical rhythm tightens; buttons get hover, active and
`focus-visible` states.

### B6. Teach the model page craft

Block A of the prompt is generated from the registry, so `proof`, `split` and
`stickyCta` document themselves. What must be written by hand is the composition
guidance:

- for an opt-in / waitlist / lead-magnet intent, the **form goes first** as `split`
- one offer, one action, repeated — every CTA on the page points at the same place
- **never `faq.source: "live"` on a campaign page.** That pulls the site-wide FAQ, which
  is why a waitlist page for a strength class currently asks "What is DJP Athlete and
  what services do you offer?". Inline Q&As that answer *objections to this offer* are
  the only correct FAQ on a landing page.
- proof near the top, not buried; footer minimal — a landing page removes exits

---

## Track C — The leads inbox

### C1. Migration `00204`

```sql
ALTER TABLE public.funnel_submissions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;

ALTER TABLE public.funnel_submissions
  ADD CONSTRAINT funnel_submissions_status_check
  CHECK (status IN ('new', 'contacted', 'signed_up'));

CREATE INDEX IF NOT EXISTS funnel_submissions_status_idx
  ON public.funnel_submissions (status, created_at DESC);
```

Additive and non-destructive. **Applied to the dev clone only during this work; production
is left for the owner's go-ahead**, in line with the standing rule about unsupervised
outward-facing actions. Since the code is also not being pushed, the two stay in step:
one go-ahead applies the migration and deploys the reader together.

### C2. `lib/db/funnel-leads.ts`

A new file rather than more weight on `funnels.ts`: `listLeads(filters)`, `countLeads`,
`setLeadStatus`, `setLeadNotes`, `listLeadsForExport`. Paginated — `funnel_submissions`
is a growth table and `.select()` caps at ~1000 rows.

### C3. `/admin/funnels/leads`

Built on `components/ui/data-table.tsx`, which is the house standard and non-negotiable
per CLAUDE.md — a page that invents its own table reads as a different app. Columns:
when, page, name, contact, status. The row expands to show every answer in the payload.
Filters for page, status, date range and free text; CSV export honours the active
filter. The count badge on the funnels board becomes a link into this page filtered to
that funnel.

Status is a `DataTableBadge` with a dropdown; notes are an inline textarea that saves on
blur.

### C4. Writes are audited

`PATCH /api/admin/funnels/leads/[id]` behind `withAudit()`, with new slugs in
`lib/audit/actions.ts`. A lead's status and notes are exactly the kind of mutation the
audit trail exists for.

### C5. The alert

On a successful submission the submit route fires a plain notification to `COACH_EMAIL`
with the lead's name, contact details, the page they came from, every answer, and a deep
link to the row. **Fire-and-forget, wrapped so it can never fail the submission** — a
visitor who has just handed over their email must see success whatever our mail provider
is doing.

No feature flag. The standing rule is to flag money and mass-email risk; this is one
transactional email to the operator per lead, and flagging it defaults the feature to
off, which recreates the exact problem being fixed.

---

## Risks

**The build route is the delicate one.** 982 lines carrying a compare-and-swap lock, an
owner-message-first write, a two-attempt retry, a blocked-response path and a
generation log. The transport changes; none of that logic does. It all still runs after
the stream closes, in the same order, and the `result` event carries the same object.
The 919-line route test and the 889-line builder test both need a small SSE reader
rather than rewrites.

**`stickyCta` touches eight modules.** Cut first if anything is cut.

**Tone polarity in the new form CSS** is the most likely place for a silent visual bug,
because it is invisible until someone renders a form on an accent band. Tests assert
light/dark/accent pairing, not token existence.

**Nothing is pushed and production is not migrated.** Both are staged for a one-word
go-ahead.

---

## Verification

Targeted suites for what moves — `__tests__/lib/funnels/**`, the build and publish route
tests, the builder component tests, plus new suites for `streamAgent`, the SSE framing,
`GenerationStage`, the form CSS pairing, `proof`, `split`, `stickyCta` resolution, and
the leads DAL/page/export. Plus `npm run build`, which is the separate gate that catches
what `tsc` alone does not.

Not a full-suite run: per the standing rule, targeted tests plus a build.
