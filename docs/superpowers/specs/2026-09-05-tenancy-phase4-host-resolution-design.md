# Tenancy phase 4 — public surfaces resolve their tenant from the Host header

Date: 2026-09-05. Branch `feat/tenancy-phase4-host-resolution`, worktree `../djpathlete-tenancy-phase4`,
cut from `fix/test-runner-jsdom` @ `afec4964` (itself 4 commits on `origin/main` @ `7c9c3d01`). It is stacked
on that branch deliberately: phase 4's verification is worthless on a runner where 82% of the suite cannot
start, and that branch is what makes the runner honest. Merge A, then B.

Predecessor: `2026-09-05-remove-singleton-business-id-design.md` §3 rejected a `resolvePublicTenant()` helper
"until phase 4 decides its signature". This is phase 4; the signature is decided below.

## 0. Goal, and what "done" looks like

Every entry on the CANNOT RESOLVE A TENANT YET shelf of `lib/tenancy/platform.ts` stops calling
`platformBusinessId()` directly and resolves through ONE new function, `resolvePublicTenant()` in
`lib/tenancy/public.ts`, which maps the request's Host to a business via `business_domains` and falls back to
the platform only when no row matches. Done means:

- the shelf names exactly ONE caller, `lib/tenancy/public.ts`, and `__tests__/lib/tenancy/platform-inventory.test.ts`
  proves it in both directions (every caller named; every named path still a caller);
- `business_domains` has its first reader (it has had zero since migration 00240);
- production's own two hosts are rows, seeded by migration, and the code serves the platform when the rows are
  absent (the migration and the Vercel build race on push);
- every retargeted suite asserts WHICH tenant reached the DAL, never that a value did;
- one converted reader is proven end to end against the running app under two different Hosts.

## 1. Measured starting state

- `SINGLETON_BUSINESS_ID` production references: 5 (definition, seam, one history comment, two `functions/`
  twins). This branch adds none and removes none — the seam stays; what changes is who calls it.
- The shelf has 17 callers, each with exactly ONE seam line (measured with `grep -n`, not `grep -l`):
  10 routes (`contact`, `shop/leads`, `newsletter`, `inquiry`, `events/[id]/signup`, `events/[id]/checkout`,
  `funnels/submit`, `ask/config`, `quiz/progress` at `createAttempt`, `ask` at `createConversation`) and
  7 pages/components (`(marketing)/ask/page`, `(marketing)/camps/[slug]/page`, `(marketing)/clinics/[slug]/page`,
  `public/InquiryForm`, `public/StepUpInquiryForm`, `funnels/islands/FormIsland`, `funnels/islands/QuizIsland`).
- `business_domains` (00240): `id`, `business_id → businesses on delete cascade`, `host text NOT NULL UNIQUE`
  ("lowercase, no scheme, no port"), `kind 'primary'|'alias'`, `verified_at`, `vercel_domain_id`, `created_at`.
  Production: ONE business (`00000000-0000-0000-0000-000000000001`, "Primary", slug `primary`, active) and
  **zero** `business_domains` rows. Dev clone: at 00250 (latest), table present, zero rows.
- Production hosts: `https://darrenjpaul.com` answers 307 → `https://www.darrenjpaul.com/`, which answers 200.
- Rendering today (from the build's route table): `/ask` ƒ (force-dynamic); `/camps/[slug]` and `/clinics/[slug]`
  **● SSG** (`revalidate = 300` + `generateStaticParams`); `/go/[slug]/[[...step]]` ƒ; every converted route
  handler ƒ (`/api/ask/config` is `force-dynamic` explicitly).
- No Host-header resolution exists anywhere. `proxy.ts` covers `/admin`, `/client`, `/api/admin` only.
- `recordAudit` accepts any `action: string`; the taxonomy in `lib/audit/actions.ts` is a closed list the admin
  UI resolves through `getActionDef`. Precedent for an automation-side failure slug: `booking.tenant_unresolved`.

## 2. The tenant sources, after this branch

| Source | When | Boundary |
|---|---|---|
| Session — `resolveAdminTenant()` | admin/staff session | `lib/tenancy/resolve.ts` (unchanged; the ONLY session boundary) |
| A row that already carries the tenant | request names a row with `business_id` | inline, per caller (unchanged: `conversation.business_id`, `quiz_attempts.business_id`, contact rows, connections) |
| **Host header** — `resolvePublicTenant()` | no session, no row, a public request | `lib/tenancy/public.ts` (NEW; the ONLY Host boundary) |
| `platformBusinessId()` with an inventory entry | none of the above | `lib/tenancy/platform.ts` (unchanged function; shelf rewritten) |

`resolve.ts` and `public.ts` never import each other. `users.role` stays `admin|client|editor|staff`. No
permission changes, no switcher, no ads scoping.

## 3. Design

### 3.1 `lib/db/business-domains.ts` — the reader (new file)

```ts
export class BusinessDomainReadError extends Error { code: string; constructor(code: string, message: string) }
/** The business a host belongs to, or null when no row claims it. THROWS on a failed read. */
export async function findBusinessIdByHost(host: string): Promise<string | null>
```

Service-role client (`createServiceRoleClient()`, the same `getClient()` shape as `lib/db/businesses.ts`);
`.from("business_domains").select("business_id").eq("host", host).maybeSingle()`. `error` → throw
`BusinessDomainReadError(error.code, error.message)` — never the raw object (it logs `[object Object]`), and
never `null` for a failure: null means "no row", full stop ("null and [] are different answers"). No `kind`
filter: an `alias` row resolves exactly like a `primary` one; the distinction is for the domain-management
surface this branch does not build. `host` is passed already normalised (below); the DAL does not lowercase.

### 3.2 `lib/tenancy/public.ts` — the Host boundary (new file)

```ts
/** Lowercase, no port, first value of a comma list; null for absent/blank. Exported for its own tests. */
export function normalizeHost(raw: string | null | undefined): string | null
/** The business this public request belongs to. Never throws for a tenancy reason. */
export async function resolvePublicTenant(): Promise<string>
```

Zero arguments, `await headers()` from `next/headers`, so one call works in route handlers and server
components alike with no call-site signature churn (the brief's decision). Algorithm:

1. `const h = await headers()`; `raw = h.get("x-forwarded-host") ?? h.get("host")`. **The `headers()` call is
   NOT wrapped in try/catch.** During a static prerender Next throws from `headers()` to bail the route out to
   dynamic rendering; swallowing that would prerender the page with the platform tenant and silently keep it
   static forever. A test pins that a throwing `headers()` propagates.
2. `host = normalizeHost(raw)`: trim; take the first comma-separated value; lowercase; strip `:port`
   (IPv6 literal `[::1]:3050` → `[::1]`). Null is treated exactly like an unmatched host (the second bullet of step 3), with the host logged as `(none)`.
3. `findBusinessIdByHost(host)`:
   - a row → its `business_id`. Done. No log.
   - `null` → `platformBusinessId()`; `console.warn("[tenancy] no business_domains row for host \"<host>\"; serving the platform")`
     **once per host per process** (a module-level `Set`). Dev (`localhost:3050`) and every preview host land
     here on every request; "never silent" means the host is named, not that the log is flooded.
   - throws with code `42P01` (undefined_table) or `PGRST205` (PostgREST's "not in schema cache") → NOT a deploy
     window: `business_domains` has been live since migration 00240, so either code in production means the
     table is gone or PostgREST's schema cache is stale — an incident. `platformBusinessId()`, plus
     `console.error` naming the code and the word "MISSING" (every occurrence, not deduped — same as any other
     failed read below), plus the same once-per-host `recordAudit` row described below. The branch exists so an
     environment behind 00240 (a fresh clone, a preview database) still serves the platform instead of 500ing.
   - throws with any other code → **the read-failure decision** (brief: record it explicitly). `platformBusinessId()`
     — a public page 500ing on a transient read is worse than serving the platform — plus
     `console.error("[tenancy] business_domains read failed for host \"<host>\" (<code> <message>); serving the platform")`
     on every occurrence (not deduped: each is an incident), plus
     `recordAudit({ action: "tenancy.public_host_lookup_failed", category: "system", outcome: "failure",
     actor: { role: "system" }, error: { code, message }, metadata: { host } })` so the 24h failure strip on
     `/admin/audit-logs` sees it. The audit row is filed ONCE per host per process (the error line is
     per request): during a sustained outage every public request would otherwise pay an extra awaited
     insert against the same degraded database, and one row per instance already lights the strip.
     `recordAudit` never throws and is AWAITED (a serverless function may end with the response);
     `actor` is passed so it does not call `auth()` on a public request.
   - **Every per-host dedupe set is bounded.** The host is client-controlled, so an unbounded `Set`
     keyed on it is a memory-growth vector on a warm instance; at 1000 entries the set is cleared and
     dedupe simply starts over (a host may warn twice per thousand distinct hosts — acceptable).
4. Return the id. The return type stays `Promise<string>` (the brief's signature); WHY the platform was served
   is in the logs, not the type. If a caller ever needs the reason, widen then.

The doc comment on `resolvePublicTenant` is an inventory of its callers in the same spirit as `platform.ts`:
grouped as "the §5.1 lead-capture routes", "the pages and components that render the wording those routes
file", "the two attempt/conversation creators". `__tests__/lib/tenancy/public-inventory.test.ts` pins it both
ways (§7).

**Security.** A client controls its own `Host`/`x-forwarded-host`. The worst it can do is file its OWN
submission under a business whose host it names — which it could equally do by sending the request to that
host. No tenant's data becomes readable: every read on these surfaces is by the resolved tenant's own rows,
and an unknown host resolves to the platform, not to "any". Vercel sets `x-forwarded-host` from the real
request; it is read first because that is the value a proxy in front of the app would carry.

### 3.3 Migration `00251_business_domains_platform_seed.sql`

```sql
insert into public.business_domains (business_id, host, kind, verified_at)
values ('00000000-0000-0000-0000-000000000001', 'www.darrenjpaul.com', 'primary', now()),
       ('00000000-0000-0000-0000-000000000001', 'darrenjpaul.com',     'alias',   now())
on conflict (host) do nothing;
```

`host` is a plain UNIQUE constraint (not a partial index), so `on conflict (host)` is inferable. `verified_at`
is set: both hosts are live on Vercel and serving today. `vercel_domain_id` stays null — it has no reader, and
naming a value with no reader is the labelling gap CLAUDE.md warns about. Applied to the dev clone by the
implementer (standing instruction); applied to production by the Action on push to main — NOT by hand.

**The race.** Push to main → the migration applies while Vercel builds. Old code + new rows: ignores them.
New code + no rows yet: the "no row" branch of §3.2 step 3, platform. Both orders serve the platform; there is no window in which a
production request resolves to anything else, because the only business is the platform.

### 3.4 Audit taxonomy

One row added to `AUDIT_ACTIONS`: `{ slug: "tenancy.public_host_lookup_failed", category: "system",
description: "A public request's Host could not be looked up in business_domains; the platform was served" }`.

### 3.5 The 17 conversions

Each converted file keeps the shape the last branch established (`git show f6bbabd7 -- app/api/newsletter/route.ts`):
resolve ONCE at the top, thread the value. The only textual change per file is the seam line and the comment
above it: `const businessId = platformBusinessId()` → `const businessId = await resolvePublicTenant()`, the
import swapped, and the comment rewritten from "CANNOT RESOLVE YET until phase 4" to "resolved from the Host
(lib/tenancy/public.ts); the platform only when no domain row matches". Specifics:

- `app/api/ask/config/route.ts:66` and the seven pages/components call the seam INLINE inside
  `getBusinessSettings(platformBusinessId())`; each becomes `const businessId = await resolvePublicTenant()` on
  its own line, then `getBusinessSettings(businessId)`, so the value is greppable and threadable.
- `app/api/quiz/progress/route.ts:101` (`createAttempt(platformBusinessId(), …)`) and
  `components/funnels/islands/QuizIsland.tsx:47` are converted in the SAME task. The inventory says why:
  the island's wording and the submit route's filed wording agree only because two calls return the same
  value; under Host resolution both calls read the same header, so they still agree, and `quiz/submit` keeps
  inheriting the attempt's `business_id` (a row source, preferred over the Host by §2).
- `app/api/ask/route.ts:379` (`createConversation`) is the ONE place a conversation's tenant is decided; every
  later call in that route keeps threading `conversation.business_id`.
- `components/funnels/islands/FormIsland.tsx:56` resolves only when a `tel` field is present (existing
  guard); the resolve moves inside that branch, so a form with no phone field costs no read.
- Wrapped handlers (`withAudit`) and server components both run inside Next's request scope, where
  `headers()` is valid.

### 3.6 `lib/tenancy/platform.ts` — the shelf after this branch

The CANNOT RESOLVE A TENANT YET shelf keeps its heading and its two non-public entries (the pipeline
reconciler's payments half — correct by construction; the sentence about `quiz/submit` NOT being a caller),
and replaces the 17-path list with ONE entry:

> the Host boundary's own fallback (`lib/tenancy/public.ts`) — every public, unauthenticated surface now
> resolves through `resolvePublicTenant()`, which reads `business_domains` by Host and reaches this only when
> no row claims the host, when the table is missing (an incident since 00240, audited), or when the read failed. The
> callers are inventoried in that file, not here.

Nothing on the other three shelves changes.

## 4. What does NOT change

`app/api/webhooks/ghl-booking`, `app/api/public/invite/[token]/claim` (correct by construction);
`app/api/webhooks/twilio/inbound`, `lib/bookings/calendly-tenant.ts`, `app/api/stripe/webhook` (narrower
variants); `lib/funnels/sections/resolve.ts loadCatalogues`, `lib/db/google-ads-accounts.ts` and the two ads
routes (frozen); `lib/automation/pipeline-reconcile.ts` (payments has no business_id); `app/api/quiz/submit`
(inherits the attempt; the inventory test pins that it never calls the seam). `lib/tenancy/resolve.ts`,
`users.role`, permissions, `proxy.ts`: untouched.

## 5. Behaviour changes — explicit

1. **`/camps/[slug]` and `/clinics/[slug]` stop being SSG.** `headers()` is a dynamic API; a page whose
   content depends on the Host cannot be one static artefact, so Next will render them on demand (● → ƒ in the
   build table; `revalidate = 300` becomes moot). This is inherent to Host tenancy, not incidental: the same
   path on two hosts must show two businesses' consent wording. The build table before/after is part of
   verification. The eventual shape for static-per-host pages is a proxy rewrite to a `/[host]/…` segment
   (Vercel's Platforms pattern); that restructures routing and is a later phase, named here so nobody mistakes
   `headers()` for the end state.

   **Measured after the branch (build route table, dev clone, 2026-09-06).** The blast radius is the
   RENDER TREE of the converted components, not their call sites, and it is wider than the two routes
   above: every static marketing page that embeds `InquiryForm` or `StepUpInquiryForm` went ○ → ƒ —
   `/assessment`, `/in-person`, `/online`, `/programs/rotational-reboot`, `/step-up-for-students` (all
   `revalidate = 3600`, previously CDN-cached 1h/1y). Next logs NOTHING when it does this. `/camps/[slug]`
   and `/clinics/[slug]` still show ● on this build only because the dev clone has zero published events,
   so `generateStaticParams` returned no paths and no prerender ran. MEASURED on a second build (2026-09-06)
   after temporarily publishing one camp and one clinic with future dates on the dev clone: both flipped to ƒ,
   again with no log line. Seven routes, not two — all seven measured. Accepted as inherent (a page
   naming the tenant cannot be one static artefact); the mitigation, when wanted, is a Suspense/PPR
   boundary around the form so the page shell stays static — a later phase.
2. **One extra indexed read per resolution** (`business_domains.host` is UNIQUE, so indexed). No page reads
   twice today: `camps/[slug]` renders `EventSignupCard`, not `InquiryForm`, and `/camps` renders
   `InquiryForm` without resolving itself. This is a memo for WHEN a future page resolves AND also renders a
   component that resolves — no cache in this phase; a per-request memo (`React.cache`) is a two-line
   follow-up once the cost is measured, not assumed.
3. **A matching host row now wins over the platform.** Identical today: the only rows are the platform's own.
4. **Audit rows appear on a failed lookup** — a new, rare, system-actor row type.

## 6. Error handling summary

| Condition | Result | Log | Audit |
|---|---|---|---|
| `headers()` throws | propagates | — | — |
| no Host at all | platform | warn once per host ("(none)") | — |
| row found | row's business | — | — |
| no row | platform | warn once per host | — |
| `42P01` / `PGRST205` (table missing — an incident since 00240) | platform | error every time, "MISSING" + code | `tenancy.public_host_lookup_failed`, failure — ONCE per host per process |
| any other read error | platform | error every time, code + message | `tenancy.public_host_lookup_failed`, failure — ONCE per host per process |

## 7. Testing — assert WHICH tenant

- `__tests__/lib/db/business-domains.test.ts` (node pragma): the query hits `business_domains` with
  `.eq("host", <exact normalised host>)`; no row → `null`; a PostgREST error → throws `BusinessDomainReadError`
  carrying that code (a mutation that returns null on error must fail this).
- `__tests__/lib/tenancy/public.test.ts` (node pragma; `next/headers` mocked; `@/lib/db/business-domains`,
  `@/lib/tenancy/platform` (→ `"platform-biz"`), `@/lib/audit/record` mocked): `normalizeHost` table
  (uppercase, port, IPv6+port, comma list, blank → null); `x-forwarded-host` wins over `host`; a matching
  row's business is returned; unknown host → `"platform-biz"` and `console.warn` called with the host; the
  warn fires ONCE for two resolutions of the same host; `42P01` → platform, warn, NO audit; `PGRST205` same;
  other code → platform, `console.error` containing code and message, `recordAudit` called with
  `outcome: "failure"` and the host; a throwing `headers()` propagates (the prerender invariant).
- Route suites that today mock `@/lib/tenancy/platform` to `"platform-biz"` AND whose route is on the shelf
  (`funnels/submit-sms-consent`, `newsletter/tenant`, `spine/contact-spine`, `spine/event-signup-spine`,
  `spine/inquiry-spine`, `spine/shop-leads-spine`, `app/ask-config-route`) switch to mocking
  `@/lib/tenancy/public` → `resolvePublicTenant` resolving `"host-biz"`, and assert `"host-biz"` reaches the
  DAL. Suites for callers NOT on the shelf (invite-claim, webhook-capture-tenant, calendly-*, google-ads)
  keep the platform mock untouched.
- Every other suite that imports a converted file (measured: contact 1, shop/leads 2, newsletter 3, inquiry 2,
  events/signup 2, events/checkout 2, funnels/submit 2, ask/config 1, quiz/progress 1, ask 2, ask/page 1,
  InquiryForm 1, StepUpInquiryForm 1, FormIsland 1, QuizIsland 1; camps and clinics pages 0) must mock
  `@/lib/tenancy/public`, because the real one calls `headers()` and throws outside a request scope — on the
  honest runner that failure is loud, which is the point. Each such suite gains one which-tenant assertion
  where the DAL call is visible.
- `platform-inventory.test.ts` fails the moment the first caller is converted (reverse check sees a named path
  that stopped calling) — that is the test working. The shelf rewrite (§3.6) is part of the first conversion
  task, and `lib/tenancy/public.ts` then satisfies the forward check.
- `__tests__/lib/tenancy/public-inventory.test.ts` (new, node pragma): every file under app/lib/components
  referencing the identifier `resolvePublicTenant` on a code line is named in `public.ts`'s doc comment, and
  every path the comment names still references it; presence control: at least 17 callers. The walker is
  extracted from the platform test into `__tests__/helpers/seam-callers.ts` and both tests use it.
- Mutation checks, run and recorded: (i) hard-code `platformBusinessId()` back into one converted route —
  its retargeted suite must fail; (ii) make the DAL return null on error — the DAL suite must fail;
  (iii) drop the dedupe Set — the once-per-host test must fail.
- **End to end, in the real app.** On the DEV clone (never production): create a second business via
  `create_business` with a distinct `display_name`, insert a `business_domains` row for `phase4-coach.test`,
  run `npm run dev` on 3050 in the worktree, and show `GET /api/ask/config` under three Hosts:
  `x-forwarded-host: phase4-coach.test` → the coach's display name; `www.darrenjpaul.com` → the platform's
  name via the row (no warn in the server log); `localhost:3050` → the platform's name via the fallback WITH
  the warn. Then Playwright screenshots of `/camps` under the coach host and the platform host — the inquiry
  form, a component conversion rendered by a page that does not resolve itself (Chromium forbids overriding
  `Host`, so `x-forwarded-host` is set via `setExtraHTTPHeaders` — the header the resolver reads first),
  annotated with `scripts/_annotate-lib.mjs`, delivered under `screenshots/tenancy-phase4/`.
- Gates: tsc error SET identical to the 251-line baseline (modulo `(line,col)`); `npm run build` green with the
  route table diffed (● → ƒ for camps/clinics expected, nothing else); targeted suites with non-zero counts.

## 8. Out of scope, each for a reason

| Not done | Why |
|---|---|
| Coach domain onboarding (adding `business_domains` rows from the admin, Vercel domain API, `vercel_domain_id` writer) | a surface with a customer; none exists yet |
| Seeding preview hosts (`*.vercel.app`) | they should serve the platform, and the fallback does that; a row per preview is noise |
| Per-request memoisation of the resolution | measure first; two-line follow-up |
| Static-per-host rendering (proxy rewrite to a host segment) | restructures routing; the SaaS direction spec's call |
| Giving `funnels`/`events`/`shop_*` a `business_id` | subsystem scoping, unchanged from the predecessor's §9 |
| Any change to `resolve.ts`, permissions, `users.role`, ads | INVARIANTS |

## 9. Decisions made without the owner — review these

1. **Stacked on `fix/test-runner-jsdom`, not on `origin/main`.** The brief ordered "B after A is merged"; the
   merge needs a go-ahead the session cannot get, and the REASON for the order (an honest runner) is met by
   stacking. Merge A first; B then merges clean.
2. **Read failure → serve the platform + `console.error` + audit row** (the brief's recommendation, taken).
3. **Missing table → error every time, audit once per host per process.** `business_domains` has been live
   since migration 00240, so a missing table in production is an incident, not a deploy window; see decision
   11 below.
4. **The "no row" warn is deduped per host per process.** The brief said "never silent"; a warn per request on
   every dev and preview request is noise that gets muted, which is silence with extra steps.
5. **`verified_at = now()` on the seed rows.** They are live on Vercel today.
6. **camps/clinics lose SSG** (§5.1). Inherent; flagged rather than worked around.
7. **A second business is created on the DEV clone** for the end-to-end proof. Dev is the clone; the row is
   named `phase4-coach` so it is greppable and deletable.
8. **Audit slug is `tenancy.public_host_lookup_failed`, category `system`.** Nearest precedent is
   `booking.tenant_unresolved` (automation); this is not a cron, so `system`.
10. **Seven marketing routes lose static rendering, not two** (§5.1). Five measured on the first build after
   the branch, the camps/clinics pair on a second build with upcoming dev events; the spec had counted seam
   call sites instead of the components' render tree. Accepted as
   inherent; flagged for the owner because it is a CDN-caching regression on five pages that were
   static, and the fix (a Suspense/PPR boundary) is a later phase.
9. **Audit row deduped per host per process; dedupe sets capped at 1000.** Both from Task 2's review
   (2026-09-05): the reviewer flagged the unbounded client-keyed set and the per-request awaited write
   during an outage. The error LOG stays per request.
11. **Table-missing reclassified as an incident** (whole-branch review, 2026-09-06): the branch cannot be a
   deploy window for a table that predates this branch; it now errors and audits like any failed read, and
   exists for environments behind 00240.

## 10. Risks and traps for the implementer

- Do NOT catch around `headers()` (§3.2 step 1). A blanket try/catch reads as defensive and breaks Next's
  dynamic-rendering detection silently.
- PostgREST reports a missing table as `PGRST205` on current versions and `42P01` on older ones; handle both.
- The inventory test's reverse check WILL fail mid-branch; rewrite the shelf in the same task as the first
  conversion, and do not "fix" the test by adding the converted paths to `NAMED_BUT_NOT_CALLERS`.
- In vitest, `next/headers` `headers()` throws outside a request scope; every suite touching a converted file
  must mock `@/lib/tenancy/public`. Do not mock `next/headers` in route suites — mock the boundary.
- The migration number: 00251 is unclaimed on every remote branch as of this spec. Re-check before pushing.
- zsh: `for x in $LIST` runs once; use literal lists or `${=VAR}`.
