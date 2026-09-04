# Coach reachability: contacts, pipeline and chat

**Branch:** `feat/coach-reachability` off `main@3d2ddbaa`
**Date:** 2026-09-04
**Precedes:** phase 2 (Calendly OAuth per coach), which this does not touch.

## The problem

A coach is `users.role='staff'` + a `business_members` row + a permission map.
Today such a person can reach exactly two admin areas: `/admin/bookings` (via
`schedule`) and `/admin/funnels/quizzes` (via `funnels`).

`/admin/contacts`, `/admin/pipeline` and `/admin/chat` appear in neither
`OWNER_ONLY_PREFIXES` nor `PATH_PERMISSIONS`. `resolvePathRequirement` therefore
returns `unmapped`, `canAccessPath` default-denies (`registry.ts:611-612`), and
`proxy.ts` redirects to `/admin/no-access`. That is the single reason a second
coach cannot yet run their book of business.

## The decision: what a coach may see

**A new boolean permission key, `contacts`,** covering three screens as one
capability: the contact record, the pipeline board, and website-visitor chat
transcripts.

`leads` is left alone as the raw website-inquiry inbox (`/admin/inbox`).

### Why a new key rather than reusing `leads`

`/admin/contacts/[id]` is one named person's entire history in one place —
every form they filled in, every text message, what they paid, the calls they
booked. The page audits itself as `admin_read_sensitive` for exactly that
reason. `/admin/inbox` is raw inquiries.

Bundling them would mean granting inbox triage implies full CRM and payment
history, permanently and invisibly. Keeping them separate lets a marketing
editor triage inquiries without seeing money. Nobody holds `leads` on
production today (read back: 1 admin, 2 editors, **0 staff**), so this costs
nothing to separate now and cannot be separated cheaply later.

### Why one key rather than three

Contacts, pipeline and chat are one job: the board draws its cards from the
contacts list, and the chat transcript is how half those contacts arrived. A
coach granted only some of the three lands in a half-broken app — the pipeline
board's cards link to contact records that bounce. One key, one coherent
capability.

### What a coach still may NOT do

- `ads` stays ungrantable in practice. `listGoogleAdsAccounts`
  (`lib/db/google-ads-accounts.ts:10`) takes no tenant at all. Out of scope
  here; do not grant it until that reader is scoped.
- Everything in `OWNER_ONLY_PREFIXES` is unchanged.
- `programs` is not implied. `listGrantablePrograms()` takes no businessId
  because `programs` has no `business_id` column — a known, separately-owned gap.

## The trap, and why the two halves cannot be split

Adding `PATH_PERMISSIONS` rows on their own would convert "a coach cannot get
there" into "a coach reads and writes another tenant's records by typing a
UUID". Four surfaces are unscoped or mis-scoped today and are safe **only**
because they are unreachable.

The handoff for this session named `contacts/[id]` and `chat/[id]` as the two.
Read back against `main`, that is half right and half stale:

| # | Surface | Actual state on `main` | Class |
|---|---|---|---|
| 1 | `lib/db/chat.ts:75` `getConversation(id)` | **no business predicate at all** | reads ANY tenant |
| 2 | `lib/db/pipeline.ts:1024` `readOpportunityForGrant(id)` | **no business predicate at all** | reads ANY tenant |
| 3 | `app/api/admin/contacts/[id]/tags/route.ts` `getContactById(id)` | falls to `SINGLETON_BUSINESS_ID` default | wrong tenant |
| 4 | `app/api/admin/pipeline/move/route.ts` `moveOpportunityManually` | `businessId` param exists, is **not passed** → singleton | wrong tenant |
| 5 | same route, `addTag(...)` | falls to the singleton default | **wrong tenant, on a WRITE** |
| 6 | same route, `removeTag(...)` | falls to the singleton default | **wrong tenant, on a WRITE** |

**5 and 6 were missed on the first pass and found by the whole-branch review.**
The first version of this document said "four surfaces" and named only the READ
on line 97 of the tags route, eight lines above two writes carrying the identical
default. Scoping the read and leaving the writes is worse than scoping neither:
the read PROVES the caller owns the contact, and the write then files the row
under a different business. The insert succeeds, answers `200 {created:true}`,
and the tag vanishes on refresh because every reader filters on the caller's own
business — while DELETE, mis-keyed the same way, can never remove a tag that was
filed correctly. It regressed the OPERATOR too, whenever the business switcher
was off the singleton.

No repair migration is needed: `contact_tags` was read back on both databases and
holds **0 rows on production** and 0 mis-keyed rows on the dev clone, so the bug
was never exercised. Worth knowing if that changes — `contact_tags_unique` is
`UNIQUE (contact_id, tag)` and is NOT business-scoped, so a mis-keyed row would
block the corrected insert with a 23505 rather than sitting harmlessly beside it.

`app/(admin)/admin/contacts/[id]/page.tsx` is **already scoped** — a "Task 13"
conversion did it, and it resolves a tenant and passes it to both
`getContactById` and `listSequences`. The handoff's claim that it is unscoped
is out of date. The pipeline and chat *list* pages are scoped too.

Classes 1 and 2 are the worse ones: an arbitrary UUID reaches an arbitrary
tenant. Classes 3 and 4 are narrower but not benign — they point a coach's
writes at the **operator's own** tenant.

## Three gates, not one

Reachability is gated in three independent places. All three must move together
or the change is either useless or unsafe.

1. **`proxy.ts`** — reads `PATH_PERMISSIONS`. Currently `unmapped` → deny.
2. **`requireAdmin()`** (`lib/auth-helpers.ts:18-27`) — demands `role === "admin"`
   exactly, and redirects everyone else. Present on all five pages. This is why
   mapping the path alone would still bounce a coach.
3. **`session.user.role !== "admin"`** inside `pipeline/grant` and
   `pipeline/move`. (`contacts/[id]/tags` already uses `canAccessAdminPath`.)

The house replacements already exist and are used elsewhere:
`requirePermission(key, tier)` for pages and `canAccessAdminPath(user, request?)`
for routes, both in `lib/permissions/guard.ts`. `/admin/bookings` — the page a
coach can already reach — carries **no** page guard at all and leans on the
proxy plus `resolveAdminTenant()`; the admin layout's own comment names
`requirePermission()` as the per-area mechanism.

## Work items

### 1. `lib/permissions/registry.ts`
- Add `"contacts"` to `BooleanPermissionKey`.
- Add a `PermissionDef`: key `contacts`, label **"Contacts & Pipeline"**, group
  `coaching`, kind `boolean`, description naming all three screens so the invite
  screen does not undersell what it grants.
- Add `PATH_PERMISSIONS` rows: `/admin/contacts`, `/admin/pipeline`,
  `/admin/chat`, `/api/admin/contacts`, `/api/admin/pipeline`.
- Add `{ permission: "contacts", path: "/admin/contacts" }` to `HOME_PRIORITY`
  so a coach holding only this key lands somewhere real instead of
  `/admin/no-access`.

No nav change is needed: `filterNavForActor` already derives visibility from
`canAccessPath`, so the links appear on their own. That is also the property
worth a test — a visible link that bounces reads as a bug, not a boundary.

### 2. Scope the four surfaces

- `getConversation(id, businessId?)` — **optional** second parameter. Three of
  its four callers are the public `/api/ask` paths and `escalate.ts`, which
  legitimately resolve a conversation before knowing its business. The admin
  page passes it; the public paths do not. Same shape, and same reason, as
  `getBusinessSettings`'s retained default.
- `readOpportunityForGrant(opportunityId, businessId)` — **required** second
  parameter. It has exactly one caller, so there is no reason to leave a
  footgun.
- `contacts/[id]/tags` route — `resolveAdminTenantForRequest(request)`, pass
  `businessId` to `getContactById`.
- `pipeline/move` route — same, pass the existing `businessId` param through.

### 3. Relax the guards
- Five pages: `requireAdmin()` → `requirePermission("contacts")`.
  (`/admin/contacts`, `/admin/contacts/[id]`, `/admin/pipeline`, `/admin/chat`,
  `/admin/chat/[id]`.)
- `pipeline/grant` and `pipeline/move`: `role !== "admin"` → `canAccessAdminPath`.

### 4. Tests
Every suite gets `// @vitest-environment node` on line 1, and every run is
confirmed at a **non-zero** count — a jsdom suite reports "no tests", which is
indistinguishable from passing.

- Registry: the five prefixes resolve to `contacts`; a staff actor holding
  `contacts` passes and one holding only `leads` is denied; `admin` is
  unaffected on every path.
- Nav: a `contacts`-holding staff actor sees Pipeline, Contacts and Chat
  assistant, and does not see owner-only entries.
- Cross-tenant probes for all four surfaces: a subject in business B must not be
  readable or writable by a coach resolved to business A.

**The tenancy fixtures must use a business id that is NOT
`00000000-0000-0000-0000-000000000001`.** Four vacuous assertions were found on
the last branch for exactly this. Prove each one by mutating the value, not the
arity — an argument-blind mock let a wrong tenant pass 91/91 once already.

## Baseline to compare against

Pre-existing red at `main@3d2ddbaa`, not to be blamed on this branch:
`funnel-island-traits`, `section-inspector`, `webhook-funnel-purchase`,
`campaign-revenue-page`, `contacts-table`, `pipeline-board`.
`tsc --noEmit` is **251** errors — compare the error SET, not just the count,
because a falling count hides new errors too.

## Found by the whole-branch review, and fixed here

Per-task checking could not have seen most of these; they are properties of the
finished branch read against its own goal statement.

- **The `coach` preset granted nothing new.** The permission shipped in no
  preset at all, so the one path an owner actually takes — inviting a teammate
  as "Coach", the default selection on the invite dialog — produced exactly the
  person this change exists to unblock, still unable to reach any of it. Front
  Desk deliberately still does not get it.
- **The tag writes** (surfaces 5 and 6 above).
- **`programId` was unvalidated server-side.** The picker offers only active,
  priced programs, but that filter was client-side only: any UUID in the
  `programs` table reached `assignProgram`, which creates an account and sends
  email. Now re-checked against `listGrantablePrograms()` in the route.
- **Every coach card-move audited as `actor_role: "admin"`.** Hardcoded in
  `moveOpportunityManually`, true by construction only while the route was
  admin-only. "Did a coach close this deal?" got the wrong answer from the one
  trail meant to answer it.
- **Two buttons posted to an unmapped route.** `/api/admin/sequences/enrol` is
  not in `PATH_PERMISSIONS` and its handler still requires `role === "admin"`,
  so a coach saw a populated sequence picker that 403s. The gate is right and
  fails closed twice; the button is now hidden from anyone who cannot use it,
  asked of the same registry that gates the route so the two cannot drift.
  The singleton write inside that route remains out of scope and unreachable.
- **A dead link in the first paragraph** of the coach's own home page:
  `/admin/funnels/leads` needs `funnels`. Now plain text unless the viewer can
  open it.

## Out of scope, deliberately

Calendly OAuth (phase 2), the `fn_*` RPC quartet, the neutral `Slot` type,
scoping `listGoogleAdsAccounts`, the `sequences/enrol` singleton write,
`contacts.user_id` having no writer, `payments` having no `business_id`, and
`loadCatalogues()`'s frozen platform id. Each wants its own change.
