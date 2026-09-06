# Tenancy phase 5a — events become per-tenant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `events` and `event_signups` a `business_id`, and give every reader of either a tenant predicate, so a coach's host serves their own camps and clinics instead of the platform's.

**Architecture:** One migration adds the column to both tables (carried through the deploy race by a `DEFAULT` this branch deliberately does not drop), binds the child to its parent with a composite FK, makes `events.slug` unique per business, and gives the two signup RPCs a tenant argument. The DAL then takes `businessId` as its first parameter on every function, matching `lib/db/quizzes.ts`. Public surfaces get their tenant from `resolvePublicTenant()`, admin surfaces from `resolveAdminTenant()`, the Stripe webhook from the signup row it already reads.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres via PostgREST, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-06-tenancy-phase5a-events-per-tenant-design.md` — read §3 and §9 before starting. The plan argues from the spec; where they disagree, the spec wins and you report the divergence.

## Global Constraints

Every task's requirements implicitly include all of these.

- **Node:** run `source ~/.nvm/nvm.sh && nvm use` before ANY `npx`/`npm`/`node` command. Nothing auto-switches Node here; the machine default is 20.11.1, on which vitest reports a worker crash as "no tests" — visually identical to passing.
- **Never write `SINGLETON_BUSINESS_ID` inline in TypeScript.** Its production count is exactly 5 and must stay 5. If something genuinely cannot resolve a tenant, call `platformBusinessId()` from `lib/tenancy/platform.ts` and add an honest entry to the correct shelf saying WHICH KIND of seam it is.
- **Two boundaries, no third.** Public/unauthenticated → `resolvePublicTenant()` (`lib/tenancy/public.ts`). Admin/staff session → `resolveAdminTenant()` or `resolveAdminTenantForRequest(req)` (`lib/tenancy/resolve.ts`). These two files never import each other.
- **Tests assert WHICH tenant, then mutate.** Mock the boundary to a sentinel that is NOT the platform id — `"host-biz"` for public, `"admin-biz"` for admin. Assert that exact value reaches the DAL. Never `expect.any(String)`. Then hard-code the platform id in the file under test and confirm the test fails; record that you ran it. A test that only proves "a value came back" proves nothing.
- **No Claude attribution** anywhere — not in commit messages, code comments, or docs.
- **Do NOT push or merge.** Migrations auto-apply to production on push to main.
- **Never mutate production data.** `.env.local` points at the DEV CLONE (`anjvztjiokcgiyhobknq`). Production is a different project.
- **zsh:** `for x in $LIST` runs ONCE with the whole list as `$x`; `cmd $FILES` gets one 4KB filename. Use literal lists, `${=VAR}`, or `xargs`.
- **Classify by the matching LINE (`grep -n`), never `grep -l`** — a file that merely mentions a symbol in a comment is not a caller.
- **Strip ANSI before counting anything in a vitest log:** `sed 's/\x1b\[[0-9;]*m//g'`.
- **Targeted tests only.** Run the suites covering your change plus `npm run build` where the task says so. Do NOT run the full suite; it is justified only at the end, by the branch owner.
- **`npm run lint` is broken repo-wide** (Next 16 removed `next lint`). Prettier and tsc are the gates.
- **Prettier:** never reformat a file you did not otherwise change. ~78 test files fail `--check` repo-wide and specs/plans in `docs/` are not prettier-formatted (the phase-4 spec fails too). Before blaming yourself: `git show HEAD:<file> | npx prettier --check --stdin-filepath <file>`.
- **The plan is a sketch; the codebase wins.** If a signature here does not match reality, follow reality and REPORT the divergence in your task report. Do not force the plan's shape.

## Baselines — do not blame these on yourself

- `npx tsc --noEmit` = EXACTLY 251 errors on `origin/main` @ `322a9f93`. Baseline file (outside the repo, it DOES exist): `/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/tsc-base-full-singleton-removal-2026-09-05.txt`. Compare the SET, normalising line numbers:
  ```bash
  npx tsc --noEmit 2>&1 | grep -E "error TS" | sort > /tmp/after.txt
  diff <(sed -E 's/\([0-9]+,[0-9]+\)//' "/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/tsc-base-full-singleton-removal-2026-09-05.txt" | sort) \
       <(sed -E 's/\([0-9]+,[0-9]+\)//' /tmp/after.txt | sort)
  ```
- Full `npx vitest run`: 937 files, 9067 tests, ALL GREEN, ~56s. **Red baseline is ZERO** — if something fails, you broke it.

## SIX EVENT SUITES HIT THE DEV CLONE LIVE — read this before Task 2

Only `__tests__/integration/**` is excluded from the default vitest run. These suites do NOT mock `@/lib/supabase` and write real rows to the dev clone on every run:

`__tests__/db/events.test.ts` · `__tests__/db/event-signups.test.ts` · `__tests__/api/admin/events.test.ts` · `__tests__/api/admin/events-signups.test.ts` · `__tests__/api/events/signup.test.ts` · `__tests__/lib/events/ensure-priced.test.ts`

Consequences: (1) **Task 1's migration must be applied to the dev clone before Task 2**, or these fail on a schema that has no `business_id`. (2) They are genuine integration coverage of the composite FK and the per-tenant slug constraint — use them, do not mock them away. (3) Grep their output for PostgREST codes (`22P02`, `42P01`, `23503`, `23505`, `PGRST116`, `PGRST201`); a green run will not tell you a mock was incomplete.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `supabase/migrations/00252_events_business_id.sql` | schema + both RPCs, one file | 1 |
| `types/database.ts` | `Event.business_id`, `EventSignup.business_id` | 1 |
| `lib/db/events.ts` | 8 functions, `businessId` first | 2 |
| `lib/db/event-signups.ts` | 6 scoped, 2 deliberately unscoped + documented | 3 |
| `app/(marketing)/{camps,clinics}/page.tsx`, `.../[slug]/page.tsx` | public list + detail | 4 |
| `app/(marketing)/{camps,clinics}/[slug]/success/page.tsx`, `components/funnels/islands/EventIsland.tsx` | public post-purchase + funnel island | 5 |
| `app/api/events/[id]/{signup,checkout}/route.ts`, `lib/events/checkout.ts` | public writes | 6 |
| `app/(admin)/admin/events/**`, `app/api/admin/events/**`, `app/(admin)/admin/marketing/faqs/page.tsx` | admin | 7 |
| `app/api/stripe/webhook/route.ts`, `lib/analytics/sections/bookings.ts`, `lib/events/ensure-priced.ts`, `app/api/funnels/{submit,preview-submit}/route.ts`, `lib/funnels/sections/resolve.ts` | shared readers | 8 |
| `lib/lead-engine/chat/facts.ts`, `lib/db/bookkeeping.ts`, `lib/tenancy/platform.ts` | direct `.from()` readers + the shelf | 9 |

---

### Task 1: Migration + types

**Files:**
- Create: `supabase/migrations/00252_events_business_id.sql`
- Modify: `types/database.ts:1320-1346` (`Event`), `types/database.ts:1348+` (`EventSignup`)

**Interfaces:**
- Consumes: nothing.
- Produces: `events.business_id`, `event_signups.business_id`, constraint `events_business_id_slug_key`, RPCs `confirm_event_signup(p_signup_id uuid, p_business_id uuid)` and `cancel_event_signup(p_signup_id uuid, p_business_id uuid)`, and the TS fields `Event.business_id: string` / `EventSignup.business_id: string`.

- [ ] **Step 1: Confirm 00252 is still free**

```bash
cd "/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete-tenancy-phase5a"
git fetch origin
for b in $(git branch -r --format='%(refname:short)' | grep -v HEAD); do
  printf '%-50s ' "$b"; git ls-tree --name-only "$b" supabase/migrations/ 2>/dev/null | sed 's|.*/||' | sort | tail -1
done
```
Expected: no branch has a `00252_*`. If one does, take the next free number and say so in your report. Migration numbers collide silently and git merges the collision clean.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/00252_events_business_id.sql`. Match `00251`'s comment style: explain the race and the load-bearing choices, because the next reader will otherwise "tidy" them.

```sql
-- supabase/migrations/00252_events_business_id.sql
-- Tenancy phase 5a: events and their signups carry a tenant.
--
-- THE RACE. On push to main this applies while Vercel is still building.
-- Old code + new schema: createEvent inserts no business_id, and the DEFAULT
-- below is what keeps that insert from failing 23502. New code + old schema
-- cannot happen (the code ships after the migration in every ordering that
-- matters here, and a missing column fails loudly rather than silently).
--
-- THE DEFAULT MUST OUTLIVE THIS DEPLOY. Dropping it belongs in a LATER
-- branch, once every writer stamps business_id explicitly. It cannot be
-- dropped in a second migration in THIS branch: the migration Action applies
-- every pending migration in one run, so the default would never exist during
-- the window it was added for.
--
-- NOT NULL is safe immediately because Postgres applies a non-volatile
-- default to existing rows without a table rewrite, so the existing events and
-- signups are backfilled by the ADD COLUMN itself. No separate backfill.

alter table public.events
  add column business_id uuid not null
    default '00000000-0000-0000-0000-000000000001'
    references public.businesses(id);

-- Sole purpose: be the target of event_signups' composite FK below. Postgres
-- requires a unique constraint on the referenced columns.
alter table public.events
  add constraint events_id_business_id_key unique (id, business_id);

-- Per-tenant slugs. Two coaches both wanting /camps/summer-camp is the first
-- day of the second tenant, not an edge case. Case-sensitivity is unchanged
-- from events_slug_key deliberately; funnels uses lower(slug) and reconciling
-- the two is a separate change, not one to smuggle into a tenancy migration.
alter table public.events drop constraint events_slug_key;
alter table public.events
  add constraint events_business_id_slug_key unique (business_id, slug);

create index events_business_status_end_idx
  on public.events (business_id, status, end_date);

alter table public.event_signups
  add column business_id uuid not null
    default '00000000-0000-0000-0000-000000000001';

-- A signup's tenant cannot drift from its event's: the pair must exist in
-- events. This is why events_id_business_id_key above exists.
alter table public.event_signups
  add constraint event_signups_event_business_fkey
    foreign key (event_id, business_id)
    references public.events (id, business_id);

-- REQUIRED, not tidy-up. PostgREST picks an embed by finding THE foreign key
-- between two tables; with both this and the composite FK above it answers
-- PGRST201 ("more than one relationship was found") instead of rows, breaking
-- lib/db/bookkeeping.ts's income read and a functions/ admin tool that embed
-- events from event_signups. Verified on the dev clone 2026-09-06: the embed
-- resolves across the composite FK alone, and fails PGRST201 with both
-- present. The composite FK implies this one (events.id is the primary key),
-- so dropping it loses no integrity.
alter table public.event_signups drop constraint event_signups_event_id_fkey;

-- The two signup RPCs gain a tenant argument. DROP first: CREATE OR REPLACE
-- cannot change a signature, and adding an argument would create an OVERLOAD,
-- leaving the unguarded one-argument version callable — which is the whole
-- hole this closes. No TypeScript predicate reaches inside a plpgsql body, so
-- the argument is the only thing that can enforce the tenant here.
drop function if exists public.confirm_event_signup(uuid);
drop function if exists public.cancel_event_signup(uuid);

create function public.confirm_event_signup(p_signup_id uuid, p_business_id uuid)
returns jsonb
language plpgsql
security definer
as $function$
declare
  v_signup event_signups%rowtype;
  v_capacity int;
  v_signup_count int;
begin
  select * into v_signup from event_signups
   where id = p_signup_id and business_id = p_business_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_signup.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;

  select capacity, signup_count into v_capacity, v_signup_count
  from events where id = v_signup.event_id for update;

  if v_signup_count >= v_capacity then
    return jsonb_build_object('ok', false, 'reason', 'at_capacity');
  end if;

  update event_signups set status = 'confirmed', updated_at = now() where id = p_signup_id;
  update events set signup_count = signup_count + 1, updated_at = now() where id = v_signup.event_id;

  return jsonb_build_object('ok', true);
end;
$function$;

create function public.cancel_event_signup(p_signup_id uuid, p_business_id uuid)
returns jsonb
language plpgsql
security definer
as $function$
declare
  v_signup event_signups%rowtype;
  v_was_confirmed boolean;
begin
  select * into v_signup from event_signups
   where id = p_signup_id and business_id = p_business_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_signup.status not in ('pending', 'confirmed') then
    return jsonb_build_object('ok', false, 'reason', 'not_cancellable');
  end if;

  v_was_confirmed := v_signup.status = 'confirmed';

  update event_signups set status = 'cancelled', updated_at = now() where id = p_signup_id;

  if v_was_confirmed then
    update events set signup_count = signup_count - 1, updated_at = now() where id = v_signup.event_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$function$;
```

- [ ] **Step 3: Apply it to the DEV clone (standing instruction) and prove each part**

Apply via the `supabase` MCP (`apply_migration`, project `anjvztjiokcgiyhobknq`), or psql against the dev URL. NOT production.

Then verify — do not assume:

```sql
-- 1. columns exist and are NOT NULL with the default
select table_name, column_name, is_nullable, column_default
from information_schema.columns
where table_schema='public' and column_name='business_id'
  and table_name in ('events','event_signups');

-- 2. exactly ONE fk from event_signups to events
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid='public.event_signups'::regclass and contype='f';

-- 3. the slug constraint is per-business
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid='public.events'::regclass and contype='u';

-- 4. the RPCs take two arguments and the one-arg forms are GONE
select proname, pg_get_function_arguments(oid) from pg_proc
where proname in ('confirm_event_signup','cancel_event_signup');
```

Expected: (1) both `NO` nullable with the platform default; (2) exactly one FK, the composite one; (3) `events_business_id_slug_key UNIQUE (business_id, slug)` present and `events_slug_key` absent; (4) exactly two rows, each `p_signup_id uuid, p_business_id uuid`.

- [ ] **Step 4: Prove the embed still resolves (the spec's load-bearing assumption)**

```bash
KEY=$(grep -E '^SUPABASE_SERVICE_ROLE_KEY' .env.local | sed 's/^[^=]*=//' | tr -d '"'"'"'')
URL=$(grep -E '^NEXT_PUBLIC_SUPABASE_URL' .env.local | sed 's/^[^=]*=//' | tr -d '"'"'"'')
curl -s "${URL}/rest/v1/event_signups?select=id,events(title,type)&limit=1" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```
Expected: `[]` or a row — **anything except `PGRST201`**. If you see `PGRST201`, the drop in Step 2 did not take; fix it before continuing. (`[]` is a valid pass: the dev clone may have no signups. The point is the absence of the ambiguity error.)

- [ ] **Step 5: Add the type fields**

In `types/database.ts`, add `business_id: string` to `Event` (after `id`) and to `EventSignup` (after `event_id`). Both are NOT NULL in the schema, so neither is optional and neither is nullable.

- [ ] **Step 6: tsc**

```bash
source ~/.nvm/nvm.sh && nvm use
npx tsc --noEmit 2>&1 | grep -E "error TS" | sort > /tmp/after-t1.txt
diff <(sed -E 's/\([0-9]+,[0-9]+\)//' "/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/tsc-base-full-singleton-removal-2026-09-05.txt" | sort) \
     <(sed -E 's/\([0-9]+,[0-9]+\)//' /tmp/after-t1.txt | sort)
```
Expected: adding two required fields to types the DAL casts into may surface NEW errors in fixture-building test files. That is information, not failure — record the exact new lines in your report; later tasks fix them. It must NOT be a wall of app-code errors; if it is, stop and report.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/00252_events_business_id.sql types/database.ts
git commit -m "feat(tenancy): events and event_signups carry business_id

Migration 00252. The DEFAULT carries old code through the deploy race and
must survive this branch; dropping it is a later one. event_signups is bound
to its event by a composite FK so its tenant cannot drift, which is why
events gains UNIQUE (id, business_id). events.slug becomes unique per
business. event_signups_event_id_fkey is dropped because two FKs between the
same tables make PostgREST embeds ambiguous. Both signup RPCs are dropped and
recreated with a tenant argument — CREATE OR REPLACE cannot change a
signature, and an overload would leave the unguarded version callable."
```

---

### Task 2: `lib/db/events.ts` — `businessId` first

**Files:**
- Modify: `lib/db/events.ts` (all 8 exported functions)
- Test: `__tests__/db/events.test.ts` (LIVE DB — see the warning above)

**Interfaces:**
- Consumes: `Event.business_id` from Task 1.
- Produces, exactly:
  - `getEvents(businessId: string, filters?: EventListFilters): Promise<Event[]>`
  - `getPublishedEvents(businessId: string, filters?: { type?: EventType; from?: Date }): Promise<Event[]>`
  - `getEventById(businessId: string, id: string): Promise<Event | null>`
  - `getEventBySlug(businessId: string, slug: string): Promise<Event | null>`
  - `createEvent(businessId: string, input: CreateEventInput): Promise<Event>`
  - `updateEvent(businessId: string, id: string, input: UpdateEventInput): Promise<Event>`
  - `setEventStatus(businessId: string, id: string, status: EventStatus): Promise<Event>`
  - `deleteEvent(businessId: string, id: string, opts?: DeleteEventOptions): Promise<void>`

- [ ] **Step 1: Write the failing test**

Add to `__tests__/db/events.test.ts`. This suite runs against the dev clone, so use a real second business id. Read one that is not the platform:

```ts
// at the top of the new describe block
const OTHER_BUSINESS = "<pick a real non-platform business id from the dev clone>"
const PLATFORM = "00000000-0000-0000-0000-000000000001"
```
Get one with:
```sql
select id, name from businesses where id <> '00000000-0000-0000-0000-000000000001' limit 3;
```

```ts
it("does not return another business's event by id or slug", async () => {
  const slug = `tenancy-${randomUUID()}`
  const event = await createEvent(PLATFORM, {
    type: "clinic", slug, title: "T", summary: "S", description: "D",
    focus_areas: [], audience: [], location_name: "L", capacity: 10,
    status: "draft", start_date: new Date(Date.now() + 864e5).toISOString(),
    end_date: null, price_dollars: null,
  } as never)
  createdIds.push(event.id)

  expect(await getEventById(PLATFORM, event.id)).not.toBeNull()
  expect(await getEventById(OTHER_BUSINESS, event.id)).toBeNull()
  expect(await getEventBySlug(PLATFORM, slug)).not.toBeNull()
  expect(await getEventBySlug(OTHER_BUSINESS, slug)).toBeNull()
})

it("stamps the business on create", async () => {
  const slug = `tenancy-${randomUUID()}`
  const event = await createEvent(PLATFORM, { /* same shape as above */ } as never)
  createdIds.push(event.id)
  expect(event.business_id).toBe(PLATFORM)
})

it("allows the same slug in two businesses", async () => {
  const slug = `shared-${randomUUID()}`
  const a = await createEvent(PLATFORM, { /* ... slug ... */ } as never)
  const b = await createEvent(OTHER_BUSINESS, { /* ... same slug ... */ } as never)
  createdIds.push(a.id, b.id)
  expect(a.slug).toBe(b.slug)
  expect(a.business_id).not.toBe(b.business_id)
})
```

Match the existing fixture shape in that file exactly — copy the object literal from the suite's first test rather than inventing fields; the validator types are strict and `as never` is only there to keep this plan readable, not as a licence to skip real typing. If the real fixture needs different fields, follow reality.

- [ ] **Step 2: Run it and watch it fail**

```bash
source ~/.nvm/nvm.sh && nvm use
npx vitest run __tests__/db/events.test.ts 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tail -30
```
Expected: FAIL — `createEvent` takes 1 argument, not 2.

- [ ] **Step 3: Implement**

In `lib/db/events.ts`, add `businessId: string` as the first parameter of all 8 functions and:

- `getEvents`, `getPublishedEvents`: add `.eq("business_id", businessId)` to the query chain.
- `getEventById`, `getEventBySlug`: add `.eq("business_id", businessId)` alongside the existing `.eq()`.
- `createEvent`: add `business_id: businessId` to the `base` object.
- `updateEvent`: add `.eq("business_id", businessId)` to the update chain, AND fix its internal `getEventById(id)` call to `getEventById(businessId, id)`.
- `setEventStatus`: its internal `getEventById(id)` → `getEventById(businessId, id)`, and `updateEvent(id, …)` → `updateEvent(businessId, id, …)`.
- `deleteEvent`: internal `getEventById(id)` → `getEventById(businessId, id)`, and add `.eq("business_id", businessId)` to the delete chain.

Put a short doc comment on `getEventBySlug` recording WHY the predicate is load-bearing:

```ts
/**
 * SCOPED BY businessId, and not merely defensively. `events.slug` is unique
 * per business since 00252, so two businesses may hold the same slug; this
 * ends in `.maybeSingle()`, which answers PGRST116 on more than one row.
 * Without the predicate the per-tenant constraint turns a wrong-tenant read
 * into a crash.
 */
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run __tests__/db/events.test.ts 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tail -30
```
Expected: PASS. Also grep that output for `22P02 42P01 23503 23505 PGRST116 PGRST201` — none should appear.

- [ ] **Step 5: Mutation-check**

Temporarily replace `businessId` with the literal platform id inside `getEventBySlug`'s predicate. Re-run. The "does not return another business's event" test MUST fail. Revert. Record in your report that you ran it and what it printed.

- [ ] **Step 6: Commit**

```bash
git add lib/db/events.ts __tests__/db/events.test.ts
git commit -m "feat(tenancy): events DAL takes businessId first

All 8 functions scoped, matching lib/db/quizzes.ts. getEventBySlug's
predicate is load-bearing rather than defensive: slugs are unique per
business since 00252, and maybeSingle() answers PGRST116 on two rows."
```

Note: tsc will now report errors at every call site. That is expected and Tasks 4-9 fix them. Do NOT fix call sites here.

---

### Task 3: `lib/db/event-signups.ts` — 6 scoped, 2 documented as unscoped

**Files:**
- Modify: `lib/db/event-signups.ts`
- Test: `__tests__/db/event-signups.test.ts` (LIVE DB)

**Interfaces:**
- Consumes: Task 1's column + RPC signatures; Task 2's `createEvent(businessId, …)` for fixtures.
- Produces:
  - `getSignupsForEvent(businessId: string, eventId: string): Promise<EventSignup[]>`
  - `getSignupById(businessId: string, id: string): Promise<EventSignup | null>`
  - `createSignup(businessId: string, eventId: string, input: CreateSignupDbInput, signupType: SignupType, waiver?: WaiverAcceptance, tracking?: SignupTracking): Promise<EventSignup>`
  - `confirmSignup(businessId: string, id: string): Promise<ConfirmResult>`
  - `cancelSignup(businessId: string, id: string): Promise<CancelResult>`
  - `listSignupsCreatedSince(businessId: string, since: Date): Promise<EventSignup[]>`
  - UNCHANGED: `getEventSignupByStripeSessionId(sessionId: string)`, `getEventSignupByPaymentIntent(piId: string)`
  - NEW in Task 8, not here: `getSignupTenantById(id: string): Promise<string | null>` — Task 8 adds it; do not add it now.

- [ ] **Step 1: Write the failing test**

```ts
it("does not return another business's signup", async () => {
  // create an event + signup under PLATFORM using the suite's existing helpers
  expect(await getSignupById(PLATFORM, signup.id)).not.toBeNull()
  expect(await getSignupById(OTHER_BUSINESS, signup.id)).toBeNull()
})

it("refuses to confirm another business's signup", async () => {
  const result = await confirmSignup(OTHER_BUSINESS, signup.id)
  expect(result).toEqual({ ok: false, reason: "not_found" })
})

it("rejects a signup whose business disagrees with its event", async () => {
  await expect(
    createSignup(OTHER_BUSINESS, platformEventId, validInput, "free"),
  ).rejects.toMatchObject({ code: "23503" })
})
```

The third test is the composite FK doing its job — it is the whole argument for the column over inheritance, so it must be pinned.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run __tests__/db/event-signups.test.ts 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tail -30
```

- [ ] **Step 3: Implement**

- `getSignupsForEvent`: add `.eq("business_id", businessId)` to BOTH the on-read cancellation sweep (the `.update()`) and the `.select()`. The sweep is a WRITE; leaving it unscoped would let one tenant's read mutate another's rows.
- `getSignupById`: add the predicate.
- `createSignup`: add `business_id: businessId` to the insert object.
- `confirmSignup` / `cancelSignup`: pass `p_business_id: businessId` to the `.rpc()` call.
- `listSignupsCreatedSince`: add the predicate.
- The two Stripe-keyed readers: leave the bodies alone, add this doc comment to each (adapt the id name):

```ts
/**
 * DELIBERATELY NOT SCOPED BY businessId. A Stripe checkout-session id is
 * issued by Stripe and globally unique, so it names exactly one signup and
 * cannot be guessed into another tenant's rows — the id IS the authorisation.
 * Adding a tenant argument here would be theatre: every caller would have to
 * invent one, and the two that exist (the success page and the webhook) have
 * no better answer than the row itself.
 *
 * Its CALLERS still check: the camps/clinics success pages compare the
 * returned row's business_id against the host's resolved business and 404 on
 * a mismatch, so this cannot be used to display another tenant's customer.
 *
 * An unscoped reader with a written argument is a decision; an unscoped
 * reader without one is a defect. Do not delete this comment to "clean up".
 */
```

- [ ] **Step 4: Run the test** — expect PASS, and grep for PostgREST codes as in Task 2.

- [ ] **Step 5: Mutation-check** — hard-code the platform id in `getSignupById`'s predicate; the "another business's signup" test must fail. Revert. Report it.

- [ ] **Step 6: Commit**

```bash
git add lib/db/event-signups.ts __tests__/db/event-signups.test.ts
git commit -m "feat(tenancy): event-signups DAL takes businessId first

Six functions scoped, including getSignupsForEvent's on-read cancellation
sweep — that is a WRITE, and an unscoped one lets one tenant's read mutate
another's rows. The two Stripe-keyed lookups stay unscoped with the argument
written down; their callers check the row's tenant instead."
```

---

### Task 4: Public list and detail pages

**Files:**
- Modify: `app/(marketing)/camps/page.tsx`, `app/(marketing)/clinics/page.tsx`, `app/(marketing)/camps/[slug]/page.tsx`, `app/(marketing)/clinics/[slug]/page.tsx`
- Test: `__tests__/app/marketing/camps-clinics-tenancy.test.tsx` (create)

**Interfaces:**
- Consumes: Task 2's `getPublishedEvents(businessId, filters)`, `getEventBySlug(businessId, slug)`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

Create `__tests__/app/marketing/camps-clinics-tenancy.test.tsx` with `// @vitest-environment jsdom` on line 1 ONLY if it renders; if it just calls the page function and asserts on mocks, leave it as `node` (the default). Prefer node.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  getPublishedEvents: vi.fn(async (..._a: unknown[]) => [] as unknown[]),
  getEventBySlug: vi.fn(async (..._a: unknown[]) => null as unknown),
}))
vi.mock("@/lib/db/events", () => ({
  getPublishedEvents: (...a: unknown[]) => mocks.getPublishedEvents(...a),
  getEventBySlug: (...a: unknown[]) => mocks.getEventBySlug(...a),
}))
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: async () => "host-biz" }))

beforeEach(() => { vi.resetAllMocks(); mocks.getPublishedEvents.mockResolvedValue([]) })

describe("camps list is scoped to the host's business", () => {
  it("passes the host business to getPublishedEvents", async () => {
    const { default: Page } = await import("@/app/(marketing)/camps/page")
    await Page({} as never)
    expect(mocks.getPublishedEvents).toHaveBeenCalledWith("host-biz", { type: "camp" })
  })
})
```

Note `vi.resetAllMocks()`, not `clearAllMocks` — leaked `*Once` implementations cross test boundaries and misattribute failures. Re-arm default return values in `beforeEach`.

These pages have other imports (analytics, layout components) that will need mocking. Add mocks until the import graph is satisfied; if the page turns out to be impractical to invoke directly, assert on the DAL call through a thinner seam and SAY SO in your report rather than weakening the assertion to `expect.any(String)`.

- [ ] **Step 2: Run it and watch it fail** — `getPublishedEvents` called with `{type:"camp"}` only.

- [ ] **Step 3: Implement**

In each of the four pages: `import { resolvePublicTenant } from "@/lib/tenancy/public"`, call `const businessId = await resolvePublicTenant()` before the read, and thread it in.

`camps/[slug]/page.tsx` and `clinics/[slug]/page.tsx` ALREADY call `resolvePublicTenant()` for consent wording — reuse that existing variable, do not resolve twice.

**Also in the two `[slug]` pages: DELETE `generateStaticParams` entirely.** Since phase 4 both render per request; prerendering a slug now means prerendering it for an arbitrary tenant. Leave a one-line comment where it was:

```ts
// No generateStaticParams: since phase 5a an event's slug is unique per
// business, not globally, so a slug alone does not name a page to prerender.
```

Their `generateMetadata` also calls `getEventBySlug` — thread the tenant there too. It is a separate function with its own `await resolvePublicTenant()`.

- [ ] **Step 4: Run the test** — PASS.

- [ ] **Step 5: Mutation-check** — hard-code the platform id in `camps/page.tsx`'s call; the test must fail. Revert. Report.

- [ ] **Step 6: Build and diff the route table**

```bash
npm run build 2>&1 | tee /tmp/build-t4.log | tail -40
grep -E '^[│├└ ]*[○●ƒ] ' /tmp/build-t4.log | sed 's/[0-9.]* kB//g' > /tmp/routes-t4.txt
```
Compare `/camps`, `/clinics`, `/camps/[slug]`, `/clinics/[slug]` against the pre-task build. The blast radius of a dynamic API is the RENDER TREE, not the call site — phase 4 predicted 2 routes and the build showed 7, with no log line. Report the actual diff, including any route you did not touch.

- [ ] **Step 7: Commit**

---

### Task 5: Success pages + EventIsland

**Files:**
- Modify: `app/(marketing)/camps/[slug]/success/page.tsx`, `app/(marketing)/clinics/[slug]/success/page.tsx`, `components/funnels/islands/EventIsland.tsx`
- Test: `__tests__/app/marketing/event-success-tenancy.test.ts` (create)

**Interfaces:**
- Consumes: `getEventBySlug(businessId, slug)`, `getEventById(businessId, id)`, `getEventSignupByStripeSessionId(sessionId)` (unchanged).

- [ ] **Step 1: Write the failing test**

```ts
it("404s when the signup belongs to a different business than the host", async () => {
  mocks.getEventBySlug.mockResolvedValue({ id: "e1", business_id: "host-biz", title: "T" })
  mocks.getEventSignupByStripeSessionId.mockResolvedValue({ id: "s1", business_id: "other-biz" })
  const { default: Page } = await import("@/app/(marketing)/camps/[slug]/success/page")
  await expect(
    Page({ params: Promise.resolve({ slug: "x" }), searchParams: Promise.resolve({ session_id: "cs_1" }) } as never),
  ).rejects.toThrow() // notFound() throws NEXT_NOT_FOUND
})

it("renders when the signup belongs to the host's business", async () => {
  mocks.getEventSignupByStripeSessionId.mockResolvedValue({ id: "s1", business_id: "host-biz" })
  // ... expect it not to throw
})
```

The second test is the **presence control** for the first: "it 404s" passes just as well when nothing rendered at all, so an absence assertion needs a matching presence assertion or it proves nothing.

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement**

In both success pages: resolve the tenant, pass it to `getEventBySlug`, and after reading the signup add:

```ts
// The signup was found by a Stripe session id, which carries no tenant. A
// coach's host must not be usable to display another business's customer,
// so the row's own tenant is checked against the host's here.
if (signup && signup.business_id !== businessId) notFound()
```

In `EventIsland.tsx`: resolve the tenant and pass it to `getEventById`. A funnel doc names an event id; without the predicate a funnel could embed another tenant's event.

- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Mutation-check** — delete the `!==` guard; the 404 test must fail. Revert. Report.
- [ ] **Step 6: Commit.**

---

### Task 6: Public write routes

**Files:**
- Modify: `app/api/events/[id]/signup/route.ts`, `app/api/events/[id]/checkout/route.ts`, `lib/events/checkout.ts`
- Test: `__tests__/api/events/signup.test.ts` (LIVE DB), `__tests__/api/events/checkout.test.ts` (mocked), `__tests__/api/spine/event-signup-spine.test.ts` (mocked)

**Interfaces:**
- Consumes: `getEventById(businessId, id)`, `createSignup(businessId, eventId, …)`.
- Produces: `createEventSignupCheckout` gains `businessId` as its first parameter — confirm the real current signature in `lib/events/checkout.ts:86` and keep every other parameter in place.

- [ ] **Step 1: Strengthen the existing tests**

Both routes ALREADY call `resolvePublicTenant()`. The spine suite already mocks it to `"host-biz"`. Add the missing which-tenant assertions:

```ts
expect(mocks.getEventById).toHaveBeenCalledWith("host-biz", "evt-1")
expect(mocks.createSignup.mock.calls[0][0]).toBe("host-biz")
```

The phase-4 carried-findings list names `__tests__/api/events/signup.test.ts` and `checkout.test.ts` as mocking the boundary with NO which-tenant assertion. This task closes that.

- [ ] **Step 2: Run and watch fail.**
- [ ] **Step 3: Implement** — thread the already-resolved `businessId` into `getEventById`, `createSignup`, and `createEventSignupCheckout`.
- [ ] **Step 4: Run — PASS.** Grep output for PostgREST codes; `signup.test.ts` is live against the clone.
- [ ] **Step 5: Mutation-check** — hard-code the platform id in the signup route; assertions must fail. Revert. Report.
- [ ] **Step 6: Commit.**

---

### Task 7: Admin surfaces

**Files:**
- Modify: `app/(admin)/admin/events/page.tsx`, `app/(admin)/admin/events/[id]/page.tsx`, `app/(admin)/admin/marketing/faqs/page.tsx`, `app/api/admin/events/route.ts`, `app/api/admin/events/[id]/route.ts`, `app/api/admin/events/[id]/duplicate/route.ts`, `app/api/admin/events/[id]/signups/[signupId]/route.ts`
- Test: `__tests__/api/admin/events.test.ts`, `__tests__/api/admin/events-signups.test.ts` (both LIVE DB)

**Interfaces:** consumes Tasks 2 and 3. Produces nothing downstream.

None of these seven resolves a tenant today.

- [ ] **Step 1: Write the failing tests** — mock `@/lib/tenancy/resolve` to `"admin-biz"` and assert it reaches each DAL call:

```ts
vi.mock("@/lib/tenancy/resolve", () => ({
  resolveAdminTenant: async () => ({ businessId: "admin-biz", choices: [], isOperator: true }),
  resolveAdminTenantForRequest: async () => ({ businessId: "admin-biz", choices: [], isOperator: true }),
}))
```
Check the real `ResolvedTenant` shape in `lib/tenancy/resolve.ts` and match it — a mock of a shape that does not exist compiles and lies.

- [ ] **Step 2: Run and watch fail.**
- [ ] **Step 3: Implement** — server components use `resolveAdminTenant()`; route handlers with a `Request` use `resolveAdminTenantForRequest(req)`. Destructure `businessId` and thread it in. `admin/marketing/faqs/page.tsx` calls `getPublishedEvents()` with no args — give it the admin tenant.
- [ ] **Step 4: Run — PASS**, grep for PostgREST codes.
- [ ] **Step 5: Mutation-check** on `admin/events/page.tsx`. Report.
- [ ] **Step 6: Commit.**

---

### Task 8: Shared readers

**Files:**
- Modify: `app/api/stripe/webhook/route.ts`, `lib/analytics/sections/bookings.ts` (+ its caller), `lib/events/ensure-priced.ts` (+ its one caller `app/api/admin/funnels/[id]/publish/route.ts:360`), `app/api/funnels/submit/route.ts`, `app/api/funnels/preview-submit/route.ts`, `lib/funnels/sections/resolve.ts`
- Test: `__tests__/api/stripe/webhook-events.test.ts`, plus the funnels submit suites

**Interfaces:** consumes Tasks 2 and 3.

- [ ] **Step 1: Write the failing test** — the webhook's tenant comes from the ROW, not a boundary:

```ts
it("confirms the signup under the signup row's own business", async () => {
  mocks.getSignupById.mockResolvedValue({ id: "s1", business_id: "row-biz", event_id: "e1" })
  await handleWebhook(/* checkout.session.completed naming signup s1 */)
  expect(mocks.confirmSignup).toHaveBeenCalledWith("row-biz", "s1")
})
```
`"row-biz"` is a third sentinel, distinct from `"host-biz"` and `"admin-biz"`, so a test cannot pass by accident on the wrong source.

- [ ] **Step 2: Run and watch fail.**
- [ ] **Step 3: Implement**
  - **Stripe webhook — two flows, two different answers. Both are worked out below; do not improvise.**

    `handleEventSignupRefund` (~line 1387) is already fine: it reads the row via `getEventSignupByPaymentIntent(paymentIntentId)`, so it has `signup.business_id` in hand. Pass it: `cancelSignup(signup.business_id, signup.id)`.

    `handleEventSignupCheckout` (~line 1269) is the hard one. It holds only `session.metadata.event_signup_id`. **Do NOT "fix" this by looking the row up with `getEventSignupByStripeSessionId(session.id)`** — it looks equivalent and is not. `lib/events/checkout.ts` writes `stripe_session_id` onto the row AFTER `createEventCheckoutSession` returns, so a webhook that arrives before that update lands finds nothing and silently drops the confirmation. That is a live payment being lost. Keying on the metadata id is what makes today's flow robust, and it must stay.

    Add ONE new export to `lib/db/event-signups.ts` instead:

    ```ts
    /**
     * The tenant a signup belongs to, by its id alone — DELIBERATELY UNSCOPED,
     * and narrow on purpose.
     *
     * The Stripe webhook holds `session.metadata.event_signup_id` and nothing
     * else it can trust. The row's `stripe_session_id` is written AFTER the
     * Stripe session is created (lib/events/checkout.ts), so a webhook that
     * arrives before that update lands would not find the row by session id —
     * looking it up that way would silently drop a paid confirmation.
     *
     * Returns ONLY the business id, never the row, so it cannot become a way to
     * read another tenant's customer data. The caller's next call is a scoped
     * one, which refuses if the id and tenant disagree.
     */
    export async function getSignupTenantById(id: string): Promise<string | null> {
      const supabase = getClient()
      const { data, error } = await supabase
        .from("event_signups")
        .select("business_id")
        .eq("id", id)
        .maybeSingle()
      if (error) throw error
      return (data as { business_id: string } | null)?.business_id ?? null
    }
    ```

    Then in `handleEventSignupCheckout`:

    ```ts
    const businessId = await getSignupTenantById(signupId)
    if (!businessId) {
      console.error(`[webhook event_signup] no signup ${signupId}`)
      return
    }
    const result = await confirmSignup(businessId, signupId)
    ```

    Thread the same `businessId` into `handleEventSignupOverbook` and into any `getEventByIdForSignup` call in this flow. The direct `.from("event_signups").update(...).eq("id", signupId)` writes in this file gain `.eq("business_id", businessId)` too.
  - **`lib/analytics/sections/bookings.ts`:** take `businessId` as a parameter and pass it to `listSignupsCreatedSince`; update its caller to supply the admin tenant.
  - **`lib/events/ensure-priced.ts`:** take `businessId` first; its one caller is an admin route with a session.
  - **`app/api/funnels/submit/route.ts`:** it already resolves a public tenant — thread it into `getEventById`.
  - **`app/api/funnels/preview-submit/route.ts`:** admin/staff-gated; use `resolveAdminTenantForRequest(req)`.
  - **`lib/funnels/sections/resolve.ts` (`loadCatalogues`):** pass `platformBusinessId()`. This file is ALREADY on `platform.ts`'s DELIBERATELY FROZEN shelf, so this is one more use in a listed file — do NOT add a new shelf entry, and do NOT convert it to a real tenant.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Mutation-check** the webhook: hard-code the platform id instead of `signup.business_id`; the `"row-biz"` test must fail. Revert. Report.
- [ ] **Step 6: Commit.**

---

### Task 9: The direct `.from()` readers, and the shelf

**Files:**
- Modify: `lib/lead-engine/chat/facts.ts` (`listPublicEvents`, line ~508) + its caller, `lib/db/bookkeeping.ts:321` + its caller, `lib/tenancy/platform.ts`
- Test: `__tests__/lib/lead-engine/chat-facts-tenancy.test.ts` (create), plus the existing platform/public inventory suites

**Interfaces:** `listPublicEvents(businessId: string): Promise<Fact[]>`.

These four files import no DAL, so an import-based inventory does not see them. `lib/ads/agent.ts` and `functions/src/ai/admin-tools.ts` are the other two and are deliberately NOT converted — see the spec §8.

- [ ] **Step 1: Write the failing test**

```ts
it("only offers the conversation's own business's events as chat facts", async () => {
  await listPublicEvents("host-biz")
  expect(mocks.eq).toHaveBeenCalledWith("business_id", "host-biz")
})
```
Mock the Supabase chain so `.eq` is observable, matching how sibling suites in `__tests__/lib/lead-engine/` mock it. Follow the existing pattern rather than inventing one.

- [ ] **Step 2: Run and watch fail.**

- [ ] **Step 3: Implement**
  - `listPublicEvents(businessId)`: add `.eq("business_id", businessId)`. Its caller has the conversation row, which carries `business_id` — thread that through. **This is a live public leak: without it a coach's `/ask` chat answers questions about the platform's camps.**
  - `lib/db/bookkeeping.ts:321`: add `.eq("business_id", businessId)` to the `event_signups` read; thread the admin tenant from its caller. Leave the `events(title,type)` embed exactly as-is — Task 1's FK drop is what keeps it working.
  - `lib/tenancy/platform.ts`: add `app/sitemap.ts` to the CORRECT shelf with an honest reason. It is NOT a caller that cannot resolve a tenant; it is a file whose entire output is keyed to one host, because every URL it emits is built from the `SITE_URL` constant. Giving it the request's business without the request's origin would list a coach's events at `darrenjpaul.com` — worse than today.

- [ ] **Step 4: Run the inventory tests — they are strict in BOTH directions**

```bash
npx vitest run __tests__/lib/tenancy/platform-inventory.test.ts __tests__/lib/tenancy/public-inventory.test.ts 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tail -20
```
**Do NOT name a converted file's path in shelf prose.** The reverse check rejects any path the comment names that no longer calls the seam — it bit two tasks in a row on phase 4. Describe an ex-caller without its path, or add it to `NAMED_BUT_NOT_CALLERS` with the sentence that says it is not a caller.

- [ ] **Step 5: Mutation-check** `listPublicEvents`. Report.

- [ ] **Step 6: Full verification**

```bash
source ~/.nvm/nvm.sh && nvm use
npx tsc --noEmit 2>&1 | grep -E "error TS" | sort > /tmp/after-final.txt
diff <(sed -E 's/\([0-9]+,[0-9]+\)//' "/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/tsc-base-full-singleton-removal-2026-09-05.txt" | sort) \
     <(sed -E 's/\([0-9]+,[0-9]+\)//' /tmp/after-final.txt | sort)
git grep -l SINGLETON_BUSINESS_ID HEAD -- '*.ts' '*.tsx' | sed "s/^HEAD://" | grep -v '^__tests__/\|/__tests__/\|^scripts/'
npm run build 2>&1 | tail -40
```
Expected: tsc SET identical to baseline; the `SINGLETON_BUSINESS_ID` list is exactly the 5 known files; build green.

- [ ] **Step 7: Commit.**

---

## Self-review notes (author)

- **Spec coverage:** §3.1 → Task 1. §3.2 → out of branch by design, named in Task 1's migration comment. §3.3 → Task 1. §3.4 → Task 2. §3.5 → Task 3. §3.6 public → Tasks 4-6; admin → Task 7; shared → Task 8; direct readers → Task 9. §3.7 → Task 9. §5.1 (`generateStaticParams`) → Task 4 step 3 + route-table diff at step 6. §7 → the mutation step in every task.
- **Task 8's Stripe webhook was the plan's weak point and is now resolved in-plan.** The circularity (a webhook whose only handle is a signup id, calling a DAL that now demands a tenant) is settled by a narrow `getSignupTenantById`. The trap that resolution avoids is recorded inline: looking the row up by `stripe_session_id` instead LOOKS equivalent but races the write in `lib/events/checkout.ts` and would silently drop paid confirmations. Verified by reading that file, not assumed.
- **Deliberately unconverted, and it must stay visible:** `lib/ads/agent.ts` (frozen subsystem) and `functions/src/ai/admin-tools.ts` (cannot import `lib/`; a real PII leak the day a second tenant exists — spec §8 gives it a deadline rather than an open deferral).
