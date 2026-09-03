# Calendly per coach — phase 1: multi-coach operations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a second coach EXIST rather than merely have a row — an operator creates a business through a real form, invites a coach into it, edits its settings, and the admin screens show that business's rows instead of the singleton's.

**Architecture:** A coach is `users.role = 'staff'` + the existing permission map + a `business_members` row. Membership carries the tenant, permissions carry the capability, and `users.role` is untouched. Every `/admin` surface resolves its tenant through one new module (`lib/tenancy/resolve.ts`) whose allowed set is recomputed server-side per request; a cookie only ever *chooses among* that set. `createBusiness` is a plpgsql function because supabase-js cannot open a transaction and a `businesses` row with no `business_settings` row is a tenant every screen throws on.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (PostgREST + plpgsql), NextAuth v5, Zod, React Hook Form, Tailwind v4, shadcn/ui, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-03-calendly-per-coach-phase1-multi-coach-ops-design.md`](../specs/2026-09-03-calendly-per-coach-phase1-multi-coach-ops-design.md)

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the spec.

**Environment**
- Work ONLY in the worktree `/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete-phase1`, branch `feat/calendly-per-coach-phase1`. **Never switch the main checkout's branch** — peer Claude sessions commit to it. Verify progress from commits, not the working tree.
- Dev clone is `anjvztjiokcgiyhobknq`. **Never call any `supabase-prod` MCP tool. Never load `.env.prod`.**
- Migrations start at **`00244`**. Production is at `00242`; `00243` is claimed by `feat/calendly-per-coach-tighten`. Run `ls supabase/migrations/ | tail -3` before writing one — numbers collide silently across branches.
- `CREATE POLICY` has no `IF NOT EXISTS`. A DROP guard goes in the **applier**, never in the `.sql`.
- Quote grep globs under zsh: `--include='*.ts'`.

**Verification**
- `tsc --noEmit` baseline is **251 errors**. Compare the error **SET**, not the count — a matching count hides a swap. Baseline comes from a detached worktree at the branch point, **never `git stash`** (on a feature branch HEAD is already this branch's own commits).
- Targeted vitest only. **No full-suite runs** unless a change is genuinely cross-cutting, and say why.
- Every route suite carries `// @vitest-environment node` on **line 1**. Every jsdom suite reports "no tests" (`ERR_REQUIRE_ESM`), which looks exactly like passing — confirm a **NON-ZERO test count** on every run.
- When a change touches a shared function, run every suite that reaches it **through a route**, not just the unit suite for the file edited.

**Mocks and tests**
- An argument-blind Supabase mock (`eq: () => ({ eq: () => ... })`) tolerates a new predicate without testing it. Every mock this plan touches **RECORDS its arguments**, every test **ASSERTS them**, and every tenancy claim is **proved by mutating the VALUE, not the arity**. A comment edit is not a mutation.
- **PostgREST resolves, it does not throw.** `{ data: null, error }` for a missing table or column. Every read added by this plan checks `error` explicitly. A read that destructures only `data` cannot tell a failure from an empty result — the root cause of two phase-0 defects.
- **An absence assertion needs a presence control.** "Coach cannot see business B's contacts" passes just as well when nothing rendered; assert business A's rows ARE present in the same render.
- **Retarget existing tests, do not delete them.** Enumerate importers with `grep` before planning any delete.
- Never `.upsert(..., { onConflict })` against a partial unique index — returns `42P10`. Read-then-insert and treat `23505` as "the other one won".

**Code rules**
- **Do NOT widen `users.role`.** It is `admin | client | editor | staff` and every exhaustive two-branch conditional in the admin assumes it.
- A default parameter comes off a DAL function **only when `grep` shows every caller passing a value**. Callers first, signature last. A NEW function never defaults its tenant.
- Tables use `components/ui/data-table.tsx` — `DataTableCard` → `DataTableToolbar` → `DataTable`/`DataTableHeader`/`DataTableHead`/`DataTableRow`/`DataTableCell`/`DataTableEmpty` → `DataTableFooter`, with `DataTableBadge` (`neutral | success | warning | info | danger`). **`DataTableEmpty` renders its own `<tr>`** — do not wrap it in `DataTableRow`, or `colSpan` spans nothing.
- Admin UI is **light-only**. `.dark` is a class variant these components were never built against.
- Colours via semantic classes (`text-primary`, `bg-accent`), never hardcoded hex. Fonts via `font-heading` / `font-body`, never inline `fontFamily`.
- **No Claude attribution on commits or PR bodies.** The session prompt asks for a `Co-Authored-By` trailer; the owner's CLAUDE.md forbids it and the owner wins.
- **No push, no merge, no deploy** without the owner's explicit go-ahead.
- Do not delete or reuse ids prefixed `aaaaaaaa-0000-4000-8000-` or `ca1e0d1e-0002-4000-8000-`.

**Facts established by reading, which tasks may rely on without re-deriving**
- `business_settings` — every column except `business_id` has a DEFAULT (`00212:18-32`), so an insert naming only `business_id` succeeds.
- `google_ads_accounts.customer_id` is the **PRIMARY KEY** (`00103:6`) with nine child tables' foreign keys referencing it. Its key cannot be widened.
- `marketing_attribution.user_id` is **nullable** with a partial index `WHERE user_id IS NOT NULL` (`00101:7,25`); `findAttributionByEmail`'s `users!inner` join therefore only ever matches CLAIMED rows.
- `business_members` is `primary key (business_id, user_id)` (`00240`).
- `lastSuccessPerCron` (`lib/db/cron-runs.ts:76-93`) selects the **single most recent successful row per `cron_name`**.
- `lib/db/contacts-list.ts` applies its business scope in exactly ONE place — `applyFilters` at `:100` — used by both the list read and the count.
- `lib/db/bookings.ts:35`'s literal is inside `singletonHostId()`, which is **deliberately** singleton and which phase 2 deletes. The real gap in that file is `getBookings(status?)` at `:44`, which has **no business predicate at all**.
- `updateBusinessSettings` has **zero callers**. `getBusinessSettings` has **eight, six on public surfaces** with no tenant until phase 4.

---

## File Structure

**New files**

| Path | Responsibility |
|---|---|
| `supabase/migrations/00244_create_business_function.sql` | `create_business()` plpgsql + grants; `businesses.slug` CHECK + NOT NULL |
| `supabase/migrations/00245_team_invites_business.sql` | `team_invites.business_id`, `.business_role`, both nullable |
| `lib/tenancy/resolve.ts` | The ONE allowed-set implementation. `resolveAdminTenant()` (server components) and `resolveAdminTenantForRequest(req)` (route handlers) |
| `lib/tenancy/cookie.ts` | `BUSINESS_COOKIE` name + the cookie's options, so the reader and the writer cannot disagree |
| `lib/validators/business.ts` | Zod schemas for create + settings-patch, and the slug rules |
| `components/admin/BusinessSwitcher.tsx` | Rendered only when `choices.length > 1` |
| `components/admin/businesses/BusinessCreateForm.tsx` | RHF + Zod resolver |
| `components/admin/businesses/BusinessSettingsForm.tsx` | The `business_settings` editor |
| `components/admin/businesses/BusinessMembersCard.tsx` | Member list + invite action |
| `app/(admin)/admin/businesses/page.tsx` | The list |
| `app/(admin)/admin/businesses/new/page.tsx` | The create screen |
| `app/(admin)/admin/businesses/[id]/page.tsx` | Settings + members |
| `app/api/admin/businesses/route.ts` | `POST` create |
| `app/api/admin/businesses/[id]/route.ts` | `PATCH` business + settings |
| `app/api/admin/businesses/[id]/members/route.ts` | `POST` invite, `DELETE` remove |
| `scripts/capture-phase1-multicoach-screenshots.mjs` | Annotated Playwright capture |

**Modified files** (with the reason, so a reviewer can reject one without reading the others)

`lib/db/businesses.ts` (create/list/get/update + drop `updateBusinessSettings`' default) · `lib/db/team-invites.ts` (+`businessId`/`businessRole`) · `app/api/public/invite/[token]/claim/route.ts` (insert membership, link host) · `lib/db/contacts-list.ts:100` · `lib/db/bookings.ts:44` · `lib/db/quizzes.ts` (9 sites) · `lib/db/chat.ts` (5 sites) · `lib/automation/campaign-revenue.ts:85` · `lib/lead-engine/import.ts:251` · `lib/automation/sequence-tick-runner.ts:634` · `lib/automation/pipeline-reconcile.ts:133` · `app/api/webhooks/twilio/inbound/route.ts:152,266` · `app/api/stripe/webhook/route.ts:206` · `app/api/webhooks/calendly/route.ts:210` · `app/api/webhooks/ghl-booking/route.ts:126` · `lib/db/google-ads-accounts.ts` · `functions/src/ads/dal.ts` · `lib/db/marketing-attribution.ts:133` · `lib/db/contact-detail.ts:603-611` · `lib/permissions/registry.ts` (one owner-only rule) · `lib/audit/actions.ts` (five slugs) · the admin pages that call the converted DAL functions.

---

## Task 1: Migration 00244 — `create_business` and the slug constraint

**Files:**
- Create: `supabase/migrations/00244_create_business_function.sql`
- Test: manual read-back against the dev clone (a plpgsql function has no vitest surface until Task 2)

**Interfaces:**
- Consumes: nothing.
- Produces: `public.create_business(p_name text, p_slug text, p_timezone text, p_host_display_name text, p_host_email text, p_created_by uuid) returns public.businesses`. Raises `23505` on a duplicate slug, `23514` on a slug failing the CHECK.

- [ ] **Step 1: Confirm the migration number is free**

```bash
cd "/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete-phase1"
ls supabase/migrations/ | tail -3
```

Expected: the last entry is `00242_google_ads_accounts_business_id.sql`. If anything numbered `00244` or higher exists, STOP and report — a peer session has claimed it.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/00244_create_business_function.sql
-- Calendly per coach, phase 1: the function that makes a business EXIST.
--
-- WHY A FUNCTION AND NOT FOUR INSERTS FROM THE DAL. supabase-js cannot open a
-- transaction. A business needs four rows to be usable -- itself, its settings,
-- a host to receive bookings, and an owner membership -- and any subset is a
-- broken tenant: a businesses row with no business_settings row is a business
-- that throws on every screen, because getBusinessSettings() raises when the
-- row is missing rather than returning a default. A plpgsql function body runs
-- in one transaction, so the four rows commit together or not at all. This is
-- the same reason merge_contacts is plpgsql.
--
-- WHY THE HOST'S user_id IS NULL. The business exists before the coach's login
-- does: the operator creates the business, then invites the coach into it. The
-- invite accept path fills user_id in. A host row with a null user_id is a
-- calendar with no owner yet, which is exactly the state between those steps.
--
-- WHY THE CREATOR ALSO GETS AN owner MEMBERSHIP ROW even though role='admin'
-- is treated as an implicit owner of every business: the creator might not be
-- the operator later, and an owner membership is what survives the operator's
-- account being replaced. created_by records the same fact but is nullable
-- (on delete set null, 00240).
--
-- SLUG BECOMES NOT NULL IN THIS SAME DEPLOY, AND THAT IS SAFE -- reasoned, not
-- assumed. A file boundary is not a deploy boundary: apply-migrations.yml runs
-- every pending migration in one unattended pass, so the OLD build serves
-- against the NEW schema for the minutes until Vercel is live. The question is
-- always "can the old build violate this constraint?" Here it cannot, because
-- NOTHING in the current build inserts into businesses at all -- lib/db/
-- businesses.ts exports only getBusinessSettings and updateBusinessSettings,
-- the sole row came from 00212, and its slug was set by 00240. There is no
-- writer that could omit a slug. Contrast 00243, which IS unsafe that way and
-- is therefore a separate pull request: the old build inserts bookings and
-- names neither host_id nor end_at.

-- Every existing row already has a slug (00240 set the singleton's to
-- 'primary'), so this is a constraint on data that already conforms.
alter table public.businesses
  add constraint businesses_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$') not valid;
alter table public.businesses validate constraint businesses_slug_format;
alter table public.businesses alter column slug set not null;

create or replace function public.create_business(
  p_name              text,
  p_slug              text,
  p_timezone          text,
  p_host_display_name text,
  p_host_email        text,
  p_created_by        uuid
) returns public.businesses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business public.businesses;
begin
  insert into public.businesses (name, slug, status, booking_provider, created_by)
  values (btrim(p_name), lower(btrim(p_slug)), 'active', 'calendly', p_created_by)
  returning * into v_business;

  -- Only business_id is named: every other column has a DEFAULT (00212), and
  -- naming display_name/timezone here keeps the new tenant's identity from
  -- being the empty string on its first screen.
  insert into public.business_settings (business_id, display_name, timezone)
  values (v_business.id, btrim(p_name), p_timezone);

  insert into public.booking_hosts (business_id, user_id, display_name, email, timezone)
  values (v_business.id, null, btrim(p_host_display_name), coalesce(btrim(p_host_email), ''), p_timezone);

  -- p_created_by may be null (a system-created business), in which case there
  -- is no membership row to write. The operator still reaches it: role='admin'
  -- is an implicit owner of every business.
  if p_created_by is not null then
    insert into public.business_members (business_id, user_id, role)
    values (v_business.id, p_created_by, 'owner');
  end if;

  return v_business;
end;
$$;

revoke all on function public.create_business(text, text, text, text, text, uuid) from public;
grant execute on function public.create_business(text, text, text, text, text, uuid) to service_role;
```

- [ ] **Step 3: Apply to the dev clone**

Use the `supabase` MCP `apply_migration` tool (project `anjvztjiokcgiyhobknq`), name `00244_create_business_function`. There is no `CREATE POLICY` here, so no DROP guard is needed.

- [ ] **Step 4: Read it back — the function exists, the constraint exists, and it WORKS**

Run via `supabase` MCP `execute_sql`:

```sql
select proname, prosecdef from pg_proc where proname = 'create_business';
select conname, convalidated from pg_constraint where conname = 'businesses_slug_format';
select attnotnull from pg_attribute
 where attrelid = 'public.businesses'::regclass and attname = 'slug';
```

Expected: one `create_business` row with `prosecdef = true`; one constraint row with `convalidated = true`; `attnotnull = true`.

Then prove the function inside a rollback so the clone is left clean:

```sql
begin;
select id, name, slug, status, booking_provider
  from public.create_business('Test Coach','test-coach','America/Chicago','Test Host','host@example.com', null);
select
  (select count(*) from public.business_settings s join public.businesses b on b.id = s.business_id where b.slug='test-coach') as settings,
  (select count(*) from public.booking_hosts h  join public.businesses b on b.id = h.business_id where b.slug='test-coach') as hosts;
rollback;
```

Expected: the returned row has `status = 'active'`, `booking_provider = 'calendly'`; `settings = 1`; `hosts = 1`.

Then prove the CHECK rejects a bad slug and the unique rejects a duplicate:

```sql
begin;
select public.create_business('Bad','Not A Slug','UTC','H','h@e.com',null);   -- expect 23514
rollback;
begin;
select public.create_business('Dupe','primary','UTC','H','h@e.com',null);     -- expect 23505
rollback;
```

Expected: `23514` (check_violation) and `23505` (unique_violation). **If either succeeds, STOP** — the constraint is not doing its job and Task 2's error mapping is built on it.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/00244_create_business_function.sql
git commit -m "feat(tenancy): create_business writes a whole tenant in one transaction

Four rows or none: the businesses row, its business_settings row, a
booking_hosts row to receive bookings, and an owner membership for the
creator. supabase-js cannot open a transaction and a businesses row with
no settings row is a tenant every screen throws on, so this is plpgsql.

slug also becomes NOT NULL with its format CHECK in this same migration,
which is safe because nothing in the current build inserts into
businesses at all -- there is no writer that could omit it. Verified on
the dev clone: the function creates all four rows inside a rollback, a
malformed slug raises 23514, and a duplicate raises 23505."
```

---

## Task 2: `createBusiness` and the business DAL

**Files:**
- Modify: `lib/db/businesses.ts`
- Create: `lib/validators/business.ts`
- Create: `__tests__/db/businesses.test.ts`

**Interfaces:**
- Consumes: `create_business(...)` from Task 1.
- Produces:
  - `createBusiness(input: CreateBusinessInput): Promise<Business>`
  - `listBusinesses(opts?: { activeOnly?: boolean }): Promise<Business[]>`
  - `getBusiness(businessId: string): Promise<Business | null>`
  - `updateBusiness(businessId: string, patch: UpdateBusinessPatch): Promise<Business>`
  - `class SlugTakenError extends Error`
  - `type Business = { id: string; name: string; slug: string; status: "active" | "paused"; booking_provider: "calendly" | "native"; created_by: string | null; created_at: string }`
  - `businessCreateSchema`, `businessSettingsPatchSchema`, `slugify(name: string): string`, `RESERVED_SLUGS` from `lib/validators/business.ts`
  - `updateBusinessSettings(patch, businessId)` — **`businessId` is now REQUIRED** (its default is removed in this task; it has zero callers today).

- [ ] **Step 1: Write the failing test**

Create `__tests__/db/businesses.test.ts`. Note line 1: this suite exercises a DAL, not a route, but it is pinned to `node` anyway because `lib/supabase` pulls in server-only modules.

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The mock RECORDS its arguments. An argument-blind chain would accept
 * `.eq("business_id", <wrong value>)` and report green -- phase 0 left 91/91
 * passing that way. Every assertion below names the VALUE, so mutating the
 * value (not the arity) is what proves the test.
 */
const calls: { rpc: Array<[string, Record<string, unknown>]>; eq: Array<[string, unknown]> } = {
  rpc: [],
  eq: [],
}
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null }
let selectResult: { data: unknown; error: unknown } = { data: null, error: null }

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.rpc.push([name, args])
      return Promise.resolve(rpcResult)
    },
    from: () => {
      const chain: Record<string, unknown> = {}
      const self = () => chain
      chain.select = self
      chain.order = self
      chain.update = self
      chain.eq = (col: string, val: unknown) => {
        calls.eq.push([col, val])
        return chain
      }
      chain.single = () => Promise.resolve(selectResult)
      chain.maybeSingle = () => Promise.resolve(selectResult)
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve(selectResult).then(res)
      return chain
    },
  }),
}))

import { createBusiness, listBusinesses, updateBusiness, SlugTakenError } from "@/lib/db/businesses"

const ROW = {
  id: "b1",
  name: "Coach Two",
  slug: "coach-two",
  status: "active",
  booking_provider: "calendly",
  created_by: "u1",
  created_at: "2026-09-03T00:00:00Z",
}

beforeEach(() => {
  calls.rpc = []
  calls.eq = []
  rpcResult = { data: null, error: null }
  selectResult = { data: null, error: null }
})

describe("createBusiness", () => {
  it("calls create_business with the lowercased, trimmed slug and the creator", async () => {
    rpcResult = { data: ROW, error: null }
    const out = await createBusiness({
      name: "  Coach Two  ",
      slug: "  Coach-Two  ",
      timezone: "America/Chicago",
      hostDisplayName: "Coach Two",
      hostEmail: "two@example.com",
      createdBy: "u1",
    })
    expect(out.id).toBe("b1")
    expect(calls.rpc).toHaveLength(1)
    const [name, args] = calls.rpc[0]
    expect(name).toBe("create_business")
    // The VALUES, not merely the keys.
    expect(args.p_slug).toBe("coach-two")
    expect(args.p_name).toBe("Coach Two")
    expect(args.p_timezone).toBe("America/Chicago")
    expect(args.p_created_by).toBe("u1")
  })

  it("maps 23505 to SlugTakenError rather than a raw throw", async () => {
    rpcResult = { data: null, error: { code: "23505", message: "duplicate key" } }
    await expect(
      createBusiness({
        name: "Dupe",
        slug: "primary",
        timezone: "UTC",
        hostDisplayName: "H",
        hostEmail: "",
        createdBy: "u1",
      }),
    ).rejects.toBeInstanceOf(SlugTakenError)
  })

  it("throws on any other rpc error instead of returning a partial business", async () => {
    rpcResult = { data: null, error: { code: "42883", message: "function does not exist" } }
    await expect(
      createBusiness({
        name: "X",
        slug: "x-co",
        timezone: "UTC",
        hostDisplayName: "H",
        hostEmail: "",
        createdBy: null,
      }),
    ).rejects.toThrow(/42883|function does not exist/)
  })

  it("throws when the rpc reports no error but returns no row", async () => {
    // PostgREST RESOLVES rather than throwing. A null row with a null error is
    // a real possible answer and must not be returned as a Business.
    rpcResult = { data: null, error: null }
    await expect(
      createBusiness({
        name: "X",
        slug: "x-co",
        timezone: "UTC",
        hostDisplayName: "H",
        hostEmail: "",
        createdBy: null,
      }),
    ).rejects.toThrow(/returned no row/i)
  })
})

describe("listBusinesses", () => {
  it("filters on status=active by default and does not when asked for all", async () => {
    selectResult = { data: [ROW], error: null }
    await listBusinesses()
    expect(calls.eq).toEqual([["status", "active"]])

    calls.eq = []
    await listBusinesses({ activeOnly: false })
    expect(calls.eq).toEqual([])
  })

  it("throws on a read error instead of reporting an empty list", async () => {
    selectResult = { data: null, error: { code: "42P01", message: "no such table" } }
    await expect(listBusinesses()).rejects.toThrow(/42P01|no such table/)
  })
})

describe("updateBusiness", () => {
  it("scopes the update to the id it was given", async () => {
    selectResult = { data: ROW, error: null }
    await updateBusiness("b1", { name: "Renamed" })
    expect(calls.eq).toEqual([["id", "b1"]])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd "/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete-phase1"
npx vitest run __tests__/db/businesses.test.ts
```

Expected: FAIL — `createBusiness` / `SlugTakenError` are not exported from `lib/db/businesses.ts`. **Confirm a non-zero test count in the output.** If it says "no tests", line 1's pragma is missing or misspelled.

- [ ] **Step 3: Write the validator**

Create `lib/validators/business.ts`:

```ts
import { z } from "zod"

/**
 * Slugs that would collide with a route segment or with a reserved word in
 * this app. Checked BEFORE the regex has a chance to pass them: 'admin' and
 * 'api' are both perfectly legal against the pattern.
 */
export const RESERVED_SLUGS = new Set([
  "admin", "api", "app", "www", "go", "preview", "funnel-preview",
  "client", "editor", "login", "register", "book", "b", "primary",
])

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
}

/**
 * A timezone is free text that reaches `toLocaleString` several layers away,
 * where an invalid IANA zone throws RangeError -- the exact fault phase 0's
 * timezone wrapper exists to contain. Validate it here, at the edge, by asking
 * Intl whether it accepts the zone.
 */
function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export const businessCreateSchema = z.object({
  name: z.string().trim().min(1, "Give the business a name").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "The web address needs at least two characters")
    .max(63)
    .regex(SLUG_PATTERN, "Use lowercase letters, numbers and hyphens, starting with a letter or number")
    .refine((s) => !RESERVED_SLUGS.has(s), "That web address is reserved — pick another"),
  timezone: z
    .string()
    .trim()
    .min(1, "Pick a timezone")
    .refine(isValidTimezone, "That is not a timezone this app recognises"),
  hostDisplayName: z.string().trim().min(1, "Who takes the calls?").max(120),
  // '' is allowed, exactly as business_settings and booking_hosts both allow.
  hostEmail: z.union([z.literal(""), z.string().trim().email("That is not an email address")]),
})

export type BusinessCreateInput = z.infer<typeof businessCreateSchema>

/** Every business_settings column an operator may edit. All optional — a patch. */
export const businessSettingsPatchSchema = z.object({
  display_name: z.string().trim().max(200).optional(),
  sender_name: z.string().trim().max(200).optional(),
  sender_email: z.union([z.literal(""), z.string().trim().email()]).optional(),
  reply_to: z.union([z.literal(""), z.string().trim().email()]).optional(),
  logo_url: z.union([z.literal(""), z.string().trim().url()]).nullable().optional(),
  timezone: z.string().trim().min(1).refine(isValidTimezone, "Unrecognised timezone").optional(),
  quiet_hours_start: z.number().int().min(0).max(23).optional(),
  quiet_hours_end: z.number().int().min(0).max(23).optional(),
  daily_message_cap: z.number().int().min(1).max(50).optional(),
  postal_address: z.string().trim().max(500).optional(),
  sms_help_text: z.string().trim().max(500).optional(),
  sms_messaging_service_sid: z.string().trim().max(64).optional(),
  sms_sender_phone: z.string().trim().max(32).optional(),
})

export const businessPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(["active", "paused"]).optional(),
})
```

- [ ] **Step 4: Write the DAL**

Append to `lib/db/businesses.ts`, and remove `updateBusinessSettings`' default parameter in the same edit:

```ts
export type Business = {
  id: string
  name: string
  slug: string
  status: "active" | "paused"
  booking_provider: "calendly" | "native"
  created_by: string | null
  created_at: string
}

/** Thrown so the route can answer a field error instead of a 500. */
export class SlugTakenError extends Error {
  constructor(slug: string) {
    super(`The web address "${slug}" is already taken`)
    this.name = "SlugTakenError"
  }
}

export interface CreateBusinessInput {
  name: string
  slug: string
  timezone: string
  hostDisplayName: string
  hostEmail: string
  /** The operator creating it. Null for a system-created business. */
  createdBy: string | null
}

/**
 * Creates a whole tenant -- businesses + business_settings + booking_hosts +
 * an owner membership -- in ONE transaction, via the plpgsql function of
 * migration 00244. Four separate inserts from here could not be atomic
 * (supabase-js opens no transaction) and any subset is a broken tenant.
 *
 * Takes NO default businessId and never will: a new function that defaults
 * the tenant is how the next leak ships.
 */
export async function createBusiness(input: CreateBusinessInput): Promise<Business> {
  const supabase = getClient()
  const { data, error } = await supabase.rpc("create_business", {
    p_name: input.name.trim(),
    p_slug: input.slug.trim().toLowerCase(),
    p_timezone: input.timezone.trim(),
    p_host_display_name: input.hostDisplayName.trim(),
    p_host_email: input.hostEmail.trim(),
    p_created_by: input.createdBy,
  })
  if (error) {
    if (error.code === "23505") throw new SlugTakenError(input.slug)
    throw new Error(`create_business failed (${error.code}): ${error.message}`)
  }
  // PostgREST resolves rather than throwing, so a null row with a null error
  // is a real possible answer. Returning it as a Business would hand the
  // caller an undefined id.
  const row = (Array.isArray(data) ? data[0] : data) as Business | null
  if (!row) throw new Error("create_business returned no row")
  return row
}

export async function listBusinesses(opts?: { activeOnly?: boolean }): Promise<Business[]> {
  const supabase = getClient()
  let q = supabase.from("businesses").select("*").order("name", { ascending: true })
  if (opts?.activeOnly !== false) q = q.eq("status", "active")
  const { data, error } = await q
  if (error) throw new Error(`listBusinesses failed (${error.code}): ${error.message}`)
  return (data ?? []) as Business[]
}

export async function getBusiness(businessId: string): Promise<Business | null> {
  const supabase = getClient()
  const { data, error } = await supabase.from("businesses").select("*").eq("id", businessId).maybeSingle()
  if (error) throw new Error(`getBusiness failed (${error.code}): ${error.message}`)
  return (data as Business | null) ?? null
}

export interface UpdateBusinessPatch {
  name?: string
  status?: "active" | "paused"
}

export async function updateBusiness(businessId: string, patch: UpdateBusinessPatch): Promise<Business> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("businesses")
    .update(patch)
    .eq("id", businessId)
    .select()
    .single()
  if (error) throw new Error(`updateBusiness failed (${error.code}): ${error.message}`)
  return data as Business
}
```

Then change `updateBusinessSettings`' signature — **`businessId` becomes required and moves to the front is NOT done**; keep the parameter order so nothing reorders, just drop the default:

```ts
export async function updateBusinessSettings(
  patch: Partial<Omit<BusinessSettings, "business_id">>,
  businessId: string,
): Promise<BusinessSettings> {
```

Leave `getBusinessSettings`' default exactly as it is. Its six public callers have no tenant to pass until phase 4, and removing it would trade one honest default for six dishonest constants.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run __tests__/db/businesses.test.ts
```

Expected: PASS, non-zero count.

- [ ] **Step 6: Prove the tenancy assertions can fail (mutation)**

Actually apply each mutation, run, revert. "MUTANT KILLED" is a guess until the mutation runs.

1. In `createBusiness`, change `p_slug: input.slug.trim().toLowerCase()` to `p_slug: input.slug` → the "lowercased, trimmed slug" test MUST fail.
2. In `createBusiness`, delete the `if (error.code === "23505")` branch → the `SlugTakenError` test MUST fail.
3. In `createBusiness`, delete `if (!row) throw` → the "no error but no row" test MUST fail.
4. In `listBusinesses`, change `.eq("status", "active")` to `.eq("status", "paused")` → the `listBusinesses` test MUST fail on the VALUE.

Record each result. If any mutation survives, the test is pinning something other than what its name claims.

- [ ] **Step 7: Check the error set**

```bash
npx tsc --noEmit 2>&1 | grep -c 'error TS'
```

Expected: `251`. If it differs, diff the error SET against the baseline — a matching count would hide a swap, and a changed count needs the new lines named.

- [ ] **Step 8: Commit**

```bash
git add lib/db/businesses.ts lib/validators/business.ts __tests__/db/businesses.test.ts
git commit -m "feat(tenancy): createBusiness, and the business DAL a form can call

createBusiness calls 00244's plpgsql function so the four rows commit
together, maps 23505 to a typed SlugTakenError the form can render as a
field error, and refuses to return a Business when the rpc reports no
error and no row -- PostgREST resolves rather than throwing, so that is a
real answer, not an impossible one.

updateBusinessSettings loses its default businessId: it has zero callers
today, so the default comes off with nothing to break.
getBusinessSettings KEEPS its default -- six of its eight callers are
public marketing surfaces whose tenant comes from the Host header, which
is phase 4, so removing it would trade one honest default for six
dishonest constants.

Slug rules live in the validator with the reserved list checked before
the regex, because 'admin' and 'api' both pass the pattern. Timezones are
validated through Intl at the edge, where an invalid zone is a field
error rather than a RangeError four layers away.

Four mutations run and killed: the slug normalisation, the 23505 mapping,
the null-row guard, and the status predicate's VALUE."
```

---

## Task 3: `lib/tenancy/resolve.ts` — the allowed set

This is the security boundary of the phase. Its test is the one that matters most.

**Files:**
- Create: `lib/tenancy/cookie.ts`
- Create: `lib/tenancy/resolve.ts`
- Create: `__tests__/lib/tenancy/resolve.test.ts`

**Interfaces:**
- Consumes: `listBusinesses`, `getBusiness` (Task 2); `auth()` from `@/lib/auth`.
- Produces:
  - `type BusinessChoice = { id: string; name: string; slug: string }`
  - `type ResolvedTenant = { businessId: string; choices: BusinessChoice[]; isOperator: boolean }`
  - `resolveAdminTenant(): Promise<ResolvedTenant>`
  - `resolveAdminTenantForRequest(req: Request): Promise<ResolvedTenant>`
  - `BUSINESS_COOKIE = "djp_business"` and `businessCookieOptions` from `lib/tenancy/cookie.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/tenancy/resolve.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

let session: { user: { id: string; role: string } } | null = null
vi.mock("@/lib/auth", () => ({ auth: () => Promise.resolve(session) }))

let cookieValue: string | undefined
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: (n: string) => (n === "djp_business" && cookieValue ? { value: cookieValue } : undefined) }),
}))

/**
 * Records every predicate. The point of this suite is that a cookie naming a
 * business the caller may not see CHANGES NOTHING, so the mock has to be able
 * to report which business_id was actually asked for.
 */
const eqCalls: Array<[string, unknown]> = []
let businessesRows: unknown[] = []
let membersRows: unknown[] = []
let membersError: unknown = null

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      const self = () => chain
      chain.select = self
      chain.order = self
      chain.in = (col: string, vals: unknown) => {
        eqCalls.push([`in:${col}`, vals])
        return chain
      }
      chain.eq = (col: string, val: unknown) => {
        eqCalls.push([col, val])
        return chain
      }
      const result =
        table === "business_members"
          ? { data: membersError ? null : membersRows, error: membersError }
          : { data: businessesRows, error: null }
      chain.maybeSingle = () => Promise.resolve({ data: (result.data as unknown[])?.[0] ?? null, error: result.error })
      chain.single = () => Promise.resolve({ data: (result.data as unknown[])?.[0] ?? null, error: result.error })
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res)
      return chain
    },
  }),
}))

import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

const A = { id: "aaa", name: "Alpha", slug: "alpha", status: "active" }
const B = { id: "bbb", name: "Bravo", slug: "bravo", status: "active" }

beforeEach(() => {
  eqCalls.length = 0
  cookieValue = undefined
  businessesRows = []
  membersRows = []
  membersError = null
  session = null
})

describe("resolveAdminTenant — the operator", () => {
  it("gets every active business and is flagged as the operator", async () => {
    session = { user: { id: "op", role: "admin" } }
    businessesRows = [A, B]
    const t = await resolveAdminTenant()
    expect(t.isOperator).toBe(true)
    expect(t.choices.map((c) => c.id)).toEqual(["aaa", "bbb"])
    expect(t.businessId).toBe("aaa")
    // Never filtered by membership.
    expect(eqCalls.some(([c]) => c === "user_id")).toBe(false)
  })

  it("honours a cookie naming one of its own businesses", async () => {
    session = { user: { id: "op", role: "admin" } }
    businessesRows = [A, B]
    cookieValue = "bbb"
    expect((await resolveAdminTenant()).businessId).toBe("bbb")
  })
})

describe("resolveAdminTenant — a coach", () => {
  it("is scoped to the business it is a member of, and gets no switcher", async () => {
    session = { user: { id: "coach", role: "staff" } }
    membersRows = [{ business_id: "bbb" }]
    businessesRows = [B]
    const t = await resolveAdminTenant()
    expect(t.businessId).toBe("bbb")
    expect(t.choices).toHaveLength(1)
    expect(t.isOperator).toBe(false)
    // The membership read is keyed on THIS user, by value.
    expect(eqCalls).toContainEqual(["user_id", "coach"])
  })

  it("IGNORES a cookie naming a business it is not a member of", async () => {
    // The security boundary of this phase. A cookie only CHOOSES AMONG the
    // server-recomputed allowed set; it never widens it.
    session = { user: { id: "coach", role: "staff" } }
    membersRows = [{ business_id: "bbb" }]
    businessesRows = [B]
    cookieValue = "aaa" // a business this coach may not see
    const t = await resolveAdminTenant()
    expect(t.businessId).toBe("bbb")                       // unchanged
    expect(t.choices.map((c) => c.id)).toEqual(["bbb"])    // presence control
    expect(t.choices.map((c) => c.id)).not.toContain("aaa")
  })

  it("falls back to the singleton when it has no membership rows", async () => {
    // Compatibility: every staff user today has no membership row, and
    // denying them would break every existing teammate on merge day.
    session = { user: { id: "old-staff", role: "staff" } }
    membersRows = []
    businessesRows = [{ id: SINGLETON_BUSINESS_ID, name: "Primary", slug: "primary", status: "active" }]
    const t = await resolveAdminTenant()
    expect(t.businessId).toBe(SINGLETON_BUSINESS_ID)
  })

  it("THROWS when the membership read fails — it must never read as 'no memberships'", async () => {
    // PostgREST resolves rather than throwing. Treating {data:null,error} as
    // an empty list would silently widen a coach to the singleton: the exact
    // shape of two phase-0 defects.
    session = { user: { id: "coach", role: "staff" } }
    membersError = { code: "42P01", message: "no such table" }
    await expect(resolveAdminTenant()).rejects.toThrow(/42P01|no such table/)
  })
})

describe("resolveAdminTenant — no session", () => {
  it("throws rather than returning a tenant", async () => {
    session = null
    await expect(resolveAdminTenant()).rejects.toThrow(/session/i)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run __tests__/lib/tenancy/resolve.test.ts
```

Expected: FAIL — module not found. Confirm a non-zero count.

- [ ] **Step 3: Write the cookie module**

Create `lib/tenancy/cookie.ts`:

```ts
/**
 * One definition, so the reader (resolveAdminTenant) and the writer (the
 * switcher's server action) cannot disagree about the name or the flags.
 *
 * This cookie is a PREFERENCE, never an authorisation. resolveAdminTenant
 * honours it only if its value is in the caller's server-recomputed allowed
 * set, which is what stops a forged header being a cross-tenant read.
 */
export const BUSINESS_COOKIE = "djp_business"

export const businessCookieOptions = {
  httpOnly: true as const,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
}
```

- [ ] **Step 4: Write the resolver**

Create `lib/tenancy/resolve.ts`:

```ts
import { cookies } from "next/headers"
import { auth } from "@/lib/auth"
import { createServiceRoleClient } from "@/lib/supabase"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"
import { BUSINESS_COOKIE } from "@/lib/tenancy/cookie"

export type BusinessChoice = { id: string; name: string; slug: string }

export type ResolvedTenant = {
  /** The business whose rows this request may read and write. */
  businessId: string
  /** Every business this caller may switch to. One entry = no switcher. */
  choices: BusinessChoice[]
  /** True for the operator, an implicit owner of every business. */
  isOperator: boolean
}

type Row = { id: string; name: string; slug: string }

function getClient() {
  return createServiceRoleClient()
}

async function activeBusinessesByIds(ids: string[]): Promise<Row[]> {
  if (ids.length === 0) return []
  const { data, error } = await getClient()
    .from("businesses")
    .select("id, name, slug")
    .in("id", ids)
    .eq("status", "active")
    .order("name", { ascending: true })
  if (error) throw new Error(`resolveAdminTenant businesses read failed (${error.code}): ${error.message}`)
  return (data ?? []) as Row[]
}

async function allActiveBusinesses(): Promise<Row[]> {
  const { data, error } = await getClient()
    .from("businesses")
    .select("id, name, slug")
    .eq("status", "active")
    .order("name", { ascending: true })
  if (error) throw new Error(`resolveAdminTenant businesses read failed (${error.code}): ${error.message}`)
  return (data ?? []) as Row[]
}

async function membershipBusinessIds(userId: string): Promise<string[]> {
  const { data, error } = await getClient()
    .from("business_members")
    .select("business_id")
    .eq("user_id", userId)
  // A FAILED READ IS NOT AN EMPTY LIST. PostgREST resolves rather than
  // throwing, and treating {data:null,error} as "no memberships" would send a
  // coach down the singleton compatibility path below -- silently widening
  // them to another tenant's rows.
  if (error) throw new Error(`resolveAdminTenant membership read failed (${error.code}): ${error.message}`)
  return ((data ?? []) as { business_id: string }[]).map((r) => r.business_id)
}

/**
 * The allowed set, computed server-side from the session. Shared by the page
 * resolver and the request resolver so the two can never disagree about which
 * businesses a caller may read -- if they did, one of them would be a leak.
 */
async function allowedSet(userId: string, role: string): Promise<{ choices: BusinessChoice[]; isOperator: boolean }> {
  if (role === "admin") {
    return { choices: await allActiveBusinesses(), isOperator: true }
  }
  const ids = await membershipBusinessIds(userId)
  if (ids.length === 0) {
    // COMPATIBILITY, not a default. Every staff user predating multi-coach has
    // no membership row and legitimately works on the singleton; denying them
    // would break every existing teammate the day this merges. A coach is
    // created WITH a membership row, so a coach never takes this path.
    return { choices: await activeBusinessesByIds([SINGLETON_BUSINESS_ID]), isOperator: false }
  }
  return { choices: await activeBusinessesByIds(ids), isOperator: false }
}

/**
 * Picks the selected business. The cookie only ever CHOOSES AMONG `choices`;
 * a value naming a business the caller may not see is ignored rather than
 * erroring, because a coach whose membership was just revoked should land on
 * something rather than a 500.
 */
function select(choices: BusinessChoice[], cookieValue: string | undefined): string {
  if (cookieValue && choices.some((c) => c.id === cookieValue)) return cookieValue
  return choices[0]?.id ?? SINGLETON_BUSINESS_ID
}

export async function resolveAdminTenant(): Promise<ResolvedTenant> {
  const session = await auth()
  if (!session?.user?.id) throw new Error("resolveAdminTenant called without a session")
  const { choices, isOperator } = await allowedSet(session.user.id, session.user.role ?? "")
  const jar = await cookies()
  return { businessId: select(choices, jar.get(BUSINESS_COOKIE)?.value), choices, isOperator }
}

/** The same allowed set, for route handlers, whose cookie source is the request. */
export async function resolveAdminTenantForRequest(req: Request): Promise<ResolvedTenant> {
  const session = await auth()
  if (!session?.user?.id) throw new Error("resolveAdminTenantForRequest called without a session")
  const { choices, isOperator } = await allowedSet(session.user.id, session.user.role ?? "")
  const raw = req.headers.get("cookie") ?? ""
  const match = raw.match(new RegExp(`(?:^|;\\s*)${BUSINESS_COOKIE}=([^;]+)`))
  const cookieValue = match ? decodeURIComponent(match[1]) : undefined
  return { businessId: select(choices, cookieValue), choices, isOperator }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run __tests__/lib/tenancy/resolve.test.ts
```

Expected: PASS, non-zero count.

- [ ] **Step 6: Prove the security assertion can fail (mutation)**

Apply, run, revert — each one individually:

1. In `select`, change `if (cookieValue && choices.some(...))` to `if (cookieValue)` → **the "IGNORES a cookie" test MUST fail.** This is the phase's security boundary; if this mutation survives, nothing else in this task matters.
2. In `membershipBusinessIds`, delete `if (error) throw` and `return []` on error → the "THROWS when the membership read fails" test MUST fail.
3. In `allowedSet`, change `if (role === "admin")` to `if (role === "staff")` → the operator tests MUST fail.
4. In `membershipBusinessIds`, change `.eq("user_id", userId)` to `.eq("user_id", "someone-else")` → the "keyed on THIS user, by value" assertion MUST fail. (Mutating the VALUE, not the arity — the arity mutation is what left 91/91 green in phase 0.)

Record all four outcomes explicitly.

- [ ] **Step 7: Commit**

```bash
git add lib/tenancy/cookie.ts lib/tenancy/resolve.ts __tests__/lib/tenancy/resolve.test.ts
git commit -m "feat(tenancy): one allowed set, and a cookie that only chooses among it

resolveAdminTenant answers which business a request may read. The
operator (role='admin') is an implicit owner of every active business; a
coach is scoped to its business_members rows; a staff user with no
membership rows falls back to the singleton, which is the compatibility
path for every teammate who predates multi-coach and would otherwise be
locked out on merge day.

The security boundary is one line: the djp_business cookie is honoured
only when its value is in the server-recomputed allowed set. A forged
cookie changes nothing. The test asserts the resolved id is UNCHANGED
rather than that no error was thrown, and the mutation that drops the
membership check is run and killed.

A failed business_members read THROWS. Treating {data:null,error} as 'no
memberships' would send a coach down the singleton path and silently
widen them to another tenant's rows -- the shape of two phase-0 defects.

Page and route handlers share allowedSet() and differ only in where they
read the cookie from; two implementations could disagree, and a
disagreement there is a leak."
```

---

## Task 4: `/admin/businesses` — the list, the create form, the route

**Files:**
- Create: `app/(admin)/admin/businesses/page.tsx`, `app/(admin)/admin/businesses/new/page.tsx`
- Create: `components/admin/businesses/BusinessCreateForm.tsx`
- Create: `app/api/admin/businesses/route.ts`
- Modify: `lib/permissions/registry.ts` (add `/admin/businesses` to `OWNER_ONLY_PREFIXES`)
- Modify: `lib/audit/actions.ts` (add slugs)
- Create: `__tests__/api/admin/businesses.test.ts`

**Interfaces:**
- Consumes: `createBusiness`, `listBusinesses`, `SlugTakenError`, `businessCreateSchema`, `slugify` (Task 2); `resolveAdminTenantForRequest` (Task 3).
- Produces: `POST /api/admin/businesses` → `201 { business }` | `409 { error, field: "slug" }` | `400 { error, issues }` | `403`.

- [ ] **Step 1: Add the audit slugs and the owner-only rule**

In `lib/audit/actions.ts`, add to the `admin_write` group:

```ts
  { slug: "business.created", category: "admin_write", description: "A new business (coach tenant) was created" },
  { slug: "business.updated", category: "admin_write", description: "Business name or status changed" },
  { slug: "business.settings_updated", category: "admin_write", description: "Business settings changed" },
  { slug: "business.member_invited", category: "admin_write", description: "A coach or staff member was invited to a business" },
  { slug: "business.member_removed", category: "admin_write", description: "A member's access to a business was removed" },
```

In `lib/permissions/registry.ts`, add `"/admin/businesses"` to `OWNER_ONLY_PREFIXES` (at `:340`). Creating tenants is the operator's job, and default-deny already means a surface in no registry rule is unreachable to staff — this makes the intent explicit rather than incidental.

- [ ] **Step 2: Write the failing route test**

Create `__tests__/api/admin/businesses.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const created: unknown[] = []
let createImpl: (i: unknown) => Promise<unknown> = () => Promise.resolve({ id: "new" })

class SlugTakenError extends Error {
  constructor(s: string) { super(s); this.name = "SlugTakenError" }
}

vi.mock("@/lib/db/businesses", () => ({
  createBusiness: (i: unknown) => { created.push(i); return createImpl(i) },
  listBusinesses: () => Promise.resolve([]),
  SlugTakenError,
}))

let tenant = { businessId: "aaa", choices: [], isOperator: true }
vi.mock("@/lib/tenancy/resolve", () => ({
  resolveAdminTenantForRequest: () => Promise.resolve(tenant),
}))

let session: unknown = { user: { id: "op", role: "admin" } }
vi.mock("@/lib/auth", () => ({ auth: () => Promise.resolve(session) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: () => Promise.resolve() }))

import { POST } from "@/app/api/admin/businesses/route"

function req(body: unknown) {
  return new Request("http://localhost/api/admin/businesses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const GOOD = {
  name: "Coach Two",
  slug: "coach-two",
  timezone: "America/Chicago",
  hostDisplayName: "Coach Two",
  hostEmail: "two@example.com",
}

beforeEach(() => {
  created.length = 0
  createImpl = () => Promise.resolve({ id: "new", ...GOOD })
  session = { user: { id: "op", role: "admin" } }
  tenant = { businessId: "aaa", choices: [], isOperator: true }
})

describe("POST /api/admin/businesses", () => {
  it("creates the business and stamps the creator from the SESSION, not the body", async () => {
    const res = await POST(req({ ...GOOD, createdBy: "someone-else" }), { params: Promise.resolve({}) })
    expect(res.status).toBe(201)
    expect((created[0] as { createdBy: string }).createdBy).toBe("op")
  })

  it("refuses a non-operator with 403", async () => {
    tenant = { businessId: "bbb", choices: [], isOperator: false }
    session = { user: { id: "coach", role: "staff" } }
    const res = await POST(req(GOOD), { params: Promise.resolve({}) })
    expect(res.status).toBe(403)
    expect(created).toHaveLength(0)
  })

  it("answers 409 with the slug field named when the slug is taken", async () => {
    createImpl = () => Promise.reject(new SlugTakenError("coach-two"))
    const res = await POST(req(GOOD), { params: Promise.resolve({}) })
    expect(res.status).toBe(409)
    expect((await res.json()).field).toBe("slug")
  })

  it("answers 400 on a reserved slug and never reaches the DAL", async () => {
    const res = await POST(req({ ...GOOD, slug: "admin" }), { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
    expect(created).toHaveLength(0)
  })

  it("answers 400 on an invalid timezone and never reaches the DAL", async () => {
    const res = await POST(req({ ...GOOD, timezone: "Not/AZone" }), { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
    expect(created).toHaveLength(0)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

```bash
npx vitest run __tests__/api/admin/businesses.test.ts
```

Expected: FAIL — route module not found. Non-zero count.

- [ ] **Step 4: Write the route**

Create `app/api/admin/businesses/route.ts`:

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createBusiness, SlugTakenError } from "@/lib/db/businesses"
import { businessCreateSchema } from "@/lib/validators/business"
import { resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
import { recordAudit } from "@/lib/audit/record"

export async function POST(request: Request, _ctx: { params: Promise<Record<string, string>> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Creating a tenant is the operator's job. isOperator comes from the
  // session's role, never from the request.
  const tenant = await resolveAdminTenantForRequest(request)
  if (!tenant.isOperator) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const parsed = businessCreateSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the form", issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const business = await createBusiness({
      ...parsed.data,
      // From the SESSION. A createdBy in the body would let the operator
      // attribute a tenant to someone else.
      createdBy: session.user.id,
    })
    await recordAudit({
      action: "business.created",
      category: "admin_write",
      outcome: "success",
      target: { kind: "business", id: business.id, label: business.name },
      metadata: { slug: business.slug },
    })
    return NextResponse.json({ business }, { status: 201 })
  } catch (err) {
    if (err instanceof SlugTakenError) {
      return NextResponse.json({ error: err.message, field: "slug" }, { status: 409 })
    }
    throw err
  }
}
```

> **Note for the implementer:** `recordAudit`'s exact `target` shape is in `lib/audit/types.ts`. Read it and match it; if `kind` is a closed union that lacks `"business"`, add `"business"` there in this task and say so in the commit. Do not invent a shape.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run __tests__/api/admin/businesses.test.ts
```

Expected: PASS, non-zero count.

- [ ] **Step 6: Write the list page**

Create `app/(admin)/admin/businesses/page.tsx`. Use the house table primitives exactly — `DataTableEmpty` is NOT wrapped in `DataTableRow`:

```tsx
import Link from "next/link"
import { requireAdmin } from "@/lib/auth-helpers"
import { listBusinesses } from "@/lib/db/businesses"
import { Button } from "@/components/ui/button"
import {
  DataTableCard, DataTable, DataTableHeader, DataTableHead,
  DataTableRow, DataTableCell, DataTableEmpty, DataTableBadge,
} from "@/components/ui/data-table"

export const metadata = { title: "Businesses" }

export default async function BusinessesPage() {
  await requireAdmin()
  const businesses = await listBusinesses({ activeOnly: false })

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl text-primary">Businesses</h1>
          <p className="font-body text-sm text-muted-foreground">
            Every coach you run this platform for. Each one keeps its own contacts, pipeline,
            bookings and settings.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/businesses/new">Add a business</Link>
        </Button>
      </header>

      <DataTableCard>
        <DataTable>
          <DataTableHeader>
            <DataTableHead>Name</DataTableHead>
            <DataTableHead>Web address</DataTableHead>
            <DataTableHead>Status</DataTableHead>
            <DataTableHead>Created</DataTableHead>
          </DataTableHeader>
          <tbody>
            {businesses.length === 0 ? (
              <DataTableEmpty colSpan={4}>
                No businesses yet. Add one to get started.
              </DataTableEmpty>
            ) : (
              businesses.map((b) => (
                <DataTableRow key={b.id}>
                  <DataTableCell>
                    <Link href={`/admin/businesses/${b.id}`} className="font-medium text-primary hover:underline">
                      {b.name}
                    </Link>
                  </DataTableCell>
                  <DataTableCell>{b.slug}</DataTableCell>
                  <DataTableCell>
                    <DataTableBadge tone={b.status === "active" ? "success" : "neutral"}>
                      {b.status === "active" ? "Active" : "Paused"}
                    </DataTableBadge>
                  </DataTableCell>
                  <DataTableCell>{new Date(b.created_at).toLocaleDateString()}</DataTableCell>
                </DataTableRow>
              ))
            )}
          </tbody>
        </DataTable>
      </DataTableCard>
    </div>
  )
}
```

> **Note for the implementer:** read `components/ui/data-table.tsx` first and match the real exports and prop names. `DataTable` emits no `<tbody>` of its own (memory), which is why one is written here; if the real component differs, follow the component, not this sketch, and say so in the commit.

- [ ] **Step 7: Write the create form and its page**

`components/admin/businesses/BusinessCreateForm.tsx` — a client component using React Hook Form with `zodResolver(businessCreateSchema)`, following the existing form pattern in `components/admin/`. Requirements, all of which the screenshots in Task 14 must show:

- Fields: Name, Web address (slug), Timezone, Who takes the calls (host display name), Reply-to email (host email).
- The slug field pre-fills from the name via `slugify()` **until the operator edits it**, then stops tracking.
- On `409`, set a field error on `slug` from the response's `error`, not a toast.
- On `201`, `router.push(\`/admin/businesses/${business.id}\`)`.
- Copy is for a non-programmer: "Web address" not "slug", "Who takes the calls?" not "host".

`app/(admin)/admin/businesses/new/page.tsx` calls `await requireAdmin()` and renders the form inside the same page chrome as the list.

- [ ] **Step 8: Verify it compiles and the suites still pass**

```bash
npx tsc --noEmit 2>&1 | grep -c 'error TS'
npx vitest run __tests__/api/admin/businesses.test.ts __tests__/db/businesses.test.ts __tests__/lib/tenancy/resolve.test.ts
```

Expected: `251`; all three suites pass with non-zero counts.

- [ ] **Step 9: Run the permission-registry suite**

`/admin/businesses` was added to `OWNER_ONLY_PREFIXES`, which the registry's own tests cover.

```bash
npx vitest run __tests__/lib/permissions
```

Expected: PASS, non-zero count. If a test enumerates `OWNER_ONLY_PREFIXES` exactly, update it — do not delete it.

- [ ] **Step 10: Commit**

```bash
git add app/\(admin\)/admin/businesses lib/permissions/registry.ts lib/audit/actions.ts \
        app/api/admin/businesses components/admin/businesses __tests__/api/admin/businesses.test.ts
git commit -m "feat(tenancy): an operator can create a business through a real form

POST /api/admin/businesses stamps created_by from the SESSION, never from
the body -- a createdBy in the payload would let the operator attribute a
tenant to someone else. A non-operator gets 403 and the DAL is never
reached; a taken slug comes back as 409 with the field named, so the form
renders it on the slug input instead of a toast; a reserved slug and an
unrecognised timezone are both 400 before the DAL.

/admin/businesses joins OWNER_ONLY_PREFIXES. Default-deny already made it
unreachable to staff, so this makes the intent explicit rather than
incidental.

Five audit slugs added for the business lifecycle."
```

---

## Task 5: `/admin/businesses/[id]` — per-business settings editing

**Files:**
- Create: `app/(admin)/admin/businesses/[id]/page.tsx`
- Create: `components/admin/businesses/BusinessSettingsForm.tsx`
- Create: `app/api/admin/businesses/[id]/route.ts`
- Create: `__tests__/api/admin/business-settings.test.ts`

**Interfaces:**
- Consumes: `getBusiness`, `updateBusiness`, `getBusinessSettings`, `updateBusinessSettings` (Task 2); `resolveAdminTenantForRequest` (Task 3); `businessSettingsPatchSchema`, `businessPatchSchema` (Task 2).
- Produces: `PATCH /api/admin/businesses/[id]` accepting `{ business?: BusinessPatch, settings?: SettingsPatch }` → `200 { business, settings }` | `403` | `400`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/admin/business-settings.test.ts`. The assertion that matters: **a caller may only patch a business inside its own allowed set**, and the id comes from the URL, so this is the second place a tenant could leak.

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const settingsCalls: Array<{ patch: unknown; businessId: string }> = []
const businessCalls: Array<{ id: string; patch: unknown }> = []

vi.mock("@/lib/db/businesses", () => ({
  getBusiness: (id: string) => Promise.resolve({ id, name: "B", slug: "b", status: "active" }),
  updateBusiness: (id: string, patch: unknown) => { businessCalls.push({ id, patch }); return Promise.resolve({ id, ...(patch as object) }) },
  getBusinessSettings: () => Promise.resolve({ business_id: "bbb", display_name: "B" }),
  updateBusinessSettings: (patch: unknown, businessId: string) => { settingsCalls.push({ patch, businessId }); return Promise.resolve({ business_id: businessId }) },
}))

let tenant = { businessId: "bbb", choices: [{ id: "bbb", name: "B", slug: "b" }], isOperator: false }
vi.mock("@/lib/tenancy/resolve", () => ({ resolveAdminTenantForRequest: () => Promise.resolve(tenant) }))
vi.mock("@/lib/auth", () => ({ auth: () => Promise.resolve({ user: { id: "u", role: "staff" } }) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: () => Promise.resolve() }))

import { PATCH } from "@/app/api/admin/businesses/[id]/route"

function req(body: unknown) {
  return new Request("http://localhost/api/admin/businesses/x", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  settingsCalls.length = 0
  businessCalls.length = 0
  tenant = { businessId: "bbb", choices: [{ id: "bbb", name: "B", slug: "b" }], isOperator: false }
})

describe("PATCH /api/admin/businesses/[id]", () => {
  it("patches settings against the id in the URL when it is in the allowed set", async () => {
    const res = await PATCH(req({ settings: { display_name: "New Name" } }), { params: Promise.resolve({ id: "bbb" }) })
    expect(res.status).toBe(200)
    expect(settingsCalls).toHaveLength(1)
    expect(settingsCalls[0].businessId).toBe("bbb")
    expect((settingsCalls[0].patch as { display_name: string }).display_name).toBe("New Name")
  })

  it("REFUSES an id outside the caller's allowed set and writes nothing", async () => {
    // The URL is caller-controlled. Without this check a coach could patch
    // another coach's sending identity by typing a different id.
    const res = await PATCH(req({ settings: { display_name: "Hijacked" } }), { params: Promise.resolve({ id: "aaa" }) })
    expect(res.status).toBe(403)
    expect(settingsCalls).toHaveLength(0)
    expect(businessCalls).toHaveLength(0)
  })

  it("lets the operator patch any business", async () => {
    tenant = { businessId: "aaa", choices: [{ id: "aaa", name: "A", slug: "a" }, { id: "bbb", name: "B", slug: "b" }], isOperator: true }
    const res = await PATCH(req({ settings: { display_name: "Fine" } }), { params: Promise.resolve({ id: "bbb" }) })
    expect(res.status).toBe(200)
    expect(settingsCalls[0].businessId).toBe("bbb")
  })

  it("rejects an out-of-range quiet hour and writes nothing", async () => {
    const res = await PATCH(req({ settings: { quiet_hours_start: 99 } }), { params: Promise.resolve({ id: "bbb" }) })
    expect(res.status).toBe(400)
    expect(settingsCalls).toHaveLength(0)
  })

  it("rejects an unrecognised timezone and writes nothing", async () => {
    const res = await PATCH(req({ settings: { timezone: "Mars/Olympus" } }), { params: Promise.resolve({ id: "bbb" }) })
    expect(res.status).toBe(400)
    expect(settingsCalls).toHaveLength(0)
  })

  it("patches the business row too when asked", async () => {
    const res = await PATCH(req({ business: { status: "paused" } }), { params: Promise.resolve({ id: "bbb" }) })
    expect(res.status).toBe(200)
    expect(businessCalls[0]).toEqual({ id: "bbb", patch: { status: "paused" } })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run __tests__/api/admin/business-settings.test.ts
```

Expected: FAIL — route not found. Non-zero count.

- [ ] **Step 3: Write the route**

Create `app/api/admin/businesses/[id]/route.ts`:

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  getBusiness, updateBusiness, getBusinessSettings, updateBusinessSettings,
} from "@/lib/db/businesses"
import { businessPatchSchema, businessSettingsPatchSchema } from "@/lib/validators/business"
import { resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
import { recordAudit } from "@/lib/audit/record"
import { z } from "zod"

const bodySchema = z.object({
  business: businessPatchSchema.optional(),
  settings: businessSettingsPatchSchema.optional(),
})

export async function PATCH(request: Request, ctx: { params: Promise<Record<string, string>> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await ctx.params
  const tenant = await resolveAdminTenantForRequest(request)

  // THE ID IN THE URL IS CALLER-CONTROLLED. The operator may patch any
  // business; anyone else may patch only one inside their own allowed set.
  // Without this, a coach could rewrite another coach's sending identity by
  // typing a different id.
  const permitted = tenant.isOperator || tenant.choices.some((c) => c.id === id)
  if (!permitted) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the form", issues: parsed.error.issues }, { status: 400 })
  }

  let business = await getBusiness(id)
  if (!business) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (parsed.data.business && Object.keys(parsed.data.business).length > 0) {
    business = await updateBusiness(id, parsed.data.business)
    await recordAudit({
      action: "business.updated",
      category: "admin_write",
      outcome: "success",
      target: { kind: "business", id, label: business.name },
      metadata: { patch: parsed.data.business },
    })
  }

  let settings = await getBusinessSettings(id)
  if (parsed.data.settings && Object.keys(parsed.data.settings).length > 0) {
    settings = await updateBusinessSettings(parsed.data.settings, id)
    await recordAudit({
      action: "business.settings_updated",
      category: "admin_write",
      outcome: "success",
      target: { kind: "business", id, label: business.name },
      metadata: { fields: Object.keys(parsed.data.settings) },
    })
  }

  return NextResponse.json({ business, settings })
}
```

Note the audit metadata for settings records **field names only, not values** — `sender_email` and `sms_messaging_service_sid` are identity configuration and the scrubber does not cover them by name.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run __tests__/api/admin/business-settings.test.ts
```

Expected: PASS, non-zero count.

- [ ] **Step 5: Prove the authorisation assertion can fail (mutation)**

1. Change `const permitted = tenant.isOperator || tenant.choices.some(...)` to `const permitted = true` → the "REFUSES an id outside the allowed set" test MUST fail.
2. Change `updateBusinessSettings(parsed.data.settings, id)` to `updateBusinessSettings(parsed.data.settings, tenant.businessId)` → the operator test MUST fail (it patches `bbb` while `tenant.businessId` is `aaa`). This is the mutation that proves the route writes to the business in the URL and not to whichever one the cookie happened to select.

- [ ] **Step 6: Write the detail page and the settings form**

`app/(admin)/admin/businesses/[id]/page.tsx`:
- `await requireAdmin()`, then `resolveAdminTenant()`, then the same permitted check as the route (a page that renders what the API would refuse is a bug in the other direction).
- Renders `<BusinessSettingsForm>` and, in Task 6, `<BusinessMembersCard>`.
- Header shows the business name, its web address and its status badge.

`components/admin/businesses/BusinessSettingsForm.tsx` — client component, RHF + `zodResolver(businessSettingsPatchSchema)`, `PATCH`es to the route above, `toast.success` from Sonner on save. Group the fields under plain-language headings: **Identity** (display name, logo), **Email** (sender name, sender email, reply-to), **Timing** (timezone, quiet hours, daily cap), **Text messages** (help text, messaging service SID, sender phone), **Legal** (postal address).

- [ ] **Step 7: Verify**

```bash
npx tsc --noEmit 2>&1 | grep -c 'error TS'
npx vitest run __tests__/api/admin/business-settings.test.ts __tests__/db/businesses.test.ts
```

Expected: `251`; both pass with non-zero counts.

- [ ] **Step 8: Commit**

```bash
git add app/\(admin\)/admin/businesses/\[id\] app/api/admin/businesses/\[id\] \
        components/admin/businesses/BusinessSettingsForm.tsx \
        __tests__/api/admin/business-settings.test.ts
git commit -m "feat(tenancy): per-business settings editing

PATCH /api/admin/businesses/[id] writes to the business named in the URL,
and the URL is caller-controlled -- so it checks that id against the
caller's own allowed set before it writes anything. The operator may
patch any business; a coach may patch only its own. The mutation that
replaces the check with 'true' is run and killed, and so is the one that
writes to tenant.businessId instead of the URL's id: that second one is
what proves the route does not quietly patch whichever business the
cookie happened to select.

Settings audit metadata records FIELD NAMES ONLY. sender_email and
sms_messaging_service_sid are identity configuration and the metadata
scrubber does not cover them by name.

The page repeats the route's permitted check, because a page that renders
what the API would refuse is the same bug facing the other way."
```

---

## Task 6: Migration 00245 and member invitation

**Files:**
- Create: `supabase/migrations/00245_team_invites_business.sql`
- Modify: `lib/db/team-invites.ts`
- Modify: `app/api/public/invite/[token]/claim/route.ts`
- Create: `lib/db/business-members.ts`
- Create: `app/api/admin/businesses/[id]/members/route.ts`
- Create: `components/admin/businesses/BusinessMembersCard.tsx`
- Create: `__tests__/db/business-members.test.ts`
- Modify: `__tests__` suites covering the claim route (enumerate with `grep -rln 'invite/\[token\]/claim\|claimRoute' __tests__`)

**Interfaces:**
- Consumes: `resolveAdminTenantForRequest` (Task 3); existing `createInvite`, `getInviteByToken`, `markInviteUsed`.
- Produces:
  - `listBusinessMembers(businessId): Promise<BusinessMember[]>`
  - `addBusinessMember(businessId, userId, role): Promise<"added" | "already">`
  - `removeBusinessMember(businessId, userId): Promise<void>`
  - `linkHostToUser(businessId, userId): Promise<void>`
  - `createInvite` gains optional `businessId?: string | null` and `businessRole?: "owner" | "coach" | "staff" | null`.

- [ ] **Step 1: Confirm the migration number, then write it**

```bash
ls supabase/migrations/ | tail -3
```

Expected last entry: `00244_create_business_function.sql`.

```sql
-- supabase/migrations/00245_team_invites_business.sql
-- Calendly per coach, phase 1: an invite can name a business.
--
-- WHY team_invites AND NOT A NEW business_invites TABLE. team_invites already
-- has 24-byte base64url tokens, a 7-day TTL, revoke (expire in place, keeping
-- the row for audit), token rotation on resend, used_at, a status helper and an
-- accept route. A parallel table would duplicate every one of those and give
-- the operator two invite lists to reconcile.
--
-- BOTH COLUMNS NULLABLE, and that is not laziness: every existing row has
-- neither, and an invite with no business is still a perfectly valid
-- platform-staff invite. The accept path inserts a business_members row only
-- when business_id is present, so null means exactly what it looks like.
--
-- The CHECK mirrors business_members.role (00240). It is a separate constraint
-- rather than a foreign key onto some roles table because there is no such
-- table -- the same shape 00240 chose.

alter table public.team_invites
  add column if not exists business_id   uuid references public.businesses(id) on delete cascade,
  add column if not exists business_role text check (business_role in ('owner','coach','staff'));

create index if not exists team_invites_business_id on public.team_invites (business_id);
```

- [ ] **Step 2: Apply to the dev clone and read back**

Apply via `supabase` MCP `apply_migration`, name `00245_team_invites_business`. Then:

```sql
select column_name, is_nullable, data_type
  from information_schema.columns
 where table_name = 'team_invites' and column_name in ('business_id','business_role');
```

Expected: two rows, both `is_nullable = YES`.

Prove the CHECK rejects a bad role inside a rollback:

```sql
begin;
insert into public.team_invites (email, role, token, invited_by, expires_at, permissions, business_role)
values ('x@e.com','staff','tok-test',null, now() + interval '7 days', '{}'::jsonb, 'wizard');  -- expect 23514
rollback;
```

Expected: `23514`. If it inserts, the CHECK is missing.

- [ ] **Step 3: Write the failing test for the membership DAL**

Create `__tests__/db/business-members.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const eqCalls: Array<[string, unknown]> = []
const inserts: unknown[] = []
let existingRow: unknown = null
let existingError: unknown = null
let insertError: unknown = null

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {}
      const self = () => chain
      chain.select = self
      chain.order = self
      chain.delete = self
      chain.is = self
      chain.eq = (c: string, v: unknown) => { eqCalls.push([c, v]); return chain }
      chain.insert = (row: unknown) => { inserts.push(row); return { select: () => ({ single: () => Promise.resolve({ data: row, error: insertError }) }) } }
      chain.update = (row: unknown) => { inserts.push(row); return chain }
      chain.maybeSingle = () => Promise.resolve({ data: existingRow, error: existingError })
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: existingRow ? [existingRow] : [], error: existingError }).then(res)
      return chain
    },
  }),
}))

import { addBusinessMember } from "@/lib/db/business-members"

beforeEach(() => {
  eqCalls.length = 0
  inserts.length = 0
  existingRow = null
  existingError = null
  insertError = null
})

describe("addBusinessMember", () => {
  it("inserts the membership scoped to BOTH the business and the user", async () => {
    const out = await addBusinessMember("bbb", "u9", "coach")
    expect(out).toBe("added")
    expect(inserts[0]).toEqual({ business_id: "bbb", user_id: "u9", role: "coach" })
    expect(eqCalls).toContainEqual(["business_id", "bbb"])
    expect(eqCalls).toContainEqual(["user_id", "u9"])
  })

  it("reports 'already' when the row exists, without inserting", async () => {
    existingRow = { business_id: "bbb", user_id: "u9", role: "coach" }
    expect(await addBusinessMember("bbb", "u9", "coach")).toBe("already")
    expect(inserts).toHaveLength(0)
  })

  it("treats a 23505 from a concurrent accept as 'already', not a failure", async () => {
    // business_members is primary key (business_id, user_id), so a double
    // accept races. Read-then-insert, and 23505 means the other one won.
    // NEVER .upsert(onConflict) -- that answers 42P10 against a partial index.
    insertError = { code: "23505", message: "duplicate key" }
    expect(await addBusinessMember("bbb", "u9", "coach")).toBe("already")
  })

  it("throws when the existence read fails — a failed read is not 'no row'", async () => {
    existingError = { code: "42P01", message: "no such table" }
    await expect(addBusinessMember("bbb", "u9", "coach")).rejects.toThrow(/42P01|no such table/)
  })
})
```

- [ ] **Step 4: Run it to verify it fails**

```bash
npx vitest run __tests__/db/business-members.test.ts
```

Expected: FAIL — module not found. Non-zero count.

- [ ] **Step 5: Write the membership DAL**

Create `lib/db/business-members.ts`:

```ts
import { createServiceRoleClient } from "@/lib/supabase"

export type BusinessMemberRole = "owner" | "coach" | "staff"

export type BusinessMember = {
  business_id: string
  user_id: string
  role: BusinessMemberRole
  created_at: string
  email: string
  first_name: string
  last_name: string
}

function getClient() {
  return createServiceRoleClient()
}

export async function listBusinessMembers(businessId: string): Promise<BusinessMember[]> {
  const { data, error } = await getClient()
    .from("business_members")
    .select("business_id, user_id, role, created_at, users!inner(email, first_name, last_name)")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true })
  if (error) throw new Error(`listBusinessMembers failed (${error.code}): ${error.message}`)
  type Joined = Omit<BusinessMember, "email" | "first_name" | "last_name"> & {
    users: { email: string; first_name: string; last_name: string }
  }
  return ((data ?? []) as unknown as Joined[]).map((r) => ({
    business_id: r.business_id,
    user_id: r.user_id,
    role: r.role,
    created_at: r.created_at,
    email: r.users.email,
    first_name: r.users.first_name,
    last_name: r.users.last_name,
  }))
}

/**
 * Idempotent by construction. business_members is
 * `primary key (business_id, user_id)`, so two concurrent accepts of the same
 * invite race: read first, and treat a 23505 from the insert as "the other one
 * won". Deliberately NOT `.upsert(..., { onConflict })`, which answers 42P10
 * against a partial unique index -- a trap this repo has already paid for.
 */
export async function addBusinessMember(
  businessId: string,
  userId: string,
  role: BusinessMemberRole,
): Promise<"added" | "already"> {
  const supabase = getClient()
  const { data: existing, error: readError } = await supabase
    .from("business_members")
    .select("user_id")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle()
  // A FAILED READ IS NOT "NO ROW". Falling through to the insert on a failed
  // read turns a real error into a confusing 23505.
  if (readError) throw new Error(`addBusinessMember read failed (${readError.code}): ${readError.message}`)
  if (existing) return "already"

  const { error } = await supabase
    .from("business_members")
    .insert({ business_id: businessId, user_id: userId, role })
    .select()
    .single()
  if (error) {
    if (error.code === "23505") return "already"
    throw new Error(`addBusinessMember failed (${error.code}): ${error.message}`)
  }
  return "added"
}

export async function removeBusinessMember(businessId: string, userId: string): Promise<void> {
  const { error } = await getClient()
    .from("business_members")
    .delete()
    .eq("business_id", businessId)
    .eq("user_id", userId)
  if (error) throw new Error(`removeBusinessMember failed (${error.code}): ${error.message}`)
}

/**
 * Fills in the host row's user_id once the coach's login exists.
 *
 * create_business writes a host with a NULL user_id, because the business is
 * created before the coach has an account. Only the FIRST unclaimed host row
 * is linked, and `.is("user_id", null)` is what stops a second coach's accept
 * from stealing a host that already belongs to someone.
 */
export async function linkHostToUser(businessId: string, userId: string): Promise<void> {
  const { error } = await getClient()
    .from("booking_hosts")
    .update({ user_id: userId })
    .eq("business_id", businessId)
    .is("user_id", null)
  if (error) throw new Error(`linkHostToUser failed (${error.code}): ${error.message}`)
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run __tests__/db/business-members.test.ts
```

Expected: PASS, non-zero count.

- [ ] **Step 7: Thread the business through `createInvite` and the claim route**

In `lib/db/team-invites.ts`, extend `createInvite`'s input with `businessId?: string | null` and `businessRole?: BusinessMemberRole | null` and include them in the insert. Keep `role` derived from permissions exactly as it is — that logic is why an invite and a later permissions edit cannot disagree, and it is not this task's business.

In `app/api/public/invite/[token]/claim/route.ts`, after the user is created and `markInviteUsed` runs, add:

```ts
// An invite that names a business also grants membership. Null business_id is
// the ordinary case -- a platform-staff invite -- and grants nothing here.
if (invite.business_id) {
  const role = (invite.business_role ?? "coach") as BusinessMemberRole
  await addBusinessMember(invite.business_id, newUser.id, role)
  // A coach is the person whose calendar the bookings land on, so their login
  // claims the host row create_business left unowned. Only coaches: a staff
  // member is not a host.
  if (role === "coach") await linkHostToUser(invite.business_id, newUser.id)
}
```

- [ ] **Step 8: Find and run every suite that reaches the claim route**

The claim route is shared, so this is where a too-narrow suite list would let a regression through — the phase-0 mistake.

```bash
grep -rln 'invite' __tests__ | sort
```

Run every suite that grep names, plus the team-invite DAL suite:

```bash
npx vitest run $(grep -rln 'invite' __tests__ | tr '\n' ' ')
```

Expected: all PASS with non-zero counts. Any failure here is this task's to fix, not a pre-existing red — confirm against the branch-point worktree if unsure.

- [ ] **Step 9: Write the members route and card**

`app/api/admin/businesses/[id]/members/route.ts`:
- `POST` — body `{ email, businessRole, permissions }`. Same allowed-set check as Task 5 (id from the URL). Calls `createInvite({ email, invitedBy: session.user.id, permissions, businessId: id, businessRole })`. Records `business.member_invited`. Returns the invite's token so the operator can copy the link — the same thing `/admin/team` already does.
- `DELETE` — body `{ userId }`. Same check. `removeBusinessMember`. Records `business.member_removed`. **Does not delete the user**, who may belong to another business.

`components/admin/businesses/BusinessMembersCard.tsx` — the house data-table primitives, columns Name · Email · Role · Added, plus an "Invite a coach" dialog with email + role + the existing permission checkboxes. Copy for a non-programmer: "Invite a coach", "They'll get a link that works for 7 days."

- [ ] **Step 10: Verify and commit**

```bash
npx tsc --noEmit 2>&1 | grep -c 'error TS'
npx vitest run __tests__/db/business-members.test.ts $(grep -rln 'invite' __tests__ | tr '\n' ' ')
```

Expected: `251`; all pass with non-zero counts.

```bash
git add supabase/migrations/00245_team_invites_business.sql lib/db/business-members.ts \
        lib/db/team-invites.ts app/api/public/invite/\[token\]/claim/route.ts \
        app/api/admin/businesses/\[id\]/members components/admin/businesses/BusinessMembersCard.tsx \
        __tests__/db/business-members.test.ts
git commit -m "feat(tenancy): invite a coach into a business

Reuses team_invites rather than building a second invite system: it
already has the tokens, the 7-day expiry, revoke, rotation and an accept
route, and a parallel table would have given the operator two invite
lists to reconcile. 00245 adds business_id and business_role, both
nullable, because every existing row has neither and an invite naming no
business is still a valid platform-staff invite.

addBusinessMember is idempotent by construction. business_members is
primary key (business_id, user_id), so two accepts of one invite race:
read first, and treat 23505 as 'the other one won'. Deliberately NOT
upsert(onConflict), which answers 42P10 against a partial index.

A coach's accept also claims the host row create_business left with a
null user_id. The .is('user_id', null) predicate is what stops a second
accept stealing a host that already has an owner.

Removing a member deletes the membership row and NOT the user, who may
belong to another business.

Ran every suite grep finds for 'invite', not just the DAL's own: the
claim route is shared, and a too-narrow suite list is how phase 0 shipped
a 14-test regression past three gates."
```

---

## Task 7: The switcher, and scoping contacts / bookings / campaign-revenue

**Files:**
- Create: `components/admin/BusinessSwitcher.tsx`
- Create: `app/(admin)/admin/actions.ts` (the cookie-setting server action)
- Modify: `app/(admin)/admin/layout.tsx`
- Modify: `lib/db/contacts-list.ts:100`, `lib/db/bookings.ts:44`, `lib/automation/campaign-revenue.ts:79-85`
- Modify: `app/(admin)/admin/contacts/page.tsx`, `app/(admin)/admin/bookings/page.tsx`, `app/(admin)/admin/insights/campaign-revenue/page.tsx`
- Modify: `__tests__/lib/automation/campaign-revenue.test.ts` and any contacts-list / bookings suites

**Interfaces:**
- Consumes: `resolveAdminTenant` (Task 3).
- Produces:
  - `ContactFilters` gains a required `businessId: string`.
  - `getBookings(businessId: string, status?: BookingStatus)` — **`businessId` first and required.**
  - `readCampaignRevenue({ since, until, businessId })` — `businessId` required.

- [ ] **Step 1: Write the failing tests**

Add to (or create) `__tests__/db/contacts-list.test.ts` and `__tests__/lib/db/bookings.test.ts`, using argument-recording mocks. The essential assertions:

```ts
// contacts-list: applyFilters is the ONE place the scope is applied, so this
// asserts the VALUE reaching .eq() for both the list read and the count.
it("scopes both the list and the count to the businessId it was given", async () => {
  await listContacts({ businessId: "bbb", page: 1, pageSize: 20 })
  const scoped = eqCalls.filter(([c]) => c === "business_id")
  expect(scoped.length).toBeGreaterThanOrEqual(2)     // list AND count
  expect(scoped.every(([, v]) => v === "bbb")).toBe(true)
  expect(scoped.some(([, v]) => v === SINGLETON_BUSINESS_ID)).toBe(false)
})

// bookings: this predicate does not exist today at all.
it("scopes getBookings to the business, which it previously did not do", async () => {
  await getBookings("bbb")
  expect(eqCalls).toContainEqual(["business_id", "bbb"])
})

it("still applies the status filter alongside the business scope", async () => {
  await getBookings("bbb", "scheduled")
  expect(eqCalls).toContainEqual(["business_id", "bbb"])
  expect(eqCalls).toContainEqual(["status", "scheduled"])
})
```

- [ ] **Step 2: Run them to verify they fail**

```bash
npx vitest run __tests__/db/contacts-list.test.ts __tests__/lib/db/bookings.test.ts
```

Expected: FAIL (signature mismatch / missing predicate). Non-zero counts.

- [ ] **Step 3: Convert the three DAL functions**

`lib/db/contacts-list.ts` — add `businessId: string` to `ContactFilters` and change `:100`:

```ts
  q = q.eq("business_id", filters.businessId)
```

Keep the existing comment about why the scope lives in `applyFilters` — it is still the reason, and it now reads as a description of a real per-tenant filter rather than an aspiration.

`lib/db/bookings.ts` — `getBookings` gains a required first parameter and the predicate it never had:

```ts
/**
 * `businessId` is REQUIRED and comes first. This function previously applied
 * NO business predicate at all -- not a default, an absence -- so every
 * admin bookings list read every business's rows. Not a leak while one
 * business existed; a leak the moment a second one does.
 */
export async function getBookings(businessId: string, status?: BookingStatus) {
  const supabase = getClient()
  let query = supabase
    .from("bookings")
    .select("*")
    .eq("business_id", businessId)
    .order("booking_date", { ascending: false })
  if (status) query = query.eq("status", status)
  // ... rest unchanged
```

Leave `singletonHostId()` and its `SINGLETON_BUSINESS_ID` at `:35` **exactly as they are.** That literal is deliberate — it is the host lookup for the vendor path, phase 2 deletes the function entirely, and converting it now would mean inventing a tenant the webhook cannot yet resolve.

`lib/automation/campaign-revenue.ts` — `readCampaignRevenue` takes `businessId` in its input object and `:85`'s `.eq("business_id", SINGLETON_BUSINESS_ID)` becomes `.eq("business_id", input.businessId)`.

- [ ] **Step 4: Convert the callers**

- `app/(admin)/admin/bookings/page.tsx:9` → `const { businessId } = await resolveAdminTenant()`, then `getBookings(businessId)`.
- `app/(admin)/admin/insights/campaign-revenue/page.tsx:52` → `readCampaignRevenue({ since, until, businessId })` and `getBusinessSettings(businessId)`.
- `app/(admin)/admin/contacts/page.tsx` → pass `businessId` into the filters it builds.

**`functions/src/ai/admin-tools.ts:387` calls a DIFFERENT `getBookings`** — a local function defined at `:1540` in the same file, not the DAL. `functions/` cannot import from `lib/`. Do not touch it in this task; note it in the commit so nobody later mistakes it for a missed caller.

- [ ] **Step 5: Run every suite that reaches these through a route**

```bash
grep -rln 'getBookings\|contacts-list\|listContacts\|readCampaignRevenue' __tests__ | sort
npx vitest run $(grep -rln 'getBookings\|contacts-list\|listContacts\|readCampaignRevenue' __tests__ | tr '\n' ' ')
```

Expected: all PASS with non-zero counts.

- [ ] **Step 6: Prove the scope assertions can fail (mutation)**

1. `lib/db/contacts-list.ts` — change `filters.businessId` back to `SINGLETON_BUSINESS_ID` → the contacts-list value test MUST fail.
2. `lib/db/bookings.ts` — delete the `.eq("business_id", businessId)` line → the bookings test MUST fail.
3. `lib/automation/campaign-revenue.ts` — change `input.businessId` to `SINGLETON_BUSINESS_ID` → its suite MUST fail.

- [ ] **Step 7: Build the switcher**

`app/(admin)/admin/actions.ts`:

```ts
"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { BUSINESS_COOKIE, businessCookieOptions } from "@/lib/tenancy/cookie"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"

export async function selectBusiness(businessId: string) {
  // Validated against the caller's OWN allowed set before it is written, so a
  // forged action argument cannot park an unreachable id in the cookie. The
  // resolver would ignore it anyway; refusing here keeps the cookie honest.
  const { choices, isOperator } = await resolveAdminTenant()
  if (!isOperator && !choices.some((c) => c.id === businessId)) return
  const jar = await cookies()
  jar.set(BUSINESS_COOKIE, businessId, businessCookieOptions)
  revalidatePath("/admin")
}
```

`components/admin/BusinessSwitcher.tsx` — a small `<select>` (or the shadcn `Select`) of `choices`, calling `selectBusiness`. In `app/(admin)/admin/layout.tsx`, resolve the tenant and render it **only when `choices.length > 1`**, so a coach with one business sees nothing.

- [ ] **Step 8: Verify and commit**

```bash
npx tsc --noEmit 2>&1 | grep -c 'error TS'
```

Expected: `251`.

```bash
git add components/admin/BusinessSwitcher.tsx app/\(admin\)/admin/actions.ts \
        app/\(admin\)/admin/layout.tsx lib/db/contacts-list.ts lib/db/bookings.ts \
        lib/automation/campaign-revenue.ts app/\(admin\)/admin/bookings/page.tsx \
        app/\(admin\)/admin/contacts/page.tsx \
        app/\(admin\)/admin/insights/campaign-revenue/page.tsx __tests__
git commit -m "feat(tenancy): contacts, bookings and campaign revenue read one business

getBookings previously applied NO business predicate at all -- not a
default, an absence -- so the admin bookings list read every business's
rows. It now takes businessId as a required first parameter.

contacts-list keeps its scope in applyFilters, the one place used by both
the list read and the count, so a filter cannot narrow the table
differently from the number above it. readCampaignRevenue takes the
business from its only caller, an admin page, not a cron.

singletonHostId's literal is LEFT ALONE deliberately: it is the vendor
path's host lookup, phase 2 deletes the function, and converting it now
would mean inventing a tenant the webhook cannot resolve yet.

functions/src/ai/admin-tools.ts:387 calls a LOCAL getBookings defined at
:1540 in that same file, not this DAL -- functions/ cannot import from
lib/. Recorded here so it is not later mistaken for a missed caller.

The switcher renders only when a caller has more than one business, and
the server action validates the id against the caller's allowed set
before writing the cookie."
```

---

## Task 8: Scoping `lib/db/quizzes.ts` (9 sites)

**Files:**
- Modify: `lib/db/quizzes.ts` (`:175, 223, 253, 273, 343, 433, 674, 816, 861`)
- Modify: the admin quiz pages and `/api/admin` quiz routes that call it
- Modify: `__tests__` suites reaching quizzes

**Interfaces:**
- Produces: every exported function in `lib/db/quizzes.ts` that currently pins the singleton takes `businessId: string` as a **required** parameter. Write the resulting signatures into the commit message so Task 9's implementer can read them without opening the file.

- [ ] **Step 1: Enumerate the functions and their callers**

```bash
grep -n 'SINGLETON_BUSINESS_ID' lib/db/quizzes.ts
grep -n '^export async function\|^export function' lib/db/quizzes.ts
grep -rn "from \"@/lib/db/quizzes\"" --include='*.ts' --include='*.tsx' app lib | grep -v '__tests__'
```

Write the mapping (function → line → callers) into the task notes before editing. Nine sites across a 900-line file is where an ad-hoc edit misses one.

- [ ] **Step 2: Write the failing tests**

For each exported function that gains the parameter, one test asserting the **value** reaching `.eq("business_id", …)`, using an argument-recording mock. Group them in the existing quizzes suite if one exists (`ls __tests__ | grep -i quiz`); create `__tests__/db/quizzes.test.ts` with `// @vitest-environment node` on line 1 if not.

At minimum, one test per site, each of the form:

```ts
it("scopes <fn> to the business it was given", async () => {
  await <fn>("bbb", ...)
  const scoped = eqCalls.filter(([c]) => c === "business_id")
  expect(scoped.every(([, v]) => v === "bbb")).toBe(true)
  expect(scoped).not.toHaveLength(0)              // presence control
})
```

The `not.toHaveLength(0)` line is not redundant: without it the test passes when the predicate is absent entirely.

- [ ] **Step 3: Run them to verify they fail, then convert all nine sites, then run again**

```bash
npx vitest run __tests__/db/quizzes.test.ts
```

Convert. The two `insert` sites (`:343`, `:861`) write `business_id: businessId`; the seven read sites become `.eq("business_id", businessId)`.

- [ ] **Step 4: Convert every caller, and run every suite reaching quizzes through a route**

```bash
npx vitest run $(grep -rln 'quiz' __tests__ | tr '\n' ' ')
```

Expected: all PASS with non-zero counts. The quiz surfaces include a public funnel path — if a caller is a public route with no tenant, pass `platformBusinessId()` from Task 10 and say so, rather than inventing a resolution.

- [ ] **Step 5: Mutation**

Change three of the nine converted sites (one insert, two reads) to `SINGLETON_BUSINESS_ID`, one at a time; each MUST fail its test. Then verify no site was missed:

```bash
grep -n 'SINGLETON_BUSINESS_ID' lib/db/quizzes.ts
```

Expected: no output, or only lines inside comments. **Text assertions must exclude prose** — grepping a file for a word also matches the comment explaining it, so read each remaining hit rather than counting them.

- [ ] **Step 6: Verify and commit**

```bash
npx tsc --noEmit 2>&1 | grep -c 'error TS'
```

Expected: `251`.

```bash
git add lib/db/quizzes.ts app lib __tests__
git commit -m "feat(tenancy): quizzes read and write one business

Nine hard-coded singleton sites in lib/db/quizzes.ts -- seven reads and
two inserts -- now take a required businessId. Every caller converted;
grep confirms no live literal remains in the file, and each remaining hit
was read rather than counted, because grepping for a constant also
matches the comment explaining it.

One test per site asserting the VALUE reaching .eq(), each with a
presence control so the assertion cannot pass when the predicate is
absent entirely. Three mutations run and killed.

<paste the resulting signatures here>"
```

---

## Task 9: Scoping `lib/db/chat.ts` (5 sites)

**Files:**
- Modify: `lib/db/chat.ts` (`:48, 112, 354, 388, 429`)
- Modify: its callers, including `app/api/ask/route.ts`, `app/api/ask/capture/route.ts`, `app/(admin)/admin/chat/page.tsx`
- Modify: `__tests__` suites reaching chat

**Interfaces:**
- Produces: `createConversation` takes a required `businessId`; the four read/write sites take one. Paste resulting signatures into the commit.

- [ ] **Step 1: Read the seam before editing**

`app/api/ask/route.ts:410` already reads `getBusinessSettings(conversation.business_id)` — the conversation row is the tenant carrier for every turn after the first. So:

- `createConversation` (`:48`) is where the tenant enters. Its caller is a **public** surface, whose tenant comes from the `Host` header — phase 4. It takes a required `businessId`, and the public caller passes `platformBusinessId()` from Task 10.
- `:112` is the second insert; same treatment.
- `:354, 388, 429` are admin reads; they take the resolved `businessId`.

- [ ] **Step 2: Write the failing tests**

One per site, asserting the value, each with a presence control. Plus one that matters more than the others:

```ts
it("stamps the conversation with the businessId it was given, not the singleton", async () => {
  await createConversation({ businessId: "bbb", /* ...existing fields */ })
  expect(inserted[0].business_id).toBe("bbb")
  expect(inserted[0].business_id).not.toBe(SINGLETON_BUSINESS_ID)
})
```

- [ ] **Step 3: Run to fail, convert, run to pass**

```bash
npx vitest run $(grep -rln 'chat\|ask' __tests__ | tr '\n' ' ')
```

The chat suites include route suites. Confirm non-zero counts on each — and note that `__tests__` for the three GHL webhook suites needed `--environment node` pinning before (memory), so if a chat route suite reports "no tests", add the line-1 pragma before assuming it covers nothing.

- [ ] **Step 4: Mutation**

Change `:48`'s `business_id: businessId` to `business_id: SINGLETON_BUSINESS_ID` → the stamping test MUST fail. Repeat for one admin read site.

- [ ] **Step 5: Verify and commit**

```bash
npx tsc --noEmit 2>&1 | grep -c 'error TS'
grep -n 'SINGLETON_BUSINESS_ID' lib/db/chat.ts
```

Expected: `251`; no live literals (read each remaining hit, do not count).

```bash
git commit -m "feat(tenancy): a chat conversation carries its business

createConversation takes a required businessId and stamps it on the row.
Every later turn already reads the tenant off the conversation
(app/api/ask/route.ts:410 does this today), so the conversation row is
the tenant carrier and this is the one place it enters.

The public /api/ask caller has no tenant until phase 4 resolves the Host
header, so it passes platformBusinessId() -- a named seam, not a
resolution, and honest about which.

<paste the resulting signatures here>"
```

---

## Task 10: `platformBusinessId()`, the import path, and the two crons

**Files:**
- Create: `lib/tenancy/platform.ts`
- Modify: `lib/lead-engine/import.ts:251`
- Modify: `lib/automation/sequence-tick-runner.ts:634`, `lib/automation/pipeline-reconcile.ts:133`
- Modify: `app/api/webhooks/calendly/route.ts:210`, `app/api/webhooks/ghl-booking/route.ts:126`
- Modify: the import route that calls `import.ts`
- Modify: `__tests__/lib/automation/pipeline-reconcile.test.ts`, the sequence-tick suites, the two webhook suites

**Interfaces:**
- Produces:
  - `platformBusinessId(): string` from `lib/tenancy/platform.ts`
  - `runSequenceTick` / `runPipelineReconcile` iterate active businesses and still write **one** `cron_runs` row.
  - `importContacts(..., businessId)` — required.

- [ ] **Step 1: Write the seam**

Create `lib/tenancy/platform.ts`:

```ts
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

/**
 * The platform's OWN business -- the tenant that owns darrenjpaul.com.
 *
 * This is a SEAM, not a resolution, and the distinction is the point. Three
 * surfaces genuinely cannot resolve a tenant yet:
 *   - the Calendly webhook, until phase 2 gives each coach a connection row
 *     whose event-type URI identifies the business;
 *   - the GHL booking webhook, which is the calendar Calendly replaces and
 *     will never be per-coach;
 *   - public pages, until phase 4 resolves the Host header.
 *
 * Each of those calls this instead of writing the constant inline, so phase 2
 * and phase 4 have ONE greppable place to change rather than four literals
 * scattered across routes. Calling it a resolution would be a lie; naming it
 * honestly is the whole value.
 */
export function platformBusinessId(): string {
  return SINGLETON_BUSINESS_ID
}
```

Replace the literals at `app/api/webhooks/calendly/route.ts:210` and `app/api/webhooks/ghl-booking/route.ts:126` with `platformBusinessId()`. Behaviour is identical; the two webhook suites must stay green unchanged, which is the point.

- [ ] **Step 2: Write the failing cron tests**

The assertions that matter are about the `cron_runs` row, not the loop:

```ts
it("writes ONE cron_runs row per tick even with several businesses", async () => {
  businesses = [{ id: "aaa" }, { id: "bbb" }]
  await runPipelineReconcile()
  expect(cronRunInserts).toHaveLength(1)
})

it("marks the single row failed and names the failing business when one fails", async () => {
  // lastSuccessPerCron takes the single most recent SUCCESSFUL row per
  // cron_name, so a row per business would hide a business failing every tick
  // behind any business that succeeded.
  businesses = [{ id: "aaa" }, { id: "bbb" }]
  failFor = "bbb"
  await runPipelineReconcile()
  expect(cronRunEnds[0].status).toBe("failed")
  expect(cronRunEnds[0].detail.failures.map((f) => f.businessId)).toEqual(["bbb"])
})

it("one business failing does not stop the others", async () => {
  businesses = [{ id: "aaa" }, { id: "bbb" }]
  failFor = "aaa"
  await runPipelineReconcile()
  expect(processed).toContain("bbb")
})

it("is unchanged for a single active business", async () => {
  // The behavioural no-op that makes this safe to land now.
  businesses = [{ id: SINGLETON_BUSINESS_ID }]
  await runPipelineReconcile()
  expect(cronRunInserts).toHaveLength(1)
  expect(cronRunEnds[0].status).toBe("success")
})
```

- [ ] **Step 3: Run to fail, then convert both crons**

Replace `const businessId = SINGLETON_BUSINESS_ID` with a loop:

```ts
const businesses = await listBusinesses({ activeOnly: true })
const failures: Array<{ businessId: string; error: string }> = []
for (const business of businesses) {
  try {
    // ...the existing body, with businessId = business.id
  } catch (err) {
    // One business's failure must not abort the others, and it must not
    // vanish either: it lands in the single cron_runs row's detail.
    failures.push({ businessId: business.id, error: (err as Error).message })
    console.error(`[pipeline-reconcile] business ${business.id} failed: ${(err as Error).message}`)
  }
}
await logCronEnd(/* ... */, {
  status: failures.length > 0 ? "failed" : "success",
  detail: { businesses: businesses.length, failures },
})
```

`logCronStart` / `logCronEnd` stay **outside** the loop. That is the whole point.

- [ ] **Step 4: Convert the import path**

`lib/lead-engine/import.ts:251` — `businessId` becomes a required parameter, supplied by the admin import route from `resolveAdminTenantForRequest`.

- [ ] **Step 5: Run every suite reaching these through a route**

```bash
npx vitest run $(grep -rln 'pipeline-reconcile\|sequence-tick\|import\|calendly\|ghl-booking' __tests__ | tr '\n' ' ')
```

Expected: all PASS with non-zero counts. The two webhook suites must pass **without edits** — `platformBusinessId()` is behaviour-identical, so a failure there means the swap was not behaviour-identical after all.

- [ ] **Step 6: Mutation**

1. Move `logCronEnd` inside the loop → the "ONE cron_runs row" test MUST fail.
2. Remove the try/catch → the "does not stop the others" test MUST fail.
3. Change `status: failures.length > 0 ? "failed" : "success"` to always `"success"` → the "marks the single row failed" test MUST fail.

- [ ] **Step 7: Verify and commit**

```bash
npx tsc --noEmit 2>&1 | grep -c 'error TS'
```

Expected: `251`.

```bash
git commit -m "feat(tenancy): the crons iterate businesses, and still write one cron_runs row

Both crons loop over active businesses. The cron_runs row stays ONE PER
TICK, marked failed if any business failed with the per-business outcome
in detail.failures[] -- because lastSuccessPerCron takes the single most
recent successful row per cron_name, so a row per business would hide a
business failing every tick behind any business that succeeded. That is
the opposite of what a per-business row looks like it does.

One business's failure is caught, recorded and does not abort the others.
Behaviourally a no-op while only the singleton is active, which is what
makes it safe to land now and easy to test.

platformBusinessId() replaces the bare constant on the Calendly and GHL
webhooks. It is a SEAM, not a resolution: those two genuinely cannot
resolve a tenant until phase 2 gives each coach a connection row. Naming
it honestly gives phase 2 one greppable place instead of four literals.
Both webhook suites pass UNEDITED, which is what proves the swap was
behaviour-identical.

Three mutations run and killed, including moving logCronEnd inside the
loop."
```

---

## Task 11: The Twilio and Stripe webhooks resolve a real tenant

**Files:**
- Modify: `app/api/webhooks/twilio/inbound/route.ts:152, 266`
- Modify: `app/api/stripe/webhook/route.ts:206`
- Modify: `lib/db/businesses.ts` (add `getBusinessBySmsNumber`)
- Modify: `lib/db/contacts.ts` (add `findContactWithBusinessByIdentifiers`)
- Modify: `__tests__/api/webhooks/*twilio*`, `__tests__/api/webhooks/pipeline-hooks.test.ts`, `__tests__/api/webhooks/sequence-exit-hooks.test.ts`

**Interfaces:**
- Produces:
  - `getBusinessBySmsNumber(toNumber: string): Promise<string | null>`
  - `findContactWithBusinessByIdentifiers(args: { email?: string | null; userId?: string | null }): Promise<{ id: string; businessId: string } | null>`

- [ ] **Step 1: Write the failing tests**

```ts
// Twilio — the To number is the only tenant evidence an inbound SMS carries.
it("resolves the business from the To number", async () => {
  smsNumberRows = [{ business_id: "bbb", sms_sender_phone: "+15550001111" }]
  await POST(twilioReq({ To: "+15550001111", From: "+15559998888", Body: "STOP" }))
  expect(timelineInserts[0].business_id).toBe("bbb")
  expect(exitCalls[0][2]).toBe("bbb")
})

it("falls back to the platform business when no business claims the To number", async () => {
  // Correct, not lazy: sms_sender_phone defaults to '' and the singleton's
  // number lives in env today, so an unmatched number is the ORDINARY case
  // until a coach's number is configured.
  smsNumberRows = []
  await POST(twilioReq({ To: "+15550009999", From: "+15559998888", Body: "STOP" }))
  expect(timelineInserts[0].business_id).toBe(SINGLETON_BUSINESS_ID)
})

it("does NOT look up an empty To number", async () => {
  // sms_sender_phone is NOT NULL DEFAULT '', so .eq('sms_sender_phone','')
  // would match every business that has not configured one.
  await POST(twilioReq({ To: "", From: "+15559998888", Body: "STOP" }))
  expect(eqCalls.some(([c, v]) => c === "sms_sender_phone" && v === "")).toBe(false)
})

it("still answers TwiML", async () => {
  // JSON 12300s every STOP. 27 green tests missed this once because the route
  // still answered 200.
  const res = await POST(twilioReq({ To: "+15550001111", From: "+1555", Body: "STOP" }))
  expect(res.headers.get("content-type")).toMatch(/xml/)
})

// Stripe — the webhook has no tenant; the payer's contact row does.
it("takes the business from the contact it resolved, not the singleton", async () => {
  contactRow = { id: "c1", business_id: "bbb" }
  await POST(stripeReq(sessionCompleted))
  expect(exitCalls[0]).toEqual(["c1", "payment", "bbb"])
})

it("warns and picks the oldest when two businesses know the same email", async () => {
  contactRows = [
    { id: "c-old", business_id: "aaa", created_at: "2026-01-01T00:00:00Z" },
    { id: "c-new", business_id: "bbb", created_at: "2026-06-01T00:00:00Z" },
  ]
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  await POST(stripeReq(sessionCompleted))
  expect(exitCalls[0][2]).toBe("aaa")
  expect(warn).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run to fail, then implement**

`lib/db/businesses.ts`:

```ts
/**
 * Which business owns this inbound number. The To number is the only tenant
 * evidence an inbound SMS carries, and business_settings.sms_sender_phone
 * (00221) already holds it.
 *
 * Returns null rather than throwing on no match: an unmatched number is the
 * ORDINARY case today, because sms_sender_phone is NOT NULL DEFAULT '' and
 * the platform's own number still lives in the environment. The caller falls
 * back to the platform business.
 */
export async function getBusinessBySmsNumber(toNumber: string): Promise<string | null> {
  const to = toNumber.trim()
  // '' would match every business that has not configured a number.
  if (!to) return null
  const { data, error } = await getClient()
    .from("business_settings")
    .select("business_id")
    .eq("sms_sender_phone", to)
    .maybeSingle()
  if (error) {
    // Logged, not thrown: a failed read here must not 500 the SMS webhook,
    // and PostgREST resolves rather than throwing so this is the only
    // diagnostic. The caller falls back to the platform business.
    console.error(`[businesses] getBusinessBySmsNumber failed (${error.code} ${error.message})`)
    return null
  }
  return (data as { business_id: string } | null)?.business_id ?? null
}
```

`lib/db/contacts.ts`:

```ts
/**
 * DELIBERATELY UNSCOPED -- the only contact lookup in this repo with no
 * business predicate, and it must stay that way. Its caller is a vendor
 * webhook (one Stripe account serves every business) which has NO tenant in
 * scope; the contact row it finds is what SUPPLIES the tenant to every
 * consequence downstream. Do not "fix" this by adding a businessId: a
 * businessId here would have to be a guess, and the guess is the leak.
 *
 * KNOWN AMBIGUITY, stated rather than hidden: two businesses can each hold a
 * contact with the same email -- a shared lead. Resolution is the OLDEST row
 * (the first business to know this person) plus a warning, which is
 * deterministic but not RIGHT. The right fix is stamping business_id into the
 * Stripe checkout session metadata at creation and preferring it when
 * present; that touches every checkout creation site and is phase 4.
 */
export async function findContactWithBusinessByIdentifiers(args: {
  email?: string | null
  userId?: string | null
}): Promise<{ id: string; businessId: string } | null> {
  const supabase = getClient()

  const pick = async (column: "user_id" | "email", value: string) => {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, business_id, created_at")
      .eq(column, value)
      .order("created_at", { ascending: true })
    if (error) throw error
    const rows = (data ?? []) as { id: string; business_id: string }[]
    if (rows.length === 0) return null
    if (rows.length > 1) {
      console.warn(
        `[contacts] ${rows.length} contacts across businesses match ${column}; taking the oldest (${rows[0].business_id}). ` +
          `Stamp business_id into the checkout session to remove this ambiguity.`,
      )
    }
    return { id: rows[0].id, businessId: rows[0].business_id }
  }

  if (args.userId) {
    const hit = await pick("user_id", args.userId)
    if (hit) return hit
  }
  const email = normaliseEmail(args.email)
  if (email) {
    const hit = await pick("email", email)
    if (hit) return hit
  }
  return null
}
```

Then in the routes:
- **Twilio** — resolve once near the top: `const businessId = (await getBusinessBySmsNumber(to)) ?? platformBusinessId()`, and thread it into `writeTimelineEvent` (replacing `:152`'s literal), `exitRunsForContact` (`:266`), and the sibling `findContactByIdentifiers` / `suppress` / `recordConsent` / `applyPipelineEvent` calls the handover named.
- **Stripe** — replace `findContactByIdentifiers({ userId, email })` at `:206` with `findContactWithBusinessByIdentifiers({ userId, email })` and pass the resolved `businessId` to `exitRunsForContact` and `applyPipelineEvent`.

- [ ] **Step 3: Run every suite that reaches either route**

```bash
npx vitest run $(grep -rln 'twilio\|stripe\|pipeline-hooks\|sequence-exit' __tests__ | tr '\n' ' ')
```

Expected: all PASS with non-zero counts. If a suite reports "no tests", add `// @vitest-environment node` on line 1 before concluding anything.

- [ ] **Step 4: Mutation**

1. Twilio: change the fallback to `getBusinessBySmsNumber(to) ?? "aaa"` → the fallback test MUST fail on the value.
2. Twilio: remove the `if (!to) return null` guard → the empty-To test MUST fail.
3. Stripe: pass `SINGLETON_BUSINESS_ID` to `exitRunsForContact` instead of the resolved id → the "takes the business from the contact" test MUST fail.
4. Stripe: change `.order("created_at", { ascending: true })` to `false` → the tie-break test MUST fail (it would pick `bbb`).

- [ ] **Step 5: Verify and commit**

```bash
npx tsc --noEmit 2>&1 | grep -c 'error TS'
```

Expected: `251`.

```bash
git commit -m "fix(tenancy): the Twilio and Stripe webhooks resolve a real tenant

Both routes passed SINGLETON_BUSINESS_ID with a comment calling it a
sanctioned placeholder. Both can do better than a placeholder now.

Twilio resolves the business from the To number via
business_settings.sms_sender_phone, which 00221 already added -- the To
number is the only tenant evidence an inbound SMS carries. An empty To is
NOT looked up: sms_sender_phone is NOT NULL DEFAULT '', so an empty query
would match every business that has not configured one. An unmatched
number falls back to the platform business, which is the ordinary case
until a coach's number is set. The route still answers TwiML; JSON
12300s every STOP.

Stripe resolves from the payer's contact row through one deliberately
unscoped lookup -- one Stripe account serves every business, so the
webhook carries no tenant but the contact record does. The known
ambiguity is stated rather than hidden: two businesses can hold the same
email, and the oldest row wins with a warning. Deterministic, not right;
the right fix stamps business_id into the checkout session metadata and
is phase 4.

Four mutations run and killed, including the ordering that decides the
tie-break."
```

---

## Task 12: The Google Ads write half

**Files:**
- Modify: `lib/db/google-ads-accounts.ts`
- Modify: `functions/src/ads/dal.ts`
- Modify: the OAuth callback that calls `upsertGoogleAdsAccount`
- Modify: `__tests__` suites reaching either

**Interfaces:**
- Produces:
  - `upsertGoogleAdsAccount(account: UpsertGoogleAdsAccountInput, businessId: string): Promise<GoogleAdsAccount>`
  - `class AdsAccountOwnedByAnotherBusinessError extends Error`
  - `functions/src/ads/dal.ts:getActiveGoogleAdsAccounts` gains a `businessId` predicate.

- [ ] **Step 1: Write the failing tests**

```ts
it("writes business_id on insert — the whole missing write half", async () => {
  existing = null
  await upsertGoogleAdsAccount({ customer_id: "123" }, "bbb")
  expect(inserted[0].business_id).toBe("bbb")
})

it("keeps matching on customer_id alone, which is the primary key", async () => {
  existing = { customer_id: "123", business_id: "bbb" }
  await upsertGoogleAdsAccount({ customer_id: "123" }, "bbb")
  expect(eqCalls.filter(([c]) => c === "customer_id")).not.toHaveLength(0)
})

it("REFUSES to move an account between businesses", async () => {
  // Re-discovery silently reassigning a coach's ad account is the failure
  // this guard exists for.
  existing = { customer_id: "123", business_id: "aaa" }
  await expect(upsertGoogleAdsAccount({ customer_id: "123" }, "bbb"))
    .rejects.toBeInstanceOf(AdsAccountOwnedByAnotherBusinessError)
  expect(updates).toHaveLength(0)
})

it("does not clobber is_active on the update branch", async () => {
  existing = { customer_id: "123", business_id: "bbb" }
  await upsertGoogleAdsAccount({ customer_id: "123" }, "bbb")
  expect(Object.keys(updates[0])).not.toContain("is_active")
})
```

- [ ] **Step 2: Run to fail, then implement**

```ts
/** Re-discovery must not silently move an ad account between coaches. */
export class AdsAccountOwnedByAnotherBusinessError extends Error {
  constructor(customerId: string, ownerBusinessId: string) {
    super(`Google Ads account ${customerId} already belongs to business ${ownerBusinessId}`)
    this.name = "AdsAccountOwnedByAnotherBusinessError"
  }
}
```

In `upsertGoogleAdsAccount`: add `businessId: string` as a required second parameter; select `customer_id, business_id` on the existence read; if `existing && existing.business_id !== businessId` throw the new error; write `business_id: businessId` in the insert. Replace the singleton-only doc comment with one describing the new contract, and record there that `customer_id` is the PRIMARY KEY with nine child foreign keys, so `(customer_id, business_id)` is not available and one customer id genuinely belongs to one business.

In `functions/src/ads/dal.ts`, add the `.eq("business_id", businessId)` predicate to its own `getActiveGoogleAdsAccounts`. It is a **twin, not a caller** — `functions/` cannot import from `lib/` — so it needs its own edit and its own test in the functions suite.

- [ ] **Step 3: Run every suite reaching ads through a route**

```bash
npx vitest run $(grep -rln 'google-ads\|googleAds\|ads/' __tests__ | tr '\n' ' ')
```

Expected: all PASS with non-zero counts.

- [ ] **Step 4: Mutation**

1. Delete the ownership check → the "REFUSES to move" test MUST fail.
2. Remove `business_id: businessId` from the insert → the write-half test MUST fail.
3. In the Firebase twin, remove the new predicate → its test MUST fail.

- [ ] **Step 5: Verify and commit**

```bash
npx tsc --noEmit 2>&1 | grep -c 'error TS'
```

Expected: `251`.

```bash
git commit -m "fix(ads): the per-tenant reader finally has a per-tenant writer

getActiveGoogleAdsAccounts has filtered on business_id since 00242 while
upsertGoogleAdsAccount never wrote it, so no business but the singleton
could ever have an ads account and enqueueBookingConversion returned null
silently for every other one -- a lookup keyed on a column nothing writes
returns empty, which reads exactly like 'nothing to do'.

upsertGoogleAdsAccount now takes a required businessId and writes it on
insert. It KEEPS matching on customer_id alone, which is correct because
customer_id is the PRIMARY KEY: the handover's suggested
(customer_id, business_id) match is not available, since nine child
tables carry foreign keys onto it and widening the key would mean
rewriting all nine. One Google Ads customer id is one real ad account and
genuinely belongs to one coach, so no migration is needed here at all.

Re-discovery finding an account that belongs to another business now
THROWS rather than silently reassigning it.

functions/src/ads/dal.ts is a Firebase twin, not a caller, and got the
same predicate in its own edit with its own test."
```

---

## Task 13: Attribution and the contact record's bookings

**Files:**
- Modify: `lib/db/marketing-attribution.ts:133`
- Modify: `lib/bookings/ingest.ts:337`, `app/api/stripe/webhook/route.ts:469`
- Modify: `lib/db/contact-detail.ts:603-611` (and delete `bookingMatchesContact` if it has no other caller)
- Modify: `__tests__/lib/bookings/ingest.test.ts`, the stripe suites, any contact-detail suite

**Interfaces:**
- Produces: `findAttributionForContact(args: { userId: string; withinDays?: number }): Promise<MarketingAttribution | null>` replacing `findAttributionByEmail`.

- [ ] **Step 1: Confirm `bookingMatchesContact` has no other caller before planning its deletion**

```bash
grep -rn 'bookingMatchesContact' --include='*.ts' lib app __tests__
```

If a test imports it directly, **retarget that test** at the new join behaviour rather than deleting it.

- [ ] **Step 2: Write the failing tests**

```ts
// contact-detail: two faults, not one.
it("scopes the bookings read to the business AND joins on contact_id", async () => {
  await getContactDetail("c1", "bbb")
  expect(eqCalls).toContainEqual(["business_id", "bbb"])
  expect(eqCalls).toContainEqual(["contact_id", "c1"])
})

it("no longer reads another business's bookings into the window", async () => {
  // Before: no tenant predicate at all, so another business's bookings could
  // both fill the window and match on a shared email.
  expect(eqCalls.some(([c]) => c === "contact_id")).toBe(true)
  expect(returnedBookings.every((b) => b.business_id === "bbb")).toBe(true)
})

// attribution
it("keys on the resolved user_id, not a bare email", async () => {
  await findAttributionForContact({ userId: "u9" })
  expect(eqCalls).toContainEqual(["user_id", "u9"])
  expect(selectArg).not.toMatch(/users!inner/)
})

it("keeps the 30-day window", async () => {
  await findAttributionForContact({ userId: "u9" })
  expect(gteCalls[0][0]).toBe("first_seen_at")
})
```

- [ ] **Step 3: Run to fail, then implement**

`lib/db/marketing-attribution.ts` — replace `findAttributionByEmail` with `findAttributionForContact`:

```ts
/**
 * Attribution for a contact, keyed on the contact's OWN user_id.
 *
 * marketing_attribution has no business_id and cannot get one in this phase:
 * captureAttribution runs in proxy.ts, where the tenant is not resolved until
 * phase 4, and a column with no correct writer is a labelling gap rather than
 * a feature. So the tenant safety here comes from HOW the userId was obtained
 * -- the caller resolved it from a contact of its own business.
 *
 * The old `users!inner(email)` join is gone, and nothing is lost by it:
 * marketing_attribution.user_id is nullable with a partial index
 * (00101:7,25), so that join only ever matched rows already CLAIMED by a
 * registered user. A contact with no user_id had no match then either.
 *
 * The 30-day default window is unchanged -- it is a settled decision.
 */
export async function findAttributionForContact(args: {
  userId: string
  withinDays?: number
}): Promise<MarketingAttribution | null> {
  const supabase = getClient()
  const since = new Date(Date.now() - (args.withinDays ?? 30) * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from("marketing_attribution")
    .select("*")
    .eq("user_id", args.userId)
    .gte("first_seen_at", since)
    .order("first_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as MarketingAttribution | null) ?? null
}
```

Both callers resolve the contact's `user_id` first and skip the lookup when it is null.

`lib/db/contact-detail.ts:603-611` — replace the whole in-memory block:

```ts
  // Bookings now join on contact_id, which phase 0 started writing. That fixes
  // TWO faults the in-memory match had: this read carried no tenant predicate
  // at all, so another business's bookings could fill the window AND a shared
  // email could match another coach's booking onto this contact record.
  //
  // The phone-format trap that forced the in-memory match is still true --
  // bookings store national-format phones, so .eq() on phone_e164 matches zero
  // rows forever and .ilike() on email is a PII disclosure. Keying on
  // contact_id sidesteps both, which is why the join is the fix rather than a
  // tightened comparison.
  //
  // Rows written before phase 0 have a null contact_id and drop off the record.
  // Correct: they were never provably this contact's.
  let bookings: BookingRow[] = []
  const { data, error } = await supabase
    .from("bookings")
    .select("id, booking_date, duration_minutes, status, source, created_at")
    .eq("business_id", businessId)
    .eq("contact_id", contact.id)
    .order("booking_date", { ascending: false })
    .limit(BOOKINGS_WINDOW)
  if (error) throw new Error(`getContactDetail bookings: ${error.message}`)
  bookings = (data ?? []) as BookingRow[]
  const bookingsWindowFull = bookings.length >= BOOKINGS_WINDOW
```

`getContactDetail`'s `businessId` (currently defaulted at `:509`) is passed by its admin caller.

- [ ] **Step 4: Run every suite reaching these through a route**

```bash
npx vitest run $(grep -rln 'attribution\|contact-detail\|contactDetail\|ingest' __tests__ | tr '\n' ' ')
```

Expected: all PASS with non-zero counts.

- [ ] **Step 5: Mutation**

1. Remove `.eq("business_id", businessId)` from the bookings read → its test MUST fail.
2. Remove `.eq("contact_id", contact.id)` → its test MUST fail.
3. Change `.eq("user_id", args.userId)` to a literal → the attribution test MUST fail on the value.

- [ ] **Step 6: Verify and commit**

```bash
npx tsc --noEmit 2>&1 | grep -c 'error TS'
```

Expected: `251`.

```bash
git commit -m "fix(tenancy): attribution keys on the contact, and bookings join on contact_id

contact-detail's bookings read had NO tenant predicate at all and matched
by in-memory email/phone comparison. Two faults, not one: another
business's bookings could fill the window and starve this contact's own,
and a shared email could match another coach's booking onto this
contact's record. Both close with .eq(business_id).eq(contact_id), which
phase 0 made possible by starting to write contact_id.

The phone-format trap that forced the in-memory match is still true --
national-format phones make .eq(phone_e164) match nothing forever and
.ilike() on email is a PII disclosure -- which is exactly why the join is
the fix rather than a tightened comparison. Pre-phase-0 rows have a null
contact_id and drop off; they were never provably this contact's.

findAttributionByEmail becomes findAttributionForContact, keyed on the
contact's own user_id. marketing_attribution gets NO business_id column:
captureAttribution runs in proxy.ts where the tenant is not resolved
until phase 4, and a column with no correct writer is a labelling gap.
The tenant safety comes from how the userId was obtained.

Dropping the users!inner join loses nothing -- user_id is nullable with a
partial index, so that join only ever matched already-claimed rows. The
30-day window is untouched; it is a settled decision."
```

---

## Task 14: Prove it in a browser

**Files:**
- Create: `scripts/capture-phase1-multicoach-screenshots.mjs`
- Create: `screenshots/calendly-per-coach-phase1/*.png` + `README.md`

- [ ] **Step 1: Read the reference capture script first**

```bash
sed -n '1,140p' scripts/capture-phase0-tenancy-screenshots.mjs
sed -n '1,80p' scripts/_annotate-lib.mjs
```

Reuse `markerOn(page, locator, caption, opts)` at `:97`, `shoot(page, name, title, subtitle, markers, opts)` at `:119`, and the `/api/dev/login?callbackUrl=...` sign-in at `:214`. Do not reimplement them.

- [ ] **Step 2: Start the dev server, redirected to a log**

```bash
cd "/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete-phase1"
npm run dev > /tmp/phase1-dev.log 2>&1 &
```

**Never pipe a long-running server to `head`** — it wedges, and every route then times out AFTER working fine (memory). Wait for "Ready" in the log before driving.

Migrations `00244` and `00245` must already be applied to the dev clone (Tasks 1 and 6). If the Businesses screen 500s, check that first: the dev clone has been missing migrations before.

- [ ] **Step 3: Capture the flow — through the real UI, in this order**

The second business must be created **through the form**, not seeded. A fixture proves render, not origination (memory), and the whole claim of this phase is that `createBusiness` works.

| # | Shot | State it must show |
|---|---|---|
| 01 | `/admin/businesses` | The list with the singleton, and the "Add a business" button |
| 02 | `/admin/businesses/new` | The filled form, slug pre-filled from the name |
| 03 | `/admin/businesses/new` | The **slug-taken 409** rendered on the slug field — type `primary` |
| 04 | `/admin/businesses/<new id>` | The new business's settings, saved, with a real timezone |
| 05 | `/admin/businesses/<new id>` | The members card, with the coach invite dialog open |
| 06 | `/admin/businesses` | Both businesses listed |
| 07 | Any admin page | The **switcher** visible, with two choices |
| 08 | `/admin/contacts` | Signed in as the **operator**, business B selected — B's rows |
| 09 | `/admin/contacts` | Signed in as the **coach** — B's rows, and **no switcher** |
| 10 | `/admin/bookings` | The coach's own bookings list, scoped |

Shot 09 is the one that proves the phase. It needs a real coach login: create the invite through shot 05, claim it, then sign in as that user. If `/api/dev/login` cannot mint a session for an arbitrary user, drive the real claim page and the real login form — reaching an awkward state is part of the job, not a reason to skip it.

- [ ] **Step 4: Burn the annotations in, at the capture's exact pixel width**

`annotate()` markers are raw pixels — derive them from `boundingBox × deviceScaleFactor`, **warn loudly** on a missing target and on a marker resolving to no element, and never let two markers resolve to one element (memory). Admin UI is light-only: do not capture a dark variant.

- [ ] **Step 5: Look at every PNG**

Read each file back with the Read tool and confirm the annotation sits on the element its caption names. `ffprobe`-style verification does not apply to stills; the check is that you looked.

- [ ] **Step 6: Write the README and commit**

`screenshots/calendly-per-coach-phase1/README.md` — one line per shot: what it shows and which spec section it evidences.

```bash
git add scripts/capture-phase1-multicoach-screenshots.mjs screenshots/calendly-per-coach-phase1
git commit -m "test(tenancy): ten annotated shots through the real admin routes

The second business is created THROUGH THE FORM, not seeded -- a fixture
proves render, not origination, and createBusiness working is the whole
claim of this phase.

Shot 09 is the one that proves it: signed in as a real invited coach,
/admin/contacts shows that business's rows and NO switcher. The coach
login comes from claiming a real invite minted in shot 05.

Shot 03 captures the slug-taken 409 rendered on the field rather than as
a toast, which is the behaviour Task 4's test pins.

Annotations burned into the PNGs at the capture's exact pixel width,
markers derived from boundingBox x DSF. Light-only: .dark is a class
variant these components were never built against."
```

---

## Task 15: Whole-branch review and the handover

- [ ] **Step 1: Confirm no live singleton literals remain where they should not**

```bash
grep -rn 'SINGLETON_BUSINESS_ID' --include='*.ts' --include='*.tsx' app lib | grep -v '__tests__'
```

Every remaining hit must be one of: `lib/lead-engine/constants.ts` (the definition), `lib/tenancy/platform.ts` (the seam), `lib/db/bookings.ts:35` (`singletonHostId`, deliberate), `getBusinessSettings`' default (six public callers, phase 4), `lib/tenancy/resolve.ts` (the compatibility fallback), or a comment. **Read each one** — text assertions must exclude prose, and grepping for a constant also matches the comment explaining it.

- [ ] **Step 2: Confirm the error set, not the count**

```bash
git worktree add --detach /tmp/phase1-baseline 963745ab
cd /tmp/phase1-baseline && npm ci --silent && npx tsc --noEmit 2>&1 | grep 'error TS' | sort > /tmp/baseline-errors.txt
cd "/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete-phase1" && npx tsc --noEmit 2>&1 | grep 'error TS' | sort > /tmp/branch-errors.txt
diff /tmp/baseline-errors.txt /tmp/branch-errors.txt
```

Expected: no diff. A matching count with a diff is a swap and must be explained line by line.

- [ ] **Step 3: Request an independent review**

Use `superpowers:requesting-code-review` on the whole branch. Ask the reviewer specifically to:
- **run** the mutations, not reason about them — the cookie check in `select()` above all;
- check every suite list against `grep` for importers;
- confirm no migration sets a constraint the old build could violate.

- [ ] **Step 4: Update `JOURNAL.md` (local only, never staged) and the memory directory**

- [ ] **Step 5: Report to the owner** — what is done, what needs their go-ahead (the push, the PR, and the tighten branch's two production `SELECT`s), and every decision made under autonomy.

---

## Self-Review

**1. Spec coverage.** Every spec section maps to a task: §3 → Task 3; §4 → Tasks 1–2; §5.1–5.2 → Task 4; §5.3 → Tasks 5–6; §6.1–6.2 → Tasks 7–9; §6.3 → Task 6; §6.4 → Task 10; §7.1 → Task 12; §7.2 → Task 11; §7.3 → Task 13; §7.4 → Task 13; §8 → Tasks 1, 6; §9 → every task's mutation step; §10 → Task 14; §11 → Task 15.

**2. Placeholders.** Two deliberate `<paste the resulting signatures here>` markers in Tasks 8 and 9's commit messages — those are instructions to record real output, not unwritten content. Tasks 4, 5, 6, 8, 9 carry explicit "read the real component/type first and follow it, not this sketch" notes where the plan is writing against a file it has not fully read; that is marked, per the phase-0 lesson that an instruction stated with confidence is the one a subagent will not verify.

**3. Type consistency.** `businessId` is the parameter name throughout. `ResolvedTenant.choices` is `BusinessChoice[]` in Tasks 3, 4, 5, 7. `getBookings(businessId, status?)` has `businessId` first in both the interface block and the code. `addBusinessMember` returns `"added" | "already"` in both its test and its implementation. `platformBusinessId()` is defined in Task 10 and referenced forward from Tasks 8 and 9 — those two tasks must therefore run **after** Task 10, or create the one-line module themselves; noted here because the task numbering does not otherwise imply it.

**Ordering constraint:** Tasks 1 → 2 → 3 are strictly sequential. Task 10 must precede Tasks 8 and 9 (both reference `platformBusinessId()`). Tasks 11, 12, 13 are independent of each other and of 7–9. Task 14 needs 1–13. Task 15 is last.
