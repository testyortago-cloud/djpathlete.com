# Tenancy phase 5a — events become per-tenant

Status: proposed. Branch `feat/tenancy-phase5a-events-per-tenant`, worktree
`../djpathlete-tenancy-phase5a`, cut from `origin/main` @ `322a9f93`.

Predecessor: `docs/superpowers/specs/2026-09-05-tenancy-phase4-host-resolution-design.md`,
whose §8 defers "Giving `funnels`/`events`/`shop_*` a `business_id`" to a later phase.
This is the first of those phases.

## 0. Goal, what "done" looks like, and where this sits

Phase 4 gave every public surface a way to know whose request it is. It changed nothing about
what those surfaces then read, because the content tables carry no tenant. Hand a coach
`coach.example.com` today and their contacts, consents, quiz attempts and chat conversations
separate correctly while their `/camps` page lists DJP Athlete's camps. This phase closes that
for events.

**Done** = `events` and `event_signups` carry `business_id`; every reader of either carries a
tenant predicate; `events.slug` is unique per business rather than globally; a request to
`/camps` on a host with no events of its own shows an empty list rather than another
business's; and `/admin/events` shows the signed-in admin's tenant rather than every tenant's.

### The decomposition this phase belongs to

Owner-approved 2026-09-06. Vertical slices — each phase is one migration plus its own readers
plus its own constraint change, complete and shippable, so no column ever ships without a
reader.

| Phase | Subsystem | Importer files | `.from()` sites | Why this order |
|---|---|---|---|---|
| **5a (this)** | events | 28 | 25 | Smallest; 0 signup rows in production so the child-column decision is free to get right; the leak is already visible on screen (§1); establishes the pattern |
| 5b + 5c | funnels — public read (`/go`), then builder / admin | 34 | 31 | The actual blocker to a second tenant. Split in two because `/go` never touches `loadCatalogues()`, which `lib/tenancy/platform.ts` deliberately freezes; the split point between them is measured when 5b is specced, not now |
| 5d | shop | 39 | 37 | Largest, and least urgent for a coach; `shop_orders` has no parent to inherit from, so it forces the plain-column case |

`blog_posts` (37 rows, 44 sites), `faqs` (126, 7) and `programs` (74, 26) are **not** in this
decomposition. Whether a coach's blog is their own content or content the platform syndicates
to them is a product question, not an engineering one, and `programs` is additionally entangled
with the AI generation pipeline and with client assignments. It needs an owner ruling before it
gets a phase.

## 1. Measured starting state

Production database via the `supabase-prod` MCP, and `grep -n` over `app/ lib/ components/
functions/src`, excluding `__tests__`. All figures 2026-09-06.

- `events`: 3 rows, no `business_id`, 11 `.from("events")` sites.
  `event_signups`: **0 rows**, no `business_id`, 14 `.from("event_signups")` sites.
- **28 production files** read `events` or `event_signups`. 24 import `@/lib/db/events` or
  `@/lib/db/event-signups` (10 public-surface, 7 admin, 7 shared); **4 more bypass the DAL with a
  direct `.from()`** and are invisible to an import-based inventory —
  `lib/lead-engine/chat/facts.ts`, `lib/db/bookkeeping.ts`, `lib/ads/agent.ts` and
  `functions/src/ai/admin-tools.ts` (4 sites). Enumerated in §3.6. Classify by the matching
  LINE, not by the import: this spec's first draft missed all four.
- `lib/db/events.ts` exports 8 functions (170 lines); `lib/db/event-signups.ts` exports 8 (139).
- Constraints today: `events_slug_key` is `UNIQUE (slug)` — **global**. `event_signups` has no
  unique constraint beyond its primary key. For contrast, `funnel_steps` already carries
  `UNIQUE (funnel_id, slug)`, which is the shape this phase gives `events`.
- Two plpgsql functions mutate signups with no tenant argument:
  `confirm_event_signup(p_signup_id uuid)` and `cancel_event_signup(p_signup_id uuid)`.
- `event_signups` already carries `event_signups_event_id_fkey`, a single-column FK to
  `events(id)`. Two production call sites embed across it —
  `lib/db/bookkeeping.ts:321` (`.select("*, events(title,type)")`) and
  `functions/src/ai/admin-tools.ts:1085` (`events(title, type)`). §3.1 is why that matters.
- **None** of the 7 admin files calls `resolveAdminTenant()`. Two of the public API routes
  (`events/[id]/signup`, `events/[id]/checkout`) already call `resolvePublicTenant()` and have
  nowhere to put the answer.
- The leak is already visible: `app/(marketing)/camps/[slug]/page.tsx` calls
  `resolvePublicTenant()` for its consent wording (phase 4) **and** `getEventBySlug(slug)` with
  no predicate. The page names the host's business while displaying the platform's camp. The
  two halves are live and they disagree.
- `SINGLETON_BUSINESS_ID` production references: 5. This phase adds none and removes none.
- Migration `00252` is unclaimed on all 20 remote branches (checked with
  `git ls-tree --name-only <branch> supabase/migrations/`). Re-check before pushing.
- Baselines on `322a9f93`: `npx tsc --noEmit` = exactly 251 errors; `npx vitest run` = 937
  files / 9067 tests, all green, red baseline **zero**; `prettier --check` fails on ~78
  pre-existing test files; `npm run lint` is broken repo-wide (Next 16 removed `next lint`).

## 2. Where the tenant comes from, per surface

No new source. This phase routes existing sources into a table that can finally hold the answer.

| Source | Boundary | Used by |
|---|---|---|
| Host header | `resolvePublicTenant()` — `lib/tenancy/public.ts` | the 8 public surfaces in §3.6 |
| Session | `resolveAdminTenant()` / `resolveAdminTenantForRequest()` — `lib/tenancy/resolve.ts` | the 7 admin surfaces, plus `ensureEventPriced`'s caller and the analytics reader |
| A row that already carries the tenant | inline | the Stripe webhook, which reads a signup and uses `signup.business_id` |
| `platformBusinessId()` with an honest shelf entry | `lib/tenancy/platform.ts` | `loadCatalogues()` (already shelved) and `app/sitemap.ts` (new) |

`resolve.ts` and `public.ts` still never import each other. No third way is added.

## 3. Design

### 3.1 Migration `00252_events_business_id.sql`

One file. The schema below and the RPC replacement in §3.3 go in the same migration — they
are one change, and splitting them would leave a window where the guarded column exists and
the unguarded function still mutates across it.

```sql
alter table public.events
  add column business_id uuid not null
    default '00000000-0000-0000-0000-000000000001'
    references public.businesses(id);

-- Sole purpose: be the target of event_signups' composite FK below.
alter table public.events
  add constraint events_id_business_id_key unique (id, business_id);

alter table public.events drop constraint events_slug_key;
alter table public.events
  add constraint events_business_id_slug_key unique (business_id, slug);

create index events_business_status_end_idx
  on public.events (business_id, status, end_date);

alter table public.event_signups
  add column business_id uuid not null
    default '00000000-0000-0000-0000-000000000001';

alter table public.event_signups
  add constraint event_signups_event_business_fkey
    foreign key (event_id, business_id)
    references public.events (id, business_id)
    on delete cascade;   -- inherited from the constraint this replaces

-- Redundant once the composite FK exists, and actively harmful: see below.
alter table public.event_signups drop constraint event_signups_event_id_fkey;
```

Four things in that are load-bearing and all four read like tidy-up candidates.

**The `DEFAULT` is the deploy-race mitigation, and this branch must not remove it.** Migrations
apply to production automatically on push to main and race the Vercel build. In the window
where the migration has landed and the old bundle is still serving, `createEvent` inserts no
`business_id`; with `NOT NULL` and no default that insert fails with `23502` and admin event
creation 500s. The default makes it land on the platform, which is correct because the platform
is the only business. Dropping the default belongs in the **next** branch, not a second
migration in this one: the migration Action applies every pending migration in a single run, so
an add-then-drop pair inside one branch means the default never exists during the window it was
added for.

**`NOT NULL` is safe immediately** *because* of that default — Postgres 11+ applies a default to
existing rows without a table rewrite, so the 3 events and 0 signups are backfilled by the
`add column` itself. There is no separate backfill statement and no nullable interregnum.

**Dropping `event_signups_event_id_fkey` is required, not tidy-up.** PostgREST resolves an
embed by finding the foreign key between the two tables; with TWO FKs from `event_signups` to
`events` the embed is ambiguous and it answers `PGRST201` instead of rows. Two production call
sites embed across it — `lib/db/bookkeeping.ts:321` and `functions/src/ai/admin-tools.ts:1085` —
so leaving both constraints in place breaks the bookkeeping income read and a Firebase admin
tool. The composite FK fully implies the single-column one (`events.id` is the primary key, so
`(event_id, business_id)` referencing `(id, business_id)` cannot be satisfied without
`event_id` referencing `id`), which is why dropping it loses no REFERENTIAL integrity.

**It does not, however, inherit the old constraint's `ON DELETE` clause, and the first draft of
this spec was wrong to say the drop costs nothing.** `event_signups_event_id_fkey` was declared
`ON DELETE CASCADE`; a composite replacement with no `ON DELETE` defaults to `NO ACTION`, which
makes deleting an event that has signups raise `foreign_key_violation` instead of cascading.
`deleteEvent(businessId, id, { force: true })` exists precisely to rely on that cascade — its
own doc comment says so, and the admin confirm dialog tells the user the delete "cascades via
FK". Caught by Task 1's review, which reproduced the failure on the dev clone rather than
reasoning about it. The clause is therefore explicit above, with a comment saying where it came
from, so a later reader does not tidy it away.

Whether cascade remains the right semantic once a tenant boundary exists — as opposed to
blocking the delete — is a product question this phase does not answer. It preserves today's
behaviour exactly; changing it would be a separate, deliberate decision.

Dropping it, rather than adding a disambiguating hint to both call sites, is deliberate: one of
the two lives in `functions/`, which has `rootDir: "src"` and cannot import `lib/`, so a hint
there is a twin edit that has to be kept in sync forever. Dropping the redundant constraint
requires **no call-site change at all**.

**VERIFIED on the dev clone, 2026-09-06, not assumed.** A scratch parent/child pair mirroring
this exact shape was created, probed through PostgREST, and dropped:

- With ONLY the composite FK, the embed resolves:
  `GET /_probe_child?select=label,_probe_parent(title)` -> `[{"label":"Child A","_probe_parent":{"title":"Parent A"}}]`.
- Adding the single-column FK alongside it makes the SAME request fail with `PGRST201`,
  "Could not embed because more than one relationship was found", listing both constraints and
  hinting at the disambiguated forms.

So the drop is required and sufficient, and no call site changes. Had it gone the other way the
fallback was the hint form — `events!event_signups_event_business_fkey(title,type)` at both
sites, twin edit accepted.

**`(business_id, slug)`, not `(business_id, lower(slug))`.** `events_slug_key` is case-sensitive
today; `funnels_slug_key` is a functional index on `lower(slug)`. Making events case-insensitive
here would be a second, unrelated behaviour change smuggled into a tenancy migration. The
divergence is real and belongs to phase 5b to resolve for funnels, or to a later cleanup — it is
named here so nobody reads the inconsistency as an oversight.

### 3.2 The deferred second migration (a LATER branch, not this one)

`00253` (or whatever is free then) drops both defaults, once every writer in §3.6 stamps
`business_id` explicitly. Until it lands, a writer that forgets to stamp silently produces a
platform-owned row instead of failing — which is exactly why it must land, and why this spec
names it rather than leaving it to be noticed.

### 3.3 The two RPCs gain a tenant argument

`confirm_event_signup` and `cancel_event_signup` are plpgsql keyed on `p_signup_id` alone. No
TypeScript predicate reaches inside them, so scoping the DAL around them would leave the hole
open. Migration `00252` replaces both with a `(p_signup_id uuid, p_business_id uuid)` signature
that filters on both, returning the existing `not_found` result when the signup is not the
caller's.

The alternative — a call-site guard — is what `assertQuizInBusiness` had to be invented for, and
[lib/db/quizzes.ts](../../../lib/db/quizzes.ts) documents why that is the weaker shape: a
PostgREST update matching zero rows is not an error it reports, so a forgotten guard fails
silently. A required argument cannot be forgotten; the compiler says so.

**Both functions are dropped and recreated in the same migration.** `CREATE OR REPLACE FUNCTION`
cannot change a signature, and adding an argument creates an *overload* rather than replacing —
leaving the unguarded one-argument version callable. The migration must `drop function` first.

### 3.4 `lib/db/events.ts` — the contract

`businessId` becomes the first parameter of every function, matching `lib/db/quizzes.ts`, which
is the repo's existing scoped-DAL shape.

| Function | After | Predicate |
|---|---|---|
| `getEvents(businessId, filters)` | scoped list | `.eq("business_id", businessId)` |
| `getPublishedEvents(businessId, filters)` | scoped list | same, plus existing status/date filters |
| `getEventById(businessId, id)` | scoped lookup — returns `null` for another tenant's event | `.eq("id", id).eq("business_id", businessId)` |
| `getEventBySlug(businessId, slug)` | scoped lookup | `.eq("slug", slug).eq("business_id", businessId)` |
| `createEvent(businessId, input)` | stamps `business_id` | — |
| `updateEvent(businessId, id, input)` | scoped write | `.eq("business_id", businessId)` |
| `setEventStatus(businessId, id, status)` | scoped write | same |
| `deleteEvent(businessId, id, opts)` | scoped write | same |

`getEventBySlug`'s predicate is not optional and not merely defensive. It ends in
`.maybeSingle()`; the moment two businesses share a slug — which `(business_id, slug)` newly
permits — an unscoped read returns two rows and PostgREST answers `PGRST116`. The constraint
change converts a silent wrong-tenant read into a crash unless the predicate lands in the same
commit.

### 3.5 `lib/db/event-signups.ts` — the contract

| Function | After | Note |
|---|---|---|
| `getSignupsForEvent(businessId, eventId)` | scoped | `.eq("business_id", businessId)` |
| `getSignupById(businessId, id)` | scoped | same |
| `createSignup(businessId, …)` | stamps | the composite FK rejects a `business_id` that disagrees with the event's |
| `confirmSignup(businessId, id)` | passes `p_business_id` | §3.3 |
| `cancelSignup(businessId, id)` | passes `p_business_id` | §3.3 |
| `listSignupsCreatedSince(businessId, since)` | scoped | its one caller is admin analytics |
| `getEventSignupByStripeSessionId(sessionId)` | **unchanged** | correct by construction |
| `getEventSignupByPaymentIntent(piId)` | **unchanged** | correct by construction |

The last two stay unscoped deliberately: a Stripe session id and a payment-intent id are
globally unique and issued by Stripe, so they name exactly one signup and cannot be guessed into
another tenant's. That reasoning goes in a doc comment on both functions, in the style
`lib/tenancy/platform.ts` uses for its shelves — an unscoped reader with a written argument is a
decision; an unscoped reader without one is a defect, and the two must not look alike.

Their **callers** still check. The two success pages read a signup by Stripe session id and then
render it; they compare `signup.business_id` against the host's resolved business and answer 404
on a mismatch, so a coach's host cannot be used to display another tenant's customer details.

### 3.6 The 24 files, by boundary

**Public — `resolvePublicTenant()` (9 files).**

| File | Reads | Today |
|---|---|---|
| `app/(marketing)/camps/page.tsx` | `getPublishedEvents({type:"camp"})` | `force-dynamic` already |
| `app/(marketing)/clinics/page.tsx` | `getPublishedEvents({type:"clinic"})` | `force-dynamic` already |
| `app/(marketing)/camps/[slug]/page.tsx` | `getEventBySlug`, `getPublishedEvents` | **already resolves**, for consent wording only |
| `app/(marketing)/clinics/[slug]/page.tsx` | same | **already resolves** |
| `app/(marketing)/camps/[slug]/success/page.tsx` | `getEventBySlug`, `getEventSignupByStripeSessionId` | unresolved; gains the §3.5 ownership check |
| `app/(marketing)/clinics/[slug]/success/page.tsx` | same | same |
| `components/funnels/islands/EventIsland.tsx` | `getEventById` | unresolved — a funnel could otherwise embed another tenant's event |
| `app/api/events/[id]/signup/route.ts` | `getEventById`, `createSignup` | **already resolves** |
| `app/api/events/[id]/checkout/route.ts` | `getEventById` → `lib/events/checkout.ts` | **already resolves** |

**Admin — `resolveAdminTenant()` (7 files).** None resolves today.

`app/(admin)/admin/events/page.tsx` (`getEvents`) ·
`app/(admin)/admin/events/[id]/page.tsx` (`getEventById`, `getSignupsForEvent`) ·
`app/(admin)/admin/marketing/faqs/page.tsx` (`getPublishedEvents()` — an admin page calling a
published reader) ·
`app/api/admin/events/route.ts` · `app/api/admin/events/[id]/route.ts` ·
`app/api/admin/events/[id]/duplicate/route.ts` ·
`app/api/admin/events/[id]/signups/[signupId]/route.ts` (the two RPCs).

**Shared and other (7 files).**

| File | Tenant from |
|---|---|
| `app/api/funnels/submit/route.ts` | the `resolvePublicTenant()` it already calls |
| `app/api/funnels/preview-submit/route.ts` | `resolveAdminTenantForRequest()` — the route is admin/staff-gated |
| `app/api/stripe/webhook/route.ts` | **the signup row** — reads it, then passes `signup.business_id`. The webhook has no tenant of its own; this is spec §2's "a row that already carries the tenant", not a new seam |
| `lib/analytics/sections/bookings.ts` | its caller's admin tenant, threaded in |
| `lib/events/checkout.ts` | its two callers, both of which resolve |
| `lib/events/ensure-priced.ts` | its one caller, `app/api/admin/funnels/[id]/publish/route.ts` |
| `lib/funnels/sections/resolve.ts` | `platformBusinessId()` — see §3.7 |

**Direct `.from()` readers, outside the DAL (4 files).** None imports `lib/db/events`, so an
import-based inventory does not see them.

| File | Reads | Disposition |
|---|---|---|
| `lib/lead-engine/chat/facts.ts` (`listPublicEvents`) | published upcoming events, as facts for the public `/ask` chat | **Converted.** A genuine public leak: a coach's chat would answer questions about the platform's camps. The tenant is already available — the conversation row carries `business_id`, which is how phase 4 left `/ask` |
| `lib/db/bookkeeping.ts` | `event_signups` + embedded `events(title,type)`, for the income report | **Converted**, admin tenant. Also the call site that proves §3.1's embed assumption |
| `lib/ads/agent.ts` | published upcoming events, as ad-copy context | **Not converted.** The ads subsystem is frozen by standing invariant; scoping it is its own phase, and doing it here as a side effect is exactly what that freeze exists to prevent |
| `functions/src/ai/admin-tools.ts` (4 sites, incl. one embed) | events and signups, for the admin AI assistant | **Not converted.** `functions/` cannot import `lib/`, so scoping it means a twin tenancy helper — a Firebase-runtime phase, not this one. §8 records that it becomes a real leak the day a second tenant exists |

**Not converted: `app/sitemap.ts`.** See §3.7.

### 3.7 `lib/tenancy/platform.ts` — one shelf entry added, one unchanged

`loadCatalogues()` in `lib/funnels/sections/resolve.ts` is already on the DELIBERATELY FROZEN
shelf. It calls `getEvents({})` and `getPublishedEvents`, so it gains a `platformBusinessId()`
argument. That is one more *use* in a file already listed as a caller — no new shelf entry, and
the inventory test stays satisfied.

`app/sitemap.ts` is **new** on that shelf, and honestly labelled: it is not a caller that cannot
resolve a tenant, it is a file whose whole output is keyed to one host. Every URL it emits is
built from `SITE_URL`, a constant. Giving it the request's business without also giving it the
request's origin would produce a sitemap listing a coach's events at `darrenjpaul.com` — worse
than today, not better. A per-host sitemap needs per-host absolute URLs, which blog and shop
also depend on; that is its own phase.

## 4. What does not change

`lib/tenancy/resolve.ts`, `lib/tenancy/public.ts`, `users.role`, permissions, `proxy.ts`, the
ads subsystem, `SINGLETON_BUSINESS_ID`'s count of 5. No business switcher, no agency hierarchy,
no permission tiers. `funnels`, `shop_*`, `blog_posts`, `faqs`, `programs` keep no `business_id`
— later phases, or an owner ruling.

## 5. Behaviour changes — explicit

1. **`generateStaticParams` comes off `/camps/[slug]` and `/clinics/[slug]`.** Since phase 4
   both render per request; prerendering a slug now means prerendering it for an arbitrary
   tenant. Removing it is a correctness fix, not a regression — but it is a build-table change
   and must be measured, not assumed (§7).
2. **`/admin/events` shows one tenant's events.** Today it shows all. With one tenant the
   rendered list is identical; the diff is invisible in production and real in the clone, which
   has 8 businesses.
3. **`events.slug` is no longer globally unique.** Two businesses may hold the same slug. Any
   code that treats a slug as a global identifier is now wrong; §3.4 names the one place that
   would crash rather than lie.
4. **A signup can no longer be confirmed or cancelled across tenants**, because the RPCs filter.
5. **No rendering change to the marketing pages.** `/camps` and `/clinics` are already
   `force-dynamic`; the five pages that lost CDN caching in phase 4 are untouched here.

## 6. Error handling

| Condition | Result |
|---|---|
| Public read, host resolves to a business with no events | empty list / 404 — the same shape as "no events yet", which is the honest answer |
| `getEventById` / `getEventBySlug` for another tenant's event | `null`, then the caller's existing not-found path |
| Admin write against another tenant's event | update matches zero rows; the DAL's existing `.single()` error path fires |
| RPC called with a mismatched `p_business_id` | existing `{ok:false, reason:"not_found"}` — no new result shape |
| `createSignup` with a `business_id` disagreeing with its event's | `23503` from the composite FK — structurally impossible to persist |

No new audit slug. Nothing here is a tenancy *resolution* failure; phase 4 owns that taxonomy.

## 7. Testing — assert WHICH tenant, then mutate

Retargeting a suite to pass one more argument proves nothing. Every converted reader gets:

1. The boundary mocked to a sentinel that is **not** the platform id — `"host-biz"` for public,
   `"admin-biz"` for admin, following phase 4's convention.
2. An assertion that **that value** reaches the DAL — `expect(getPublishedEvents).toHaveBeenCalledWith("host-biz", …)`,
   never `expect.any(String)` and never "a value came back".
3. A recorded mutation run: hard-code the platform id in the converted file and confirm the test
   fails. A mutation that is only described is a guess.

Plus: a migration test that the composite FK rejects a mismatched pair; a test that the two
Stripe-keyed readers stay unscoped (an absence assertion, so it carries a presence control — a
sibling asserting a scoped reader *does* filter, or it passes when nothing rendered).

Suites reaching the network are suites with incomplete mocks: `__tests__/setup.tsx` loads
`.env.local`, which points at the dev clone. Grep test output for PostgREST codes (`22P02`,
`42P01`, `23503`) and DAL log prefixes; a green run will not say so.

Gates: `npx tsc --noEmit` compared as a **set** against the 251-line baseline at
`/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/tsc-base-full-singleton-removal-2026-09-05.txt`
with `(line,col)` stripped; targeted suites; `npm run build`; the build's route table diffed
before and after for §5.1. Not the full suite — this change is not cross-cutting.

## 8. Out of scope, each for a reason

| Not done | Why |
|---|---|
| `funnels`, `shop_*` | phases 5b–5d; §0 |
| `blog_posts`, `faqs`, `programs` | needs an owner ruling on whether a coach's content is their own or syndicated |
| Dropping the `00252` defaults | must survive one deploy; §3.2 |
| A per-host sitemap | needs per-host absolute URLs, which blog and shop share; §3.7 |
| Making `events.slug` case-insensitive | unrelated behaviour change; §3.1 |
| Coach domain onboarding, `vercel_domain_id` writer | still no surface with a customer |
| The five marketing pages that lost CDN caching in phase 4 | phase 4 §5.1's mitigation, untouched here |
| `lib/ads/agent.ts`'s events read | the ads subsystem is frozen by standing invariant; scope the subsystem, then this reader |
| `functions/src/ai/admin-tools.ts` (4 sites) | `functions/` cannot import `lib/`; needs a twin tenancy helper. **This one is not merely deferred — it is a PII leak the day a second tenant exists**, because the platform owner's AI assistant reads every signup's name and parent email with no predicate. It must be closed before a second tenant onboards, not "later" |
| Anything in `resolve.ts`, permissions, `users.role`, ads | INVARIANTS |

## 9. Decisions made without the owner — review these

1. **`event_signups` gets its own `business_id` with a composite FK**, rather than inheriting
   through `event_id`. Argued and approved in brainstorming: `shop_orders` has no parent to
   inherit from, so the column is forced somewhere regardless, and one rule — every table
   carries `business_id` — is the only version a structural test can pin. The FK makes drift
   impossible rather than merely tested.
2. **`NOT NULL` immediately, carried by a `DEFAULT` that this branch does not drop** (§3.1, §3.2).
3. **The RPCs gain an argument rather than a call-site guard** (§3.3).
4. **`(business_id, slug)` stays case-sensitive**, diverging from `funnels` (§3.1).
5. **`getEventSignupByStripeSessionId` and `…ByPaymentIntent` stay unscoped**, with the argument
   written down and their callers checking ownership (§3.5).
6. **`app/sitemap.ts` goes on the platform shelf rather than being converted** (§3.7).
7. **`generateStaticParams` is removed** from the two detail pages (§5.1).
8. **The admin surfaces are in this phase**, not deferred — 7 files, and leaving them is a
   reader with no predicate.
9. **The Stripe webhook takes its tenant from the signup row**, adding no seam entry (§3.6).
10. **`event_signups_event_id_fkey` is dropped** rather than disambiguating two embeds by hand,
    one of which is a `functions/` twin (§3.1).
11. **The composite FK carries `on delete cascade`,** preserving the dropped constraint's
    behaviour exactly rather than silently changing event deletion (§3.1). Whether cascade is
    still the right semantic across a tenant boundary is deliberately NOT decided here.
12. **`lib/ads/agent.ts` and `functions/src/ai/admin-tools.ts` keep unscoped events reads.**
    Both are named in §8 with the reason. The second is flagged as a leak with a deadline —
    a second tenant — rather than an open-ended deferral.

## 10. Risks and traps for the implementer

- **The build's blast radius is the render tree, not the call site.** Phase 4 predicted two
  routes would lose static rendering and the build showed seven, with no log line. Before and
  after route tables, diffed, or the claim is unverified. An `●` on a build whose
  `generateStaticParams` returned nothing is a declaration, not evidence.
- **Verify the composite-FK embed before building on it** (§3.1). It is the one assumption here
  that, if wrong, invalidates the migration's shape rather than one call site.
- **An import-based file inventory misses direct `.from()` readers.** This spec's first draft
  counted 24 files and the real number is 28; the four it missed included the public chat's
  events reader. Enumerate with `grep -n 'from("<table>")'`, not by DAL import.
- **`CREATE OR REPLACE FUNCTION` cannot change a signature** — it overloads. `drop function`
  first, or the unguarded one-argument RPC stays callable (§3.3).
- **Do not name a converted file's path in `platform.ts` prose.** The inventory test's reverse
  check rejects any named path that no longer calls the seam; it bit two tasks in a row on
  phase 4. Describe without the path, or add to `NAMED_BUT_NOT_CALLERS`.
- **Plan-authored code is a sketch.** The codebase wins; report divergences rather than forcing
  the plan's shape. `vi.fn(async () => {})` infers a zero-arg mock whose `.mock.calls[0][0]` is
  `TS2493`.
- **zsh:** `for x in $LIST` runs once with the whole list; `cmd $FILES` gets one 4KB filename.
  Both fail with a flattering zero. Use literal lists, `${=VAR}`, or `xargs`.
- **Classify by the matching line (`grep -n`), never `grep -l`.** Ten of one brief's 25
  "production references" were prose in comments.
- **Strip ANSI before counting anything in a vitest log:** `sed 's/\x1b\[[0-9;]*m//g'`.
- **`source ~/.nvm/nvm.sh && nvm use` before any npx/npm/node command.** Nothing auto-switches
  Node here and the machine default is 20.11.1, on which vitest reports a worker crash as
  "no tests".
- **Never mutate production data.** `.env.local` points at the dev clone, which is a mix of real
  and seeded rows (8 businesses; 3 events, all past and all draft).
- **Do not push or merge without the owner's explicit go-ahead** — migrations auto-apply on push
  to main.
