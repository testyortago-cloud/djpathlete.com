# G31 Funnel Tenancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the seven funnel tables a `business_id`, make every reader over them take an explicit tenant, and resolve `/go/<slug>` by request Host before slug.

**Architecture:** Two pushes. Push 1 is migration `00278` alone — the column arrives with a `DEFAULT` so old code keeps working. Push 2 threads an explicit `businessId` first parameter through 45 DAL functions in 7 files and their 41 importers, so a missed call site is a compile error rather than a silent cross-tenant read.

**Tech Stack:** Next.js 16 App Router, Supabase (PostgREST via supabase-js), Vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-24-funnel-tenancy-design.md`

## Global Constraints

- **Never add a new `SINGLETON_BUSINESS_ID` reference** in `*.ts`/`*.tsx`. A tenant that cannot be resolved goes through `platformBusinessId()` in `lib/tenancy/platform.ts` with an honest note about which kind of seam it is. The literal in migration SQL is fine — that is how `00252` created every tenanted table.
- **`app/api/quiz/submit/route.ts` must NOT call `platformBusinessId()`.** `__tests__/lib/tenancy/platform-inventory.test.ts` fails if it does. It already resolves `businessId` from the quiz attempt; keep it that way.
- **Migration number is `00278`.** Verified free against `main`, all three worktrees and every local branch on 2026-09-24. Re-check before writing the file.
- **`tsc --noEmit` baseline is 238 errors across 54 files.** Compare the per-file SET against `.claude/baselines/tsc-ce6f2aba-perfile.txt`, never the count — a falling count hides new errors.
- **Vitest requires Node 24.** `source ~/.nvm/nvm.sh && nvm use 24` first. Node 20 fails vitest's own require(esm) guard before reaching the suite, and a skipped suite reads as a green suite.
- **Targeted test runs only.** Name the test files. Never sweep a whole `__tests__/` directory.
- **Never run `prettier --write` across the repo.** ~78 files were never formatted; only format files this branch touches.
- **No Claude/Anthropic attribution** in any commit message.
- **`npm run lint` is broken repo-wide** (`next lint` removed in Next 16, no eslint config). Skip it and say so.

## Review Focus

Five failure modes the spec implies that no task's own happy path exercises. Each has its test placed in the task that owns the code.

1. **`PGRST201` on the leads inbox.** `funnel_submissions` embeds both `funnels` and `funnel_steps`; adding a composite FK beside the simple one gives PostgREST two relationships and it returns an error instead of rows. *Test in Task 3.*
2. **A cascade silently becoming a foreign-key violation.** `deleteFunnel` and `deleteStep` depend on `ON DELETE CASCADE`; the FK replacement must carry it across. *Test in Task 1.*
3. **A cron that closes only one tenant's funnels.** `funnel-window` has no session and no Host. If it resolves a single tenant, a second tenant's expired funnel stays live forever. *Test in Task 7.*
4. **A slug collision surfacing as a 500.** Per-tenant uniqueness means `createFunnel` can now hit `23505`. An admin typing a taken slug must get a field error, not a stack trace. *Test in Task 2.*
5. **`/go` on an unclaimed Host.** Every dev host, every preview deploy and `*.vercel.app` resolve to no `business_domains` row. They must keep serving the platform's funnels, not 404. *Test in Task 6.*

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `supabase/migrations/00278_funnel_tenancy.sql` | schema | create |
| `lib/db/funnels.ts` | funnels, steps, versions, submissions | 18 signatures |
| `lib/db/funnel-leads.ts` | leads inbox reads | 6 signatures + embed |
| `lib/db/funnel-builder.ts` | builder turns | 4 signatures |
| `lib/db/funnel-page-tree.ts` | step tree | 2 signatures |
| `lib/db/funnel-schema-support.ts` | intake column probe | 1 signature |
| `lib/db/funnel-checkout-grants.ts` | checkout grants | 3 signatures |
| `lib/db/lead-magnets.ts` | lead magnets | 6 signatures |
| `lib/funnels/sections/resolve.ts` | `loadCatalogues()` | unfreeze |
| `lib/tenancy/platform.ts` | seam inventory | remove entry |
| 41 importers | routes, pages, components | pass the tenant |

---

### Task 1: Migration 00278 — the column, the constraints, the FK swaps

**Files:**
- Create: `supabase/migrations/00278_funnel_tenancy.sql`
- Test: `__tests__/migrations/00278.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `business_id uuid NOT NULL` on all seven funnel tables; `unique (id, business_id)` on `funnels` and `funnel_steps`; composite FKs replacing five simple ones; `funnels_business_id_slug_key` on `(business_id, lower(slug))`; `lead_magnets_business_id_slug_key` on `(business_id, slug)`.

**THIS TASK IS PUSH 1 AND SHIPS ALONE.** No code in this task. The default is what lets the currently-deployed bundle keep inserting while the column exists.

- [ ] **Step 1: Re-verify the migration number is still free**

```bash
ls supabase/migrations | sort | tail -1
for d in ../../worktrees/*/; do ls "$d/supabase/migrations" 2>/dev/null | sort | tail -1; done
```
Expected: nothing at or above `00278`. If something is, use the next free number and update this plan.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/00278_funnel_tenancy.sql`:

```sql
-- supabase/migrations/00278_funnel_tenancy.sql
-- G31: the funnel subsystem carries a tenant.
--
-- THIS MIGRATION SHIPS IN ITS OWN PUSH, AHEAD OF THE CODE. apply-migrations.yml
-- runs on push to main while Vercel is still building and nothing sequences the
-- two. Shipping the predicates in the same push would mean 47 readers each
-- tolerating a missing column, and a tolerance path that never turns off is a
-- cross-tenant leak nobody sees. Pushing the schema first costs one extra push
-- and removes that branch entirely.
--
-- THE DEFAULT MUST OUTLIVE THIS DEPLOY. It is what keeps the currently-deployed
-- bundle's inserts from failing 23502 while it is still serving. Dropping it
-- belongs in a LATER branch, once every writer stamps business_id explicitly.
-- It cannot be dropped in a second migration in this branch: the Action applies
-- every pending migration in one run, so the default would never exist during
-- the window it was added for. (00252 recorded this; it is followed, not
-- rediscovered.)
--
-- NOT NULL is safe immediately: Postgres applies a non-volatile default to
-- existing rows during ADD COLUMN without a table rewrite, so the 9 funnels,
-- 10 steps, 2 versions and 198 turns in production are backfilled by the
-- ADD COLUMN itself. No separate backfill statement.

alter table public.funnels
  add column business_id uuid not null
    default '00000000-0000-0000-0000-000000000001'
    references public.businesses(id);

alter table public.funnel_steps
  add column business_id uuid not null
    default '00000000-0000-0000-0000-000000000001'
    references public.businesses(id);

alter table public.funnel_step_versions
  add column business_id uuid not null
    default '00000000-0000-0000-0000-000000000001'
    references public.businesses(id);

alter table public.funnel_step_turns
  add column business_id uuid not null
    default '00000000-0000-0000-0000-000000000001'
    references public.businesses(id);

alter table public.funnel_submissions
  add column business_id uuid not null
    default '00000000-0000-0000-0000-000000000001'
    references public.businesses(id);

alter table public.funnel_checkout_grants
  add column business_id uuid not null
    default '00000000-0000-0000-0000-000000000001'
    references public.businesses(id);

alter table public.lead_magnets
  add column business_id uuid not null
    default '00000000-0000-0000-0000-000000000001'
    references public.businesses(id);

-- Targets for the composite foreign keys below. Postgres requires a unique
-- constraint on the referenced columns.
alter table public.funnels
  add constraint funnels_id_business_id_key unique (id, business_id);
alter table public.funnel_steps
  add constraint funnel_steps_id_business_id_key unique (id, business_id);

-- THE FIVE FK REPLACEMENTS. Each is DROP-then-ADD, never ADD-alongside.
--
-- WHY REPLACE: lib/db/funnel-leads.ts selects
--   "*, funnels:funnel_id (name, slug), funnel_steps:step_id (name)"
-- and PostgREST picks an embed by finding THE foreign key between two tables.
-- With both a simple and a composite FK present it answers PGRST201 ("more
-- than one relationship was found") instead of rows, and the leads inbox goes
-- blank. 00252 hit this exact wall with event_signups and verified on the dev
-- clone that the embed resolves across the composite FK alone.
--
-- ON DELETE CASCADE IS CARRIED ACROSS EVERY ONE, and that is load-bearing:
-- deleteFunnel and deleteStep in lib/db/funnels.ts both rely on the cascade.
-- Dropping the clause here would turn each of them into a
-- foreign_key_violation at runtime, with no test failing at build time.

alter table public.funnel_steps drop constraint funnel_steps_funnel_id_fkey;
alter table public.funnel_steps
  add constraint funnel_steps_funnel_business_fkey
    foreign key (funnel_id, business_id)
    references public.funnels (id, business_id)
    on delete cascade;

alter table public.funnel_step_versions drop constraint funnel_step_versions_step_id_fkey;
alter table public.funnel_step_versions
  add constraint funnel_step_versions_step_business_fkey
    foreign key (step_id, business_id)
    references public.funnel_steps (id, business_id)
    on delete cascade;

alter table public.funnel_step_turns drop constraint funnel_step_turns_step_id_fkey;
alter table public.funnel_step_turns
  add constraint funnel_step_turns_step_business_fkey
    foreign key (step_id, business_id)
    references public.funnel_steps (id, business_id)
    on delete cascade;

alter table public.funnel_submissions drop constraint funnel_submissions_funnel_id_fkey;
alter table public.funnel_submissions
  add constraint funnel_submissions_funnel_business_fkey
    foreign key (funnel_id, business_id)
    references public.funnels (id, business_id)
    on delete cascade;

alter table public.funnel_submissions drop constraint funnel_submissions_step_id_fkey;
alter table public.funnel_submissions
  add constraint funnel_submissions_step_business_fkey
    foreign key (step_id, business_id)
    references public.funnel_steps (id, business_id)
    on delete cascade;

-- Per-tenant slugs. Two coaches both wanting /go/free-guide is the first day of
-- the second tenant, not an edge case.
--
-- Case sensitivity is UNCHANGED on each: funnels stays case-insensitive
-- (lower(slug)), lead_magnets stays case-sensitive. 00252 made the same call
-- for events and said why — reconciling the two is a separate change, not one
-- to smuggle into a tenancy migration.
drop index if exists public.funnels_slug_key;
create unique index funnels_business_id_slug_key
  on public.funnels (business_id, lower(slug));

drop index if exists public.lead_magnets_slug_key;
create unique index lead_magnets_business_id_slug_key
  on public.lead_magnets (business_id, slug);

create index funnels_business_status_idx
  on public.funnels (business_id, status);
create index funnel_submissions_business_created_idx
  on public.funnel_submissions (business_id, created_at desc);
```

- [ ] **Step 3: Write the failing SQL test**

Create `__tests__/migrations/00278.test.ts`. This follows the house pattern: fixtures + the migration body inside a `DO` block that RAISES on a wrong answer, so a silently-passing statement cannot look green.

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"

const SQL = readFileSync("supabase/migrations/00278_funnel_tenancy.sql", "utf8")

describe("00278 funnel tenancy", () => {
  it("adds business_id to all seven tables", () => {
    for (const t of [
      "funnels", "funnel_steps", "funnel_step_versions", "funnel_step_turns",
      "funnel_submissions", "funnel_checkout_grants", "lead_magnets",
    ]) {
      expect(SQL).toMatch(new RegExp(`alter table public\\.${t}\\s+add column business_id uuid not null`))
    }
  })

  it("REPLACES each simple FK rather than adding alongside it", () => {
    // MUTANT: delete a `drop constraint` line. PostgREST then sees two
    // relationships between funnel_submissions and funnels and answers
    // PGRST201, and the leads inbox renders empty with no error anyone sees.
    for (const c of [
      "funnel_steps_funnel_id_fkey",
      "funnel_step_versions_step_id_fkey",
      "funnel_step_turns_step_id_fkey",
      "funnel_submissions_funnel_id_fkey",
      "funnel_submissions_step_id_fkey",
    ]) {
      expect(SQL).toContain(`drop constraint ${c}`)
    }
  })

  it("carries ON DELETE CASCADE onto every replacement FK", () => {
    // MUTANT: drop the cascade on any one of them. deleteFunnel/deleteStep
    // then raise foreign_key_violation at runtime and nothing fails at build.
    const adds = SQL.match(/add constraint funnel_\w+_business_fkey[\s\S]*?;/g) ?? []
    expect(adds).toHaveLength(5)
    for (const a of adds) expect(a).toContain("on delete cascade")
  })

  it("scopes both slug indexes per tenant, preserving each one's case rule", () => {
    expect(SQL).toContain("create unique index funnels_business_id_slug_key\n  on public.funnels (business_id, lower(slug))")
    expect(SQL).toContain("create unique index lead_magnets_business_id_slug_key\n  on public.lead_magnets (business_id, slug)")
    expect(SQL).toContain("drop index if exists public.funnels_slug_key")
  })

  it("keeps the default, because the deploy window depends on it", () => {
    // MUTANT: add `alter column business_id drop default`. The currently
    // deployed bundle's inserts then fail 23502 for the length of the build.
    expect(SQL).not.toMatch(/drop default/)
    expect((SQL.match(/default '00000000-0000-0000-0000-000000000001'/g) ?? [])).toHaveLength(7)
  })
})
```

- [ ] **Step 4: Run it and watch it fail**

```bash
source ~/.nvm/nvm.sh && nvm use 24
npx vitest run __tests__/migrations/00278.test.ts
```
Expected: FAIL — `ENOENT` on the migration file, before Step 2 is done; PASS after.

- [ ] **Step 5: Apply to the DEV CLONE and read the result back**

**READ THIS BEFORE RUNNING ANYTHING.** `scripts/migrations/apply.mjs` takes its target from
`SUPABASE_PROJECT_REF`, and `.github/workflows/apply-migrations.yml` defaults that variable to
`epzuvzkokzqtzomeyoha` — **production**. The variable is not optional here and it must not be
inherited. The dev clone is `anjvztjiokcgiyhobknq`.

Dry-run first, and read the list it prints before letting it write:

```bash
SUPABASE_PROJECT_REF=anjvztjiokcgiyhobknq \
SUPABASE_ACCESS_TOKEN=<dev token> \
DRY_RUN=true node scripts/migrations/apply.mjs
```
Expected: `00278_funnel_tenancy.sql` listed as pending, and nothing else unexpected. If a migration
you did not write is listed, STOP — another session may be mid-flight, and applying theirs is not
yours to do.

Then drop `DRY_RUN` to apply. Verify in the clone rather than assuming: seven `business_id` columns
present, five `*_business_fkey` constraints present, both old slug indexes gone, and
`select count(*) from funnels where business_id is null` returning `0`.

**Production gets this migration from the owner's push, never from this branch.**

- [ ] **Step 6: Prove the cascade still cascades, in the clone**

Insert a throwaway funnel + step + version, delete the funnel, and assert the step and version are gone. This is Review Focus #2 and it cannot be proved by reading SQL.

- [ ] **Step 7: Commit (this is push 1)**

```bash
git add supabase/migrations/00278_funnel_tenancy.sql __tests__/migrations/00278.test.ts
git commit -m "feat(funnels): give the funnel tables a tenant column"
```

---

### Task 2: `lib/db/funnels.ts` — 18 readers take a tenant

**Files:**
- Modify: `lib/db/funnels.ts`
- Test: `__tests__/lib/db/funnels-tenancy.test.ts` (create)

**Interfaces:**
- Consumes: `business_id` from Task 1.
- Produces, in order of appearance — every one gains `businessId: string` as its FIRST parameter:
  `listFunnels(businessId, opts?)`, `getFunnelById(businessId, id)`, `getFunnelBySlug(businessId, slug)`,
  `createFunnel(businessId, input)`, `updateFunnel(businessId, id, input)`, `deleteFunnel(businessId, id)`,
  `listSteps(businessId, funnelId)`, `listStepDocuments(businessId)`, `getStep(businessId, id)`,
  `createStep(businessId, input)`, `updateStep(businessId, id, input)`, `deleteStep(businessId, id)`,
  `saveStepDraft(businessId, ...)`, `publishStep(businessId, input)`,
  `getVersionNumber(businessId, versionId)`, `getPublishedStep(businessId, funnelSlug, stepSlug?, opts?)`,
  `listPublishedFunnelSteps(businessId)`, `createSubmission(businessId, input)`,
  `getSubmissionCountsByFunnel(businessId)`, `getPublishedFormConfig(businessId, ...)`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/db/funnels-tenancy.test.ts`. The fake must be **projection- and filter-aware**: a fake that ignores `.eq()` passes a reader whose predicate names the wrong column, which is the whole bug class here.

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const A = "aaaaaaaa-0000-0000-0000-00000000000a"
const B = "bbbbbbbb-0000-0000-0000-00000000000b"

// Rows from two tenants. A reader that drops its predicate returns both.
const ROWS = [
  { id: "f1", slug: "free-guide", business_id: A, status: "published" },
  { id: "f2", slug: "free-guide", business_id: B, status: "published" },
]

let captured: { col: string; val: unknown }[] = []
function makeQuery(rows: Record<string, unknown>[]) {
  const q: Record<string, unknown> = {}
  let current = [...rows]
  const chain = (fn: () => void) => { fn(); return q }
  q.select = () => q
  q.order = () => q
  q.limit = () => q
  q.ilike = (col: string, val: string) =>
    chain(() => { captured.push({ col, val }); current = current.filter((r) => String(r[col]).toLowerCase() === val.toLowerCase()) })
  q.eq = (col: string, val: unknown) =>
    chain(() => { captured.push({ col, val }); current = current.filter((r) => r[col] === val) })
  q.maybeSingle = async () => ({ data: current[0] ?? null, error: null })
  q.then = (res: (v: unknown) => void) => res({ data: current, error: null })
  return q
}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: () => makeQuery(ROWS) }),
}))

import { getFunnelBySlug, listFunnels } from "@/lib/db/funnels"

beforeEach(() => { captured = [] })

describe("funnels DAL is tenant-scoped", () => {
  it("getFunnelBySlug returns tenant A's row for a slug both tenants own", async () => {
    const f = await getFunnelBySlug(A, "free-guide")
    expect(f?.id).toBe("f1")
  })

  it("getFunnelBySlug returns tenant B's row for the same slug", async () => {
    // THE PERMISSIVE CONTROL. Without it, a predicate hard-coded to A passes
    // the test above and every absence assertion below.
    const f = await getFunnelBySlug(B, "free-guide")
    expect(f?.id).toBe("f2")
  })

  it("filters on business_id with the VALUE it was given, not merely some value", async () => {
    // MUTANT: `.eq("business_id", A)` hard-coded, or `.eq("id", businessId)`.
    // Asserting only that .eq was called would survive both.
    await getFunnelBySlug(B, "free-guide")
    expect(captured).toContainEqual({ col: "business_id", val: B })
  })

  it("listFunnels returns only the named tenant's funnels", async () => {
    expect((await listFunnels(A)).map((f) => f.id)).toEqual(["f1"])
    expect((await listFunnels(B)).map((f) => f.id)).toEqual(["f2"])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run __tests__/lib/db/funnels-tenancy.test.ts
```
Expected: FAIL — `getFunnelBySlug` takes `(slug)`, so passing `(A, "free-guide")` matches nothing.

- [ ] **Step 3: Convert all 18 readers**

The pattern, applied to every one. Before:

```ts
export async function getFunnelBySlug(slug: string): Promise<Funnel | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("funnels")
    .select("*")
    .ilike("slug", escapeLikePattern(slug))
    .maybeSingle()
  if (error) throw new Error(`getFunnelBySlug: ${error.message}`)
  return (data as Funnel | null) ?? null
}
```

After:

```ts
export async function getFunnelBySlug(businessId: string, slug: string): Promise<Funnel | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("funnels")
    .select("*")
    .eq("business_id", businessId)
    .ilike("slug", escapeLikePattern(slug))
    .maybeSingle()
  if (error) throw new Error(`getFunnelBySlug: ${error.message}`)
  return (data as Funnel | null) ?? null
}
```

Writers stamp the column explicitly rather than leaning on the default:

```ts
export async function createFunnel(businessId: string, input: CreateFunnelInput): Promise<Funnel> {
  // ...
  .insert({ ...row, business_id: businessId })
}
```

`getPublishedStep` passes its tenant down to `getFunnelBySlug` and filters the step and version reads on `business_id` too — a step is reachable only within the funnel's tenant.

- [ ] **Step 4: Give `createFunnel` a usable slug-collision error** *(Review Focus #4)*

Per-tenant uniqueness means `23505` is now reachable by an admin typing a slug their own tenant already uses. Mirror `SlugTakenError` from `lib/db/businesses.ts` rather than inventing a second shape:

```ts
if (error?.code === "23505") throw new SlugTakenError(input.slug)
```

Add a test asserting a `23505` from the client surfaces as `SlugTakenError` and not a bare 500.

- [ ] **Step 5: Run the tests**

```bash
npx vitest run __tests__/lib/db/funnels-tenancy.test.ts
```
Expected: PASS, all cases including the permissive control.

- [ ] **Step 6: Commit**

```bash
git add lib/db/funnels.ts __tests__/lib/db/funnels-tenancy.test.ts
git commit -m "feat(funnels): the funnels DAL reads one tenant at a time"
```

---

### Task 3: `lib/db/funnel-leads.ts` — six readers, and the embed that constrains them

**Files:**
- Modify: `lib/db/funnel-leads.ts`
- Test: `__tests__/lib/db/funnel-leads-tenancy.test.ts` (create)

**Interfaces:**
- Consumes: `business_id` (Task 1); the composite FKs (Task 1) which the embed now resolves across.
- Produces: `listLeads(businessId, filters?)`, `getQuizOutcomesForLeads(businessId, attemptIds)`, `countLeads(businessId, filters?)`, `getLead(businessId, id)`, `setLeadStatus(businessId, id, status)`, `setLeadNotes(businessId, id, notes)`. `searchClause(term)` is unchanged — it is a pure string builder.

- [ ] **Step 1: Write the failing test, including the embed shape** *(Review Focus #1)*

```ts
it("keeps the funnels/funnel_steps embed intact", async () => {
  // MUTANT: change SELECT_WITH_PAGE to plain "*". The inbox then renders every
  // row with a blank page column and no error — the exact silent-degradation
  // PGRST201 would cause if the migration had added FKs alongside.
  await listLeads(A)
  expect(capturedSelect).toContain("funnels:funnel_id (name, slug)")
  expect(capturedSelect).toContain("funnel_steps:step_id (name)")
})

it("scopes leads to one tenant", async () => {
  expect((await listLeads(A)).map((l) => l.id)).toEqual(["s1"])
  expect((await listLeads(B)).map((l) => l.id)).toEqual(["s2"]) // permissive control
})
```

- [ ] **Step 2: Run it and watch it fail** — `npx vitest run __tests__/lib/db/funnel-leads-tenancy.test.ts`

- [ ] **Step 3: Add `businessId` and the predicate to all six.** `applyFilters` gains the predicate once, at the base, so no filter combination can omit it.

- [ ] **Step 4: Run the tests** — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db/funnel-leads.ts __tests__/lib/db/funnel-leads-tenancy.test.ts
git commit -m "feat(funnels): the leads inbox reads one tenant's submissions"
```

---

### Task 4: builder, page-tree and schema-support — seven readers

**Files:**
- Modify: `lib/db/funnel-builder.ts`, `lib/db/funnel-page-tree.ts`, `lib/db/funnel-schema-support.ts`
- Test: `__tests__/lib/db/funnel-builder-tenancy.test.ts` (create)

**Interfaces:**
- Produces, verified against the files rather than guessed:
  - `funnel-builder.ts` — `getDraft(businessId, stepId)`, `appendTurn(businessId, input)`, `listTurns(businessId, stepId)`, `getTurnByRevision(businessId, stepId, revision)`, `revertToRevision(businessId, stepId, revision)`.
  - `funnel-page-tree.ts` — `getPageTree(businessId, stepId)`, `savePageTree(businessId, stepId, tree)`.
  - `funnel-schema-support.ts` — `hasIntakeColumns(businessId)`. `__resetIntakeColumnCache()` is unchanged: it resets module state for tests and touches no table.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/db/funnel-builder-tenancy.test.ts` with the same projection-aware fake as Task 2 (copy it; a shared helper across suites is a fake that can be wrong in one place and right in another):

```ts
const TURNS = [
  { id: "t1", step_id: "s1", revision: 1, business_id: A },
  { id: "t2", step_id: "s1", revision: 1, business_id: B },
]

it("listTurns returns only the asking tenant's turns for a shared step id", async () => {
  expect((await listTurns(A, "s1")).map((t) => t.id)).toEqual(["t1"])
})

it("listTurns returns tenant B's turns too", async () => {
  // The permissive control. A predicate hard-coded to A passes the case above.
  expect((await listTurns(B, "s1")).map((t) => t.id)).toEqual(["t2"])
})

it("filters on the business_id VALUE it was given", async () => {
  // MUTANT: `.eq("business_id", A)`, or `.eq("step_id", businessId)`. Asserting
  // only that .eq was called survives both.
  await listTurns(B, "s1")
  expect(captured).toContainEqual({ col: "business_id", val: B })
})

it("getTurnByRevision will not reach across tenants for a revision number", async () => {
  // Revisions restart per step, so the same (step_id, revision) pair exists in
  // both tenants. This is the read that reverts a page; the wrong answer here
  // overwrites one coach's page with another's draft.
  expect((await getTurnByRevision(A, "s1", 1))?.id).toBe("t1")
  expect((await getTurnByRevision(B, "s1", 1))?.id).toBe("t2")
})
```

- [ ] **Step 2: Run and watch fail** — `npx vitest run __tests__/lib/db/funnel-builder-tenancy.test.ts`
- [ ] **Step 3: Convert the eight readers** (five + two + one) to the Task 2 pattern.
- [ ] **Step 4: Run — expected PASS.**
- [ ] **Step 5: Commit** — `feat(funnels): the builder and page tree read one tenant`

---

### Task 5: checkout grants and lead magnets — nine readers

**Files:**
- Modify: `lib/db/funnel-checkout-grants.ts`, `lib/db/lead-magnets.ts`
- Test: `__tests__/lib/db/lead-magnets-tenancy.test.ts` (create)

**Interfaces:**
- Produces, verified against the files:
  - `funnel-checkout-grants.ts` — `hasProcessedCheckoutSession(businessId, sessionId)`, `hasGrantedOpportunity(businessId, opportunityId)`, `recordCheckoutGrant(businessId, input)`.
  - `lead-magnets.ts` — `listLeadMagnets(businessId, opts?)`, `getLeadMagnetById(businessId, id)`, `createLeadMagnet(businessId, input)`, `updateLeadMagnet(businessId, id, input)`, `deleteLeadMagnet(businessId, id)`, `findRelevantLeadMagnet(businessId, ...)`.

**Neither table has a foreign key into the funnel tables**, so neither got a composite FK in Task 1. The predicate is the *only* scoping they have — which makes these tests the only thing standing between one coach and another's lead magnets.

**There is no `getLeadMagnetBySlug`.** Nothing reads `lead_magnets` by slug today; the slug index re-scoped in Task 1 constrains *writes* only. Do not invent a slug reader to justify it — the constraint stops two tenants colliding on a slug they each own, and that is worth having without a reader.

`findRelevantLeadMagnet` is reached from `components/marketing/blog/LeadMagnetBlock.tsx`, which is **public**. Its tenant comes from `resolvePublicTenant()` in Task 6, not from an admin session.

- [ ] **Step 1: Write the failing tests**

```ts
it("hasProcessedCheckoutSession does not see another tenant's grant", async () => {
  // Stripe session ids are globally unique, so this cannot collide by accident
  // today. It is scoped anyway: the day grants are read to decide whether
  // somebody already paid, answering from another tenant's row is the kind of
  // wrong answer that hands out a product for free.
  expect(await hasProcessedCheckoutSession(A, "cs_1")).toBe(true)
  expect(await hasProcessedCheckoutSession(B, "cs_1")).toBe(false)
})

it("listLeadMagnets returns each tenant only its own", async () => {
  expect((await listLeadMagnets(A)).map((m) => m.id)).toEqual(["m1"])
  expect((await listLeadMagnets(B)).map((m) => m.id)).toEqual(["m2"]) // permissive control
})

it("findRelevantLeadMagnet filters on the business_id VALUE", async () => {
  await findRelevantLeadMagnet(B, { tags: ["speed"] })
  expect(captured).toContainEqual({ col: "business_id", val: B })
})
```

- [ ] **Step 2: Run and watch fail** — `npx vitest run __tests__/lib/db/lead-magnets-tenancy.test.ts`
- [ ] **Step 3: Convert the nine.**
- [ ] **Step 4: Run — expected PASS.**
- [ ] **Step 5: Commit** — `feat(funnels): checkout grants and lead magnets carry a tenant`

---

### Task 6: the public surfaces resolve Host, then slug

**Files:**
- Modify: `app/(funnel)/go/[slug]/[[...step]]/page.tsx`, `app/api/funnels/submit/route.ts`, `app/api/funnels/preview-submit/route.ts`, `app/api/funnels/checkout/route.ts`, `app/og/funnel/[slug]/[[...step]]/route.tsx`, `app/sitemap.ts`, `components/marketing/blog/LeadMagnetBlock.tsx`
- Test: `__tests__/app/funnel-go-tenancy.test.tsx` (create)

**Interfaces:**
- Consumes: `getPublishedStep(businessId, ...)` (Task 2), `resolvePublicTenant()` (existing).

- [ ] **Step 1: Write the failing tests** *(Review Focus #5)*

```ts
it("serves tenant A's funnel on tenant A's host", async () => {
  findBusinessIdByHost.mockResolvedValue(A)
  await Page({ params: Promise.resolve({ slug: "free-guide", step: [] }) })
  expect(getPublishedStep).toHaveBeenCalledWith(A, "free-guide", undefined)
})

it("404s a slug that belongs to another tenant", async () => {
  // Not a "wrong tenant" page: telling an anonymous visitor that a page exists
  // but belongs to somebody else is a disclosure, not a courtesy.
  findBusinessIdByHost.mockResolvedValue(A)
  getPublishedStep.mockResolvedValue(null) // B owns this slug, A does not
  await expect(Page({ params: Promise.resolve({ slug: "b-only", step: [] }) })).rejects.toThrow(
    "NEXT_HTTP_ERROR_FALLBACK;404",
  )
})

it("still serves the platform's funnel on an unclaimed host", async () => {
  // MUTANT: make an unresolved host 404. Every preview deploy and every
  // *.vercel.app URL then serves nothing, and the failure looks like a broken
  // funnel rather than a tenancy decision.
  findBusinessIdByHost.mockResolvedValue(null)
  const res = await Page({ params: { slug: "free-guide" } })
  expect(res).not.toBeNull()
})
```

- [ ] **Step 2: Run and watch fail.**
- [ ] **Step 3: Thread `await resolvePublicTenant()` into each public caller.**

`app/api/quiz/submit/route.ts` already has a `businessId` from the attempt — pass that one. Do **not** add a `platformBusinessId()` call there; the inventory test fails if you do.

- [ ] **Step 4: Run — expected PASS.**
- [ ] **Step 5: Commit** — `feat(funnels): a public funnel page belongs to the host that asked for it`

---

### Task 7: admin routes and the one cron with no session

**Files:**
- Modify: the 20 `app/api/admin/funnels/*`, `app/api/admin/lead-magnets/*` and `app/(admin)/admin/{funnels,pages,lead-magnets}/*` callers; `app/api/admin/internal/funnel-window/route.ts`
- Test: `__tests__/api/admin/funnels-tenancy.test.ts`, `__tests__/api/admin/internal/funnel-window-tenancy.test.ts` (create)

**Interfaces:**
- Consumes: `resolveAdminTenantForRequest(req)` (existing), `listBusinesses()` from `lib/db/businesses.ts`.

- [ ] **Step 1: Write the failing test for the cron** *(Review Focus #3)*

```ts
it("closes expired funnels for EVERY business, not just one", async () => {
  // MUTANT: resolve a single tenant here. A second tenant's expired camp page
  // then stays published forever, and the cron reports success every night.
  listBusinesses.mockResolvedValue([{ id: A }, { id: B }])
  await POST(authedRequest())
  expect(listFunnels).toHaveBeenCalledWith(A)
  expect(listFunnels).toHaveBeenCalledWith(B)
})
```

The cron iterates businesses rather than resolving one. It has no session and no Host, but its job is every tenant's expired funnels — the pipeline reconciler already does exactly this, and a `platformBusinessId()` seam here would be wrong rather than merely conservative.

- [ ] **Step 2: Run and watch fail.**
- [ ] **Step 3: Thread `resolveAdminTenantForRequest(req)` into every admin route; make the cron loop over `listBusinesses()`.**
- [ ] **Step 4: Name the resolved tenant in the funnels list empty state** — per spec D7, so "no funnels" cannot be misread as "they vanished".
- [ ] **Step 5: Run — expected PASS.**
- [ ] **Step 6: Commit** — `feat(funnels): admin funnel screens scope to the selected tenant`

---

### Task 8: unfreeze `loadCatalogues()`

**Files:**
- Modify: `lib/funnels/sections/resolve.ts`, `lib/funnels/preview-render.ts`, `app/api/admin/funnels/steps/[stepId]/build/route.ts`, `app/api/admin/funnels/steps/[stepId]/publish/route.ts`, `app/(admin)/admin/funnels/[id]/edit/**`
- Test: `__tests__/lib/funnels/load-catalogues-tenancy.test.ts` (create)

**Interfaces:**
- Produces: `loadCatalogues(businessId)`.

- [ ] **Step 1: Write the failing test**

```ts
it("offers only the asking tenant's events to the builder", async () => {
  // THE BUG THIS CLOSES, quoted from lib/tenancy/platform.ts: the builder and
  // the publish gate validated an event CTA against a platform-only catalogue
  // while the live page resolved a real per-host tenant — so the day a second
  // tenant published a funnel with an event CTA, both passed and the live
  // render was silent absence.
  const cat = await loadCatalogues(B)
  expect(cat.events.map((e) => e.id)).toEqual(["event-b"])
})
```

- [ ] **Step 2: Run and watch fail.**
- [ ] **Step 3: Add the parameter and thread it through the six call sites.**
- [ ] **Step 4: Run — expected PASS.**
- [ ] **Step 5: Commit** — `feat(funnels): the builder validates against its own tenant's catalogue`

---

### Task 9: retire the seams

**Files:**
- Modify: `lib/tenancy/platform.ts`, `lib/db/funnels.ts` (the `listPublishedFunnelSteps` comment)
- Test: `__tests__/lib/tenancy/platform-inventory.test.ts` (existing — must stay green)

- [ ] **Step 1: Run the inventory test first, to see it green before touching it.**
- [ ] **Step 2: Remove `loadCatalogues()` from the frozen list**, and the paragraph recording the builder/gate/live-render disagreement — the disagreement is resolved by Task 8, and a note claiming a live bug that no longer exists is worse than no note.
- [ ] **Step 3: Replace the `SINGLETON`-in-all-but-name comment** in `listPublishedFunnelSteps` with the predicate it asks for. The comment says *"When `funnels` becomes tenant-scoped this reader needs the predicate"* — this is that moment.
- [ ] **Step 4: Re-measure the constant count** and confirm it has not risen:

```bash
git grep -l SINGLETON_BUSINESS_ID -- '*.ts' '*.tsx' | grep -v '^__tests__/\|/__tests__/\|^scripts/' | wc -l
```
Expected: 5, unchanged.

- [ ] **Step 5: Run the inventory test — expected PASS.**
- [ ] **Step 6: Commit** — `refactor(tenancy): the funnel subsystem leaves the seam inventory`

---

### Task 10: prove it against a real second tenant

**Files:**
- Create: `scripts/verify-funnel-tenancy.ts` (dev clone only)
- Create: `docs/handoff/2026-09-24-g31-two-tenant-verification.md`

**THE DEV CLONE, NEVER PRODUCTION.** `.env.local` points at `anjvztjiokcgiyhobknq`. `.env.prod` exists and is real; this task must not touch it.

- [ ] **Step 1: Create a second business in the clone** via `createBusiness()` — not a raw insert, so its `business_settings`, `booking_hosts` and owner membership are created the way a real tenant's are.
- [ ] **Step 2: Give it a funnel whose slug collides with a platform funnel**, a published step and a version. The collision is the point: it is illegal before Task 1 and legal after.
- [ ] **Step 3: Add a `business_domains` row** for a host you can send in a header.
- [ ] **Step 4: Drive each surface and record the answer:**
  - `/go/<shared-slug>` with tenant A's host → A's page.
  - Same path with tenant B's host → B's page.
  - Same path with an unclaimed host → the platform's page, not a 404.
  - `/admin/funnels` as each tenant → only that tenant's rows.
  - The leads inbox → renders, with the page column populated (**the PGRST201 check**).
  - The builder's event CTA catalogue → only the asking tenant's events.
- [ ] **Step 5: Write the findings up** in the handoff doc — what was driven, what answered, and anything that surprised you. A run that found nothing is still worth recording, because the next person will otherwise repeat it.
- [ ] **Step 6: Commit** — `test(funnels): drive the tenancy split against a real second tenant`

---

## Gates before handing back

- [ ] Targeted suites for every file touched, named individually.
- [ ] `npx tsc --noEmit` — per-file error SET identical to `.claude/baselines/tsc-ce6f2aba-perfile.txt`.
- [ ] `npm run build` — exit 0.
- [ ] `git log` checked for attribution lines after every commit.
- [ ] **Do NOT push or merge.** Two pushes are owed, in order: Task 1's migration alone, then everything else. Both are the owner's to trigger.
