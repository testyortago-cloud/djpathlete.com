# G35 — Readers with no tenant predicate: design

**Date:** 2026-09-25 · **Ledger row:** G35 (`docs/lead-engine-gaps-to-ship-2026-09-19.md`) · **Branch:** `worktree-g35-untenanted-readers` on `main@8b7fb0e6`

## 0. Why this is bigger than the row, and what the owner ruled

The row named three things: the chat's fact readers (`faqs`, `programs`, `testimonials`), `hasConsent`, and
campaign revenue's `marketing_attribution` read. Before designing, a discovery workflow (`wf_d0aba934-80f`,
five investigators plus a completeness critic, 13 claims re-checked) swept every read of the 38 tables that
carry `business_id`: **197 read sites, 41 with no business predicate**, most of them safe by construction
(keyed on a webhook id, a token, or an id from an already-scoped read). It also found readers of untenanted
tables behind grantable staff permissions, which the sweep by construction could not see.

**Production has one business** (`Primary`, measured 2026-09-23), so nothing below leaks in production today.
Every item is a fuse for the white-label destination, not an incident.

The owner ruled, in this session:

1. **Scope:** fix the readers where the tenant is already in hand; name every no-column seam honestly;
   record the large ones as new ledger rows with the owner's questions. Not "only what the row says",
   and not "narrow the admin AI chat and `/admin/programs` to owner-only now".
2. **Chat facts and funnel FAQ/testimonial sections** show **nothing** for a business that is not the
   platform business, rather than the platform's rows. Same rule the chat's Calendly booking offer follows.
3. **SEO and social agent alerts** go to the **owners** of the job's business, as in-app bell rows.
4. **Contact and inquiry bell alerts** go to the site business's members with role **owner or coach**
   (approved with the design).

## 1. Section A — add the predicate where the tenant is in hand

Every change here makes a tenant argument REQUIRED. An optional tenant is how `getConversation` ended up
with `if (businessId)` and a public caller that never passed one.

### A1. `hasConsent` (`lib/db/contact-consents.ts:38`)
- `hasConsent(contactId, channel, businessId)` adds `.eq("business_id", businessId)`.
- Callers, all with the tenant in scope: `lib/db/sequences.ts:105-106` (`loadRunContext`), `lib/lead-engine/sms.ts:423`
  (`sendManualSms`), `lib/lead-engine/sms-consent.ts:189`.
- Why it is not "correct by construction": `contact_consents` has two SEPARATE foreign keys (`business_id →
  businesses`, `contact_id → contacts`), no composite, and `business_id` defaults to the platform UUID. Nothing
  in the schema makes a consent row's business equal its contact's. Dev clone: 0 of 59 rows mismatch today.
- It also makes `contactsWithEmailConsent`'s doc comment (`lib/db/sequence-reporting.ts:215-216`, "cannot
  disagree with hasConsent") true by construction instead of true by data. Update that comment.
- Test: a consent row filed under another business is NOT honoured (MUTANT: drop the `.eq`); control: the
  same row under the right business is. Watch the existing tiebreak test whose fixture rows have no
  `business_id` and expect `false` — it would pass vacuously; give its rows a business.

### A2. Bookings
- **The edit hole.** `PATCH /api/admin/bookings` (`app/api/admin/bookings/route.ts`, permission `schedule`,
  live UI caller `components/admin/BookingList.tsx:93`) resolves no tenant. `getBookingById(id)` and
  `updateBookingStatus(id, …)` (`lib/db/bookings.ts:46`, `:52`) filter on `id` only, and the route returns the
  updated row with the contact's name, email and phone. Fix: the route calls `resolveAdminTenantForRequest`
  (`NoAccessibleBusinessError` → 403); both DAL functions take `businessId` first and add the predicate;
  a booking of another business answers **404** (today a missing row is a PGRST116 → 500).
- **The Daily Brief.** `getBookingsInRange(from, to)` (`lib/db/bookings.ts:108`) becomes
  `getBookingsInRange(businessId, from, to)`; `lib/analytics/sections/bookings.ts:42` passes `opts.businessId`,
  which it already has. The "HALF-SCOPED, deliberately not fully" comment (`:36-40`) is replaced.
- **Dead code.** `getUpcomingBookings` (`lib/db/bookings.ts:33`) has no caller; delete it (any new caller would
  read every business's bookings).

### A3. Chat conversations (`lib/db/chat.ts:97`)
- `getConversation(id, businessId)` — REQUIRED, always filtered. The "Optional … public callers legitimately
  have no tenant" doc comment predates the Host boundary (`resolvePublicTenant`, phase 4) and is replaced.
- `app/api/ask/route.ts:329`: resolve the Host tenant BEFORE reading `requestedId`, and read under it. A
  conversation id from another business reads as absent, and the route answers its existing 404
  `unknownConversation` (Ruling R7 overruled this spec's first wording, "the visitor starts a fresh
  conversation": nothing is created for a foreign id). The
  later reads keep using `conversation.business_id`, which now equals the Host tenant by construction.
- `app/api/ask/capture/route.ts:240`: resolve the Host tenant and read under it; a foreign id answers the
  existing 404 `unknownConversation`. If this adds a `resolvePublicTenant` caller, add it to the
  `lib/tenancy/public.ts` inventory (enforced by `__tests__/lib/tenancy/public-inventory.test.ts`).
- `lib/lead-engine/chat/escalate.ts:173` (`runEscalation`): `input.businessId` becomes REQUIRED and is passed
  to `getConversation`. Its caller (`app/api/ask/route.ts`) passes `conversation.business_id`.
- `app/(admin)/admin/chat/[id]/page.tsx:55` already passes a tenant; unchanged.
- `readContactIdentity` (`lib/db/pipeline.ts:2064`) becomes `readContactIdentity(businessId, contactId)`, filtered.
  Its one caller, `app/api/ask/route.ts:649`, passes `conversation.business_id`. Its unsafe source was the
  unscoped conversation read, which this section closes; the predicate makes that true locally too.

### A4. Quizzes (`lib/db/quizzes.ts:166`)
- `getQuizDefinition(businessId, quizId)` — REQUIRED, filtered (`quizzes` carries `business_id`). This is the
  real gap: today nothing compares the quiz's business with the attempt's, so B's host can open an attempt
  (stamped B) on A's quiz and file B's contact, card and consent against A's quiz.
- **The invariant that stays:** `app/api/quiz/progress/route.ts` DECIDES the attempt's business from the Host
  (`resolvePublicTenant()`, today called only when creating an attempt), and `app/api/quiz/submit/route.ts`
  INHERITS it from the attempt row (`:143-152`) instead of resolving again. `lib/tenancy/platform.ts` records
  that submit deliberately calls nothing; keep it that way.
  - progress: resolve the Host tenant FIRST (before `:73`), read the quiz under it; for an existing attempt
    (`:88`) also refuse one whose `businessId` is not the Host tenant (404, same as a foreign quiz id).
  - submit: read the quiz under `attempt.businessId`, so a quiz of another business reads as absent.
- `getAttempt(attemptId)` (`:927`) stays keyed on the attempt id: that id is an unguessable UUID issued to the
  visitor (a bearer token, like `getInviteByToken`), and the comparisons above close the cross-business path.
  Its doc comment says so.
- Admin callers pass the admin tenant: `app/api/quiz/preview-submit/route.ts:58`,
  `app/api/admin/quizzes/[id]/route.ts:217`, `:260`, `app/api/admin/quizzes/[id]/add-to-step/route.ts:98`,
  `app/api/admin/funnels/route.ts:123` (copy source), and `lib/funnels/sections/resolve.ts:540` (inside
  `loadCatalogues`, which already has `businessId`).

### A5. Contact and inquiry bell alerts
- `app/api/contact/route.ts:83` and `app/api/inquiry/route.ts:229` read `users` where `role = 'admin'` and bell
  every platform admin. Both routes already hold the Host `businessId`.
- New recipients: `business_members` of that business with `role in ('owner','coach')`. The read error is
  logged, not swallowed (the precedent is `lib/bookings/ingest.ts:737-747`, which fans out to members). One
  helper serves both routes (e.g. `listBusinessMemberUserIds(businessId, roles)` in `lib/db/business-members.ts`).
- In production today this is the same people, provided `Primary`'s owners still equal the admins
  migration `00246` backfilled (unconfirmed; production was not readable from this session). A Primary member
  with role `coach` would newly receive these bells.
- G30 already moved the EMAIL half of the inquiry alert to `reply_to`; this moves the bell half.

## 2. Section B — "show nothing" for a business that is not the platform

Rule: these readers read tables with no `business_id`, and those rows are the platform's own. A reader
that knows its tenant returns nothing when the tenant is not `platformBusinessId()`. It never falls back to
the platform's rows. This is the NARROWER VARIANT shelf in `lib/tenancy/platform.ts`: the caller resolves a
real tenant and consults the seam only to decide whether that tenant is the one the rows describe (the
Calendly booking offer, `lib/calendly/config-for-business.ts:102`, is the precedent).

### B1. Chat facts (`lib/lead-engine/chat/facts.ts`)
- `searchPublicFaqs(businessId, query, pageKey?)`, `listPublicProgrammes(businessId)`,
  `listPublicTestimonials(businessId)`: return `[]` before any query when `businessId !== platformBusinessId()`.
- `lib/lead-engine/chat/tools.ts:586`, `:591`, `:609` pass `executorBusinessId` (`ctx.businessId`, from
  `conversation.business_id`), as `listPublicEvents` already does at `:599-601`.
- What a second business's visitor sees: the assistant has no FAQs, programmes or testimonials to ground an
  answer on, so it says it does not know, instead of presenting the platform's as that coach's.
- Test: a non-platform business gets `[]` and NO query is issued (MUTANT: the gate after the read); control:
  the platform business gets its rows.

### B2. Funnel islands
- `FunnelRenderContext` (`components/funnels/islands/index.tsx:18-60`) gains a REQUIRED `businessId`, set by the
  three routes from the tenant they already resolved: `/go` (`app/(funnel)/go/[slug]/[[...step]]/page.tsx:150`),
  `/preview` (`app/(funnel)/preview/[slug]/[[...step]]/page.tsx:105-111`), `/funnel-preview`
  (`app/(funnel)/funnel-preview/[stepId]/page.tsx:149-155`). `renderIsland` passes the context to
  `FaqIsland` and `TestimonialsIsland`, which return `null` when `context.businessId !== platformBusinessId()`.
- **Why the route's tenant and not `resolvePublicTenant()` inside the island** (the way `EventIsland` does it):
  on the two preview routes the Host is the admin's, not the funnel's, so a platform admin previewing coach
  B's funnel would see the platform's FAQs while `/go` on B's host shows nothing — the preview/live
  disagreement G31 named this subsystem's worst failure.
- Only `source: "live"` sections render through these islands. Inline FAQs and authored quotes are the
  business's own content and are untouched.
- The island is the only guarantee: `steps/[stepId]/publish/route.ts:89-92` lets a step with no section
  document through the gate. The gate (B3) keeps new pages from publishing an empty band; the island keeps
  any page from showing the platform's rows.
- Existing context literals to update: `__tests__/components/funnels/quiz-island-context.test.tsx:47`,
  `form-island-sms-consent.test.tsx`; `funnel-draft-preview-page.test.tsx:365-376` asserts context.

### B3. The builder catalogue and the publish gate agree with the render
- `loadCatalogues(businessId)` (`lib/funnels/sections/resolve.ts:488`) returns `faqPageKeys: []` for a
  non-platform business, and a new REQUIRED field that says whether the platform's live FAQ and testimonial
  feeds are available to this business.
- `resolveDoc` (`:1165`) records a live FAQ or a live testimonial section on a business without the feeds as
  a new, distinct entry (not an `UnknownFaqKey`, whose wording "no page has FAQs yet" would mislead).
  `publishGate` (`:1463`) makes it a BLOCKER with plain wording: live FAQs and live testimonials come from DJP
  Athlete's own lists, which this business cannot use; switch the section to your own FAQs or your own quotes.
- Today nothing in `resolveDoc`/`publishGate` inspects testimonial sections at all; this adds that check.
- Every `Catalogues` literal gains the field (`resolve.test.ts` ×7, `offers-route.test.ts:50`,
  `ai-plan-route.test.ts:80`). `resolve.test.ts:1496` uses a NON-platform stub id and expects FAQ keys: it
  flips, and must be retargeted (not deleted) to assert the new rule, with a platform-id control beside it.
- The build route's prompt reads FAQ keys a second time, independently (`build/route.ts:508-556`,
  `getFaqCountsByPage` at `:519`). It follows the same rule, and Block B tells a non-platform builder that live
  FAQs and live testimonials are unavailable (Block A is cached and tenant-agnostic, so it cannot carry this).
- Not changed: the inspector's "Content source" select still offers "Live"; a live section chosen there shows
  the blocker on the preview banner and refuses at publish. Threading tenant data into the inspector is not
  worth it for a state the gate already stops.

### B4. Inventory
- Each file that now calls `platformBusinessId()` is named in `lib/tenancy/platform.ts` on the NARROWER
  VARIANT shelf with its reason: `lib/lead-engine/chat/facts.ts`, `components/funnels/islands/FaqIsland.tsx`,
  `components/funnels/islands/TestimonialsIsland.tsx`, `lib/funnels/sections/resolve.ts`,
  `app/api/admin/funnels/steps/[stepId]/build/route.ts`. `__tests__/lib/tenancy/platform-inventory.test.ts`
  enforces it (the forward check fails until they are named).

## 3. Section C — agent alerts go to the owners of the job's business

### C1. The job carries its business
- The three enqueue routes stamp `businessId: platformBusinessId()` into the job input:
  `app/api/admin/internal/seo-agent/route.ts:31` (a direct Firestore write, kept, because it sets `triggeredBy`),
  `app/api/admin/internal/social-agent-cron/route.ts:18-22`, `app/api/admin/social/agent/run/route.ts:32-36`.
- The session route uses the PLATFORM id, not the admin's selected tenant: every table the agents read or
  write (`blog_posts`, `gsc_query_daily`, `content_calendar`, `*_agent_memos`, `social_posts`,
  `platform_connections`, `strategy_briefs`, `notifications`) has no `business_id`; their subject is
  darrenjpaul.com's own search and blog data. Shelf: CORRECT BY CONSTRUCTION.
- Tests must tell the stamp apart from `userId`: `SYSTEM_USER_ID` and `SINGLETON_BUSINESS_ID` are the same
  literal. Mock `platformBusinessId` to a distinct id and assert that id reaches the input.

### C2. Functions resolve the owners
- One helper in `functions/src/lib/` (functions cannot import `lib/`): `notifyBusinessOwners(supabase,
  businessId, notification)`. It reads `business_members` with a LITERAL select (`.select("user_id")`,
  `.eq("business_id", businessId)`, `.eq("role", "owner")`, `.order("created_at")`, `.order("user_id")`) so the
  select contract probes it; checks the read error; inserts one `notifications` row per owner; returns the id
  of the FIRST row in that order, or an error.
- `resolveFlagOutcome` (`lib/seo-agent/outcomes.ts:249-264`) reads ONE notification by id, and `notifications`
  has nothing tying sibling rows together, so `execution_target_id` is the first owner's row; "acknowledged"
  means that owner read it. Stated in the helper's doc comment.
- A job with no `businessId` does not default: it logs and skips the alert (`executed: false` with a reason
  for the SEO flag). New functions meeting a job enqueued by an old route therefore lose at most that one
  alert, which is today's state anyway (every alert dies on PGRST205).

### C3. The two call sites
- `functions/src/seo/execute.ts:127-165`: `AgentContext` gains `businessId` (threaded from
  `functions/src/seo-agent.ts:28-29,144` via the job input); the `profiles` read is replaced by the helper.
  `functions/src/seo-agent.ts:149-151` also logs `r.error` / `r.rejection_reason`, which it drops today (that
  is why the PGRST205 has been invisible).
- `functions/src/social-agent.ts:570-619` (`no_eligible_topic`): the `profiles` read is replaced by the helper,
  and the helper's result is checked. The link `/admin/social-agent/memos` does not exist; it becomes
  `/admin/strategy`, where the brief whose `dont_do` filtered every topic lives.
- Tests: `functions/src/__tests__/seo-execute.test.ts` (seven `ctx` literals gain `businessId`; the `profiles`
  mocks become `business_members`); a new suite for the helper; the social branch gets its first test.

### C4. Contract ratchet and deploy
- Delete both `profiles` entries from `KNOWN_REFUSED` (`__tests__/integration/postgrest-select-contract.test.ts:110-126`)
  in the same commit; the "still refused" check fails otherwise.
- One merge deploys Vercel (routes) and Firebase (`deploy-functions.yml`, paths `functions/**`) at the same
  time, in no controlled order. Both orders are safe: new functions with old routes skip the alert (no
  `businessId`); old functions with new routes ignore the extra field. No migration.

## 4. Section D — name every no-column seam honestly

### D1. A new shelf in `lib/tenancy/platform.ts`: UNTENANTED BY SCHEMA
Readers of a table with NO `business_id`, on a surface more than one business can reach (a grantable staff
permission, a public route that resolves a tenant, or a multi-tenant cron). They do not call
`platformBusinessId()`; they name no tenant at all. Each entry states the table, the surface, who reaches it,
and the ledger row that owns the decision.

| # | File · function | Table(s) | Surface | Row |
|---|---|---|---|---|
| S1 | `lib/db/programs.ts` · `getPrograms`, `getAllPrograms`, `getProgramById` | programs | `/admin/programs`, `/admin/programs/[id]` (`programs`, Coach preset); analytics | G37 |
| S2 | `lib/db/assignments.ts` · `getAssignments`, `getAssignmentCountsByProgram` | program_assignments | `/admin/programs` | G37 |
| S3 | `app/api/admin/programs/copy-sources/route.ts` · GET | programs, program_assignments, users | `programs`; returns assignees' full names | G37 |
| S4 | `lib/db/users.ts` · `getClients` | users | assign picker on `/admin/programs/[id]` (`programs`) | G37 |
| S5 | `lib/db/pipeline.ts` · `listGrantablePrograms` | programs | pipeline board + grant route (`contacts`) | G37 |
| S6 | `lib/db/contact-detail.ts` · `getContactDetail` (payments leg) | payments | contact record (`contacts`) | G04 |
| S7 | `lib/funnels/sections/resolve.ts` · `loadCatalogues` (programs, packs) | programs, session_pack_products | funnel builder, gate, preview (`funnels`) | G31 |
| S8 | `app/api/funnels/checkout/route.ts` · POST | programs | public, Host-resolved | G40 |
| S9 | `lib/db/marketing-attribution.ts` · `findAttributionForContact` | marketing_attribution | Stripe webhook, booking ingest | G42 |
| S10 | `lib/db/newsletter.ts` · `getActiveSubscribers`, `getAllSubscribers` | newsletter_subscribers | `/admin/newsletter` (`blog`), analytics | G38 |
| S11 | `lib/db/legal-documents.ts` · `getActiveDocument` | legal_documents | camps, clinics, funnel forms (public, Host-resolved) | G43 |
| S12 | `lib/db/lead-inquiries.ts` · `getLeadInquiryById` | lead_inquiries | `leads` (by id) | G45 |

Named in the shelf's preamble as NOT entries, so they do not read as omissions: `users` looked up by email or
id (identity, not tenant data); `marketing_attribution` read by `session_id` (keyed on the visitor's own
cookie); `lib/automation/campaign-revenue.ts:322-325` (reads by session ids that came from rows filtered on
`business_id`, so correct by construction — gets an in-place comment instead); platform digests and the
platform's own content pipeline (content attribution, weekly report, subscriber deltas), which have the Daily
Brief's shape; whole untenanted subsystems (blog, website CMS, money, analytics, exercises, client portal,
social/SEO/AI tables), which are named in ledger row G36 rather than one reader at a time.

### D2. The inventory test gains a matching list
In `__tests__/lib/tenancy/platform-inventory.test.ts`, `UNTENANTED_BY_SCHEMA: Array<{ file, fn, table, reads?,
row, surfaces? }>`, with checks:
- (a) the inventory text names each `file` and each `surfaces` path;
- (b) the read is still there: within the body of `fn` (from `function fn` / `export async function fn` /
  `export async function GET|POST` to the next column-0 `}`), the needle `reads` (default `.from("<table>")`)
  appears — so converting the reader makes the entry stale and the test fails;
- (c) no `supabase/migrations/*.sql` statement adds `business_id` to the table (comments stripped, split on
  `;`, `alter table … add [column] [if not exists] business_id`, `rename … to business_id`, `create table T
  (… business_id …)`) — so the table gaining a column makes the entry stale;
- (d) the reverse check excludes every `file` and `surfaces` entry;
- (e) controls: a fixture entry for a table that HAS the column (`events`) must fail (c), and the list has at
  least 12 entries.
Shelf prose must not cite `__tests__/lib/...` or `functions/src/lib/...` paths: the reverse-check regex reads
them as `lib/...` paths.

The live select contract (`npm run test:integration:selects`) additionally probes
`select=business_id&limit=0` on each shelf table and expects `42703`: the only check that sees a column added
outside the migrations.

### D3. In-place comments and stale comments
- A G31-style comment at each shelf read that lacks one (the S7 reads already have them).
- Stale comments corrected: `app/(admin)/admin/pipeline/page.tsx:79-81` ("this is not a scoping gap, there is
  nothing to scope" — false under this rule); `lib/db/marketing-attribution.ts:131-135` (the "tenant is not
  resolved until phase 4" reason expired with the Host boundary) and `:144-146` ("user_id is never shared across
  businesses" — `linkContactsToUser` links one user to every business's contact with that email);
  `lib/bookings/ingest.ts:559-570` ("nothing writes contacts.user_id" — G04 gave it a writer).

## 5. Section E — recorded, not built (new ledger rows)

Each row carries its evidence and, where it needs one, the owner's question. None is built in G35.

- **G36 · Grantable staff surfaces read every business's data (M, owner decision).** Headline: the admin AI chat
  (`/api/admin/ai-chat`, permission `ai_tools`, a grantable checkbox) runs ~46 tool reads with no tenant —
  client personal details, payments, orders, subscriptions, bookings, events and signups, attribution. Also the
  blog, website-CMS, money, analytics and exercise-library surfaces over untenanted tables. Question: scope
  them, or make them owner-only (the ads precedent) before any of them is granted to another business's staff.
- **G37 · Programmes, assignments and client lists are shared across businesses (M/L, owner decision).**
  Reachable through the Coach preset (`programs`, `contacts`) by every second-business coach on the dev clone
  today: the platform's private, athlete-named plans, all assignments, every client of every business, and a
  coach can publish a public programme into the platform's chat. Question: the programs tenancy ruling the
  phase-5a spec already parks.
- **G38 · One newsletter list for every business (M, owner decision).** A visitor who subscribes on business B's
  host, under consent wording that names B, is mailed by the platform (`functions/src/newsletter-send.ts:43`) and
  uploaded to the platform's Google Ads Customer Match list.
- **G39 · The ads subsystem mixes businesses (frozen; owner decision).** Customer Match uploads every business's
  bookers and subscribers under the platform's ad account; conversion adjustments pick a booking from any
  business; the strategist is fed every business's events; the accounts list (and disconnect) spans every
  business; the pipeline's bookings arm has a column and no predicate. Extends the DELIBERATELY FROZEN shelf.
- **G40 · Funnel checkout sells any priced programme (S, correctness).** `app/api/funnels/checkout/route.ts`
  checks only that `productId` is a UUID with a price: not that it is one of the published page's offers, nor
  active/public, nor this business's. Fix: bind `productId` to the published version's offers.
- **G41 · The strategy critic's attribution read filters on columns that do not exist (S).**
  `functions/src/strategy/critic-signals.ts:60` filters `occurred_at` and aggregates `channel`/`event_type`
  (42703, ignored), so the Chief critic has never seen attribution. The select contract cannot see it: it does
  not probe filter columns. Fix both.
- **G42 · `marketing_attribution` has no tenant (owner decision).** The DAL's reason for no column expired with
  the Host boundary; `landing_url` carries the host on 509 of 512 clone rows, so a backfill is possible.
  `findAttributionForContact` crosses businesses through `linkContactsToUser`.
- **G43 · Every business's customers accept the platform's waiver (owner / legal decision).**
  `getActiveDocument` serves the platform's `legal_documents` on camp, clinic and funnel-form surfaces that
  resolve another business's tenant.
- **G44 · Schema guards for tenancy (M, later).** The platform `DEFAULT` on `business_id` in 30 of 38 tenanted
  tables (one schema-wide decision, already known from 00278); no composite FK tying a consent (or any
  cascading child) to its contact's business; `merge_contacts` never checks that the survivor exists in
  `p_business`; the `lead_magnets` "active lead magnets are public" RLS policy returns every business's
  magnets to the anon key.
- **G45 · Small ownership checks (S).** `markAsRead(id)` (`lib/db/notifications.ts:20-25`) does not check who owns
  the notification; `getLeadInquiryById` reads by id with no tenant; `/admin/team` lists, revokes and resends
  every business's invites (operator-only today); `sendManualSms` checks consent on `args.contactId` but sends
  to `args.phone`, and the route does not check that they match (intra-business, a G28 concern); the SEO job
  reports "completed" whatever its actions did.

## 6. Out of scope, deliberately

Composite foreign keys and dropping the platform `DEFAULT` (G44); converting any subsystem named in G36-G39;
the checkout binding (G40); the marketing site served on a coach's host (it is the platform's own site in
full; the "output keyed to one host" shelf); hard-bounce and shared-sender suppression policy (per-business
suppression is already correct for STOP and unsubscribe; both points are recorded with G38/G44 context).

## 7. Testing and verification

- TDD per change: each predicate and gate gets a test that FAILS without it and a control that passes with the
  right tenant (the house pattern: an absence assertion needs a presence control). Mutation-check each half
  separately (e.g. `hasConsent` without the `.eq`; the island gate after the read; the catalogue without the
  platform check; the route without `resolveAdminTenantForRequest`).
- Suites: every test file that imports or mocks a changed module (grep `(from|import\()\s*"@/…"`), the
  functions suites for C, `platform-inventory.test.ts`, `public-inventory.test.ts`.
- `npm run test:integration:selects` (the new `business_members` select in functions; the deleted
  `KNOWN_REFUSED` entries; the D2 column probes), tsc per-file against
  `.claude/baselines/tsc-ce6f2aba-perfile.txt`, `npm run build`, `SINGLETON_BUSINESS_ID` count still 5,
  `npm --prefix functions test` for the touched functions suites.
- Driven in the real app on the dev clone, with annotated screenshots: a second business's host
  (`phase4-coach.test` → `82d5b238-…`) where the chat has no platform FAQs or testimonials and a live FAQ
  section is refused at preview; the same on the platform host as the control.
- Whole-branch review before merge (a multi-lens review workflow with verifiers), then the owner's go-ahead.
