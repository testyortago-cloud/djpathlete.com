# FAQ Management CMS — Design

**Date:** 2026-05-20
**Status:** Approved (design); pending implementation plan
**Author:** Darren / Claude

## Problem

FAQs are hardcoded as TypeScript arrays scattered across ~9 page files:

- `/faq` — a `groups` array (7 groups, ~30 Q&As) + inline `FAQPage` JSON-LD.
- `components/FAQSection.tsx` — a `defaultFAQs` array (7 generic Q&As).
- Inline FAQ arrays + `FAQPage` JSON-LD on `/online`, `/athletes`,
  `/athletes/[type]`, `/services/online-vs-in-person`,
  `/services/coaching-vs-training-app`, `/sports/[sport]`, `/camps/[slug]`,
  `/clinics/[slug]`, `/programs/rotational-reboot`.

The admin cannot edit any of them without a developer and a deploy. There is
no single place to see, create, edit, delete, or reorder the FAQs that appear
on the website.

(Blog posts are out of scope — they already store FAQs in `blog_posts.faq`.)

## Goal

A FAQ CMS in the admin under **Marketing** that lets the admin create, edit,
delete, and reorder FAQs for **any page** of the website — static pages and
templated pages (sports, athlete types, camps, clinics). Every page with FAQs
renders them from the database and **auto-emits** the SEO/AEO/GEO structured
data; the admin only ever writes plain questions and answers. The editor
includes AI assistance to generate page-relevant questions and suggest
accurate answers, both fully editable.

## Approach (chosen: A)

Single `faqs` table keyed by `page_key`, a typed page registry, and one
reusable server component that renders the FAQs and emits all structured data.
Rejected: a FAQ↔page join table (reusable FAQs — YAGNI, page FAQs are
page-specific) and a JSON-column-on-pages model (loses per-FAQ rows, ordering,
audit, per-FAQ AI ops).

## Data model

### Table `faqs` — migration `00158_faqs.sql`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK, `gen_random_uuid()` | |
| `page_key` | text, not null | Page the FAQ renders on. See "Page keys" below. |
| `category` | text, nullable | Optional grouping. Only `/faq` groups today (7). Null elsewhere. |
| `question` | text, not null | |
| `answer` | text, not null | Plain text. AEO/GEO favours clean extractable answers; `FAQPage` JSON-LD requires plain text. |
| `link_text` | text, nullable | One optional internal link per FAQ (existing `/faq` pattern). |
| `link_href` | text, nullable | |
| `sort_order` | int, not null, default 0 | Drag-to-reorder in admin. |
| `status` | text, not null, default `published` | `published` \| `draft`. Drafts do not render and do not emit schema. |
| `created_at` | timestamptz, not null, default `now()` | |
| `updated_at` | timestamptz, not null, default `now()` | Maintained by trigger. |

Constraints / indexes:

- `CHECK (status IN ('published','draft'))`
- `CHECK ((link_text IS NULL) = (link_href IS NULL))` — link is both-or-neither.
- Index `faqs_page_key_idx ON faqs (page_key, status, sort_order)` — the single
  query each page runs.
- RLS: service-role only (consistent with `marketing_products`); all reads go
  through the DAL with the service-role client.

### Page keys

`page_key` is a stable string identifying the page:

- Static pages: `faq`, `online`, `in-person`, `assessment`,
  `services/online-vs-in-person`, `services/coaching-vs-training-app`,
  `programs/rotational-reboot` (extendable).
- Sport pages: `sports/<slug>` (e.g. `sports/tennis-performance-training`),
  derived from the existing `SPORTS` array.
- Athlete pages: `athletes/<slug>` (e.g. `athletes/professional`), derived
  from the existing `ATHLETES` array.
- Event pages (camps/clinics): `event/<event-id>`.

### Page registry — `lib/faq/pages.ts`

A `lib/` module shared by the admin UI and the renderer. Exposes:

- `STATIC_FAQ_PAGES` — a hardcoded typed list:
  `{ key, label, routePath, supportsCategories, contextSummary }`.
- `getSportFaqPages()` — derived from `SPORTS`.
- `getAthleteFaqPages()` — derived from `ATHLETES`.
- Event pages are not static; the admin page-picker fetches current published
  camps/clinics from the events DAL and offers `event/<id>` keys.
- `resolveFaqPage(pageKey)` — returns the registry entry (label, routePath,
  contextSummary) for revalidation and AI grounding.

`contextSummary` is a short, factual description of the page used to ground
the AI. For sports/athletes/events it is pulled from existing data
(`SPORTS`/`ATHLETES` entries, event records); for static pages it is a curated
sentence or two added to the registry. No HTML scraping.

## Rendering & auto SEO/AEO/GEO

`components/public/ManagedFaqSection.tsx` — a server component, the only thing
pages call:

- Props: `pageKey: string`, `variant: "accordion" | "cards"`,
  optional `title`, optional `className`.
- Fetches published FAQs for `pageKey` ordered by `sort_order` via the DAL.
- Renders the accordion UI:
  - `variant="accordion"` — the `FAQSection` left-title / right-list layout.
  - `variant="cards"` — the `/faq` and service-page `<details>` card layout.
  - When any FAQ has a `category`, render grouped (used by `/faq`).
- Auto-emits structured data — admin never touches code:
  - **SEO** — `FAQPage` JSON-LD via the existing `buildFaqPageSchema`
    (`lib/seo/build-faq-page-schema.ts`), which already emits only when ≥3
    non-empty entries exist (Google rich-result rule).
  - **AEO** — `speakable` SpeakableSpecification targeting the question and
    answer nodes.
  - **GEO** — clean semantic HTML: `<h2>` section heading, `<h3>` questions,
    `<details>/<summary>` so answers are extractable.
- Empty / error handling: 0 published FAQs → renders nothing. DB error →
  renders nothing and logs; it must never crash the host page.

Pages stay ISR (`export const revalidate`); FAQ writes trigger
`revalidatePath()` for the affected route (see Cross-cutting).

## Admin UI

New route `app/(admin)/admin/marketing/faqs/page.tsx`, new nav item
"FAQs" in the Marketing group of `components/admin/admin-nav.ts`.

- **Page picker** — grouped dropdown: Static / Sports / Athletes / Events.
  Selecting a page loads its FAQ list. The admin never types a route path.
- **FAQ list** for the selected page:
  - Drag-to-reorder via `@dnd-kit` (already in the stack); reorder persists
    `sort_order`.
  - Inline status toggle (published / draft).
  - Edit and delete (delete confirms).
- **Editor** (dialog or inline panel): question, answer, optional category
  (shown only when the page `supportsCategories`), optional internal link
  (`link_text` + `link_href`).
- **AI — "Generate questions"**: proposes excellent, page-specific questions
  grounded in the page `contextSummary`. The admin keeps/discards/edits any.
- **AI — "Suggest answer"**: for a given question, drafts an accurate,
  straightforward answer grounded in the page context. Fully editable.

## AI assist

- Route: `app/api/admin/marketing/faqs/ai/route.ts` (POST). Admin-auth gated.
- Calls Anthropic directly (small payload — a handful of Q&As, low
  `max_tokens`; no 10-minute streaming-guard risk).
- **Grounding:** the route resolves the `page_key` via the registry, builds a
  prompt from the page `contextSummary` + `lib/business-info.ts` (NAP, brand
  facts) + the existing FAQs for that page (to avoid duplicates).
- **Accuracy guardrail:** the system prompt requires concise, factual,
  non-promotional answers and explicitly forbids inventing facts not present
  in the supplied context — if a fact is unknown, the answer says so or omits
  the claim.
- Two actions: `generate_questions` (returns a list of questions) and
  `suggest_answer` (returns one answer for a supplied question). Output is
  parsed/validated with Zod before returning to the client.
- Degrades gracefully — if the AI call fails, the admin still writes manually.

## Migration

1. Seed `faqs` with the ~50 existing hardcoded FAQs (the `/faq` groups, plus
   each page's inline array, plus the sport/athlete data-file FAQs). Done via
   a one-off seed script (`scripts/seed-faqs.ts`) kept out of the migration so
   the schema migration stays pure DDL.
2. Convert pages to `<ManagedFaqSection>` **one page at a time, each verified**
   before moving on — so a bad conversion cannot break multiple pages at once.
   Order: `/faq` first (highest value, exercises grouping), then static
   service pages, then sports, then athletes, then event pages.
3. Each conversion removes the hardcoded FAQ array and the inline `FAQPage`
   JSON-LD from that page (the component now emits it).

## Cross-cutting concerns

- **Revalidation:** FAQ create/update/delete/reorder → `revalidatePath()` for
  the page's `routePath` (resolved from the registry). Event pages revalidate
  their dynamic route.
- **Audit logging:** all admin writes go through `withAudit()` /
  `recordAudit()`. New `marketing`-category action slugs in
  `lib/audit/actions.ts`: `faq.create`, `faq.update`, `faq.delete`,
  `faq.reorder`.
- **Validation:** `lib/validators/faq.ts` — Zod schema for FAQ input
  (question/answer non-empty, status enum, link both-or-neither, page_key
  must resolve in the registry).
- **Error handling:** DAL returns typed results; the admin UI surfaces errors
  via Sonner toasts; the render component fails closed (renders nothing).
- **No feature flag** — the FAQ CMS is low-risk. The page-by-page migration is
  the safety mechanism.

## Components and their boundaries

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `00158_faqs.sql` | Table, constraints, index, `updated_at` trigger | — |
| `lib/faq/pages.ts` | Page registry + key resolution + context summaries | `SPORTS`, `ATHLETES` data |
| `lib/db/faqs.ts` | All `faqs` reads/writes (DAL) | service-role Supabase client |
| `lib/validators/faq.ts` | Zod schema for FAQ input | page registry |
| `lib/seo/build-faq-page-schema.ts` | `FAQPage` JSON-LD (exists; extend if needed) | — |
| `components/public/ManagedFaqSection.tsx` | Fetch + render FAQs + emit JSON-LD/speakable | DAL, schema builder, registry |
| `app/(admin)/admin/marketing/faqs/page.tsx` | Admin FAQ CMS UI | DAL, registry |
| `app/api/admin/marketing/faqs/*` | Admin CRUD + reorder endpoints | DAL, validator, audit |
| `app/api/admin/marketing/faqs/ai/route.ts` | AI question/answer assist | Anthropic, registry, business-info |

## Testing (TDD)

Tests written first, red-green verified:

- `lib/db/faqs.ts` — list by page, create, update, delete, reorder.
- `lib/validators/faq.ts` — accepts valid input, rejects empty Q/A, bad
  status, half-set link, unknown page_key.
- `lib/seo/build-faq-page-schema.ts` — already tested; extend for the
  <3-entry null case if not covered.
- `lib/faq/pages.ts` — registry resolves static/sport/athlete keys; unknown
  key returns undefined.
- AI route prompt-assembly helper — grounding context is built from the
  registry + business-info; output Zod parsing rejects malformed AI output.
- Component-level tests for `ManagedFaqSection` and the admin list where
  practical (jsdom).

## Out of scope

- Blog post FAQs (already DB-backed via `blog_posts.faq`).
- Multi-page reuse of a single FAQ (a join table) — page FAQs are
  page-specific; revisit only if a real need appears.
- AI generating entire FAQ sets unattended — the admin always reviews and
  edits AI output.
