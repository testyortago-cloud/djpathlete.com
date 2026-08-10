> # ⚠️ SUPERSEDED — 2026-08-10
>
> **Decision 1 of this spec is wrong.** It resolves the generator's output
> format to sectioned HTML+CSS. That question was already closed: a 12-agent
> design review picked **typed section documents** over free HTML, unanimously
> (security 9/10 vs 4/10, buildability 8/10 vs 5/10), and the kickoff prompt on
> disk says "architecture already chosen, challenge it only with evidence".
>
> This spec was written from a pasted snapshot of that kickoff taken *before*
> it was updated. The file was in the repo the whole time and I did not open it.
>
> **The governing plan is** `docs/superpowers/plans/2026-08-10-ai-page-builder-sections.md`.
>
> What survives here: the Postgres-vs-Firestore reasoning (§4), the
> draft-preview-through-the-real-compiler argument (§5), the GrapesJS deletion
> (§6), and the out-of-scope list (§12). What does not: the output format (§2),
> the sanitiser widening (§8), dropping `project_data` (§4 — the chosen design
> repurposes it), the no-streaming call (§5 — the review's main UX objection was
> exactly the single long call), and the cost table (§3 — unmeasured).

# AI page builder — design

**Date:** 2026-08-10
**Status:** approved (decisions made autonomously per the kickoff brief; owner review on return)
**Supersedes the authoring half of:** `docs/superpowers/specs/2026-08-09-funnel-builder-design.md`
**Plan:** `docs/superpowers/plans/2026-08-10-ai-page-builder.md`

---

## 1. What this replaces, and what it does not

The funnel builder ships today with a GrapesJS drag canvas as its authoring
surface. The owner used it and decided he wants a Lovable / v0 style **prompt
builder** instead: describe the page in chat, the AI generates it, iterate
conversationally, chat history persists per page.

**The claim that this is cheap has been verified against source.**
`lib/funnels/compile/index.ts` declares:

```ts
export interface CompileInput { html: string; css: string; rootId?: string }
```

Nothing below that seam knows GrapesJS exists. The compiler, the sanitiser, the
CSS scoper, `NodeRenderer`, the six islands, `lib/db/funnels.ts`, the public
`/go` route and the admin previews all consume `{ html, css }` or the compiled
`FunnelNode` tree. An AI generator hands over the same two strings.

**Unchanged by this work:** `lib/funnels/compile/css-scope.ts`,
`components/funnels/NodeRenderer.tsx`, `components/funnels/islands/*`,
`lib/funnels/islands.ts` (registry + Zod schemas), the public route, the
submission API, `/admin/funnels` board, the `funnels` permission key.

**Changed:** `lib/funnels/compile/sanitize.ts` (allowlist widening, §7),
`lib/db/funnels.ts` (publish reads the draft server-side), the validators, and
the entire `/admin/funnels/[id]/edit/[stepId]` screen.

**Deleted:** `components/admin/funnels/FunnelEditor.tsx`,
`components/admin/funnels/FunnelEditorLoader.tsx`, the `grapesjs` dependency.

---

## 2. Decision 1 — output format: **sectioned HTML + CSS through the existing compiler**

The three options in the brief were (a) HTML+CSS through the compiler, (b)
`FunnelNode` JSON via a tool call, (c) a fixed section library the model fills.

**Chosen: (a), with one structural addition — a page is an ordered list of
sections, and each section carries its own HTML and CSS.**

```ts
interface FunnelSection {
  id: string        // "sec_" + 8 hex chars. Stable for the section's whole life.
  kind: string      // free-form: "hero" | "features" | "testimonials" | ...
  title: string     // human label shown in the chat and the section list
  summary: string   // one line, ≤140 chars — the planner's only view of this section
  html: string      // the section's markup (no wrapper element; assembly adds it)
  css: string       // section-local CSS, namespaced at assembly time
}

interface PageDraft {
  sections: FunnelSection[]   // max 20
  pageCss: string             // page-level theme: fonts, colour vars, body background
}
```

### Why not (b), FunnelNode JSON

1. **It needs a second sanitiser.** Prompt injection reaches this generator
   (§8). A model talked into emitting `{"t":"el","tag":"iframe","attrs":{"src":"…"}}`
   bypasses `htmlToNodes` entirely, so we would have to re-implement the whole
   allowlist as a node-tree validator. Two sanitisers to keep in sync is
   strictly worse than one, and the existing one is mutation-tested with 38
   tests behind it.
2. **Token cost.** `{"t":"el","tag":"h1","attrs":{"class":"hero-title"},"children":[{"t":"text","v":"…"}]}`
   is roughly 2.5× the tokens of `<h1 class="hero-title">…</h1>`.
3. **Training distribution.** Landing-page HTML is one of the best-represented
   things a model has ever seen. Our bespoke node schema is not.

### Why not (c), a fixed section library

That is option A (typed block registry) wearing a chat interface. The owner was
offered it, chose the free-form canvas over it, and this pivot is a change of
*authoring surface*, not a reversal of that call. Re-litigating is out of scope
per the brief.

### What the section boundary buys

The section list is not decoration — it is the mechanism that makes §3 work and
it gives per-section CSS isolation **for free, from existing tested code**:

```ts
// lib/funnels/ai/assemble.ts
assembleDraft(draft) => {
  html: draft.sections
    .map(s => `<section id="djp-sec-${s.id}">${s.html}</section>`)
    .join("\n"),
  css: [draft.pageCss, ...draft.sections.map(s =>
        scopeCss(namespaceKeyframes(s.css, s.id), `djp-sec-${s.id}`))].join("\n"),
}
```

`scopeCss` prefixes every selector with `#djp-sec-<id>`. Publish then calls
`compileFunnelStep({ html, css })`, whose own `scopeCss(css, "djp-funnel-root")`
runs over the already-namespaced output. The two compose correctly —
`#djp-funnel-root #djp-sec-abc .hero-title` — because `scopeSelector`'s
idempotency check is against the funnel-root prefix only. **The compiler is
called with exactly the signature it has today.**

`id` survives the sanitiser (it is in `ALLOWED_ATTRS`); `data-djp-*` does not
(`RESERVED_ATTR_PREFIX`), which is why the section marker is an `id` and not a
data attribute.

**Keyframe namespacing is required, not optional.** `scopeCss` deliberately
skips rules inside `@keyframes`, so two sections both defining
`@keyframes fadeIn` would collide — section 3's animation silently changing
section 1's. `namespaceKeyframes` rewrites `@keyframes X` to
`@keyframes sec_<id>-X` and rewrites `animation` / `animation-name`
declarations that reference it. This is the same drift the whole design exists
to prevent, so it gets the same treatment: a test that fails if it is removed.

---

## 3. Decision 2 — the iteration mechanism (the core problem)

"Make the headline bigger" silently rewriting the testimonials is the #1
complaint about prompt builders. The guarantee here is structural, not
prompt-based.

### Two phases per turn: PLAN (Haiku) then EDIT (Sonnet)

**Phase 1 — plan.** The planner sees the **section manifest** only:

```
sec_a1b2 | hero       | Headline "Rebuild your throwing arm" + CTA into the opt-in form
sec_c3d4 | features   | Three benefit cards with checkmark icons
sec_e5f6 | proof      | Testimonials island, 3 featured
```

~40 tokens per section, never the section HTML. It returns a typed plan:

```ts
const editOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("edit_section"),   sectionId: z.string(), instruction: z.string().max(600) }),
  z.object({ op: z.literal("add_section"),    afterSectionId: z.string().nullable(),
             kind: z.string().max(40), brief: z.string().max(600) }),
  z.object({ op: z.literal("delete_section"), sectionId: z.string() }),
  z.object({ op: z.literal("reorder"),        order: z.array(z.string()).max(20) }),
  z.object({ op: z.literal("edit_theme"),     instruction: z.string().max(600) }),
  z.object({ op: z.literal("regenerate_page"),brief: z.string().max(1200) }),
])

const planSchema = z.object({
  reply: z.string().max(400),
  ops: z.array(editOpSchema).max(6),
  clarification: z.string().max(300).nullable(),
})
```

**Phase 2 — execute.** For `edit_section`, the Sonnet call receives **only**
that section's `html` + `css`, the page theme CSS, the brand rules, and the
instruction. It returns a replacement section.

### The guarantee

`applyOps` is a **pure function** — no model call inside it:

```ts
applyOps(draft: PageDraft, ops: EditOp[], results: Map<string, FunnelSection>): PageDraft
```

New section ids are minted by the **executor**, not by `applyOps` — an
`add_section` op reaching `applyOps` carries a resolved `newSectionId`, which is
also the key its generated section occupies in `results`. That keeps `applyOps`
free of `crypto.randomUUID()` and therefore deterministic under test.

Sections not named by an op are **copied by reference** from the previous draft.
They are never sent to the model, never returned by the model, never
reconstructed. `applyOps` throws if `results` contains a key that is not the
target of an op — so a future refactor that returns a whole page from a section
edit fails loudly instead of silently drifting.

**The pin** (`__tests__/lib/funnels/ai/apply.test.ts`):

> Given a 5-section draft and a stubbed generator returning a new hero,
> `applyOps` output `.sections.filter(s => s.id !== "hero")` is deep-equal to
> the input's, and `.pageCss` is byte-identical.

Plus a second: an `edit_section` op whose stub returns extra sections throws.
Plus a third: `regenerate_page` is the **only** op that may replace all
sections, and the executor for every other op is given no way to.

### Guards on the plan

`validatePlan(plan, manifest)` is pure and runs before anything executes:

- Any `sectionId` / `afterSectionId` not in the manifest → that op is **dropped**.
- `reorder.order` that is not a permutation of the manifest ids → op dropped.
- If every op is dropped, the turn becomes a clarification ("I couldn't find a
  section matching that — which one did you mean?") rather than a silent no-op.
- `regenerate_page` on a page that already has sections requires
  `confirmRegenerate: true` in the request body. The UI shows a confirm dialog.
  Without it the turn returns `needsConfirmation` and changes nothing.

### Context bounding as the page grows

| Call | Input scales with | Typical |
|---|---|---|
| Planner | number of sections (~40 tok each, capped at 20) + last 6 turns' instructions & op summaries | ~2k tok |
| Section edit | ONE section + theme CSS + brand rules + island catalogue | ~3.5k tok |
| Section create | brief + theme CSS + brand rules + island catalogue | ~2.5k tok |

Neither scales with total page size. **Generated HTML never enters the chat
history**; turns store instructions and op summaries. A 20-section page costs
the same per targeted edit as a 3-section page.

### Cost per iteration

Sonnet 4.6 $3/$15 per MTok, Haiku 4.5 $1/$5 per MTok.

| Operation | Cost |
|---|---|
| Targeted edit (plan + 1 section) | **≈ $0.036** |
| Full page generation (outline + 6 sections, parallel) | **≈ $0.18** |
| A page built over ~20 iterations | **≈ $0.90** |

The Sonnet system prompt (brand rules + island catalogue + HTML contract,
~2.5k tokens) is sent with `cacheSystemPrompt: true`; Sonnet 4.6's minimum
cacheable prefix is 1024 tokens so it caches, cutting the repeat-edit input cost
by roughly 90%. The Haiku planner prompt is **not** cached — Haiku 4.5's minimum
cacheable prefix is 4096 tokens, which the planner prompt does not reach, so a
breakpoint there would pay the write premium for zero reads.

---

## 4. Decision 3 — chat history and versions: **Postgres**, migration `00203`

### Postgres vs Firestore

The repo has both precedents. The determining factor is **who owns the loop**:

- Firestore is used where a *Firebase function* runs asynchronously and the
  browser watches (`ai_chat_state/{sessionId}` for the program-builder chat,
  `ai_jobs` for program generation). Cross-runtime handoff needs a store both
  runtimes can reach.
- Postgres is used where a Next route handler owns the request
  (`ai_conversation_history` for the admin chat, `conversations` +
  `messages` for coach↔client messaging).

Page generation runs entirely inside one Next route handler and returns within
the request. There is no background job and no second runtime. Add to that:
the funnel subsystem's four tables are already Postgres with FK cascades, so
deleting a page deletes its chat for free — in Firestore that is a manual
recursive delete nobody will write.

**`ai_conversation_history` itself is not reused**: it is keyed
`(user_id, feature, session_id)` with a CHECK constraint enumerating four
features, and it has no place for a page pointer or a resulting revision. The
chat here belongs to a *page*, not a user. Dedicated tables, same subsystem.

### Schema (`00203`)

```sql
-- Draft state. Append-only; one row per accepted change.
CREATE TABLE public.funnel_page_revisions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id     uuid NOT NULL REFERENCES public.funnel_steps(id) ON DELETE CASCADE,
  seq         integer NOT NULL,                 -- monotonic per step, for display
  parent_id   uuid REFERENCES public.funnel_page_revisions(id) ON DELETE SET NULL,
  sections    jsonb NOT NULL,                   -- FunnelSection[]
  page_css    text NOT NULL DEFAULT '',
  origin      text NOT NULL CHECK (origin IN ('generate','edit','manual','island')),
  summary     text,                             -- "Rewrote the hero"
  created_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (step_id, seq)
);

-- The conversation.
CREATE TABLE public.funnel_chat_turns (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id      uuid NOT NULL REFERENCES public.funnel_steps(id) ON DELETE CASCADE,
  seq          integer NOT NULL,
  role         text NOT NULL CHECK (role IN ('user','assistant','system')),
  content      text NOT NULL,
  ops          jsonb,                           -- the EditOp[] that ran
  revision_id  uuid REFERENCES public.funnel_page_revisions(id) ON DELETE SET NULL,
  model        text,
  tokens_in    integer,
  tokens_out   integer,
  cost_micros  integer,                         -- USD micro-dollars
  duration_ms  integer,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (step_id, seq)
);

ALTER TABLE public.funnel_steps
  ADD COLUMN draft_revision_id uuid
    REFERENCES public.funnel_page_revisions(id) ON DELETE SET NULL;

-- GrapesJS editor state has no successor. Both columns go.
ALTER TABLE public.funnel_steps         DROP COLUMN IF EXISTS project_data;
ALTER TABLE public.funnel_step_versions DROP COLUMN IF EXISTS project_data;

-- The RLS gap from 00202, closed. Every read and write goes through
-- lib/db/funnels.ts, which uses createServiceRoleClient() — service role
-- bypasses RLS, so enabling it with NO policies breaks nothing and closes
-- funnel_submissions (lead names / emails / phones) to anon + authenticated.
ALTER TABLE public.funnels              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funnel_steps         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funnel_step_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funnel_submissions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funnel_page_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funnel_chat_turns     ENABLE ROW LEVEL SECURITY;
```

Verified before writing this: every `.from("funnel…")` call in the repo lives in
`lib/db/funnels.ts`, and `getClient()` there is `createServiceRoleClient()`. No
browser-side Supabase client touches a funnel table. The **12 pre-existing**
RLS-disabled tables Supabase flags are deliberately untouched — enabling RLS on
those without policies would break working features.

`project_data` is **dropped, not repurposed.** Its only content is GrapesJS
editor state, the draft now lives in `funnel_page_revisions`, and prod has never
had the column (prod head is `00201`). The dev clone's row count is checked
before applying.

### Undo is real

- Revisions are **append-only and never deleted**.
- `funnel_steps.draft_revision_id` is the head.
- **Undo** → head becomes `head.parent_id`.
- **Redo** → the most recently created revision whose `parent_id = head.id`.
- Editing after an undo appends a new child of the current head. The abandoned
  branch stays in the table (cheap) and is simply not on the chain from head.
  Every chat turn's `revision_id` therefore stays valid forever.
- An undo appends a `role: 'system'` chat turn ("Reverted to revision N") so the
  conversation is an honest log. It does **not** append a revision.

### Draft vs published stays separate

Only **Publish** writes `funnel_step_versions`. Accepted generations write
`funnel_page_revisions`. This preserves the property already documented in
`00202`: editing a live page changes nothing for visitors until Publish. Undo
operates on revisions; rollback operates on versions (already supported by
pointing `published_version_id` at an older row).

**Publish stops accepting `{html, css}` from the client.** `publishStep` now
takes `{ stepId, publishedBy }`, loads `draft_revision_id`, assembles, and
compiles. This removes a 500KB client-supplied HTML surface and makes "publish
what you see" true by construction rather than by the client and server
agreeing.

---

## 5. Decision 4 — the screen

```
┌───────────────────────────┬──────────────────────────────────────────────┐
│  Chat (380px, sticky)     │  [Desktop|Tablet|Mobile]  Needs input (2)    │
│                           │                    Open ↗   Publish          │
│  ▸ user: "landing page    ├──────────────────────────────────────────────┤
│    for the throwing       │                                              │
│    velocity camp"         │   <iframe src="/go/<slug>?preview=draft">    │
│  ▸ assistant: Built 6     │                                              │
│    sections  [hero]       │                                              │
│    [features] [proof] …   │                                              │
│  ▸ user: "headline        │                                              │
│    bigger"                │                                              │
│  ▸ assistant: Updated     │                                              │
│    the hero  [hero]       │                                              │
│                           ├──────────────────────────────────────────────┤
│  [composer]               │  Sections: hero · features · proof · faq     │
│  ↶ Undo  ↷ Redo           │  (each: Edit HTML · Delete)                  │
└───────────────────────────┴──────────────────────────────────────────────┘
```

### Preview: `?preview=draft` on the existing public route

The existing route already has `?preview=1` (admin/staff only, falls back to the
latest published version). Add `preview=draft`: same `resolvePreview` gate,
but it loads `draft_revision_id`, assembles, and runs `compileFunnelStep`.

Three consequences, all good:

1. **What you preview is what publish produces** — same assembler, same
   compiler, same renderer, same route group (no marketing chrome).
2. **Compile failures surface during iteration.** If the draft cannot publish
   (a `checkout` island with no `productId`), the preview renders the compile
   errors instead of the page. The owner learns at edit time, not at publish
   time.
3. Zero new rendering code.

Rejected: a `srcdoc` iframe of the raw section HTML. It would update instantly
with no round-trip and an empty `sandbox` is genuinely inert — but it would show
HTML the publish compiler is going to strip, which makes the preview a liar
about the one thing it exists to tell you.

The iframe uses `sandbox="allow-same-origin"` (no scripts) — matching
`PreviewCard`, and meaning no form can fire from the preview. Interactive island
behaviour (FAQ accordion) needs the "Open ↗" tab. Documented in the UI.

### Streaming: there is none, deliberately

`streamChat` exists in `lib/ai/anthropic.ts` and is **dead code** — nothing in
`app/api` returns a stream anywhere in this repo. Introducing SSE for this
feature means being the first, in the highest-risk place.

More importantly, token-streaming half-written HTML into a preview shows the
owner a broken page mid-render, which reads as a bug. So:

- **One request per turn.** `POST .../ai/turn` plans, executes (sections in
  parallel via `Promise.all` inside the handler), assembles, writes one
  revision, returns.
- The client shows a staged progress indicator (Planning → Writing N sections →
  Assembling) that is **honest about being optimistic** — it reflects the plan,
  not live model progress. No fake token stream.
- On completion the client bumps the iframe's `key` to force one reload.
- Route sets `maxDuration = 300`. `withTimeout` per model call: 30s planner,
  90s per section. A section that times out becomes a placeholder section
  carrying an error note rather than failing the whole page.

Full-page generation is the slow case: outline (~4s) + 6 parallel sections
(~12s) ≈ **16s**. Targeted edits are ~6–9s.

### Hand editing — the GrapesJS replacement

Each section row has **Edit HTML**, opening a dialog with two textareas (section
`html`, section `css`). Saving runs it through the same assemble + compile
dry-run, shows any compile errors, and on success appends a revision with
`origin: 'manual'`. ~60 lines, no dependency, and it preserves the section model
exactly.

### House design system

The admin chrome follows the house rules: semantic classes, no hex, no inline
`fontFamily`, cards `rounded-xl border border-border bg-white shadow-sm`. The
section list is a **card/row list, not a `<table>`** — same documented exception
as `PreviewCard`, for the same reason (a funnel page is a visual artifact).
The funnel **canvas output** is exempt from the design system by prior decision.

---

## 6. Decision 5 — GrapesJS: **delete**

Recommendation and autonomous decision: remove it.

1. **The two authors are not interchangeable under this model.** The AI
   builder's state is a *section list*; GrapesJS's state is one opaque project
   blob. Round-tripping a canvas edit back into sections means re-parsing its
   HTML and guessing which section each node belongs to — and the section
   boundary is the entire basis of the §3 drift guarantee. A canvas edit that
   reflows sections destroys it. Keeping both means either a one-way canvas
   (edit it and lose chat iteration) or building a section-aware canvas.
2. **Nothing is stranded.** `00202` reached only the dev clone; no page has ever
   been built.
3. **Deletion is clean.** One import site, two files, one dependency.
4. **"Nudge one thing by hand" is served better by §5's Edit HTML dialog** — at
   the same seam, in ~60 lines, with no 500KB dependency and no threat to the
   section model.

**Kept from the GrapesJS-era code:** `island-traits.ts` and `island-props.ts`.
Despite living in the editor folder, `ISLAND_TRAITS` is a generic field
descriptor (`name / label / type / options`) derived from the island registry,
and `island-props.ts` is a pure, tested prop builder. Both power the new island
configuration form (§7). `islandBlockDefinitions()` (the GrapesJS block palette)
is deleted; `islandPlaceholderHtml()` is kept — the generator uses it.
`__tests__/components/admin/funnel-island-traits.test.ts` survives intact,
including the "every default prop is editable" invariant that caught a real bug.

---

## 7. Islands, and the UUID the model cannot invent

`checkout` needs a real `productId`, `event` an `eventId`, `faq` a `pageKey`.
Island defaults deliberately ship **empty** required ids so publishing an
unconfigured block is refused by name — there is a test asserting exactly that,
and it stays.

### Two halves

**Half one — give the model real ids.** The system prompt carries a
**catalogue** built per request from live rows:

```
PROGRAMS (use the id verbatim in productId):
  b3f1… — Comeback Code (paid)
  9a2c… — Rotational Reboot (paid)
SESSION PACKS: …
EVENTS (upcoming only): …
FAQ PAGE KEYS: home, services, camps
LEAD MAGNETS: …
```

Capped at 40 rows per kind, ordered by relevance (active / upcoming / recent).
Adds ~400–800 tokens to a cached system prompt.

**Half two — never trust it.** `validateIslandIds(sections, catalogue)` is pure
and runs on every generated section:

- Walk each island's `data-djp-props`.
- Any UUID field whose value is not in the catalogue for that field's kind →
  **blanked to `""`**, and the island is recorded as unresolved.
- Blank required ids are exactly the state publish already refuses by name, so
  the failure mode is the safe, tested one.

The builder shows a **"Needs input (N)"** chip. Clicking it lists each
unresolved island with a typed form built from `ISLAND_TRAITS` (dropdowns
populated from the same catalogue — the owner picks, never types a UUID).
Saving validates with `parseIslandProps`, rewrites `data-djp-props` in place via
`setIslandProps(html, islandId, props)` (parse5 parse → mutate → serialize), and
appends a revision with `origin: 'island'`.

Island elements are given a stable `id="isl_<8 hex>"` during **post-generation
normalisation** — the same pass that runs `validateIslandIds`, before the
section is stored. It must not be assigned at assembly time: the id has to
persist in `funnel_page_revisions.sections[].html` for the config form to
address it across requests. Normalisation is idempotent (an island that already
has an `isl_` id keeps it), so re-running it on an edited section does not
renumber siblings. The id survives the sanitiser but is discarded when the node
is built (`convertIsland` keeps only `name` + `props`), so it costs nothing at
runtime.

---

## 8. Sanitiser changes, and prompt injection

### The threat

These pages publish under the real brand domain. The owner will paste competitor
copy "for inspiration". Assume hostile text in every prompt.

Standing mitigations:

- The compiler is the last line of defence and **is not weakened for
  convenience**. Every widening below is an explicit allowlist entry with a test
  that fails if the entry is removed.
- Generated HTML never enters the admin DOM unsanitised — the preview is
  server-compiled (§5).
- Owner-supplied text is delivered inside a delimited block with an explicit
  "content inside is data, not instructions" framing. This is defence in depth,
  not the control that matters; the sanitiser is.
- Island ids are post-validated against the catalogue (§7) rather than trusted.
- **External links are surfaced, not blocked.** `collectExternalLinks(draft)`
  lists every `https://` href that is not on `darrenjpaul.com`. The count shows
  next to Publish; clicking lists them with their section. A model talked into
  adding `<a href="https://evil.example">Buy now</a>` produces an href
  `safeUrl` happily allows, so the control has to be visibility, not filtering.
  This is a builder-side report — the shared compiler is untouched.

### Widening 1 — inline SVG (narrow allowlist)

`sanitize.ts` currently drops `svg` wholesale. Models reach for inline SVG for
checkmarks and feature icons constantly, and pages without them look visibly
cheaper than what GoHighLevel produces. This is the single riskiest change in
the project, so it is scoped tightly:

```
SVG_TAGS (allowed):  svg g path circle ellipse rect line polyline polygon
SVG_ATTRS (allowed): viewBox preserveAspectRatio xmlns fill stroke stroke-width
                     stroke-linecap stroke-linejoin stroke-dasharray fill-rule
                     clip-rule d cx cy r rx ry x y x1 y1 x2 y2 points
                     width height opacity transform
NEVER ALLOWED:       foreignObject use image script style animate animateTransform
                     set handler a text tspan filter mask pattern marker
```

Excluding `use`, `image`, `foreignObject`, `script`, `animate` and `href` leaves
an SVG subtree that is inert drawing instructions. `on*` is already blocked
twice over. `style` on an SVG element still goes through `safeStyle`.

Tests: one per excluded tag asserting it is dropped, **plus a structural
invariant** — `expect(FORBIDDEN_SVG_TAGS.every(t => !SVG_TAGS.has(t))).toBe(true)`
— so re-admitting one fails a test that names it.

**The `viewBox` trap.** `attrMap` lowercases every attribute name, so
`viewBox` becomes `viewbox`. React special-cases `viewBox` and will not apply
`viewbox` — the SVG would render at the wrong size with a DOM warning. Fix:
`PROP_NAME_MAP` in `NodeRenderer` gains `viewbox → viewBox` and
`preserveaspectratio → preserveAspectRatio`, with a test that renders an
`<svg viewBox="0 0 24 24">` node and asserts the DOM attribute. Hyphenated SVG
attributes (`stroke-width`, `fill-rule`) survive lowercasing unchanged and React
accepts them as-is.

SVG children are not added to `VOID_TAGS` — React accepts an empty children
array for `<path>`.

### Widening 2 — `details` / `summary` / `open`

A no-JS accordion, no script surface, useful for FAQ-shaped copy the model
writes inline. `open` is added to `ALLOWED_ATTRS`.

### Not widened: iframe hosts

The five permitted hosts (YouTube ×4, Vimeo) cover what a landing page embeds.
No new host means **no `next.config.mjs` CSP change**, which is the one place
jsdom cannot catch a mistake. The existing `frame-src` assertion in
`__tests__/lib/funnels/compile.test.ts` stays as the guard.

---

## 9. API surface

All new routes live under `/api/admin/funnels/`, so the existing
`{ prefix: "/api/admin/funnels", permission: "funnels" }` entry in
`lib/permissions/registry.ts` already covers them by longest-prefix match — **no
registry change needed**. `/api/*` is not covered by `middleware.ts`, so every
route self-gates with `auth()` + `canAccessAdminPath`, and mutations wrap in
`withAudit`.

| Route | Verb | Purpose |
|---|---|---|
| `.../steps/[stepId]/ai/turn` | POST | `{ message, confirmRegenerate? }` → plan, execute, one revision. `maxDuration = 300`. |
| `.../steps/[stepId]/ai/undo` | POST | Move head to `parent_id`. |
| `.../steps/[stepId]/ai/redo` | POST | Move head to newest child. |
| `.../steps/[stepId]/sections/[sectionId]` | PATCH | Manual `{ html, css }` edit → revision `origin:'manual'`. |
| `.../steps/[stepId]/sections/[sectionId]/island` | PATCH | `{ islandId, props }` → revision `origin:'island'`. |
| `.../steps/[stepId]/publish` | POST | **Body now empty.** Assembles from `draft_revision_id`. |
| `.../steps/[stepId]` | PATCH | `project_data` removed from the schema. |

**Audit:** one new slug, `funnel.ai_generated` (`admin_write`) — model-authored
change, the interesting event and the one that spends money. Undo/manual/island
edits use the existing `funnel.updated`.

**Rate limiting:** the in-memory per-user limiter pattern from
`app/api/admin/ai-chat/route.ts`, at 40 turns/hour. Its weakness (per-instance)
is acceptable for a single-operator admin tool.

**Feature flag: none.** Per `no_default_feature_flags`, flags are for money and
mass-email risk. This is an admin-only, permission-gated tool the owner triggers
by hand; spend is a few cents per action and visible in the chat. A flag here
would be a switch nobody flips.

### Model choice

`MODEL_SONNET` (`claude-sonnet-4-6`) for section generation and editing,
`MODEL_HAIKU` (`claude-haiku-4-5-20251001`) for planning — the constants already
in `lib/ai/anthropic.ts`. `callAgent` keeps `structuredOutputMode: "jsonTool"`
(memory `ai_sdk_jsontool_mode`); the section generator returns
`{ kind, title, summary, html, css }` through it. Every call logs to
`ai_generation_log` (`program_id`/`client_id` null, `input_params.feature =
"funnel_page"`) alongside the per-turn token columns.

> The repo's model constants are one generation behind current releases
> (`claude-sonnet-5`, `claude-opus-5` exist). Bumping them changes behaviour for
> every AI feature in the app, so it is deliberately **not** done inside this
> feature. Flagged in the final report as a separate decision.

---

## 10. Module layout

Every decision that matters is in a pure module with no model call and no DB
access, because the last funnel bug shipped in the one untested component
("zero tests is where the bug will be").

```
lib/funnels/ai/
  types.ts           FunnelSection, PageDraft, EditOp, PlanResult, TurnResult
  assemble.ts        assembleDraft, namespaceKeyframes            [pure]
  plan.ts            planSchema, validatePlan                     [pure]
  apply.ts           applyOps  ← the drift pin                    [pure]
  catalogue.ts       buildCatalogue (DB), validateIslandIds       [validate: pure]
  islands-edit.ts    listIslands, setIslandProps                  [pure]
  external-links.ts  collectExternalLinks                         [pure]
  manifest.ts        renderManifest, renderChatContext            [pure]
  prompts.ts         system prompts, brand block, island contract [pure]
  generate.ts        planTurn, generateOutline, generateSection,
                     editSection, editTheme                       [model calls]
  run-turn.ts        orchestration: plan → validate → execute →
                     validateIslandIds → applyOps → assemble      [no DB]
lib/db/funnel-ai.ts  revisions + turns DAL, head pointer, undo/redo

components/admin/funnels/builder/
  BuilderShell.tsx  ChatPane.tsx  ChatMessage.tsx  Composer.tsx
  PreviewFrame.tsx  SectionList.tsx  SectionSourceDialog.tsx
  IslandConfigDialog.tsx  NeedsInputPanel.tsx  ExternalLinksPanel.tsx
```

`run-turn.ts` takes the model functions as injected dependencies, so the whole
turn pipeline is testable end to end with stubs and no network.

---

## 11. Testing

| Area | Test |
|---|---|
| **Drift (the pin)** | `edit_section` leaves every other section byte-identical and `pageCss` unchanged |
| Drift | `applyOps` throws when `results` holds a non-target section |
| Drift | only `regenerate_page` can replace the section list |
| Assembly | section CSS is scoped under `#djp-sec-<id>`; publish scoping composes to `#djp-funnel-root #djp-sec-<id> …` |
| Assembly | two sections with `@keyframes fadeIn` do not collide after namespacing |
| Plan validation | unknown `sectionId` dropped; all-dropped → clarification; non-permutation reorder dropped |
| Plan validation | `regenerate_page` on a non-empty page without confirmation changes nothing |
| Islands | a UUID absent from the catalogue is blanked and reported unresolved |
| Islands | a blanked required id still causes publish to refuse **by name** |
| Islands | `setIslandProps` rewrites the target island and leaves siblings byte-identical |
| Sanitiser | each allowed SVG tag survives; each forbidden one is dropped |
| Sanitiser | structural invariant — no forbidden SVG tag is in the allowlist |
| Sanitiser | `details`/`summary`/`open` survive |
| Renderer | `viewBox` reaches the DOM with correct casing |
| CSP | existing `frame-src` assertion unchanged and still passing |
| Publish | publish ignores any client-supplied html/css and uses `draft_revision_id` |
| Undo/redo | undo→edit→undo→redo lands on the right revision; chat pointers stay valid |
| Components | chat pane, needs-input panel, section dialog with mocked `fetch` |

Baselines: `npx tsc --noEmit` has **236 pre-existing errors on a clean tree** —
measured by stashing, never assumed. Targeted suites:
`npx vitest run __tests__/lib/funnels __tests__/components/admin` (443 tests /
78 files green today). `npm run build` is the deploy gate and runs as its own
command, never chained behind `test:run`.

---

## 12. Out of scope

Surfaced, deliberately not built:

- **Anonymous Stripe checkout.** The `checkout` island stays a routed link to
  `/login?callbackUrl=…`. A logged-out buy path means changing webhook handling
  for orders with no owning user — its own money-path design.
- **Booking widget.** The `booking` island stays a CTA to `/contact`; there is
  no public booking widget in this app to embed.
- CRM/pipeline UI, email drip automation, SMS.
- Funnel analytics / A/B testing (`funnel_events`).
- Image generation or an asset picker. The model writes `<img>` tags with
  placeholder paths; the owner swaps them via Edit HTML. A media library is its
  own feature.
- Multi-step funnel flows in chat ("add a thank-you page"). Pages are added from
  `/admin/funnels`; the builder edits one page.

## 13. Owner actions (post-merge)

1. Apply `00202` **then** `00203` to production (prod head is `00201`).
2. Confirm the RLS enable in `00203` — this closes the lead-PII gap.
3. Push the branch.
4. Decide separately whether to bump `lib/ai/anthropic.ts` model constants.
