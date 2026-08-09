# Funnel Builder — Design

**Date:** 2026-08-09
**Status:** Approved (design decisions from §2 onward made autonomously — see "Decisions made without sign-off")
**Goal:** Replace GoHighLevel as the landing-page / funnel builder. Free-form drag canvas, owned in-platform.

---

## 1. Why

GHL is used for exactly one thing in this business: building funnel/landing pages. It is *not* the CRM,
not the automation engine, not the SMS channel. The app's GHL coupling is shallow — 14 fire-and-forget
call sites in `lib/ghl.ts` (contact upsert, workflow trigger, webhook, contact list) plus
`lib/db/inbox-sla.ts`. Nothing depends on GHL to function; it already degrades gracefully when
unconfigured.

So this is not an untangling job. It is: **build the page builder GHL was providing.**

Four funnel types are in use today and all must be supported:
lead-magnet opt-in · application/qualification · camp/clinic registration · program sales page.

### Non-goals

Explicitly out of scope, in every phase:

- CRM / opportunity pipeline UI
- Email drip / nurture automation
- SMS / two-way texting (would mean Twilio + A2P 10DLC carrier registration — weeks of approval, not a code problem)
- Migrating the ~40 hand-coded `app/(marketing)/` pages into the canvas. They are fast, on-brand and
  working; making them editable trades that away for nothing. **The builder is for new campaign pages.**

---

## 2. Approach

Three architectures were considered:

| | Approach | Verdict |
|---|---|---|
| A | Typed block registry, form-edited, presets per funnel type | Recommended by author; **rejected by owner** |
| B | Four fixed templates (extend the `step_up_page_content` pattern) | Rejected — ceiling hit immediately |
| C | **Free-form drag canvas** (true GHL equivalent) | **Chosen by owner** |

The author's recommendation was A (on-brand by construction, typed, cheapest). The owner chose C
deliberately. This document specs C. The known, accepted trade-off: **a free-form canvas can produce
pages that violate the design system.** Mitigated (not prevented) by seeding the canvas with brand
tokens as style presets so a page *starts* on-brand.

### Engine: GrapesJS open-source core

Verified 2026-08-09:

| Package | Version | React 19 peer | Licence |
|---|---|---|---|
| `grapesjs` | 0.23.4 | n/a (framework-agnostic) | BSD-3-Clause |
| `@grapesjs/react` | 2.0.0 | `^18 \|\| ^19` | — |
| `@puckeditor/core` | 0.23.0 | `^18 \|\| ^19` | — |

- **GrapesJS core, not Studio SDK.** Studio SDK's free tier is metered (1,000 sessions/mo, 100 MB,
  1 domain) and stamps **Studio branding on published pages**; first paid tier is **$200/month** — more
  than GHL. Paying more to leave GHL defeats the purpose. The BSD-3 core is free, self-hosted, unmetered.
- **No `@grapesjs/react`.** It declares `grapesjs: ^0.22.5`, which excludes 0.23.x (caret locks the minor
  for `0.x`), so it would force a downgrade or `--legacy-peer-deps`. GrapesJS is framework-agnostic;
  mounting it in a `useEffect` is ~30 lines and removes the conflict.
- **New dependencies:** `grapesjs` (editor, client-only) and `parse5` (publish-time HTML parsing, server-only).
  `postcss` 8.5.6 and `jsdom` are already present.

### The central problem: a canvas emits HTML, not React

The pages need six interactive things (form, checkout, event registration, booking, testimonials, FAQ)
that a static HTML blob cannot provide.

**Rejected:** store raw HTML, render with `dangerouslySetInnerHTML`, then scan the DOM client-side and
portal React components into placeholders. This is what most GHL clones do. It costs an XSS surface,
breaks SSR/SEO for every interactive element, and flashes empty placeholders on load.

**Chosen: compile-time node-tree extraction.** On publish, the emitted HTML is parsed once into a
sanitized node tree stored as JSONB, with island placeholders replaced by typed island nodes:

```ts
type FunnelNode =
  | { t: "text"; v: string }
  | { t: "el"; tag: string; attrs: Record<string, string>; children: FunnelNode[] }
  | { t: "island"; name: IslandName; props: Record<string, unknown> }
```

The public renderer walks that tree and returns real React elements — `React.createElement` for
elements, real server components for islands. Consequences:

- **`dangerouslySetInnerHTML` is never used for page body.** The XSS surface is removed structurally,
  not patched. An attribute that isn't on the allowlist cannot survive compilation.
- Islands are server-rendered, nest anywhere in the tree, and need no client-side DOM scanning.
- Sanitisation happens **once at publish**, not per request.
- Compilation is a set of pure functions — the most testable possible shape for the riskiest code.

---

## 3. Data model

Migration `00202_funnels.sql` (next free number; `00201_admin_permissions.sql` is current head).

```
funnels
  id uuid pk · slug text unique · name · description
  status: draft | published | archived   (default draft)
  created_at · updated_at

funnel_steps                       -- the pages within a funnel
  id uuid pk · funnel_id fk cascade
  slug text · name · position int · is_entry bool
  seo_title · seo_description · og_image_url · noindex bool
  project_data jsonb                -- GrapesJS editor state (the DRAFT, source of truth for editing)
  published_version_id uuid null    -- fk funnel_step_versions
  unique (funnel_id, slug)

funnel_step_versions               -- immutable published snapshots
  id uuid pk · step_id fk cascade · version int
  nodes jsonb                      -- compiled FunnelNode tree (what the public route renders)
  css text                         -- scoped + sanitised stylesheet
  project_data jsonb               -- editor state at publish time, for rollback
  published_at · published_by
  unique (step_id, version)

funnel_submissions
  id uuid pk · funnel_id · step_id · form_key text
  email · name · phone · payload jsonb
  attribution_session_id text · ip_address text · user_agent text
  lead_user_id uuid null           -- the users row created/matched, status='lead'
  created_at
```

Draft and published are separate on purpose: editing a live page never changes what visitors see until
Publish. Versions are immutable, so rollback is "point `published_version_id` at an older row".

`funnel_events` (per-step view/conversion analytics) is **Phase 2** — deliberately not in this schema.

---

## 4. Publish pipeline

Pure, server-only, in `lib/funnels/compile/`. Input: GrapesJS `{ html, css }`. Output: `{ nodes, css }`.

1. **Parse** — `parse5` → DOM tree.
2. **Sanitise, allowlist-first.** Unknown tags are unwrapped (children kept), unknown attributes dropped.
   - Tags: structural + text + media only. `script`, `object`, `embed`, `form`, `input` are dropped outright.
   - `iframe` is allowed **only** when `src` host ∈ {`youtube.com`, `youtube-nocookie.com`, `player.vimeo.com`}.
     Adding a host here requires a matching `frame-src` entry in `next.config.mjs` — enforced by a config
     assertion test, because a CSP omission is invisible to component tests.
   - Attributes: `class`, `id`, `style`, `alt`, `title`, `width`, `height`, `loading`, `target`, `rel`,
     `role`, `aria-*`, `data-*` (except reserved `data-djp-*`). Every `on*` handler is dropped by construction.
   - URLs (`href`, `src`): scheme must be `https:`, `mailto:`, `tel:`, or root-relative. `javascript:`,
     `data:` (except `data:image/*` in `src`) rejected.
   - Inline `style`: `expression(`, `url(javascript:` and `@import` stripped.
3. **Extract islands** — an element carrying `data-djp-island="<name>"` becomes an island node. Its
   `data-djp-props` JSON is parsed and validated against that island's Zod schema. **Invalid props fail
   the publish** with a field-level error rather than shipping a broken page.
4. **Scope the CSS** — `postcss`: prefix every selector with `#djp-funnel-root`, recurse into `@media`,
   drop `@import`, rewrite bare `html`/`body` selectors onto the root wrapper.

### Why scoping instead of an isolated layout

Next's root `app/layout.tsx` wraps every route, so funnel pages cannot escape `globals.css` without
splitting the app into multiple root layouts — a large refactor of a working app for no user-visible
gain. Instead the page renders inside `<div id="djp-funnel-root">` and its stylesheet is prefixed with
that id. Two useful consequences:

- The app's `@layer base` rules supply sensible defaults (fonts, resets) for elements the owner never
  styled, so a rough page still looks deliberate.
- Compiled page CSS is **unlayered**, and unlayered CSS beats `@layer` rules regardless of specificity —
  so anything explicitly styled on the canvas always wins. (This is the same layering rule recorded in
  `theme_scope_token_polarity`, working in our favour for once.)

---

## 5. Islands

Six, each a server component with a Zod props schema, resolved from one registry so the editor's
element list and the renderer can never drift apart.

| Island | Props | Backed by |
|---|---|---|
| `form` | `formKey`, `fields[]`, `submitLabel`, `successMode`, `successMessage`/`redirectUrl`, `leadMagnetId?` | `funnel_submissions` + `users` (status `lead`) |
| `checkout` | `productKind` (`program` \| `session_pack`), `productId`, `label` | existing Stripe checkout routes |
| `event` | `eventId`, `showSpots`, `label` | `events` / `event_signups` |
| `booking` | `bookingType?`, `label` | existing booking widget |
| `testimonials` | `limit`, `tag?` | `testimonials` |
| `faq` | `limit`, `category?` | `faqs` |

("Live testimonials / FAQ pull" was one choice at brainstorm time; they are two islands because they are
two different tables.)

### Form submission

`POST /api/funnels/submit` — public, so it self-gates. `/api/*` is **not** covered by `middleware.ts`,
so the route validates on its own:

- Zod-validated against the *published* form config, fetched server-side by `formKey` — the client cannot
  declare its own fields.
- Honeypot field + minimum time-to-submit + per-IP rate limit.
- Attribution: `marketing_attribution` session id read from the existing cookie via
  `parseAttrCookie`, so funnel leads join the same first-touch reporting as everything else.
- Then, mirroring `/api/contact`: upsert a `users` row with `status='lead'`, notify admins, send the
  owner an email, deliver the lead magnet asset if `leadMagnetId` is set.
- **No GHL call.** New code does not write to GoHighLevel; existing routes keep theirs untouched.

---

## 6. Public rendering

- `app/(marketing)/go/[slug]/[[...step]]/page.tsx` — server component.
- `/go/<funnel>` renders the entry step; `/go/<funnel>/<step>` renders a named step.
- The `/go` prefix avoids collisions with the ~40 existing top-level marketing routes.
- Loads the step's `published_version_id`; a funnel that is not `published` 404s for the public and
  renders behind `?preview=<token>` for the owner.
- `generateMetadata` from the step's SEO fields; `noindex` honoured.
- Cached, revalidated on publish.

---

## 7. Admin

- `/admin/funnels` — list, using the house `components/ui/data-table.tsx` standard (`DataTableCard` →
  `DataTableToolbar` → `DataTable` → `DataTableBadge` for status). No hand-rolled table.
- `/admin/funnels/[id]` — steps list, reorder, settings.
- `/admin/funnels/[id]/edit/[stepId]` — the GrapesJS canvas (client component, `ssr: false`), with
  brand tokens preloaded as style presets and the six islands registered as draggable blocks.
- Permissions: new `funnels` key in `lib/permissions/registry.ts` under the `marketing` group, with
  `PATH_PERMISSIONS` prefixes for `/admin/funnels` and `/api/admin/funnels`.
- Audit: `funnel.created`, `funnel.updated`, `funnel.published`, `funnel.deleted`,
  `funnel.submission_received` added to `lib/audit/actions.ts`; admin routes wrapped in `withAudit`.
- Images: GrapesJS asset manager posts to an upload route backed by **Firebase Storage** (where all
  uploads live), not Supabase.
- **No feature flag.** Per project convention, flags are reserved for money and mass-email risk; a page
  builder is neither, and an unpublished funnel is already invisible.

---

## 8. Testing

The compiler is where the risk is, and it is pure — so that is where the tests go.

- `compile/sanitize`: every rejection rule gets a test that **fails if the rule is removed** — script
  tags, `on*` handlers, `javascript:` href, non-allowlisted iframe host, `@import`, unknown tag unwrapping.
- `compile/css-scope`: selector prefixing, `@media` recursion, `html`/`body` rewriting.
- `compile/islands`: extraction, nesting inside styled containers, invalid props failing the publish.
- `next.config.mjs` assertion: every allowlisted iframe host appears in `frame-src`.
- Submission route: honeypot, rate limit, server-side field validation rejecting client-declared fields.
- Renderer: node tree → React, including an island nested several levels deep.

Verification is targeted suites + `npm run build`, per project convention — not a full-suite run.

---

## 9. Phasing

**Phase 1 (this spec):** schema · compiler · publish pipeline · public renderer · admin list/steps/editor ·
**all six islands** · submissions · permissions · audit · tests.

The owner explicitly chose to pull all islands into Phase 1 rather than ship the spine alone.

**Phase 2 (own spec):** `funnel_events`, per-step conversion reporting, A/B split testing.

---

## 10. Decisions made without sign-off

The owner stepped away after approving §1 scope, with standing instruction to proceed autonomously.
These were chosen by the author and are the ones to review first:

1. **Node-tree compilation over stored-HTML + client hydration** (§2). Biggest architectural call.
   Removes the XSS surface and keeps islands server-rendered.
2. **CSS scoping under `#djp-funnel-root` rather than a separate root layout** (§4) — avoids a
   multi-root-layout refactor of a working app.
3. **`grapesjs` mounted directly; `@grapesjs/react` not used** (§2) — peer range conflict.
4. **`/go/<funnel>/<step>` URL shape** (§6) — collision-free against 40 existing routes.
5. **Testimonials and FAQ split into two islands** (§5).
6. **No feature flag** (§7), per project convention.
7. **New code does not write to GHL** (§5) — that is the point of the project.
8. **Not applied to production.** The migration ships as a file only; it is not run against prod, and
   nothing is pushed.
