# G31 — the funnel subsystem carries a tenant

**Date:** 2026-09-24
**Status:** approved in chat (scope, deploy strategy and proof depth decided by the
owner 2026-09-24; approach A approved; remainder decided under autonomous mode and
recorded here)
**Branch:** `worktree-g31-funnel-tenancy` off `main@534c21b4`
**Ledger row:** G31, `docs/lead-engine-gaps-to-ship-2026-09-19.md`

---

## The goal

Seven tables in the funnel subsystem carry no tenant key. Every reader over them
therefore returns every business's rows, and `/go/<slug>` resolves a public page by
slug alone. Done means: each table carries `business_id`, every reader takes an
explicit `businessId` and filters on it, `/go/<slug>` resolves the tenant from the
request Host and then the slug within that tenant, slugs are unique per tenant
rather than globally, `loadCatalogues()` stops being frozen to the platform, and
`lib/tenancy/platform.ts` no longer lists this subsystem as a seam.

This is the largest white-label row in the ledger and the one G32 needs a shape
from.

---

## What was measured, not assumed

All figures read from **production** on 2026-09-24.

| Table | rows | has `business_id` |
|---|---:|---|
| `funnels` | 9 | no |
| `funnel_steps` | 10 | no |
| `funnel_step_versions` | 2 | no |
| `funnel_step_turns` | 198 | no |
| `funnel_submissions` | 0 | no |
| `funnel_checkout_grants` | 0 | no |
| `lead_magnets` | 0 | no |
| `businesses` | 1 | — |
| `business_domains` | 2 | — |

**The backfill is trivial; the code is the work.** Volumes are small enough that the
migration is not the risk in this change.

### Two corrections to the ledger row

1. **The ledger names two DAL files. There are seven.** `lib/db/funnels.ts` (20
   exported functions) and `lib/db/funnel-leads.ts` (9) are joined by
   `funnel-builder.ts` (5), `lead-magnets.ts` (6), `funnel-checkout-grants.ts` (3),
   `funnel-page-tree.ts` (2) and `funnel-schema-support.ts` (2) — **47 exported
   functions** (45 of which touch a funnel table, directly or by delegation), not 29. A grep for bare `.from("funnel` / `.from("lead_magnets`
   across `app`, `lib`, `components` and `functions/src` finds table access in those
   seven files and nowhere else, so the DAL boundary does hold: there are no direct
   readers outside it.

2. **`funnels.slug` is already unique.** An earlier reading of `pg_constraint`
   suggested it was not; `pg_constraint` does not list plain unique *indexes*.
   `funnels_slug_key` is `CREATE UNIQUE INDEX ON funnels (lower(slug))` — global and
   case-insensitive. There is no latent duplicate-slug bug today. What G31 changes is
   the scope of that index.

---

## Decisions

### D1 — one branch converts all 47 readers *(owner, 2026-09-24)*

Rejected: converting the public path first and admin second. A half-tenanted
subsystem is the state that actually leaks, and with one production tenant nobody
would notice the gap between merges.

### D2 — two pushes: schema, then code *(owner, 2026-09-24)*

`.github/workflows/apply-migrations.yml` applies migrations on push to `main` while
Vercel is still building, and nothing sequences the two.

* **Push 1** is migration `00278` **alone**. Old code keeps working untouched because
  the column arrives with a `DEFAULT` that fills every insert it does not mention.
* **Push 2** is the code. By then the column is certainly present, so no reader needs
  to tolerate its absence.

This buys the thing that matters: **zero tolerance code**. The alternative —
shipping both together — puts a "column missing? read unscoped" fallback in 47
readers, and a tolerance path that never turns off is a cross-tenant leak nobody
sees. There is nothing to delete later because nothing was added.

**The `DEFAULT` must outlive this branch.** It cannot be dropped in a second
migration here: the migration Action applies every pending migration in one run, so
the default would never exist during the window it was added for. Dropping it is a
later branch, once every writer stamps `business_id` explicitly. This is `00252`'s
recorded lesson, followed rather than rediscovered.

### D3 — `businessId` is an explicit first parameter *(owner approved approach A)*

`getFunnelBySlug(businessId, slug)`, not an ambient context and not a tenant-bound
DAL factory.

The compiler then enumerates every call site: "did I miss a reader?" stops being a
question answered by grepping. It also matches every subsystem already converted
here — `getBusinessSettings(businessId)`, `getEventById(businessId, id)` — and
`createBusiness`'s own doc comment states the principle: *"A new function that
defaults the tenant is how the next leak ships."*

Rejected, and why:

* **AsyncLocalStorage.** Less churn, but the coupling is invisible and it resolves to
  nothing outside a request scope — crons, scripts, the `functions/` runtime. A
  reader that silently reads *every* tenant when context is missing is the exact
  failure G31 exists to remove. This repo has already been bitten by `cookies()`
  outside a request scope in the draft-preview path.
* **`funnelsFor(businessId).getBySlug(...)`.** Compile-safe like D3 and less
  repetitive, but it rewrites all 47 signatures *and* their call sites anyway, and
  introduces a module shape no other DAL here uses.

### D4 — per-tenant slugs, case-insensitivity unchanged

`funnels_slug_key` on `lower(slug)` becomes `unique (business_id, lower(slug))`.
`lead_magnets_slug_key` on `slug` becomes `unique (business_id, slug)`.

Each keeps its existing case sensitivity. `00252` made the same call for events and
said why: *"funnels uses lower(slug) and reconciling the two is a separate change,
not one to smuggle into a tenancy migration."* That still holds in this direction.

`funnel_steps` already has `unique (funnel_id, slug)`, which is tenant-safe by
construction once the funnel is — no change needed.

### D5 — composite foreign keys, and one embed that constrains them

A child row whose `business_id` differs from its parent's is the failure this column
exists to prevent, and application code alone cannot enforce it. So parents gain
`unique (id, business_id)` and children reference the pair.

**The constraint on the design is a PostgREST embed.** `lib/db/funnel-leads.ts`
selects `"*, funnels:funnel_id (name, slug), funnel_steps:step_id (name)"`, and
`funnel_submissions` has a foreign key to *both* of those tables. Adding a composite
FK **alongside** the existing simple one gives PostgREST two relationships between
the same pair of tables, and it answers `PGRST201` ("more than one relationship was
found") instead of rows — breaking the leads inbox. `00252` hit exactly this and
verified the fix on the dev clone: the embed resolves across the composite FK alone.

So each simple FK is **replaced**, not supplemented:

| Child | FK replaced | `ON DELETE` preserved |
|---|---|---|
| `funnel_steps` | → `funnels(id)` | `CASCADE` |
| `funnel_step_versions` | → `funnel_steps(id)` | `CASCADE` |
| `funnel_step_turns` | → `funnel_steps(id)` | `CASCADE` |
| `funnel_submissions` | → `funnels(id)` | `CASCADE` |
| `funnel_submissions` | → `funnel_steps(id)` | `CASCADE` |

`ON DELETE CASCADE` is carried over deliberately on every one. `deleteFunnel` and
`deleteStep` both rely on it; dropping the clause while replacing the constraint
would silently convert those into `foreign_key_violation`. This is `00252`'s
`event_signups` lesson applied five times.

**Left alone:**

* `funnel_steps.published_version_id → funnel_step_versions(id) ON DELETE SET NULL`.
  A back-pointer, not a parentage claim — the step's own `business_id` already says
  whose it is, and no embed crosses it.
* `funnel_checkout_grants` and `lead_magnets` have **no** foreign key into the funnel
  tables at all. They get `business_id` and no composite FK, because there is no
  parent to drift from.

### D6 — the public route resolves Host, then slug

`/go/<slug>[/<step>]` calls `resolvePublicTenant()` — the established Host boundary,
already used by every other public surface — and passes the result into
`getPublishedStep(businessId, slug, stepSlug)`.

An unclaimed Host (every dev host, every preview deploy, `*.vercel.app`) continues to
fall back to the platform business with a one-per-host warning. That is not a new
decision; it is `resolvePublicTenant`'s documented contract, and departing from it
here would 404 every preview deploy.

A slug that belongs to a *different* tenant than the Host resolves to returns **404**,
by the same code path that already returns 404 for a slug that does not exist. There
is no "wrong tenant" error page: telling an anonymous visitor that a page exists but
belongs to someone else is a disclosure, not a courtesy.

The two draft-preview routes (`/funnel-preview/<stepId>`, `/preview/<slug>`) are
admin/staff surfaces and resolve through the **admin** boundary
(`resolveAdminTenantForRequest`), not the Host — matching how `/admin/*` already
scopes, and keeping an owner's preview working on any host.

### D7 — admin surfaces scope through the existing admin boundary

`resolveAdminTenantForRequest(req)` already scopes the pipeline and businesses
routes. The funnel admin routes follow it rather than inventing a second rule.

Consequence worth stating: `/admin/funnels` will show the **selected** tenant's
funnels. With one business that is all nine, unchanged. The selection cookie
defaulting to something other than the platform business is a known trap in this
repo, so the tenant a screen resolved is worth naming in its empty state.

### D8 — `loadCatalogues()` is unfrozen, and that closes a real bug

`lib/tenancy/platform.ts` currently lists `loadCatalogues()` as **deliberately
frozen**, and records what the freeze costs: the funnel builder and the publish gate
validate an event CTA against a platform-only catalogue while the live page resolves
a real per-host tenant. *"The day a second tenant publishes a funnel with an event
CTA, the builder and the gate pass and the live render is silent absence."*

G31 threads a `businessId` into `loadCatalogues()` and its call graph — the
build/publish/plan routes, the build orchestrator, the funnel editor page and the
shared draft-preview renderer. The builder, the gate and the live render then agree
about one tenant's catalogue, which is the whole point of unfreezing it.

---

## What changes, by layer

### Migration `00278` (push 1, no code)

1. `business_id uuid not null default '00000000-0000-0000-0000-000000000001' references businesses(id)` on all
   seven tables. `NOT NULL` is safe immediately: a non-volatile default backfills
   existing rows during `ADD COLUMN` with no table rewrite and no separate backfill
   step.
2. `unique (id, business_id)` on `funnels` and `funnel_steps` — the targets the
   composite FKs below need.
3. Five FK replacements per **D5**, each preserving `ON DELETE CASCADE`.
4. Slug indexes re-scoped per **D4**.
5. Supporting indexes: `(business_id, status)` on `funnels`, `(business_id,
   created_at desc)` on `funnel_submissions`.

The literal platform UUID appears in this file as a column default. That is how every
tenanted table here was created (`00252`), and it is a migration default rather than a
new `SINGLETON_BUSINESS_ID` reference in application code — the inventory the repo's
rule counts is `*.ts`/`*.tsx`.

### The DAL (push 2)

**45 of the 47** exported functions take `businessId` as their first parameter —
either applying `.eq("business_id", businessId)` to their own reads and stamping it
on their own inserts, or threading it into the DAL function they delegate to
(`saveStepDraft` → `updateStep`, for example).

The **two** that do not are genuinely pure and would be made worse by the parameter:
`searchClause(term)` in `funnel-leads.ts` builds a PostgREST `or` string from user
input and touches nothing, and `__resetIntakeColumnCache()` in
`funnel-schema-support.ts` resets module state for tests. Counting them in would mean
threading a tenant through a string formatter to make a number look complete.

Writers stamp explicitly rather than leaning on the column default. The default
exists for the deploy window, not as a writing strategy; a writer that relies on it
is a writer that will break silently when the default is dropped.

### Routes and callers (push 2)

Public (`resolvePublicTenant`): `/go/<slug>`, the funnel submit route, the sitemap
reader, the preview-submit route. Admin (`resolveAdminTenantForRequest`): every
`/api/admin/funnels/*` route, the leads inbox, the builder, both preview routes.

### `lib/tenancy/platform.ts` (push 2)

`loadCatalogues()` leaves the frozen list. The paragraph recording the
builder/gate/live-render disagreement goes with it, because the disagreement is
resolved. The `SINGLETON`-in-all-but-name comment in `listPublishedFunnelSteps`
(`lib/db/funnels.ts`) is replaced by the predicate it asks for.

---

## Testing

### Per reader: mutate the predicate's VALUE, not its arity

The ledger asks for this and it is the right instruction. A test that only proves
`.eq("business_id", …)` was *called* passes when the value is the wrong tenant's;
argument-blind mocks tolerate exactly that. Each reader's test asserts the value.

### The permissive control

Every "tenant B cannot see this" assertion is paired with "tenant A still can".
A predicate that refuses everything passes every absence assertion on its own, and
surviving mutants in this repo have repeatedly been the case that must still be
ALLOWED.

### Proof against a real second tenant *(owner, 2026-09-24)*

Unit tests cannot prove isolation when production has one tenant and every fixture
supplies its own rows. So after the suites are green, a second business is created
**in the dev clone**, given its own funnel sharing a slug with a platform funnel, and
these are driven for real:

* `/go/<slug>` on each Host — each tenant's page, and 404 for the other's slug.
* `/admin/funnels` — each tenant sees only its own.
* The leads inbox — the embed still resolves (the `PGRST201` risk from **D5**).
* The builder and publish gate — against the unfrozen catalogue.

The dev clone, never production. No writing script is run against production in this
branch.

---

## Risks

| Risk | Handling |
|---|---|
| `PGRST201` breaks the leads inbox embed | **D5** replaces rather than supplements each FK; the dev-clone run exercises the inbox specifically |
| A reader is missed | Explicit parameter (**D3**) makes it a compile error, not a silent full-tenant read |
| Migration lands, code does not | **D2**: the column has a default, so old code is unaffected and push 1 is safe alone |
| Admin sees an empty list after the split | **D7**: the resolved tenant is named in the empty state |
| Dropping the default later is forgotten | Recorded here and in `00278`'s header as a later branch, with its precondition (every writer stamps explicitly) |

## Out of scope

* Dropping the column defaults — a later branch, per **D2**.
* Reconciling `funnels`' case-insensitive slugs with `events`' case-sensitive ones.
* Row-level security on the funnel tables. These predicates are application-level,
  like every other tenanted subsystem here.
* G32 (seeding a new tenant's sequences), which this unblocks but does not contain.
