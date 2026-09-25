# G31 funnel tenancy — real second-tenant verification (Task 10)

Tasks 1-9 converted seven tables and 47 DAL functions to carry a tenant, and every
one is covered by a unit test. But production has exactly ONE business, and every
unit test supplies its own mocked fixtures. Nothing so far had proved isolation
against a **real second tenant**, driven through the **real routes**, against the
**real dev database**. This is that proof.

**Script:** `scripts/verify-funnel-tenancy.ts` — repeatable, dev-clone-only, creates
its own fixtures and cleans them up on every run (verified by re-reading, not
trusted).

```bash
source ~/.nvm/nvm.sh && nvm use 24
npm run dev                                   # separate terminal, port 3050
npx tsx scripts/verify-funnel-tenancy.ts
```

## Headline finding: a real, currently-shipping bug — found and fixed

The first run surfaced a genuine defect this branch would have shipped: **the
leads inbox 500s for every tenant** (not just a new one) against the live,
re-migrated dev database.

`lib/db/funnel-leads.ts`'s `SELECT_WITH_PAGE` read `"*, funnels:funnel_id (name,
slug), funnel_steps:step_id (name)"`. That `:funnel_id` / `:step_id` hint syntax
resolves a bare column name to an embed target only when the underlying foreign
key is a **simple, single-column** FK. Migration 00278 replaced each simple FK with
a **composite** one (`(funnel_id, business_id)` / `(step_id, business_id)`), and a
composite FK's own column names are not valid embedding hints on their own.
Verified directly against PostgREST on the dev clone:

```
GET .../funnel_submissions?select=*,funnels:funnel_id(name,slug),funnel_steps:step_id(name)
400 PGRST200 "Could not find a relationship between 'funnel_submissions' and
'funnel_id' in the schema cache" — hint: "Perhaps you meant 'funnels' instead of
'funnel_id'."

GET .../funnel_submissions?select=*,funnels(name,slug),funnel_steps(name)
200 — resolves cleanly, no hint needed, because 00278 REPLACED (not
added-alongside) each FK, so there is exactly one relationship per table pair now.
```

`lib/db/funnels.ts`'s `listLeads` had no try/catch around this — `if (error) throw
new Error(...)` — so the whole `/admin/funnels/leads` page 500'd for **every**
tenant, platform included, not only the new one. The existing test
(`__tests__/lib/db/funnel-leads-tenancy.test.ts`) pinned the exact broken string
and could not have caught this: it runs against a hand-written mock query builder,
never a live PostgREST schema. This is precisely the class of gap Task 10 exists to
close.

**Fix applied** (in scope: this is G31's own subject, a direct and easily-understood
consequence of the 00278 FK replacement, in the one admin surface this task was
asked to prove):

- `lib/db/funnel-leads.ts` — `SELECT_WITH_PAGE` now reads `"*, funnels(name, slug),
funnel_steps(name)"` (no hint), with the header comment and inline comment
  rewritten to explain why the old form broke and why no hint is needed post-00278.
- `__tests__/lib/db/funnel-leads-tenancy.test.ts` — retargeted the pinned
  assertions to the corrected string, with a comment noting the mock could not have
  caught the live-PostgREST failure and that a live run is what did.
- Verified: 49/49 tests across the six suites importing `@/lib/db/funnel-leads`
  (`funnel-leads.test.ts`, `funnel-leads-tenancy.test.ts`, `LeadsBoard.test.tsx`,
  `leads-board-columns.test.tsx`, `leads-board-quiz.test.tsx`, `leads-csv.test.ts`),
  and a clean re-run of the verify script against the live dev server (500 → 200,
  page column populated).

A second, unrelated finding, non-blocking: PostgREST's schema cache did not appear
to have picked up the 00278 migration on its own after being applied via the
Supabase migration tool; `NOTIFY pgrst, 'reload schema';` was run once by hand
against the dev clone to force a refresh before the first live probe. Worth knowing
for whoever next applies a migration to this clone via the same path — the API may
lag the schema until nudged or until its own periodic check fires.

## What the script builds

1. **Tenant B** via `createBusiness()` (`lib/db/businesses.ts`) — never a raw
   insert. Confirmed the one-transaction write did its job: a `businesses` row, a
   `business_settings` row, and a `booking_hosts` row all exist for it.
2. **A funnel whose slug collides with a real platform funnel** — the script
   queries the dev clone at runtime for a published platform funnel with a live
   entry step (never hard-coded, so this stays correct as the clone's data
   changes) and creates a `kind: "funnel"` row under tenant B with the identical
   slug, publishes its entry step with a distinct marker (`G31 TENANCY PROOF —
TENANT B PAGE`), and marks the funnel published. This exact collision was
   illegal before migration 00278 (`funnels_slug_key`, a table-wide unique index)
   and is legal after (`funnels_business_id_slug_key`, per-tenant).
3. **A second, exclusive funnel** — a slug only tenant B owns at all, for a control
   check that isolates "wrong tenant" from "slug doesn't exist anywhere".
4. **A lead** (`createSubmission`) against the colliding funnel, so the leads inbox
   check exercises a real row, not an empty state.
5. **A `business_domains` row** for tenant B (`g31-proof-<stamp>.localhost`) — no
   DAL writer exists for this table yet (the domain-management surface doesn't
   exist — see CLAUDE.md's "three things a white-label SaaS needs"), so this is a
   direct insert, exactly like migration 00251's platform seed.
6. **A published, upcoming event** owned by tenant B (`createEvent`), for the
   builder's event CTA catalogue check.

The platform business id is resolved via `platformBusinessId()` throughout — never
a literal. `git grep -l SINGLETON_BUSINESS_ID -- '*.ts' '*.tsx' | grep -v
'^__tests__/\|/__tests__/\|^scripts/' | wc -l` is still **5** after this task.

## What was driven, and what answered

All of these are real HTTP requests against a running `npm run dev` on port 3050 —
`/go/*` via `node:http` with an explicit `Host` header (verified separately that
`fetch()` silently ignores an overridden Host header; `node:http` does not), the
admin surfaces via `fetch()` with a session cookie minted through the dev-only
`/api/dev/login` bypass (triple-gated: non-production, non-Vercel,
`DEV_AUTH_BYPASS_ENABLED=true`) plus the `djp_business` cookie the real business
switcher uses — `admin@darrenjpaul.com` is role `admin`, an implicit operator of
every business, so one session can act as either tenant.

| Check                                                                              | Result                                                                                                     |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `/go/<shared-slug>` with tenant A's (platform's) host                              | **200, A's page** (no tenant-B marker)                                                                     |
| `/go/<shared-slug>` with tenant B's host                                           | **200, B's page** — same URL path, different page: the headline result                                     |
| `/go/<shared-slug>` with an unclaimed host                                         | **200, the platform's page**, not a 404                                                                    |
| `/go/<a-slug-only-B-owns>` with tenant A's host                                    | **404**                                                                                                    |
| control: same slug with tenant B's own host                                        | 200, tenant B's exclusive page (proves the 404 above is a tenancy boundary, not a nonexistent slug)        |
| Leads inbox (`/admin/funnels/leads?funnelId=...`) as tenant B                      | **200, page column populated** with the real funnel name (the PGRST201/PGRST200 check — see finding above) |
| Same lead, fetched under tenant A's own session                                    | **200, lead absent** — the `business_id` predicate holds even when the `funnelId` is real                  |
| Builder's event CTA catalogue (`/api/admin/funnels/offers?kind=event`) as tenant B | **200, contains tenant B's event**                                                                         |
| Same catalogue as tenant A (platform)                                              | **200, does NOT contain tenant B's event**                                                                 |
| `/admin/funnels` board as tenant B                                                 | shows tenant B's colliding funnel; **not visible** from tenant A's board                                   |
| `/admin/funnels` board as tenant A                                                 | still shows the platform's own funnel at that slug                                                         |

**19 of 19 checks passed** on the final run (two failed on the first run — both
diagnosed and fixed; see below).

## Two things that looked like tenancy bugs and weren't

1. **The leads-inbox 500** above was real, but a second failure on the very same
   check — the rendered HTML not containing the funnel's own name — was a
   **test-authoring bug in this script**, not a product bug. The funnel name
   included literal double quotes (`collides with "off-season-speed-camp-dxf8"`);
   React escapes those to `&quot;` in the rendered HTML, so a raw `.includes()`
   against the unescaped string silently failed. Fixed by naming the fixture
   without quote characters. Recorded here because it is exactly the kind of thing
   that reads as "the embed is still broken" if you don't check the actual HTML.
2. `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are not automatically
   available to a standalone `tsx` script — Next.js loads `.env.local` for its own
   process, not for a sibling script. The script parses `.env.local` itself and
   sets `process.env` explicitly before importing any DAL module, since
   `createServiceRoleClient()` reads those two vars lazily at call time.

## Cleanup

Verified clean by re-reading every table touched after each run (not by trusting
the delete calls): `businesses`, `funnels` (cascades `funnel_steps` /
`funnel_step_versions` / `funnel_submissions` / `funnel_step_turns`), `events`,
`business_domains`, `business_settings`, `business_members`, `booking_hosts` — all
zero, on all four runs made while building this script (two of which hit the FAIL
path before the fix, confirming cleanup runs from the `finally` block regardless of
outcome). A residue sweep by name/slug pattern across the whole dev clone after all
runs also came back zero for every table.

One cleanup-ORDER note worth keeping: `funnels.business_id` and
`events.business_id` reference `businesses(id)` with **no** `on delete cascade`
(migrations 00278 and 00252 both say so explicitly — cascade lives on the
`funnels`/`events`-owned children, not on the tenant relationship itself). Deleting
the `businesses` row before its funnels/events would raise a
`foreign_key_violation`. The script deletes funnels and events first, then the
business (which does cascade `business_settings`, `booking_hosts` and
`business_members`, per migrations 00212/00240).

The dev clone already carries several other sessions' tenancy fixtures — "Northcrest
Barbell \*" (6 rows), "Trailhead Strength & Conditioning", and a `phase4-coach.test`
row in `business_domains` — none of which this script reads, writes, or deletes.

## Concerns for the owner

- **The leads-inbox fix is the important item.** It was shipping on this branch
  and would have 500'd `/admin/funnels/leads` for every tenant the moment this
  branch reached a database where the migration's cache had settled — not a
  tenancy-specific bug in the sense of leaking data, but a full outage of an admin
  surface. Whole-branch review should look at this file specifically.
- The PostgREST schema-cache lag noted above is worth a sentence in whatever
  runbook covers applying migrations to the dev clone by hand — the same class of
  "the mock says fine, the live server 400s" gap could recur for any embed touched
  by a future FK change.
- Everything else proved out cleanly: the collision is legal, the host-based split
  serves the right page to the right tenant (and the platform to everyone else),
  the wrong-tenant 404 is a real tenancy boundary (not a missing-slug 404), and
  both the leads-list predicate and the event-CTA catalogue hold in both
  directions.
