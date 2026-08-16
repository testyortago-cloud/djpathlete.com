# Making a funnel a funnel: navigation and connections

**Date:** 2026-08-16
**Status:** Approved (design)
**Branch:** `funnel-connections`
**Follows:** `2026-08-16-funnel-create-assist-design.md`

## Problem

The owner reported it in one sentence: *"all of the CTAs step are not connected
and it is reusing the landing page builder that is only good for 1 page."*

Both halves are true, and the second explains the first.

### The builder has no idea it is editing a funnel

`FunnelBuilder` receives `funnelName` and `stepName` and **nothing about its
siblings**. Its header is `← Funnel name / Step name`. The only way to reach
page 2 is to navigate back to `/admin/funnels/[id]` — a card grid with no
ordering, no arrows and no sequence — and click another card, which is a full
page load that discards the chat, the preview and the selection.

Nothing anywhere in the admin draws a funnel as a funnel. The template feature
names four steps; the builder shows one at a time and never mentions the other
three.

### "Not connected" is five separate defects

1. **The inspector cannot set a CTA target at all.**
   `components/admin/funnels/builder/SectionInspector.tsx` says so in capitals:
   *"THE LABEL IS EDITABLE, THE TARGET IS DESCRIBED."* The only way to point a
   button at another page is to ask the chat in prose. There is no step picker
   in the product.

2. **A new CTA defaults to the homepage.** `lib/funnels/sections/fields.ts`
   `blankValueFor` returns `{ label: "Button", target: { kind: "url", href: "/" } }`,
   and nothing downstream ever treats that `/` as the placeholder its own
   comment says it is.

3. **A step CTA is never checked against the funnel's real slugs.**
   `lib/funnels/sections/resolve.ts` states it outright: *"`step` targets are
   deliberately NOT validated here: the funnel's slug list is not available at
   this layer."* `publishGate` therefore blocks unresolved program / pack /
   event refs and unknown FAQ keys, and waves through a
   `{kind:"step", stepSlug:"offer-page"}` pointing at a page that does not
   exist. `renderCtaTarget` only degrades when `funnelBasePath` is missing — a
   *wrong slug* renders a perfectly valid-looking `<a>`. The page publishes
   green and 404s in production.

4. **The form — the real connector on a lead-capture funnel — defaults to a
   dead end.** `lib/funnels/islands.ts` defaults `successMode: "message"`. Step
   one captures the lead, prints "Thanks — you're in", and the thank-you page
   the owner built is never reached. Wiring it means switching to `redirect`
   and hand-typing `/go/<funnel>/<step>` into a free-text box that nothing
   validates. `prompt.ts` Block B advertises step slugs for `{kind:"step"}`
   CTAs and **never** for `redirectUrl`.

5. **Checkout and booking leave the funnel entirely** — `/login?callbackUrl=…`
   and `/contact`.

A read-only probe of the clone database found the single funnel there carrying
six CTAs — three anchors, one program, one booking, one `/contact` — **zero
step CTAs**, and its form set to message-only. Nothing about that funnel is
connected, and nothing in the product said so.

## What we are building

Five pieces. 1 and 2 are the shell; 3, 4 and 5 are the wiring.

1. A **step rail** in a persistent layout, so the funnel is navigable in place.
2. **`lib/funnels/connections.ts`** — one pure reader that answers "what leads
   where", used by the rail, the publish review and the repair tool.
3. **A broken step link blocks publish**, via a required new parameter on
   `resolveDoc`.
4. **Three ways a connection gets made**: the model writes it, the picker sets
   it, the repair tool fixes what is already broken.
5. **Booking returns into the funnel.**

Explicitly **not** building: checkout return. See "What we are not building".

**No migration.** Every connection this spec describes lives in the existing
`funnel_steps.project_data` jsonb document. Nothing is added to any table, so
the migration/Vercel race that `2026-08-16-funnel-create-templates-design.md`
had to write `funnel-schema-support.ts` for does not apply here.

## Design

### 1. The shell — a layout, not a rewrite

Every page keeps its own URL, `/admin/funnels/[id]/edit/[stepId]`. Deep links,
bookmarks, the `?start=1` creation nudge and the `base`-mismatch redirect in
`FunnelBuilderScreen` all keep working untouched. The rail is hoisted one
segment up:

```
app/(admin)/admin/funnels/[id]/edit/layout.tsx   <- new, holds the rail
app/(admin)/admin/funnels/[id]/edit/[stepId]/page.tsx   <- unchanged shape
app/(admin)/admin/pages/[id]/edit/layout.tsx     <- new, four-line twin
```

The `/admin/pages` twin delegates to the same exported shell with
`base="pages"`, exactly as `app/(admin)/admin/pages/[id]/edit/[stepId]/page.tsx`
already delegates to `FunnelBuilderScreen`. One implementation, two URLs, for
the reason `lib/funnels/admin-path.ts` documents: the sidebar highlights by
path prefix.

**Why a layout and not a rewrite into one route.** A Next.js layout persists
across navigation between its `[stepId]` children — clicking page 3 keeps the
rail, the header and the publish state mounted and re-renders only the canvas.
That delivers "a single page where I can navigate to each page" without
inventing a client-side router, without breaking one URL, and without moving
the per-step server-side resolve-and-compile that `page.tsx`'s header comment
explains at length.

**Cost: one query, already paid.** The layout calls `listSteps(funnelId)`,
which already does `select("*")` — so every sibling's `project_data` arrives
in the query the detail screen was making anyway.

**Keeping the rail live.** The layout renders a client `ConnectionsProvider`
that wraps both the rail and `{children}`, seeded with the server-computed
graph. `FunnelBuilder`, a descendant, publishes its current step's connections
into that context whenever its document changes. So wiring a button in the
inspector moves the arrow in the rail immediately; the other steps stay
server-fresh. Without this the rail would be stale the moment you edited
anything, which is precisely the "collected and ignored" failure mode this
repo has shipped twice.

The rail shows, per step in `position` order: the name, the slug, and live/draft
status — reusing `StepList`'s corrected `live = published && funnel.status ===
"published"` rule, not a second opinion about the word "published".

Between two rows it draws an arrow for every `{kind:"step"}` connection
between them, labelled with what carries it ("form", or the button's text). A
step with several onward links gets several arrows, because a funnel page
legitimately has more than one exit and collapsing them to one would be the
same lie the current screen tells by drawing none. A broken link is red and
names the missing slug; a dead end is a muted end-cap on the last row and an
amber one anywhere else.

For a landing page the rail renders a single row. That is honest — a page is
single-page by definition — and the page still gains the picker and the gate.

### 2. `lib/funnels/connections.ts` — one reader

Pure, no I/O, its own tests. The single answer to "what leads where", consumed
by the rail, the publish review and the repair tool, so those three can never
disagree.

```ts
export interface StepWithDoc {
  id: string
  name: string
  slug: string
  position: number
  isEntry: boolean
  doc: SectionDoc | null
}

export type Destination =
  | { kind: "step"; slug: string; exists: boolean }
  | { kind: "external"; href: string }
  | { kind: "offer"; what: string }   // program / pack / event / booking elsewhere
  | { kind: "anchor"; sectionId: string }
  | { kind: "none" }

export interface Connection {
  fromStepId: string
  sectionId: string
  /** Props path within the section — the `DanglingAnchor.field` format. */
  field: string
  /** The button's text, or "Form submit". What the owner will recognise. */
  label: string
  via: "cta" | "form" | "booking"
  to: Destination
}

export interface FunnelConnections {
  connections: Connection[]
  /** `to.kind === "step" && !to.exists`. Blocks publish. */
  broken: Connection[]
  /**
   * Step ids carrying no `{kind:"step"}` connection at all, excluding the one
   * with the highest `position` — which is supposed to end. Warns only.
   */
  deadEnds: string[]
}

export function funnelConnections(
  funnelSlug: string,
  steps: StepWithDoc[],
): FunnelConnections
```

It recognises exactly three connectors, which is all of them:

- a `{kind:"step", stepSlug}` CTA;
- a form island whose `redirectUrl` is inside this funnel — `/go/<funnelSlug>`
  is the entry step, `/go/<funnelSlug>/<slug>` is that step;
- a booking island's `href`, under the same rule.

**`href: "/"` maps to `{kind:"none"}`, not to `external`.** `blankValueFor`'s
own comment defines `/` as the placeholder meaning "obviously a placeholder
rather than a dead link to somewhere real" — so this module honours that
definition rather than reporting the homepage as a deliberate destination.
That one rule is what lets the rail say "not set yet" and the repair tool know
what it may touch, and it is why this design does **not** change
`blankValueFor` to default to the next step: doing so would delete the only
marker in the system that distinguishes "nobody chose" from "somebody chose
the homepage".

**No new schema field for the form's destination.** A form's target stays in
`redirectUrl`. Storing a `successStepSlug` beside it would be a second
representation of one fact — and the URL form has a property the second
representation would lose: every `redirectUrl` an owner has *already* typed by
hand gets validated by this the moment it ships.

`funnelSlug` is a parameter rather than derived, because `funnelConnections`
must stay pure and the slug is the only thing that makes a raw URL legible as
an internal link.

### 3. A broken step link blocks publish

`resolveDoc` gains a **required** third parameter:

```ts
export interface FunnelStepRef { slug: string; name: string }

export function resolveDoc(
  doc: SectionDoc,
  catalogues: Catalogues,
  steps: FunnelStepRef[],
): ResolveResult
```

Required, not optional, and for the reason `Catalogues`' own doc comment gives
for its required fields: a caller that forgets becomes a **compile error**
instead of a silently skipped check. It turns all five production call sites
red until each supplies the list —

- `app/api/admin/funnels/steps/[stepId]/publish/route.ts`
- `app/api/admin/funnels/steps/[stepId]/build/route.ts`
- `app/(admin)/admin/funnels/[id]/edit/[stepId]/page.tsx`
- `app/(funnel)/funnel-preview/[stepId]/page.tsx`
- `components/admin/funnels/builder/publish-actions.ts`

— every one of which already holds the funnel and can call `listSteps`.

`ResolveResult` gains `brokenStepLinks: BrokenStepLink[]`, shaped like
`DanglingAnchor` (`sectionId`, `field`, plus the offending `stepSlug`), and
`publishGate` puts them in **`blockers`** next to unresolved refs — not in
`warnings`, where dangling in-page anchors live. A dead in-page anchor scrolls
nowhere; a dead step link is a 404 on a page the owner is paying to send
traffic to.

**Two lists, not one.** `build/route.ts` already computes `stepSlugs` for the
prompt, filtered to exclude the current step so the model does not link a page
to itself. Validation needs the *unfiltered* list — a page may legitimately
link to itself (a "start over" button) and that is not broken. The filtered
list stays the prompt's; the full list is the validator's.

**The gate fails closed.** `gateSectionDoc` currently lets a catalogue read
failure surface as an error. The step read gets the same treatment: if
`listSteps` throws, publish is refused with "this page's links could not be
checked". The publish route's own comment settles this — a gate that degrades
to permissive *"is not a softer version of this gate, it is the absence of
one"*. The editor screen keeps its opposite and correct default: a read
failure there degrades to "links were not checked" and never turns a page the
owner wants to edit into an error screen.

### 4. Three ways a connection gets made

The first version of this design had one mechanism, `autoConnectOps`, wiring
everything. That was wrong, and the reason is worth recording: `autoConnectOps`
can only rewrite the *inspector's* placeholder `{kind:"url", href:"/"}`, and a
freshly drafted page has never been near the inspector. The model writes
whatever it likes. One mechanism would have left new funnels exactly as
disconnected as they are today while appearing to fix them.

So: three mechanisms, each owning the case it can actually reach — the model
writes it, the owner picks it, the repair tool fixes what is already broken.

**(a) New pages — the prompt.** `BuilderCatalogueInput` gains `nextStepSlug:
string | null` beside `stepSlugs`, and Block A gains a rule: on a page that is
not the last, the primary CTA and any form's success must lead to the next
step, named. Block B renders which slug that is.

This is safe against Block B's caching contract — *"no timestamps, no counts
that change per turn, no ordering that depends on anything but the source
rows"*. The next step's slug is stable for the life of a page.

**(b) The owner — the picker.** `SectionInspector`'s CTA control gains the
destination control it currently refuses: the funnel's pages, a section on this
page, an offer/booking, or another URL. The existing `describeCtaTarget`
sentence stays underneath as confirmation. The form section gains the same
picker for its success destination, writing `/go/<slug>/<step>` into
`redirectUrl`.

`blankValueFor` is **not** changed — a new button still arrives as
`{kind:"url", href:"/"}`. That is deliberate, per the rule in section 2: `/`
is the system's only marker for "nobody has chosen yet", and the rail reports
it as unset and the repair tool is allowed to touch it precisely because it
still means that. A new button that silently pointed at the next step would
look chosen without ever having been.

The comment this replaces argued a picker "would be a second, weaker
resolver". That reasoning holds for `program`/`event` refs, whose validity is
non-local, and the picker respects it: for those kinds it offers exactly
`UnresolvedCta.candidates`, which is `resolve.ts`'s own offer catalogue. A step
slug is not a row id — it is authored text this funnel owns — so a picker over
it is not a second resolver at all.

**(c) Existing funnels — the repair tool.** `autoConnectOps(doc, {funnelSlug,
nextStepSlug})` returns the ops that would connect one page, and **only** in
two unambiguous cases:

1. a CTA whose target is exactly `{kind:"url", href:"/"}` — the placeholder,
   which means "nobody chose this";
2. a form with no `redirectUrl` and `successMode` absent or `"message"`.

It never touches a program, event, booking, anchor, self-link or any URL a
human typed. Returns `[]` when nothing qualifies, so the button can say
"nothing to connect here" instead of pretending.

It surfaces as **"Connect these pages"** in the rail, which shows the exact
list of changes before applying anything, and applies them through the
existing `POST /api/admin/funnels/steps/[stepId]/edit` ops endpoint. That
matters: the change lands as a transcript turn, so it is visible in the chat
and revertible with "go back to here". Auto-wiring is undoable, not magic. No
new API route, and therefore no `lib/permissions/registry.ts` entry.

The comment this replaces argued a picker "would be a second, weaker
resolver". That reasoning holds for `program`/`event` refs, whose validity is
non-local, and the picker respects it: for those kinds it offers exactly
`UnresolvedCta.candidates`, which is `resolve.ts`'s own offer catalogue. A step
slug is not a row id — it is authored text this funnel owns — so a picker over
it is not a second resolver at all.

### 5. Booking returns into the funnel

`BookingIsland` already reads an `href` prop and defaults to `/contact`. It
gets the same step picker, and `connections.ts` reads it as a connector. That
is the whole change — no money path, no new flow.

## What we are not building

**Checkout return, deliberately.** `CheckoutIsland` never touches Stripe: it
routes to `/login?callbackUrl=/client/programs/<id>`. There is no
purchase-completion signal anywhere in a funnel, so "land them on the
thank-you page after checkout" cannot be built honestly here — it would put
"Thanks for your purchase" in front of somebody who has done nothing but log
in. Re-pointing the login callback at the next funnel step is a two-line change
we are choosing not to make for that reason alone.

The real fix is the anonymous checkout already specified in
`docs/superpowers/specs/2026-08-15-funnel-anonymous-checkout-design.md`, whose
money core is built and tested at `lib/funnels/checkout/grant.ts` and called by
nothing. When that ships, its Stripe `success_url` becomes a funnel step and
`connections.ts` gains a fourth connector. Until then the rail reports a
checkout CTA as `{kind: "offer"}` — a real destination, outside the funnel —
rather than pretending it is a step or flagging it as broken.

## Testing

**Pure modules, TDD, refusal cases written before the implementation:**
`connections.ts`, `resolveDoc`'s `brokenStepLinks`, `publishGate`'s new
blocker, `autoConnectOps`.

`autoConnectOps` needs its refusals tested harder than its successes — a
program CTA, a booking CTA, an anchor, a hand-typed URL, a form that already
redirects, and a last step all have to come back `[]`.

**Component tests** for the rail and the picker with `fireEvent`;
`@testing-library/user-event` is not a dependency. Every query scoped with
`within` — a rail renders N rows and this repo has twice shipped a test that
passed against the wrong one.

**Every test that goes green on the first run gets mutated** before it counts.
Both of the last two features shipped a test that passed for a reason its own
comment misnamed.

**`tsc --noEmit` is a gate in its own right**, against the 258-error baseline.
The `resolveDoc` signature change is deliberately a compile error at five call
sites, and the last feature's headline mistake — implementation and mock wrong
in the same direction — was caught by `tsc` and by nothing else.

**A real browser pass before this is called done.** The rail lives outside the
preview iframe but the picker writes through the same op path the canvas does,
and the canvas has already shipped completely inert once with 900+ green tests,
because a node from the iframe is not `instanceof` the parent window's
`Element`. Recognise DOM things by capability, never by `instanceof`.

The end-to-end check is one sentence: build a two-step funnel, wire step one to
step two in the picker, publish, and follow the link on the live `/go` page.

## Risks

| Risk | Handling |
| --- | --- |
| The gate starts blocking publishes that worked yesterday | It only blocks a link to a page that does not exist, which was a 404 either way. The blocker message names the step and offers the picker inline. |
| The layout adds a query per builder open | It does not — `listSteps` already selects `*`, and the layout replaces a read the detail screen was making. |
| `ConnectionsProvider` and the server graph disagree | The provider is seeded from the server graph and only ever overwrites the *current* step's entry, which is the one it has better information about. |
| The repair tool rewrites something deliberate | Two exact-match cases only, a preview of every change before applying, and the whole thing lands as a revertible transcript turn. |
| Deep links break | No route moves. The layout wraps the existing `[stepId]` segment. |
