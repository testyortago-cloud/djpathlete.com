# Prompt-Driven Page Builder — Buildable Plan

## The architecture, in two sentences

The owner types what he wants; an AI turns that into a **typed section document** (a list of 9 possible section types with typed copy slots and enum style knobs), which a hand-written server-side renderer turns into `{html, css}` and hands to the **existing, unmodified publish compiler**. The AI never writes HTML, never writes CSS, and never writes a UUID — so the sanitiser can't silently eat its output, the page can't drift off-brand, and "make the headline bigger" is a one-enum change that provably cannot touch anything else on the page.

This is the `hybrid-sections` design, which won all three judge panels (security 9/10, owner-outcome 9/10, buildability 8/10). Below it is corrected for every point the judges docked it on.

---

## What I verified myself (not taken on trust)

| Claim | Verified |
|---|---|
| `compileFunnelStep({html, css, rootId?})` is engine-agnostic | ✅ `lib/funnels/compile/index.ts:12-26`. GrapesJS appears nowhere in `lib/` or `app/` except two comments. |
| `publishStep` compiles what the caller hands it | ✅ `lib/db/funnels.ts:211-256`. `projectData` is `unknown`, stored verbatim. |
| `project_data` is opaque | ✅ `z.unknown()` at `lib/validators/funnel.ts:40`; `unknown` in the DAL. Only doc comments claim GrapesJS. |
| **Sanitiser is silent** | ✅ `sanitize.ts:181` drops `DROPPED_TAGS` *with their whole subtree*; `:193` unwraps unknown tags. Neither pushes an error. The **only** error any removal path emits is `iframe_host_not_allowed` (`:199-203`). |
| `svg`, `style`, `form`, `input`, `title` are dropped | ✅ `sanitize.ts:41-45`, with an in-code comment explaining SVG is excluded deliberately. |
| `ALLOWED_ATTRS` is 20 entries; everything else passes raw | ✅ `sanitize.ts:47-51`, and the default branch `out[name] = rawValue` at `:246`. |
| `data-djp-*` is stripped from non-island elements; plain `data-*` passes | ✅ `sanitize.ts:216` (strip) precedes `:222` (passthrough). **This is why style knobs must be `data-h`, not `data-djp-h`.** |
| `redirectUrl` has **no scheme validation** | ✅ `lib/funnels/islands.ts:65` is `z.string().max(500).optional()`, while `bookingIslandSchema.href` 40 lines below has the correct regex. |
| `checkoutIslandSchema.productId` is a required UUID | ✅ `islands.ts:84-88`, unconditional. |
| `getPublishedStep` can never show a draft | ✅ `lib/db/funnels.ts:291-298` falls back to the newest **version row**, never `project_data`. |
| `callAgent` pins `structuredOutputMode: "jsonTool"` and supports a cached system prompt | ✅ `lib/ai/anthropic.ts:87-89` and `:90-101`. 12-line comment explains why the flag is load-bearing. No test asserts it. |
| Deps | ✅ `@anthropic-ai/sdk ^0.77.0`, `ai ^6.0.97`, `@ai-sdk/anthropic ^3.0.46`, `zod ^4.3.6`, `grapesjs ^0.23.4`, `@dnd-kit/core ^6.3.1`. |
| Brand tokens are reachable | ✅ `--primary`, `--accent`, `--surface` are on bare `:root` in `app/globals.css:7-40`; `app/(funnel)/layout.tsx` is a passthrough so `#djp-funnel-root` inherits them. |
| Audit slugs are a closed set | ✅ `lib/audit/actions.ts:179-183` — five `funnel.*` entries. |
| Permission already covers the API | ✅ `lib/permissions/registry.ts:435-436` maps both `/admin/funnels` and `/api/admin/funnels` to the `funnels` permission. |
| Model IDs + pricing | ✅ via the `claude-api` skill: `claude-opus-5` $5/$25 per MTok; `claude-sonnet-5` $3/$15 ($2/$10 intro through 2026-08-31); `claude-haiku-4-5` $1/$5. Cache write 1.25× (5m TTL) / 2× (1h); cache read 0.1×. Opus 5 minimum cacheable prefix **512 tokens**. |

---

## Judge disagreements — resolved, not averaged

**1. Which output format?** Security judge scored free-HTML 4/10, buildability 5/10, owner-outcome 5/10. All three named the same cause: the sanitiser removes content **silently**, so a page the AI generated and the owner published can be visibly wrong with zero warnings. Free-HTML is rejected. Typed sections wins.

**2. Sections vs. blocks (the two structured designs).** Owner-outcome decided it on one fact I verified: in the `structured-node-tree` schema, headline size is `theme.headings` — a **page-wide** enum. "Make the hero headline bigger" would restyle every headline on the page. `hybrid-sections` puts size on the section (`style.headline`), separate from copy. **Adopted: per-section style knobs.**

**3. "Only 7 section kinds" (buildability).** Fair. Expanded to **9**: `hero, bullets, steps, testimonial, pricing, faq, form, cta, footer`. `steps` (how it works) and `footer` (contact/legal) are non-negotiable for a real landing page. Deliberately **no `nav`** — `app/(funnel)/layout.tsx`'s own comment says a landing page's job is to remove exits.

**4. "75-second wait with nothing to show" (buildability).** Fixed structurally, not with a spinner: first generation is **one plan call, then N section calls fired in parallel**, and sections land in the preview as they arrive. Wall clock drops from ~65s to ~30s and the page visibly builds. Cost of the fan-out is quantified below.

**5. "Token figures asserted, not measured" (buildability).** Correct — every number in §12 is labelled as an estimate with its inputs shown, and Stage 1 ships a real `messages.count_tokens` calibration step before the cost table is trusted.

**6. Free-HTML escape hatch (security vs. owner-outcome).** Security docked the Stage-3 `body` free-HTML slot; owner-outcome wants a ceiling escape. Resolved: the escape hatch is **not built until a tripwire fires** (§11 Stage 4), and when it does it ships with the invariant tests from the `html-through-compiler` design (below) plus a visible "custom — not brand-managed" badge.

**7. Redirect host allowlist (security, applies to all designs).** Adopted. Even after the scheme regex, `redirectUrl: "https://attacker.example/"` still validates and `FunnelForm.tsx` assigns it to `window.location.href` — a submitted lead handed to a third party under the owner's brand. Stage 0 adds a **host** allowlist, not just a scheme check.

**8. Invariant tests (buildability wants them from the losing design).** Adopted as a permanent guard: any future change to `ALLOWED_TAGS` / `ALLOWED_ATTRS` must satisfy three tests (§11 Stage 4).

---

## 1. Data model

### 1a. `funnel_steps.project_data` becomes the SectionDoc — no column change

```ts
// lib/funnels/sections/doc.ts
export interface SectionDoc {
  v: 1
  engine: "sections"
  theme: {
    tone: "light" | "dark"
    accent: "accent" | "primary"
    radius: "sharp" | "soft" | "round"
  }
  sections: Section[]                 // 1..24
}

export interface Section {
  id: string                          // short, stable: "h1", "b2" — also the anchor target
  kind: SectionKind                   // one of 9
  variant: string                     // constrained per kind
  style: {
    headline?: "sm" | "md" | "lg" | "xl"
    align?: "left" | "center"
    tone?: "default" | "muted" | "accent" | "dark"
    pad?: "tight" | "normal" | "roomy"
  }
  props: Record<string, unknown>      // validated by the kind's Zod schema
}
```

The column is already `jsonb` and typed `unknown` end-to-end. Repointing it costs **a comment change, not a schema change**. Two doc comments are wrong and must be corrected: `supabase/migrations/00202_funnels.sql:67-68` and `types/database.ts:3117`.

### 1b. Migration `00203_funnel_ai_builder.sql`

**Prerequisite: 00202 is applied to the dev clone only. Prod has neither table. 00203 must ship behind 00202, in order.**

```sql
-- supabase/migrations/00203_funnel_ai_builder.sql
--
-- The GrapesJS drag canvas is replaced by a conversational builder over a
-- TYPED SECTION document (lib/funnels/sections/doc.ts). Each turn appends a row
-- here carrying the FULL document it produced, so "put it back how it was three
-- messages ago" is a pointer copy, not a regeneration. A SectionDoc is ~5 KB, so
-- full snapshots are cheaper than the html+css they replace (~20 KB).
--
-- Published versions still live in funnel_step_versions. A chat turn is NOT a
-- version: versions are what visitors were served, turns are what the owner tried.

CREATE TABLE IF NOT EXISTS public.funnel_step_turns (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id           uuid NOT NULL REFERENCES public.funnel_steps(id) ON DELETE CASCADE,
  revision          integer NOT NULL,
  parent_revision   integer,
  role              text NOT NULL CHECK (role IN ('user','assistant')),
  source            text NOT NULL DEFAULT 'ai'
                      CHECK (source IN ('ai','inspector','revert')),
  status            text NOT NULL DEFAULT 'complete'
                      CHECK (status IN ('complete','failed')),

  -- Prose only. The owner's message, or the assistant's reply + change receipt.
  message           text NOT NULL DEFAULT '',
  -- The ops the model emitted, kept for debugging "why did it do that".
  ops               jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- FULL SectionDoc after applying ops. NULL on user turns and on failures.
  doc               jsonb,

  -- Compiler verdict for THIS revision, so the chat can say "this can't be
  -- published because ..." without recompiling on every render.
  compile_status    text CHECK (compile_status IN ('ok','warnings','failed')),
  compile_problems  jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Islands whose ref could not be resolved. Non-empty = publish blocked.
  unresolved        jsonb NOT NULL DEFAULT '[]'::jsonb,

  model                 text,
  tokens_input          integer,
  tokens_output         integer,
  cache_read_tokens     integer,
  cache_creation_tokens integer,
  latency_ms            integer,
  error_message         text,
  -- TRUE when the assistant said it could not do what was asked. Drives the
  -- ceiling tripwire in Stage 4 — do not remove.
  blocked           boolean NOT NULL DEFAULT false,

  created_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (step_id, revision)
);

CREATE INDEX IF NOT EXISTS funnel_step_turns_step_idx
  ON public.funnel_step_turns (step_id, revision DESC);

COMMENT ON COLUMN public.funnel_step_turns.doc IS
  'Full SectionDoc after this turn — NOT a diff. Undo and re-prompt both read it.';
COMMENT ON COLUMN public.funnel_step_turns.blocked IS
  'Assistant declined the request as outside the section schema. Tripwire metric.';

ALTER TABLE public.funnel_steps
  ADD COLUMN IF NOT EXISTS doc_revision integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.funnel_steps.doc_revision IS
  'Revision of the SectionDoc in project_data. Optimistic lock: a build request
   carrying a stale revision gets a 409 and the client re-syncs.';

COMMENT ON COLUMN public.funnel_steps.project_data IS
  'The DRAFT SectionDoc (lib/funnels/sections/doc.ts). The public route never
   reads it. Was GrapesJS editor state before 00203.';
COMMENT ON COLUMN public.funnel_step_versions.project_data IS
  'SectionDoc snapshot the published html/css was rendered from.';
```

### 1b-ii. RLS — must ship in `00203`, before any of this reaches prod

**`00202` creates all four funnel tables with RLS DISABLED**, and
`funnel_submissions` holds lead names, emails and phones. That is harmless while
the tables exist only on the dev clone, and unacceptable the moment `00202`
reaches production — which it must, immediately before the push, or the funnel
admin code in this branch 500s against tables that do not exist.

Every read and write goes through `lib/db/funnels.ts` / `lib/db/funnel-builder.ts`,
both of which use `createServiceRoleClient()`. Service role bypasses RLS, so
**enabling it with no policies closes the hole and breaks nothing.** Verify that
claim before applying — `grep -rn 'from("funnel' lib app components` must return
only service-role callers, and no browser-side Supabase client may touch a
funnel table.

```sql
ALTER TABLE public.funnels              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funnel_steps         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funnel_step_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funnel_submissions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funnel_step_turns    ENABLE ROW LEVEL SECURITY;
```

**Do NOT bulk-`ALTER` the 12 pre-existing RLS-disabled tables Supabase also
flags.** They have no policies either, and enabling RLS on them would break
working features. This block is scoped to funnel tables only.

**Why not `ai_conversation_history`** — its `feature` column carries a closed CHECK (`00039_ai_conversation_history.sql:9-11`: `program_generation | program_chat | admin_chat | ai_coach`), it is keyed `(user_id, session_id)` not `step_id`, and it has nowhere to put the document or the compile verdict. Reuse costs a migration anyway and buys the wrong grain.

**Why not `funnel_step_versions`** — four reasons, all in code: `version` is computed by a non-atomic read-max-then-insert (`lib/db/funnels.ts:223-231`) that races on rapid iteration against `UNIQUE (step_id, version)`; the number is shown to the owner (`FunnelEditor.tsx:183`) and becomes meaningless at v47 by lunchtime; a turn that fails to compile has no version row to write; and `getPublishedStep(..., {includeUnpublished:true})` would start serving un-reviewed AI drafts to anyone with a preview link.

### 1c. Audit + spend

Three slugs added to the closed set at `lib/audit/actions.ts:179-183`:

```ts
{ slug: "funnel.ai_turn",          category: "admin_write", description: "Funnel page AI build turn (admin)" },
{ slug: "funnel.reverted",         category: "admin_write", description: "Funnel page draft reverted to an earlier turn (admin)" },
{ slug: "funnel.version_restored", category: "admin_write", description: "Funnel step pointed back at an earlier published version (admin)" },
```

Spend goes to `ai_generation_log` with `input_params.feature = "funnel_page_build"` — a free-form string, no enum, **zero migration**. Copy `app/api/admin/bookkeeping/insights/narrative/route.ts:101-159` verbatim. **Do not pass `generation_trigger` or `assessment_result_id`** — `types/database.ts:824-844` declares them but prod's table lacks them, and PostgREST rejects the *entire insert* with PGRST204 on an unknown key.

---

## 2. The section registry

`lib/funnels/sections/registry.ts` — one file that the Zod schemas, the renderer, the stylesheet, and the AI prompt all derive from. This mirrors the pattern `lib/funnels/islands.ts:9-11` already establishes ("the editor, compiler and renderer can never drift apart").

### The nine kinds

| kind | typed slots | variants | islands |
|---|---|---|---|
| `hero` | `eyebrow?`, `headline`, `sub?`, `media?{kind:"image"\|"youtube", src, alt, w, h}`, `primaryCta`, `secondaryCta?` | `centered`, `split`, `image-bg` | — |
| `bullets` | `heading?`, `intro?`, `items[2..6]{title, body?, icon?}` | `cards`, `list`, `numbered` | — |
| `steps` | `heading?`, `intro?`, `steps[2..6]{title, body?}` | `numbered`, `timeline` | — |
| `testimonial` | `source:"live"{limit,featuredOnly}` \| `source:"quote"{quotes[1..3]{quote,name,detail?}}` | `stack`, `grid` | `testimonials` (live) |
| `pricing` | `heading?`, `plans[1..3]{name, price, cadence?, blurb?, features[1..8], cta, highlight?}`, `footnote?` | `cards`, `single` | `checkout`/`event` per CTA |
| `faq` | `heading?`, `source:"live"{pageKey}` \| `source:"inline"{items[1..12]{q,a}}` | `stack` | `faq` (live) |
| `form` | `heading?`, `sub?` + **`formIslandSchema` verbatim** (import it from `lib/funnels/islands.ts` — do not restate it; the line range in the original analysis is stale after `ed8bbfdc` and Stage 0) | `boxed`, `band` | `form` |
| `cta` | `headline`, `sub?`, `cta` | `band`, `boxed` | `checkout`/`event`/`booking` |
| `footer` | `businessName`, `lines[0..4]`, `links[0..6]{label, target}`, `legal?` | `simple`, `columns` | — |

### Three constraints the renderer obeys by construction

1. **Only tags in `ALLOWED_TAGS`.** No `<svg>` (dropped with subtree), no `<details>/<summary>` (unwrapped → accordion silently flattens), no `colspan`/`scope` (not allowlisted). Icons are an enum rendered as `<span class="djp-ic djp-ic-check">` styled with `mask-image: url("data:image/svg+xml,…")` **in our stylesheet** — identical visual result, zero new parser surface. `<img src="data:image/svg+xml">` is not an option: `safeUrl` (`sanitize.ts:83-85`) allows only png/jpeg/gif/webp/avif.
2. **Flat CSS, never nested.** `walkRules` (`css-scope.ts:42-45`) recurses into nested rules and prefixes them too, producing `#djp-funnel-root &:hover`, which per CSS Nesting can never match. Our stylesheet is hand-authored and flat, so this trap is unreachable.
3. **Style knobs are `data-h`, not `data-djp-h`.** `filterAttrs` strips every attribute starting with `data-djp-` (`sanitize.ts:216`) **before** the plain `data-*` passthrough at `:222`. A `data-djp-tone` knob would be silently deleted at publish and the page would render at default size with no error.

```html
<section id="s-h1" class="djp-s-hero" data-h="xl" data-tone="dark" data-align="center" data-pad="roomy">
```
```css
#djp-funnel-root .djp-s-hero[data-h="xl"] .djp-hd { font-size: clamp(2.75rem, 6vw, 4.5rem); }
```

### `CtaTarget` — the mechanism that eliminates hallucinated UUIDs

```ts
export const ctaTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("url"),          href: z.string().max(300).regex(/^(\/|https:\/\/)/) }),
  z.object({ kind: z.literal("step"),         stepSlug: z.string() }),
  z.object({ kind: z.literal("anchor"),       sectionId: z.string() }),
  z.object({ kind: z.literal("program"),      ref: z.string().max(120) }),
  z.object({ kind: z.literal("session_pack"), ref: z.string().max(120) }),
  z.object({ kind: z.literal("event"),        ref: z.string().max(120) }),
  z.object({ kind: z.literal("booking") }),
])
```

The model writes `{kind:"program", ref:"Comeback Code"}` — **a name, never an id**. `lib/funnels/sections/resolve.ts` matches it against `getPrograms()` (`lib/db/programs.ts:9`), `listActiveProducts()` (`lib/db/session-pack-products.ts:9`), `getPublishedEvents()` (`lib/db/events.ts:26`). Three outcomes:

- **Exactly 1 match** → substitute the real UUID; receipt says *"Buy button → **Comeback Code**"*.
- **0 or ≥2 matches** → the section still applies, the CTA renders as a **disabled placeholder**, the reply ends with an inline `<Select>` of real rows, and publish is blocked until it's chosen. Never stall the whole turn on a clarifying question — the owner should see layout immediately and then point at the one gap.

This matters more than it looks: `EventIsland.tsx:26-28` returns `null` for an unknown event id, so a *plausible* hallucinated UUID passes Zod, passes the compiler, and **renders as nothing at all**. Silent absence is the worst possible failure for someone who can't read the DOM.

### The stylesheet

`lib/funnels/sections/styles.ts` exports `THEME_CSS` plus one string per kind. `reassemble()` concatenates `THEME_CSS + css(kinds actually used)` — ~7–10 KB hand-authored, flat, no `@import`, no Tailwind utility classes, all colour via `var(--primary)` / `var(--accent)` / `var(--surface)` per `CLAUDE.md`.

**Font caveat.** `--font-heading` is declared inside `@theme inline { }` (`app/globals.css:82-86`), not on bare `:root`. Don't assume Tailwind v4 emits `inline` theme vars as real custom properties — write the fallback chain, which is correct either way because `--font-lexend-exa` is definitely set by next/font on `<body>` (`app/layout.tsx:72`):

```css
#djp-funnel-root .djp-hd {
  font-family: var(--font-heading, var(--font-lexend-exa), "Lexend Exa", system-ui, sans-serif);
}
```

Then verify by grepping the **served** stylesheet, not the source — this repo has a documented history of stale-CSS builds.

---

## 3. API routes

| Route | Notes |
|---|---|
| `POST /api/admin/funnels/steps/[stepId]/build` | `export const maxDuration = 300`. `auth()` + `canAccessAdminPath` mirroring `publish/route.ts:17-20`. `withAudit({action:"funnel.ai_turn", category:"admin_write"})`. Body `{ message, revision }`. In-memory rate limit copied from `app/api/admin/ai-chat/route.ts:11-23`. Returns `{ revision, doc, reply, receipt, compile:{ok,problems,warnings}, unresolved }`. |
| `POST .../steps/[stepId]/sections` | The inspector path: applies ops directly, `source='inspector'`, **no AI call**. Same `applyOps`, same revision semantics. |
| `POST .../steps/[stepId]/revert` | `{ toRevision }` → new head turn, `funnel.reverted`. |
| `GET .../steps/[stepId]/turns` | Transcript, `.limit(200)` (PostgREST caps `.select()` ~1000). |
| `POST .../steps/[stepId]/publish` | **Unchanged.** Client sends `reassemble(doc)` as `{html, css, project_data: doc}`. The 422-with-`problems` contract, the `withAudit({action:"funnel.published"})` wrapper, `publishStep`, and the pointer update all keep working. |
| `GET /(funnel)/funnel-preview/[stepId]` | **New, and required — see below.** |

### The draft-preview route is not optional

`getPublishedStep(..., {includeUnpublished:true})` never reads `project_data` — it falls back to the newest **version row** (`lib/db/funnels.ts:291-298`). The existing `?preview=1` link (`FunnelEditor.tsx:195`) therefore shows the last *published* page and will never reflect a draft. Left as-is, the owner iterates in chat, clicks Preview, sees the old page, and concludes the AI is broken. **This is the hidden work inside "the publish contract is engine-agnostic."**

```tsx
// app/(funnel)/funnel-preview/[stepId]/page.tsx
export const metadata = { robots: { index: false, follow: false } }

export default async function DraftPreview({ params }) {
  const session = await auth()          // middleware covers only /admin/* and /client/*
  const role = session?.user?.role      // — same self-gate as go/…/page.tsx:24-31
  if (role !== "admin" && role !== "staff") notFound()

  const { doc } = await getDraft(stepId)
  const compiled = compileFunnelStep(reassemble(doc))   // SAME compiler as publish, ~5-15 ms
  if (!compiled.ok) return <CompileProblems errors={compiled.errors} />

  return (
    <div id={FUNNEL_ROOT_ID}>
      <style dangerouslySetInnerHTML={{ __html: compiled.css }} />
      <NodeRenderer nodes={compiled.nodes} context={{ …, isPreview: true }} />
    </div>
  )
}
```

Not under `/go/` (the `[[...step]]` catch-all would swallow it), not `_`-prefixed (App Router treats those as unroutable), inside `(funnel)` so it escapes marketing chrome but keeps the root layout's brand tokens. **Compile on read** — one source of truth, and the preview shows exactly what publish will ship.

---

## 4. Prompt and tool contract

### One `callAgent`, one structured object — no new AI plumbing

Do **not** build a tool-use loop or a streaming transport in Stage 1. `callAgent` (`lib/ai/anthropic.ts:57-115`) returns one Zod-validated object and already pins the invariant that makes constrained schemas work:

```ts
providerOptions: { anthropic: { structuredOutputMode: "jsonTool" } },   // :87-89
```

The 12-line comment at `:75-86` explains why: the default `"auto"` mode uses Anthropic structured outputs, which **reject any schema carrying `minLength/maxLength/minimum/maximum/minItems/maxItems`** — i.e. every `.min()/.max()` in this design (`items[2..6]`, `plans[1..3]`, `fields[1..20]`). I confirmed this against the live docs: those keywords are on the structured-outputs "not supported" list, while tool `input_schema` accepts them. Going through `callAgent` inherits the correct mode for free. **Add a test asserting that literal while you're here — none exists.**

### Response schema

```ts
const buildResultSchema = z.object({
  reply:   z.string().min(1).max(1200),   // prose shown in chat — never markup
  blocked: z.boolean().default(false),    // set when it can't do what was asked
  ops:     z.array(opSchema).max(24),
  unresolved: z.array(z.object({ sectionId: z.string(), field: z.string(), ref: z.string() })).optional(),
})

const opSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set_page"),       sections: z.array(sectionInputSchema).min(1).max(24) }),
  z.object({ op: z.literal("add_section"),    after: z.string().nullable(), section: sectionInputSchema }),
  z.object({ op: z.literal("update_section"), id: z.string(),
                                              props: z.record(z.unknown()).optional(),
                                              style: styleSchema.partial().optional(),
                                              variant: z.string().optional() }),
  z.object({ op: z.literal("move_section"),   id: z.string(), after: z.string().nullable() }),
  z.object({ op: z.literal("remove_section"), id: z.string() }),
  z.object({ op: z.literal("set_theme"),      theme: themeSchema.partial() }),
])
```

`after: null` means **insert at the very top**. Without it there is no op for "put an announcement bar above the hero" or "move the testimonials to the top", and every such request routes to `set_page` — a full-page regeneration, which is exactly the drift §5 exists to prevent. Applies to both `add_section` and `move_section`.

`update_section.props` merges shallowly per top-level key; array slots (`items`, `plans`, `features`) replace wholesale; **a key whose patch value is `null` is DELETED**. The delete sentinel is not optional garnish — a shallow merge can add and replace but never remove, `undefined` is not expressible over JSON, and the optional slots are `.optional()` not `.nullable()`, so without it "remove the second button" also routes to `set_page`. **State all three rules in one sentence each in the prompt** — they are the only subtleties, and getting the merge wrong is the classic patch bug.

### Prompt layout — ordered by stability, because caching is a strict prefix match

`callAgent`'s `cacheSystemPrompt: true` puts one `cache_control: {type:"ephemeral"}` breakpoint on the whole system string, so **Blocks A and B go in the system prompt and Block C goes in the user message.**

| Block | Content | Est. tokens | Cached |
|---|---|---|---|
| **A** frozen | Builder role; one generated entry per section kind (name, purpose, variants, `z.toJSONSchema` props shape); the `CtaTarget` grammar with the hard rule *"never write an id, write a name"*; style-knob enums; brand rules; 2 worked examples | ~3,000 | ✅ |
| **B** per-page | Live catalogue: programs, session-pack products, published events, FAQ page keys — **name + one-line description, no ids**. <40 rows for this business | ~500 | ✅ |
| **C** per-turn | Current `SectionDoc` (~1,400 tok for a full 9-section page), last 8 turns' prose, the new message | varies | ❌ |

Three rules that are easy to get wrong and expensive to miss:

1. **Block A is built once at module load. Never interpolate the date, funnel name, or step id.** That's the silent-invalidator class — it would cost ~$0.02/turn forever with no error.
2. **Verify caching actually works** by asserting `cache_read_tokens > 0` across turns. `AgentCallResult` already exposes it (`lib/ai/types.ts:127-134`). Opus 5's minimum cacheable prefix is **512 tokens**, so Block A caches comfortably.
3. **Never send the compiled `FunnelNode` tree, previous versions, or rendered HTML.** The document is the context.

Give it its own `lib/funnels/sections/builder-config.ts` in the style of `lib/admin-ai-config.ts` — the admin `AI_CHAT_MAX_MESSAGE_LENGTH = 5000` is too small for a brief with pasted copy.

**Add a test asserting all 9 `SECTION_KINDS` and all 6 `ISLAND_NAMES` appear in the generated Block A.** A hand-written prompt would quietly break the registry's "can never drift apart" promise on kind #10.

---

## 5. The iteration mechanism (this is where these tools fail)

**The server holds the document. The model proposes ops. The server applies them.**

### The turn, step by step

1. Client POSTs `{ message, revision }`.
2. Server loads `project_data`. **If `revision !== step.doc_revision` → 409**, client re-syncs. (Two admin tabs is a real scenario for someone who leaves things open, and this repo has prior form for ordering bugs.)
3. Server builds Block C from the current doc and calls `callAgent` once.
4. **`applyOps(doc, ops)` is pure and transactional**: validate *every* op against the registry first, then produce one new doc. A half-applied patch is never possible.
5. Server runs `reassemble(newDoc)` → `compileFunnelStep(...)` **on every turn, not just at publish** (it's pure and costs single-digit milliseconds).
6. Server resolves every `CtaTarget` ref; unresolved ones are recorded, not fatal.
7. Server writes the turn row, bumps `doc_revision`, returns the doc + a **diff receipt**.
8. Client reloads the preview iframe.

### Why unrelated parts cannot drift

This is a structural guarantee, not a probability. **Sections the model didn't name are never in the output** — the server reassembles from stored props, and there is no code path by which section 4 changes when the model edited section 1. Compare a full-page-regeneration design, which can only claim "unlikely."

And the canonical request resolves to one enum:

> *"make the headline bigger"* → `{"op":"update_section","id":"h1","style":{"headline":"xl"}}` — ~30 tokens, ~10 seconds, and it is **unable** to touch the copy, because size and copy are separate fields.

### The diff receipt

After applying, the chat prints: *"Changed: Hero (headline size). Untouched: 8 sections."* The trust problem with these tools is epistemic — the owner cannot tell what moved. Tell him. If a turn touches >60% of sections, label it explicitly as a rewrite.

### Undo is a pointer move, not a regeneration

Revert-to-revision N writes N's `doc` into `project_data`, bumps `doc_revision`, and **appends a new head turn** with `source='revert'`. Append-only ⇒ undo is itself undoable, history stays linear, redo is free.

Two history levels, and the labels matter:

| | Moves | Visitor impact | Cost |
|---|---|---|---|
| **Undo** (⌘Z, by the composer) | the draft | none — label it *"the live page hasn't changed"* | free, no AI call |
| **Restore a published version** (versions list) | `published_version_id` | **immediate** | free; new DAL fn `setPublishedVersion(stepId, versionId)` + `funnel.version_restored` |

**Retention:** ~5 KB/turn × 40 turns × 40 steps ≈ 8 MB. Not urgent. Prune to the last 30 turns per step on the existing `auditLogRetentionCron` eventually.

### Failure modes — what the owner actually sees

Governing rule, from this repo's own scar tissue (`silent_gate_reads_as_broken`): every failure produces **(a) one plain sentence, (b) an intact previous draft, (c) one obvious next action.**

| Failure | What happens |
|---|---|
| Model returns an invalid op | Auto-retry once with the Zod error appended. Second failure: *"I couldn't build that change. Your page is unchanged — try describing it differently."* |
| Op names a section that doesn't exist | `applyOps` rejects the **whole batch**; same message. |
| Ref resolves to 0 or ≥2 rows | Applies anyway, placeholder CTA, inline picker in the reply, publish blocked until chosen. |
| Compile fails (should be near-impossible now) | Apply rolled back; `result.errors[].message` fed back for one repair pass — those strings are already human-readable (`sanitize.ts:285`). |
| Non-fatal warning (`iframe_host_not_allowed`) | Applies; yellow line in chat naming the removed embed. |
| Rate limit / overload | Reuse `isTransientError` + `pRetry` already inside `callAgent` (`lib/ai/anthropic.ts:35-53,106-113`). *"Busy right now — retrying…"* |
| Model refuses (`stop_reason: "refusal"`) | Through `generateObject` this surfaces as a parse failure. Catch it and return *"I couldn't build that — try describing it differently"* with the draft intact. **Never a 500** — the pattern is at `.../narrative/route.ts:149-160`. Low probability for landing pages, but youth-athlete health-claim copy is not zero-risk. |
| Publish still 422s | Route the `problems` **back into the chat** behind a **"Fix it for me"** button. In a chat builder, an error the AI can fix should never be a dead-end toast. |

Also fix the existing bug while you're here: `FunnelEditor.tsx:182` fires `toast.warning(...)` **after** the publish already succeeded — "your video embed was removed" fades away on a page that is already live. Warnings belong in the pre-publish review panel.

---

## 6. UI layout

Space is measured, not guessed: `lg:ml-64` sidebar (`AdminLayout.tsx:38`) + `h-16` top bar (`AdminTopBar.tsx:26`) + `p-6` gutters ⇒ **1136 px content box at 1440 viewport**.

```tsx
// app/(admin)/admin/funnels/[id]/edit/[stepId]/page.tsx — replaces lines 21-41
<div className="-m-6 flex h-[calc(100dvh-4rem)] flex-col">
  <BuilderHeader … />                                {/* h-12: breadcrumb + device toggle + Publish */}
  <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
    <ChatPane    className="lg:w-[340px] 2xl:w-[400px] shrink-0 border-r border-border" />
    <OutlineRail className="hidden xl:block w-[220px] shrink-0 border-r border-border" />
    <PreviewPane className="min-w-0 flex-1 bg-surface/50" />
  </div>
</div>
```

- `100dvh` not `100vh` — survives mobile browser chrome. **The current editor reserves `calc(100vh-8rem)` (`FunnelEditor.tsx:192`) against an available `100vh − 148px` and overflows by ~20 px; fix it in passing.**
- Below `lg` (where the sidebar is already hidden), collapse to a `Chat / Page / Preview` tab switcher.
- **PreviewPane** is a same-origin iframe at `/funnel-preview/[stepId]`. Reuse the scaled-iframe idiom and its documented reasoning from `PreviewCard.tsx:41-44`: **scale the iframe element for desktop, narrow it for mobile** — narrowing is what makes the page's own breakpoints fire, which is the whole point of a mobile preview. Desktop 1280 (scale ≈ 0.6), Tablet 768, Mobile 390 at 1:1. `sandbox="allow-same-origin allow-scripts"` so islands actually work; **not** `allow-forms`, **not** `allow-top-navigation`. CSP already permits it (`frame-src 'self'`, `next.config.mjs`).
- Double-buffer on reload: render the new iframe hidden, capture `contentWindow.scrollY`, swap on `load`, restore scroll, cross-fade 150 ms.
- **OutlineRail is the payoff.** Section list with drag reorder (`@dnd-kit` is already a dependency), per-section inspector popover (variant / tone / size / align selects), duplicate, delete. Every control posts to `/sections` — **no AI call**, same revision path. Because sections are typed this is ~200 lines, and it is the thing a free-HTML builder structurally cannot offer: when the chat is being unhelpful at 11pm and the campaign goes out at midnight, he changes a dropdown.
- Empty state: 5 starter chips ("Landing page for a summer camp", "Opt-in page for a free guide", …). For a non-engineer this is the single highest-leverage surface.
- House chrome throughout: `rounded-xl border border-border bg-white shadow-sm` message cards, `bg-surface/50` preview backdrop. No `data-table` — this isn't a list.

### Publish becomes a review step, not a submit

Show, **before** the write commits: compiler warnings, the mobile-width preview, unresolved CTAs, and a claims lint. Framing for the owner: *the compiler has security covered and does not need you; your job at this gate is claims and mobile.*

---

## 7. Exactly what is reused, and what is deleted

### Reused unchanged — do not touch

| Path | Why |
|---|---|
| `lib/funnels/compile/` (all 4 files, 475 lines) | The security boundary. Zero new tags, zero new attributes. All 38 tests keep protecting the publish path. |
| `lib/db/funnels.ts:211-256` (`publishStep`) | Still the sole writer of `funnel_step_versions`. |
| `app/api/admin/funnels/steps/[stepId]/publish/route.ts` | Including the 422-with-`problems` contract and `withAudit`. |
| `app/(funnel)/go/[slug]/[[...step]]/page.tsx` | Public rendering path. |
| `components/funnels/NodeRenderer.tsx` + `components/funnels/islands/*` | Renderer and all six islands. |
| `supabase/migrations/00202_funnels.sql` | Ships to prod first, unchanged. |
| `lib/ai/anthropic.ts:57-115` (`callAgent`) | Used as-is. Only additions: a `MODEL_OPUS_5` constant and a test for the `jsonTool` literal. |
| `app/api/admin/funnels/steps/[stepId]/route.ts` (PATCH draft) | The draft-write path. |

### Reused with small edits

| Path | Edit |
|---|---|
| `lib/funnels/islands.ts` | Line 65: `redirectUrl` scheme + host validation (Stage 0). Lines 84-88: `productId` conditional via `superRefine` (Stage 0). |
| `components/admin/funnels/island-traits.ts:8-74` (`ISLAND_TRAITS`) | **Keep.** Move to `lib/funnels/island-fields.ts`; it becomes the field metadata for the section inspector. The one genuinely engine-agnostic piece of GrapesJS-era code. |
| `components/admin/funnels/PreviewCard.tsx:41-44` | Scaled-iframe technique reused (not modified). |
| `lib/validators/funnel.ts:39-41` | Drop the GrapesJS comment; add `buildRequestSchema`. |
| `lib/audit/actions.ts:179-183` | Three new slugs. |
| `types/database.ts:3117,3131,3145` | Correct the GrapesJS doc comments. |
| `app/(admin)/admin/funnels/[id]/edit/[stepId]/page.tsx:21-41` | Swap the loader for the builder shell. |

### Deleted

| Path | Lines |
|---|---|
| `components/admin/funnels/FunnelEditor.tsx` | **359** (whole file) |
| `components/admin/funnels/FunnelEditorLoader.tsx` | **25** (whole file) |
| `components/admin/funnels/island-props.ts` | **76** (whole file — only consumers are FunnelEditor + its test) |
| `components/admin/funnels/island-traits.ts:77-94` | **18** (`islandPlaceholderHtml`, `islandBlockDefinitions`) |
| `package.json` — `"grapesjs": "^0.23.4"` + its CSS import | ~13 MB of `node_modules` |
| `__tests__/components/admin/funnel-island-traits.test.ts` | 160, rewritten (drops the `island-props` half) |

**Why delete rather than keep GrapesJS as a fallback:** `FunnelEditor.tsx` is 359 lines of which ~230 are pure adaptation scar tissue — `cssIcons: ""` at `:48` and the panel rewrite at `:76-114` exist only because our CSP kills the CDN icon font and every toolbar button rendered as a blank square; `changeProp: true` at `:263` exists because GrapesJS silently discarded every island setting typed into it; `appStylesheetHrefs()` at `:224-229` doesn't work in dev at all. Keeping it also means some pages have chat history as their source of truth and others don't, which silently breaks "go back three messages" on exactly the pages he touched manually. One builder, one history, one mental model.

**Net:** ~3,300 lines added against ~638 deleted, one 13 MB dependency removed, and one registry (GrapesJS traits) eliminated from the sync burden.

---

## 8. Staged plan

### Stage 0 — safety. Half a day. Ships alone, no AI involved.

1. **`lib/funnels/islands.ts:65` — live stored XSS.** `redirectUrl` has no scheme validation and `FunnelForm.tsx:83` assigns it to `window.location.href`. `redirectUrl: "javascript:…"` passes `parseIslandProps` and executes on the brand domain. **CSP does not save you** — `script-src` includes `'unsafe-inline'` (`next.config.mjs:118`), which permits `javascript:` navigation. `bookingIslandSchema.href` already has the correct regex 40 lines below. Fix:

```ts
const REDIRECT_HOSTS = ["www.darrenjpaul.com", "darrenjpaul.com"] as const

redirectUrl: z.string().max(500)
  .refine(v => v.startsWith("/") ||
    (v.startsWith("https://") && REDIRECT_HOSTS.includes(new URL(v).hostname as never)),
    "Must be a site path or an https URL on your own domain")
  .optional(),
```

The **host** check, not just the scheme check, is the part all three designs missed: after the scheme regex, `https://attacker.example/` still validates, and with no `navigate-to` CSP directive a submitted lead can be handed straight to a third-party page under the owner's brand. This is pre-existing, but the risk profile inverts once a *model* writes island props from natural language — island props are the one input path that bypasses the HTML allowlist entirely (`sanitize.ts:186` short-circuits to `convertIsland` before `filterAttrs` ever runs).

2. **`islands.ts:84-88` — `productId` required but unused.** `CheckoutIsland.tsx` ignores `productId` when `productKind === "session_pack"` and routes to `/client/sessions`. A required-but-discarded UUID is precisely the training signal that teaches a model to fabricate ids. Make it conditional via `superRefine`.
3. **Nested-CSS guard** — one line in `css-scope.ts:42`: `if (rule.parent?.type === "rule") return`. Not needed by our flat renderer, but it makes the escape hatch safe later and is correct today.
4. **Add the `structuredOutputMode: "jsonTool"` test.** The literal at `lib/ai/anthropic.ts:87-89` is load-bearing for every schema in this design and is asserted nowhere.

### Stage 1 — "Describe it, get a page." ~3 days. **Genuinely usable alone.**

Everything the owner needs to type a paragraph, watch an on-brand page build, iterate conversationally, preview it on mobile, and publish. If Stage 2 never ships, this is already a complete replacement for GoHighLevel's page builder.

TDD-first, pure, zero mocks:
1. `lib/funnels/sections/registry.ts` + 9 Zod schemas
2. `lib/funnels/sections/render.ts` (9 renderers) + `styles.ts`
3. `lib/funnels/sections/doc.ts` — `reassemble()`, size guards. **Enforce the publish caps at draft time**, not just at publish: `html ≤ 500_000` / `css ≤ 200_000` (`lib/validators/funnel.ts:44-45`). Discovering the ceiling only at publish is a nasty surprise.
4. `lib/funnels/sections/apply.ts` — ops → doc, transactional
5. `lib/funnels/sections/resolve.ts` — refs → real ids
6. `lib/funnels/sections/prompt.ts` — Block A generated from the registry
7. Migration `00203`; `lib/db/funnel-builder.ts`; three audit slugs
8. `POST .../build` with **plan-then-fan-out** (below); `GET /(funnel)/funnel-preview/[stepId]`
9. `FunnelBuilder.tsx` — chat pane + preview + Publish
10. Delete GrapesJS

**Plan-then-fan-out (the fix for the blank-wait problem):**

```
call 1 (plan)     → { theme, section specs[] }        ~10 s, writes the prompt cache
call 2..N (parallel, max 4 concurrent) → one section each, ~15-18 s
```

Fire the plan call **first and alone** — the cache is not readable until the first response begins, so parallel calls sharing a cold prefix would each pay full price. With the plan call warming it, the section calls all read at 0.1×. Each section is written into the doc as it lands and the preview refreshes, so the page visibly builds instead of showing a spinner. Wall clock ≈ **30 s** instead of ~65 s.

Iterative turns after the first generation are a **single** `callAgent` — ~10 s, no fan-out needed.

### Stage 2 — control and history. ~2 days.

OutlineRail + inspector (no AI), undo/redo, transcript UI, revert-to-turn, pre-publish review panel (warnings *before* commit, mobile-width preview, diff against the live version), `setPublishedVersion`.

Also add the non-fatal `element_removed` warning code to `CompileErrorCode` (`compile/types.ts:17-23`). Our renderer never triggers it, but it's a real pre-existing hole and it's the only thing that makes *"why did my icon disappear?"* answerable — and it's a prerequisite for the Stage-4 escape hatch.

### Stage 3 — reach. ~2 days.

More kinds if the tripwire says they're needed (`media`, `logos`, `comparison`, `guarantee`). An **image picker backed by Firebase Storage with the model restricted to uploaded assets only** — this closes the hallucinated-stock-URL hole (`safeUrl:81` allows any https host today, and models reliably invent plausible image URLs that 404) and the third-party-tracking-pixel hole in one move. Multi-step CTA targets. A **claims lint** at publish reusing the `brief.dont_do[]` word-boundary vocabulary the strategy agents already have — *"add 6 inches to your vertical in 30 days, guaranteed"* compiles perfectly clean today, and for a coaching business that's real FTC substantiation exposure.

### Stage 4 — only if the tripwire fires.

**The falsifiable test:** the `blocked` column on `funnel_step_turns` records every turn where the assistant declined. After two weeks and ~10 real pages, count. **If >15% of turns are blocked, the ceiling is real.** The correct response is *not* more section kinds — it's promoting a `custom` section kind (free `html` + `css` for one section, through the full compiler) to the fast path, with a visible "custom — not brand-managed" badge and its own compile warnings surfaced.

That escape hatch ships **only with these three tests** (lifted from the `html-through-compiler` design, which is the best security writing in the set):

```
1. ALLOWED_TAGS ∩ DROPPED_TAGS === ∅
2. every ALLOWED_ATTRS member is in exactly one of
     URL_SANITISED | VALUE_RESTRICTED | INERT
   (a new attribute landing in none of the three fails the build)
3. golden-file: a corpus of realistic AI markup compiles to a snapshotted
   {nodes, css, warnings}; the drop set changing fails CI
```

Test 2 is the one that matters: `filterAttrs`'s default branch is `out[name] = rawValue` (`sanitize.ts:246`), so admission to the allowlist is admission to raw passthrough. That test converts "did the reviewer remember to check whether this attribute holds a URL?" from a habit into a compile-time obligation.

---

## 9. Cost and model choice

### Model: `claude-opus-5`

Add a **new** constant — do not repoint the existing ones, the 4-agent program pipeline is tuned against `claude-sonnet-4-6`:

```ts
// lib/ai/anthropic.ts, near :11-14
export const MODEL_OPUS_5 = "claude-opus-5"
```

**Why Opus 5 and not Sonnet:** this is a schema-constrained generation task where a mistake is invisible to the owner (a wrong `ref`, a section that answers the wrong brief) and where the whole business case rests on the first generation being good enough that he doesn't re-prompt five times. At $5/$25 per MTok and ~10 pages a month, the difference between Opus 5 and Sonnet 5 is about **$3/month** — genuinely noise. Quality is the only axis that matters at this volume.

`claude-sonnet-5` ($3/$15 standard; $2/$10 intro only through **2026-08-31** — 22 days away, so budget at standard) is the cost lever if he ever wants it, and it's a one-constant change.

**Opus 5 specifics that bite here:**

- **Thinking is on by default.** Omitting the `thinking` field runs adaptive — a change from Opus 4.8. `max_tokens` caps thinking **plus** output together, so size generously.
- **Do not set `thinking: {type:"disabled"}`.** On Opus 5 that's where the model occasionally writes a tool call into visible text instead of emitting a structured block — a silent no-op, which in a fully op-driven builder is the worst possible bug class. It also leaks `<thinking>` tags. Use effort as the cost lever, not thinking.
- **`generateObject` is non-streaming**, so keep `maxTokens ≤ 16000` (override `DEFAULT_MAX_TOKENS = 32000` at `:14`) or risk SDK HTTP timeouts.
- **Handle `stop_reason: "refusal"`** (see §5 failure table).

Per-call settings:

| Turn | maxTokens |
|---|---|
| Plan call | 4000 |
| Section call | 6000 |
| Iterative edit | 8000 |

### Cost per iteration and per month

**These are estimates with their inputs shown.** They assume Block A ≈ 3,000 tokens, Block B ≈ 500, a 9-section doc ≈ 1,400, and Opus 5 adaptive thinking at roughly 1× the visible output. Opus 5 at $5/$25 per MTok, cache write 1.25×, cache read 0.1×.

| Operation | Input | Output (incl. thinking) | Cost |
|---|---|---|---|
| Plan call (cache write) | 3,500 written + 300 fresh | ~400 | $0.033 |
| Section call × 8 (cache read, parallel) | 3,500 read + 400 fresh each | ~750 each | $0.023 each → **$0.18** |
| **First generation, total** | | | **≈ $0.21** · **≈ 30 s** |
| **Iterative edit** ("make the headline bigger") | 3,500 read + 2,500 fresh | ~1,400 | **≈ $0.05** · **≈ 10 s** |
| Inspector change (dropdown) | — | — | **$0.00** · instant |

**Monthly, 10 pages × (1 generation + 8 iterations):**

| Model | Per month |
|---|---|
| **`claude-opus-5`** | **≈ $6.10** |
| `claude-sonnet-5` (standard $3/$15) | ≈ $3.70 |

Against GoHighLevel at **$97–297/month**, cost is not the deciding factor — latency and correctness are, which is why the fan-out and the typed schema get the design attention rather than the price.

**Calibrate before trusting these.** Stage 1 includes a one-off script that runs `client.messages.count_tokens` against the real generated Block A and a real 9-section doc, and logs actual `tokens_input` / `tokens_output` / `cache_read_tokens` per turn to `funnel_step_turns`. After ten real pages the table above is replaced with measured numbers. Note the fan-out costs roughly **2× a single monolithic call** and buys ~2× the speed plus visible progress — an explicit, cheap trade at this volume.

**There is no dollar-cost computation anywhere in this repo** (`ai_generation_log` is tokens-only; grep for `cost_usd` hits only Google Ads). "What did this page cost me?" needs new arithmetic — a small helper in `lib/funnels/sections/cost.ts` reading the token columns, if he wants it.

---

## 10. What I could not verify from the repo

Each of these is a real risk with a named check. None blocks Stage 0 or the pure modules in Stage 1.

1. **Whether `@ai-sdk/anthropic@3.0.46` + `ai@6.0.97` handle `claude-opus-5` correctly through `generateObject`** — specifically whether Opus 5's default-on adaptive thinking blocks are tolerated in a `jsonTool` response, and whether `output_config.effort` is expressible via `providerOptions`. **Check:** one smoke call through `callAgent` with a trivial schema before wiring the route. **Fallback if it fails:** `claude-sonnet-4-6`, which is proven in this repo today via `callAgent`, at ~40% of the cost and modestly lower quality. This is a one-constant change, not a redesign.
2. **Whether `--font-heading` (declared inside `@theme inline`, `app/globals.css:82-86`) is emitted as a real CSS custom property.** Mitigated by writing the fallback chain, which is correct either way. **Check:** grep the *served* stylesheet in dev, not the source — this repo has a documented stale-CSS history.
3. **All token counts and therefore all costs** are estimates built from character-count heuristics, not from `count_tokens`. §9's calibration step exists specifically for this.
4. **Latency figures** (~45 tok/s Opus 5) are from published general guidance, not measured on this workload. The 300 s `maxDuration` gives ~10× headroom on the estimate, so an error here is a UX annoyance, not a failure.
5. **Anthropic rate limits at this account's tier** for 4 concurrent Opus 5 calls. Opus 5 draws from a **separate bucket** from the Opus 4.x pool. **Check:** the tier's Opus 5 limits before enabling the fan-out; the concurrency cap of 4 is deliberately conservative.
6. **Prod schema for `funnel_steps` / `funnel_step_versions`** — I verified the migration file, not the live database, because 00202 has never been applied to prod. Apply 00202 to prod, then verify with `mcp__supabase__list_tables` before applying 00203.
7. **Whether the existing 443-test suite has any coupling to `FunnelEditor.tsx`** beyond `__tests__/components/admin/funnel-island-traits.test.ts` — I grepped for funnel test files but did not run the suite. **Check:** `npx vitest run __tests__/lib/funnels __tests__/components/admin` before and after the deletion.
8. **Whether the owner's real pages fit 9 section kinds.** The kind list is derived from one real page he wrote (`step-up-for-students.html`, 7 sections) plus standard landing-page structure. The `blocked` tripwire in §8 Stage 4 is the falsifiable test, and it is the single most important instrument in this plan.

---

## Files to open first

- `c:\Users\tayaw\Desktop\Darren Paul Projects\djpathlete\lib\funnels\islands.ts` — line 65 is the Stage-0 XSS; lines 84-88 the `productId` bug; the whole file is the registry pattern the section registry should copy
- `c:\Users\tayaw\Desktop\Darren Paul Projects\djpathlete\lib\funnels\compile\sanitize.ts` — allowlists at 26-51 define what the renderers may emit; the `data-djp-` strip at 216 is the style-knob trap; `out[name] = rawValue` at 246 is why the allowlist must never be widened casually
- `c:\Users\tayaw\Desktop\Darren Paul Projects\djpathlete\lib\funnels\compile\css-scope.ts` — 42-45 is why templates must emit flat CSS
- `c:\Users\tayaw\Desktop\Darren Paul Projects\djpathlete\lib\db\funnels.ts` — `publishStep` 211-256 unchanged; `getPublishedStep` 291-298 is why the preview route is mandatory
- `c:\Users\tayaw\Desktop\Darren Paul Projects\djpathlete\lib\ai\anthropic.ts` — `callAgent` at 57; keep `structuredOutputMode: "jsonTool"` (87-89) and add a test for it; add `MODEL_OPUS_5` near 11-14
- `c:\Users\tayaw\Desktop\Darren Paul Projects\djpathlete\components\admin\funnels\PreviewCard.tsx` — 41-44 is the scaled-iframe technique to reuse
- `c:\Users\tayaw\Desktop\Darren Paul Projects\djpathlete\components\admin\funnels\FunnelEditor.tsx` — line 182 (post-hoc warning toasts) and 192 (`100vh-8rem` overflow) are bugs to carry the fixes for
- `c:\Users\tayaw\Desktop\Darren Paul Projects\djpathlete\app\api\admin\bookkeeping\insights\narrative\route.ts` — 101-159 is the `ai_generation_log` + graceful-failure pattern to copy verbatim