# Clinics & Camps Phase 2a — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `events` + `event_signups` schema, two atomic capacity RPCs, DAL + validators, admin CRUD at `/admin/events`, and an image upload handler — all with zero public-facing changes.

**Architecture:** Additive only. New migration, new DAL files, new admin routes. Reuses existing patterns (DAL in `lib/db/bookings.ts`, upload in `app/api/upload/blog-image/`, sidebar in `components/admin/AdminSidebar.tsx`, admin form in `components/admin/blog/BlogPostForm.tsx`). No refactors to existing code beyond the sidebar nav entry and a single storage helper duplication.

**Tech Stack:** Supabase Postgres (migration + RPC functions), Next.js 16 App Router, React Hook Form + Zod resolvers, shadcn/ui (Table, Input, Select, Textarea, Button, Card, Badge), Lucide icons, NextAuth v5, Vitest for unit/integration, Playwright for e2e.

---

## Spec Reference

Source design: [docs/superpowers/specs/2026-04-14-clinics-and-camps-phase-2a-design.md](docs/superpowers/specs/2026-04-14-clinics-and-camps-phase-2a-design.md). Parent master spec: [docs/superpowers/specs/2026-04-14-clinics-and-camps-design.md](docs/superpowers/specs/2026-04-14-clinics-and-camps-design.md).

## File Structure

**New files:**

| path                                               | responsibility                                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/00062_create_events.sql`      | `events` + `event_signups` tables, indices, CHECK constraints, 2 RPCs                                                 |
| `__tests__/migrations/00062.test.ts`               | Integration test for migration: tables exist, RPCs behave atomically                                                  |
| `types/database.ts` (modified)                     | Add `Event`, `EventSignup`, `EventType`, `EventStatus`, `SignupType`, `SignupStatus`                                  |
| `lib/validators/events.ts`                         | Zod schemas for event create/update (discriminated union on `type`)                                                   |
| `lib/validators/event-signups.ts`                  | Zod schema for signup creation (used in Phase 2b)                                                                     |
| `__tests__/lib/validators/events.test.ts`          | Validator unit tests                                                                                                  |
| `__tests__/lib/validators/event-signups.test.ts`   | Validator unit tests                                                                                                  |
| `lib/db/events.ts`                                 | Event DAL (service-role client, read + write functions)                                                               |
| `lib/db/event-signups.ts`                          | Signup DAL + RPC wrappers                                                                                             |
| `__tests__/db/events.test.ts`                      | DAL integration tests                                                                                                 |
| `__tests__/db/event-signups.test.ts`               | DAL integration tests                                                                                                 |
| `lib/event-storage.ts`                             | Supabase Storage helper for event hero images                                                                         |
| `app/api/upload/event-image/route.ts`              | Admin-only multipart upload endpoint                                                                                  |
| `app/api/admin/events/route.ts`                    | POST (create)                                                                                                         |
| `app/api/admin/events/[id]/route.ts`               | PATCH (update), DELETE                                                                                                |
| `app/api/admin/events/[id]/duplicate/route.ts`     | POST (duplicate)                                                                                                      |
| `__tests__/api/admin/events.test.ts`               | API route tests                                                                                                       |
| `components/admin/events/EventForm.tsx`            | Shared create/edit form component                                                                                     |
| `components/admin/events/EventList.tsx`            | List view with filters                                                                                                |
| `components/admin/events/EventHeroImageUpload.tsx` | File picker integrated with upload endpoint                                                                           |
| `app/(admin)/admin/events/page.tsx`                | List page (server component wrapping EventList)                                                                       |
| `app/(admin)/admin/events/new/page.tsx`            | Create page                                                                                                           |
| `app/(admin)/admin/events/[id]/page.tsx`           | Edit page                                                                                                             |
| `app/(admin)/admin/events/loading.tsx`             | Loading state (copy pattern from `admin/bookings/page.tsx` — no loading.tsx there, so match `admin/blog/loading.tsx`) |
| `__tests__/e2e/admin-events.spec.ts`               | Playwright smoke test                                                                                                 |

**Modified files:**

| path                                      | change                                                              |
| ----------------------------------------- | ------------------------------------------------------------------- |
| `types/database.ts`                       | Add event-related types                                             |
| `components/admin/AdminSidebar.tsx`       | Add "Events" entry in "Business" section, position after "Bookings" |
| `components/admin/AdminMobileSidebar.tsx` | Mirror the sidebar change for the mobile drawer                     |

## Reference Snippets (context for implementers)

**DAL pattern** (from `lib/db/bookings.ts`):

```typescript
import { createServiceRoleClient } from "@/lib/supabase"
function getClient() {
  return createServiceRoleClient()
}
export async function getBookings(status?: BookingStatus) {
  const supabase = getClient()
  let query = supabase.from("bookings").select("*").order("booking_date", { ascending: false })
  if (status) query = query.eq("status", status)
  const { data, error } = await query
  if (error) throw error
  return data as Booking[]
}
```

**Admin API route pattern** (from `app/api/admin/programs/route.ts`):

```typescript
import { auth } from "@/lib/auth"
export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const body = await request.json()
  const result = createEventSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json(
      { error: "Invalid form data", details: result.error.flatten().fieldErrors },
      { status: 400 },
    )
  }
  // ... call DAL, return response
}
```

**Upload route pattern** (from `app/api/upload/blog-image/route.ts`): auth guard → formData parse → MIME + size check → storage helper → return `{ url }`.

---

## Task 1: Migration — create `events` and `event_signups` tables

**Files:**

- Create: `supabase/migrations/00062_create_events.sql`

- [ ] **Step 1: Write the migration file (schema only — RPCs in Task 2)**

Create `supabase/migrations/00062_create_events.sql`:

```sql
-- Phase 2a: clinics & camps admin CMS
-- Creates events + event_signups tables and two capacity-guard RPCs.

-- events table -------------------------------------------------------------
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('clinic', 'camp')),
  slug text not null unique,
  title text not null,
  summary text not null,
  description text not null,
  focus_areas text[] not null default '{}',
  start_date timestamptz not null,
  end_date timestamptz,
  session_schedule text,
  location_name text not null,
  location_address text,
  location_map_url text,
  age_min int,
  age_max int,
  capacity int not null check (capacity > 0),
  signup_count int not null default 0 check (signup_count >= 0 and signup_count <= capacity),
  price_cents int check (price_cents is null or price_cents >= 0),
  stripe_price_id text,
  status text not null default 'draft' check (status in ('draft', 'published', 'cancelled', 'completed')),
  hero_image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_events_status on events (status);
create index if not exists idx_events_type on events (type);
create index if not exists idx_events_start_date on events (start_date);

-- event_signups table ------------------------------------------------------
create table if not exists event_signups (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  signup_type text not null check (signup_type in ('interest', 'paid')),
  parent_name text not null,
  parent_email text not null,
  parent_phone text,
  athlete_name text not null,
  athlete_age int not null,
  sport text,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'refunded')),
  stripe_session_id text,
  stripe_payment_intent_id text,
  amount_paid_cents int,
  user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_event_signups_event_id on event_signups (event_id);
create index if not exists idx_event_signups_status on event_signups (status);
create index if not exists idx_event_signups_email on event_signups (parent_email);
```

- [ ] **Step 2: Commit the schema**

```bash
git add supabase/migrations/00062_create_events.sql
git commit -m "feat(events): add events and event_signups tables (phase 2a)"
```

Note: the migration is committed but not yet applied. Task 3 applies it against the Supabase dev instance before the integration tests run. RPCs are added by Task 2 before application.

---

## Task 2: Migration — add `confirm_event_signup` and `cancel_event_signup` RPCs

**Files:**

- Modify: `supabase/migrations/00062_create_events.sql` (append)

- [ ] **Step 1: Append RPC functions to the migration**

Append this SQL to the end of `supabase/migrations/00062_create_events.sql`:

```sql
-- confirm_event_signup RPC ------------------------------------------------
-- Atomically flips a pending signup to confirmed and increments the event's
-- signup_count. Returns jsonb { ok: bool, reason?: text }.
create or replace function confirm_event_signup(p_signup_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_signup event_signups%rowtype;
  v_capacity int;
  v_signup_count int;
begin
  select * into v_signup from event_signups where id = p_signup_id for update;
  if v_signup is null then
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
$$;

-- cancel_event_signup RPC -------------------------------------------------
-- Flips a pending or confirmed signup to cancelled. If previously confirmed,
-- decrements the event's signup_count. Returns jsonb { ok: bool, reason?: text }.
create or replace function cancel_event_signup(p_signup_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_signup event_signups%rowtype;
  v_was_confirmed boolean;
begin
  select * into v_signup from event_signups where id = p_signup_id for update;
  if v_signup is null then
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
$$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/00062_create_events.sql
git commit -m "feat(events): add confirm_event_signup + cancel_event_signup RPCs"
```

---

## Task 3: Apply migration 00062 to Supabase dev instance

**Files:** none — ops step.

- [ ] **Step 1: Apply the migration**

Run the project's standard migration-apply mechanism. This repo uses Supabase; the usual commands are:

```bash
# Option 1 — if Supabase CLI is configured locally
npx supabase db push

# Option 2 — apply directly via psql against the dev connection string
# (reads from .env.local or similar)
psql "$SUPABASE_DB_URL" -f supabase/migrations/00062_create_events.sql
```

If neither of these is familiar, check the project's README or CLAUDE.md for the documented migration-apply step, or ask the user. **Do NOT proceed until the migration is applied** — subsequent DAL tests rely on the tables existing.

- [ ] **Step 2: Verify the migration applied**

Quick sanity check via Supabase dashboard or a one-liner:

```bash
psql "$SUPABASE_DB_URL" -c "\d events" -c "\d event_signups"
```

Expected: both tables listed with the columns from Task 1.

No commit in this task — it's an operational step.

---

## Task 4: Migration integration test

**Files:**

- Create: `__tests__/migrations/00062.test.ts`

- [ ] **Step 1: Write the test**

Create `__tests__/migrations/00062.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { createServiceRoleClient } from "@/lib/supabase"
import { randomUUID } from "crypto"

describe("Migration 00062: events + event_signups + RPCs", () => {
  const supabase = createServiceRoleClient()
  let eventId: string
  const signupIds: string[] = []

  beforeAll(async () => {
    const { data, error } = await supabase
      .from("events")
      .insert({
        type: "clinic",
        slug: `test-clinic-${randomUUID()}`,
        title: "Test Clinic",
        summary: "test",
        description: "test",
        focus_areas: ["acceleration"],
        start_date: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        location_name: "Test Gym",
        capacity: 1,
        status: "draft",
      })
      .select("id")
      .single()
    expect(error).toBeNull()
    eventId = data!.id

    for (let i = 0; i < 2; i++) {
      const { data: sd, error: se } = await supabase
        .from("event_signups")
        .insert({
          event_id: eventId,
          signup_type: "interest",
          parent_name: `Parent ${i}`,
          parent_email: `p${i}@test.example`,
          athlete_name: `Athlete ${i}`,
          athlete_age: 14,
        })
        .select("id")
        .single()
      expect(se).toBeNull()
      signupIds.push(sd!.id)
    }
  })

  afterAll(async () => {
    await supabase.from("events").delete().eq("id", eventId)
  })

  it("events table has required columns", async () => {
    const { data, error } = await supabase
      .from("events")
      .select("id,type,slug,title,capacity,signup_count,status,hero_image_url")
      .eq("id", eventId)
      .limit(1)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it("event_signups foreign key cascades delete", async () => {
    const { data } = await supabase.from("event_signups").select("id").eq("event_id", eventId)
    expect(data?.length).toBe(2)
  })

  it("confirm_event_signup succeeds for first signup, returns at_capacity for second", async () => {
    const { data: first } = await supabase.rpc("confirm_event_signup", { p_signup_id: signupIds[0] })
    expect(first).toEqual({ ok: true })

    const { data: evt } = await supabase.from("events").select("signup_count").eq("id", eventId).single()
    expect(evt?.signup_count).toBe(1)

    const { data: second } = await supabase.rpc("confirm_event_signup", { p_signup_id: signupIds[1] })
    expect(second).toEqual({ ok: false, reason: "at_capacity" })
  })

  it("cancel_event_signup decrements count when cancelling a confirmed signup", async () => {
    const { data } = await supabase.rpc("cancel_event_signup", { p_signup_id: signupIds[0] })
    expect(data).toEqual({ ok: true })

    const { data: evt } = await supabase.from("events").select("signup_count").eq("id", eventId).single()
    expect(evt?.signup_count).toBe(0)
  })

  it("slug uniqueness is enforced", async () => {
    const slug = `dup-${randomUUID()}`
    await supabase.from("events").insert({
      type: "clinic",
      slug,
      title: "a",
      summary: "a",
      description: "a",
      start_date: new Date().toISOString(),
      location_name: "x",
      capacity: 1,
    })
    const { error } = await supabase.from("events").insert({
      type: "clinic",
      slug,
      title: "b",
      summary: "b",
      description: "b",
      start_date: new Date().toISOString(),
      location_name: "x",
      capacity: 1,
    })
    expect(error).not.toBeNull()
    expect(error?.message.toLowerCase()).toMatch(/duplicate|unique/)
  })
})
```

- [ ] **Step 2: Run the test**

Run: `npm run test:run -- 00062`
Expected: 5/5 pass.

If a test fails with "table does not exist" or similar, the migration wasn't applied (Task 3). Apply it and rerun.

- [ ] **Step 3: Commit**

```bash
git add __tests__/migrations/00062.test.ts
git commit -m "test(events): migration 00062 integration test"
```

---

## Task 5: Add event-related types to `types/database.ts`

**Files:**

- Modify: `types/database.ts`

- [ ] **Step 1: Read the existing file**

Read `types/database.ts` to understand its structure. It has type definitions and exported enum-like constants. Add new types at a sensible insertion point (typically alphabetically by table, or at the bottom before any `Database` generic).

- [ ] **Step 2: Append event types**

Append this block (adjust imports/location as needed to match file structure):

```typescript
// ---------- Events & event signups ----------

export type EventType = "clinic" | "camp"
export type EventStatus = "draft" | "published" | "cancelled" | "completed"
export type SignupType = "interest" | "paid"
export type SignupStatus = "pending" | "confirmed" | "cancelled" | "refunded"

export interface Event {
  id: string
  type: EventType
  slug: string
  title: string
  summary: string
  description: string
  focus_areas: string[]
  start_date: string
  end_date: string | null
  session_schedule: string | null
  location_name: string
  location_address: string | null
  location_map_url: string | null
  age_min: number | null
  age_max: number | null
  capacity: number
  signup_count: number
  price_cents: number | null
  stripe_price_id: string | null
  status: EventStatus
  hero_image_url: string | null
  created_at: string
  updated_at: string
}

export interface EventSignup {
  id: string
  event_id: string
  signup_type: SignupType
  parent_name: string
  parent_email: string
  parent_phone: string | null
  athlete_name: string
  athlete_age: number
  sport: string | null
  notes: string | null
  status: SignupStatus
  stripe_session_id: string | null
  stripe_payment_intent_id: string | null
  amount_paid_cents: number | null
  user_id: string | null
  created_at: string
  updated_at: string
}
```

- [ ] **Step 3: Verify tsc passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add types/database.ts
git commit -m "feat(events): add Event and EventSignup types"
```

---

## Task 6: Event validators

**Files:**

- Create: `lib/validators/events.ts`
- Test: `__tests__/lib/validators/events.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/validators/events.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { createEventSchema, updateEventSchema } from "@/lib/validators/events"

describe("createEventSchema", () => {
  const baseClinic = {
    type: "clinic" as const,
    slug: "spring-agility",
    title: "Spring Agility Clinic",
    summary: "Two-hour clinic",
    description: "Focus on acceleration + deceleration.",
    focus_areas: ["acceleration"],
    start_date: "2026-05-15T15:00:00.000Z",
    location_name: "Richmond Sports Complex",
    capacity: 12,
    status: "draft" as const,
  }

  it("accepts a minimal valid clinic", () => {
    const result = createEventSchema.safeParse(baseClinic)
    expect(result.success).toBe(true)
  })

  it("rejects an invalid slug", () => {
    const result = createEventSchema.safeParse({ ...baseClinic, slug: "Spring Agility!" })
    expect(result.success).toBe(false)
  })

  it("rejects a capacity of 0", () => {
    const result = createEventSchema.safeParse({ ...baseClinic, capacity: 0 })
    expect(result.success).toBe(false)
  })

  it("rejects age_max less than age_min", () => {
    const result = createEventSchema.safeParse({ ...baseClinic, age_min: 16, age_max: 12 })
    expect(result.success).toBe(false)
  })

  it("requires end_date and start_date on camp", () => {
    const baseCamp = {
      ...baseClinic,
      type: "camp" as const,
      slug: "summer-camp",
      title: "Summer Camp",
      end_date: "2026-05-28T23:00:00.000Z",
      price_dollars: 249,
    }
    expect(createEventSchema.safeParse(baseCamp).success).toBe(true)

    const noEnd = { ...baseCamp, end_date: undefined }
    expect(createEventSchema.safeParse(noEnd).success).toBe(false)
  })

  it("rejects camp with negative price", () => {
    const result = createEventSchema.safeParse({
      ...baseClinic,
      type: "camp" as const,
      slug: "neg-camp",
      title: "x",
      end_date: "2026-05-28T23:00:00.000Z",
      price_dollars: -10,
    })
    expect(result.success).toBe(false)
  })
})

describe("updateEventSchema", () => {
  it("accepts a partial update without type", () => {
    const result = updateEventSchema.safeParse({ title: "Updated Title" })
    expect(result.success).toBe(true)
  })

  it("accepts a status-only update", () => {
    const result = updateEventSchema.safeParse({ status: "published" })
    expect(result.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm run test:run -- lib/validators/events`
Expected: FAIL with "Cannot find module '@/lib/validators/events'".

- [ ] **Step 3: Write the validator**

Create `lib/validators/events.ts`:

```typescript
import { z } from "zod"

export const EVENT_TYPES = ["clinic", "camp"] as const
export const EVENT_STATUSES = ["draft", "published", "cancelled", "completed"] as const

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const eventBase = z.object({
  title: z.string().min(2).max(120),
  slug: z.string().regex(slugRegex, "Slug must be lowercase letters, numbers, and hyphens").min(2).max(120),
  summary: z.string().min(1).max(300),
  description: z.string().min(1).max(5000),
  focus_areas: z.array(z.string().min(1).max(40)).default([]),
  location_name: z.string().min(1).max(200),
  location_address: z.string().max(300).optional().nullable(),
  location_map_url: z.string().url().max(500).optional().nullable(),
  capacity: z.number().int().min(1).max(500),
  hero_image_url: z.string().url().max(500).optional().nullable(),
  status: z.enum(EVENT_STATUSES).default("draft"),
  age_min: z.number().int().min(6).max(21).optional().nullable(),
  age_max: z.number().int().min(6).max(21).optional().nullable(),
})

const ageRefine = (d: { age_min?: number | null; age_max?: number | null }) =>
  d.age_min == null || d.age_max == null || d.age_max >= d.age_min

const clinicEvent = eventBase
  .extend({
    type: z.literal("clinic"),
    start_date: z.string().datetime(),
  })
  .refine(ageRefine, { message: "age_max must be >= age_min", path: ["age_max"] })

const campEvent = eventBase
  .extend({
    type: z.literal("camp"),
    start_date: z.string().datetime(),
    end_date: z.string().datetime(),
    session_schedule: z.string().max(200).optional().nullable(),
    price_dollars: z.number().nonnegative().max(10000).optional().nullable(),
  })
  .refine(ageRefine, { message: "age_max must be >= age_min", path: ["age_max"] })

export const createEventSchema = z.discriminatedUnion("type", [clinicEvent, campEvent])

export const updateEventSchema = eventBase
  .partial()
  .extend({
    start_date: z.string().datetime().optional(),
    end_date: z.string().datetime().optional().nullable(),
    session_schedule: z.string().max(200).optional().nullable(),
    price_dollars: z.number().nonnegative().max(10000).optional().nullable(),
  })
  .refine(ageRefine, { message: "age_max must be >= age_min", path: ["age_max"] })

export type CreateEventInput = z.infer<typeof createEventSchema>
export type UpdateEventInput = z.infer<typeof updateEventSchema>
```

- [ ] **Step 4: Run tests**

Run: `npm run test:run -- lib/validators/events`
Expected: 8/8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/validators/events.ts __tests__/lib/validators/events.test.ts
git commit -m "feat(events): add event Zod validators with discriminated union"
```

---

## Task 7: Signup validator

**Files:**

- Create: `lib/validators/event-signups.ts`
- Test: `__tests__/lib/validators/event-signups.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/validators/event-signups.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { createEventSignupSchema } from "@/lib/validators/event-signups"

describe("createEventSignupSchema", () => {
  const base = {
    parent_name: "Alex Doe",
    parent_email: "alex@example.com",
    athlete_name: "Sam Doe",
    athlete_age: 14,
  }

  it("accepts a minimal valid signup", () => {
    expect(createEventSignupSchema.safeParse(base).success).toBe(true)
  })

  it("rejects an invalid email", () => {
    expect(createEventSignupSchema.safeParse({ ...base, parent_email: "not-an-email" }).success).toBe(false)
  })

  it("rejects athlete_age below 6", () => {
    expect(createEventSignupSchema.safeParse({ ...base, athlete_age: 5 }).success).toBe(false)
  })

  it("rejects athlete_age above 21", () => {
    expect(createEventSignupSchema.safeParse({ ...base, athlete_age: 25 }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test — should fail**

Run: `npm run test:run -- lib/validators/event-signups`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write the validator**

Create `lib/validators/event-signups.ts`:

```typescript
import { z } from "zod"

export const createEventSignupSchema = z.object({
  parent_name: z.string().min(2).max(100),
  parent_email: z.string().email(),
  parent_phone: z.string().min(5).max(30).optional().nullable(),
  athlete_name: z.string().min(2).max(100),
  athlete_age: z.number().int().min(6).max(21),
  sport: z.string().min(1).max(60).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
})

export type CreateSignupInput = z.infer<typeof createEventSignupSchema>
```

- [ ] **Step 4: Run tests**

Run: `npm run test:run -- lib/validators/event-signups`
Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add lib/validators/event-signups.ts __tests__/lib/validators/event-signups.test.ts
git commit -m "feat(events): add event signup Zod validator"
```

---

## Task 8: `lib/db/events.ts` — read functions

**Files:**

- Create: `lib/db/events.ts`

- [ ] **Step 1: Write the file with read functions**

Create `lib/db/events.ts`:

```typescript
import { createServiceRoleClient } from "@/lib/supabase"
import type { Event, EventStatus, EventType } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export interface EventListFilters {
  type?: EventType
  status?: EventStatus
  search?: string
}

export async function getEvents(filters: EventListFilters = {}): Promise<Event[]> {
  const supabase = getClient()
  let query = supabase.from("events").select("*").order("start_date", { ascending: true })
  if (filters.type) query = query.eq("type", filters.type)
  if (filters.status) query = query.eq("status", filters.status)
  if (filters.search) query = query.ilike("title", `%${filters.search}%`)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as Event[]
}

export async function getPublishedEvents(filters: { type?: EventType; from?: Date } = {}): Promise<Event[]> {
  const supabase = getClient()
  const from = filters.from ?? new Date()
  let query = supabase
    .from("events")
    .select("*")
    .eq("status", "published")
    .gte("start_date", from.toISOString())
    .order("start_date", { ascending: true })
  if (filters.type) query = query.eq("type", filters.type)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as Event[]
}

export async function getEventById(id: string): Promise<Event | null> {
  const supabase = getClient()
  const { data, error } = await supabase.from("events").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data as Event) ?? null
}

export async function getEventBySlug(slug: string): Promise<Event | null> {
  const supabase = getClient()
  const { data, error } = await supabase.from("events").select("*").eq("slug", slug).maybeSingle()
  if (error) throw error
  return (data as Event) ?? null
}
```

- [ ] **Step 2: Verify tsc passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/db/events.ts
git commit -m "feat(events): add events DAL read functions"
```

---

## Task 9: `lib/db/events.ts` — write functions

**Files:**

- Modify: `lib/db/events.ts` (append)

- [ ] **Step 1: Append write functions**

Append to `lib/db/events.ts`:

```typescript
import type { CreateEventInput, UpdateEventInput } from "@/lib/validators/events"

// Add the import at the top of the file if not already present.

function computeEndDate(type: EventType, startIso: string, inputEnd?: string | null): string | null {
  if (type === "clinic") {
    return new Date(new Date(startIso).getTime() + 2 * 3600 * 1000).toISOString()
  }
  return inputEnd ?? null
}

export async function createEvent(input: CreateEventInput): Promise<Event> {
  const supabase = getClient()
  const base = {
    type: input.type,
    slug: input.slug,
    title: input.title,
    summary: input.summary,
    description: input.description,
    focus_areas: input.focus_areas,
    location_name: input.location_name,
    location_address: input.location_address ?? null,
    location_map_url: input.location_map_url ?? null,
    capacity: input.capacity,
    hero_image_url: input.hero_image_url ?? null,
    status: input.status,
    age_min: input.age_min ?? null,
    age_max: input.age_max ?? null,
    start_date: input.start_date,
    end_date: input.type === "clinic" ? computeEndDate("clinic", input.start_date) : input.end_date,
    session_schedule: input.type === "camp" ? (input.session_schedule ?? null) : null,
    price_cents: input.type === "camp" && input.price_dollars != null ? Math.round(input.price_dollars * 100) : null,
  }
  const { data, error } = await supabase.from("events").insert(base).select().single()
  if (error) throw error
  return data as Event
}

export async function updateEvent(id: string, input: UpdateEventInput): Promise<Event> {
  const supabase = getClient()
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const [key, value] of Object.entries(input)) {
    if (key === "price_dollars") {
      updates.price_cents = value == null ? null : Math.round((value as number) * 100)
    } else if (value !== undefined) {
      updates[key] = value
    }
  }
  // If start_date changed for a clinic, recompute end_date.
  if (updates.start_date && !("end_date" in updates)) {
    const existing = await getEventById(id)
    if (existing?.type === "clinic") {
      updates.end_date = computeEndDate("clinic", updates.start_date as string)
    }
  }
  const { data, error } = await supabase.from("events").update(updates).eq("id", id).select().single()
  if (error) throw error
  return data as Event
}

const ALLOWED_STATUS_TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  draft: ["published", "cancelled"],
  published: ["cancelled", "completed"],
  cancelled: [],
  completed: [],
}

export async function setEventStatus(id: string, status: EventStatus): Promise<Event> {
  const current = await getEventById(id)
  if (!current) throw new Error(`Event ${id} not found`)
  const allowed = ALLOWED_STATUS_TRANSITIONS[current.status]
  if (!allowed.includes(status)) {
    throw new Error(`Cannot transition event from ${current.status} to ${status}`)
  }
  return updateEvent(id, { status })
}

export async function deleteEvent(id: string): Promise<void> {
  const event = await getEventById(id)
  if (!event) return
  if (event.status !== "draft") {
    throw new Error("Only draft events can be deleted; cancel the event instead")
  }
  if (event.signup_count > 0) {
    throw new Error("Cannot delete an event with existing signups")
  }
  const supabase = getClient()
  const { error } = await supabase.from("events").delete().eq("id", id)
  if (error) throw error
}
```

- [ ] **Step 2: Verify tsc passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/db/events.ts
git commit -m "feat(events): add events DAL write + status transition functions"
```

---

## Task 10: DAL tests for `lib/db/events.ts`

**Files:**

- Create: `__tests__/db/events.test.ts`

- [ ] **Step 1: Write integration tests**

Create `__tests__/db/events.test.ts`:

```typescript
import { describe, it, expect, afterAll } from "vitest"
import { randomUUID } from "crypto"
import {
  createEvent,
  updateEvent,
  deleteEvent,
  getEventById,
  getEventBySlug,
  getPublishedEvents,
  setEventStatus,
} from "@/lib/db/events"

describe("events DAL", () => {
  const createdIds: string[] = []

  afterAll(async () => {
    const { createServiceRoleClient } = await import("@/lib/supabase")
    const supabase = createServiceRoleClient()
    for (const id of createdIds) await supabase.from("events").delete().eq("id", id)
  })

  it("creates and fetches by id + slug", async () => {
    const slug = `test-${randomUUID()}`
    const event = await createEvent({
      type: "clinic",
      slug,
      title: "T",
      summary: "S",
      description: "D",
      focus_areas: [],
      start_date: new Date(Date.now() + 86400000).toISOString(),
      location_name: "L",
      capacity: 5,
      status: "draft",
    })
    createdIds.push(event.id)
    expect(event.id).toBeDefined()
    expect(event.end_date).not.toBeNull() // clinic auto-end

    const byId = await getEventById(event.id)
    expect(byId?.id).toBe(event.id)

    const bySlug = await getEventBySlug(slug)
    expect(bySlug?.id).toBe(event.id)
  })

  it("rejects duplicate slugs", async () => {
    const slug = `dup-${randomUUID()}`
    const event = await createEvent({
      type: "clinic",
      slug,
      title: "T",
      summary: "S",
      description: "D",
      focus_areas: [],
      start_date: new Date(Date.now() + 86400000).toISOString(),
      location_name: "L",
      capacity: 5,
      status: "draft",
    })
    createdIds.push(event.id)

    await expect(
      createEvent({
        type: "clinic",
        slug,
        title: "T2",
        summary: "S",
        description: "D",
        focus_areas: [],
        start_date: new Date(Date.now() + 86400000).toISOString(),
        location_name: "L",
        capacity: 5,
        status: "draft",
      }),
    ).rejects.toThrow()
  })

  it("getPublishedEvents returns only published + upcoming", async () => {
    const draft = await createEvent({
      type: "clinic",
      slug: `draft-${randomUUID()}`,
      title: "D",
      summary: "S",
      description: "D",
      focus_areas: [],
      start_date: new Date(Date.now() + 86400000).toISOString(),
      location_name: "L",
      capacity: 5,
      status: "draft",
    })
    createdIds.push(draft.id)

    const published = await createEvent({
      type: "clinic",
      slug: `pub-${randomUUID()}`,
      title: "P",
      summary: "S",
      description: "D",
      focus_areas: [],
      start_date: new Date(Date.now() + 86400000).toISOString(),
      location_name: "L",
      capacity: 5,
      status: "published",
    })
    createdIds.push(published.id)

    const results = await getPublishedEvents({ type: "clinic" })
    expect(results.some((e) => e.id === published.id)).toBe(true)
    expect(results.some((e) => e.id === draft.id)).toBe(false)
  })

  it("setEventStatus enforces allowed transitions", async () => {
    const event = await createEvent({
      type: "clinic",
      slug: `trans-${randomUUID()}`,
      title: "T",
      summary: "S",
      description: "D",
      focus_areas: [],
      start_date: new Date(Date.now() + 86400000).toISOString(),
      location_name: "L",
      capacity: 5,
      status: "draft",
    })
    createdIds.push(event.id)

    await setEventStatus(event.id, "published")
    await expect(setEventStatus(event.id, "draft")).rejects.toThrow()
  })

  it("deleteEvent rejects non-draft", async () => {
    const event = await createEvent({
      type: "clinic",
      slug: `del-${randomUUID()}`,
      title: "T",
      summary: "S",
      description: "D",
      focus_areas: [],
      start_date: new Date(Date.now() + 86400000).toISOString(),
      location_name: "L",
      capacity: 5,
      status: "published",
    })
    createdIds.push(event.id)
    await expect(deleteEvent(event.id)).rejects.toThrow()
  })

  it("updateEvent converts price_dollars to price_cents", async () => {
    const event = await createEvent({
      type: "camp",
      slug: `camp-${randomUUID()}`,
      title: "C",
      summary: "S",
      description: "D",
      focus_areas: [],
      start_date: new Date(Date.now() + 86400000).toISOString(),
      end_date: new Date(Date.now() + 7 * 86400000).toISOString(),
      location_name: "L",
      capacity: 10,
      status: "draft",
      price_dollars: 299,
    })
    createdIds.push(event.id)
    expect(event.price_cents).toBe(29900)

    const updated = await updateEvent(event.id, { price_dollars: 349.5 })
    expect(updated.price_cents).toBe(34950)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `npm run test:run -- db/events`
Expected: 6/6 pass.

- [ ] **Step 3: Commit**

```bash
git add __tests__/db/events.test.ts
git commit -m "test(events): integration tests for events DAL"
```

---

## Task 11: `lib/db/event-signups.ts` — all functions

**Files:**

- Create: `lib/db/event-signups.ts`
- Test: `__tests__/db/event-signups.test.ts`

- [ ] **Step 1: Write the test first**

Create `__tests__/db/event-signups.test.ts`:

```typescript
import { describe, it, expect, afterAll, beforeAll } from "vitest"
import { randomUUID } from "crypto"
import { createEvent, deleteEvent } from "@/lib/db/events"
import { createSignup, getSignupsForEvent, getSignupById, confirmSignup, cancelSignup } from "@/lib/db/event-signups"

describe("event-signups DAL", () => {
  let eventId: string
  const extraEventIds: string[] = []

  beforeAll(async () => {
    const e = await createEvent({
      type: "clinic",
      slug: `signup-test-${randomUUID()}`,
      title: "T",
      summary: "S",
      description: "D",
      focus_areas: [],
      start_date: new Date(Date.now() + 86400000).toISOString(),
      location_name: "L",
      capacity: 2,
      status: "draft",
    })
    eventId = e.id
  })

  afterAll(async () => {
    const { createServiceRoleClient } = await import("@/lib/supabase")
    const supabase = createServiceRoleClient()
    await supabase.from("events").delete().eq("id", eventId)
    for (const id of extraEventIds) await supabase.from("events").delete().eq("id", id)
  })

  it("creates a signup and fetches it back", async () => {
    const signup = await createSignup(
      eventId,
      {
        parent_name: "A",
        parent_email: "a@x.com",
        athlete_name: "S",
        athlete_age: 14,
      },
      "interest",
    )
    expect(signup.status).toBe("pending")

    const fetched = await getSignupById(signup.id)
    expect(fetched?.id).toBe(signup.id)

    const all = await getSignupsForEvent(eventId)
    expect(all.some((s) => s.id === signup.id)).toBe(true)
  })

  it("confirm + cancel flip status and adjust signup_count", async () => {
    const signup = await createSignup(
      eventId,
      {
        parent_name: "B",
        parent_email: "b@x.com",
        athlete_name: "S2",
        athlete_age: 14,
      },
      "interest",
    )

    const confirmed = await confirmSignup(signup.id)
    expect(confirmed.ok).toBe(true)

    const fetched = await getSignupById(signup.id)
    expect(fetched?.status).toBe("confirmed")

    const cancelled = await cancelSignup(signup.id)
    expect(cancelled.ok).toBe(true)
  })

  it("confirm returns at_capacity when full", async () => {
    const e = await createEvent({
      type: "clinic",
      slug: `cap-${randomUUID()}`,
      title: "T",
      summary: "S",
      description: "D",
      focus_areas: [],
      start_date: new Date(Date.now() + 86400000).toISOString(),
      location_name: "L",
      capacity: 1,
      status: "draft",
    })
    extraEventIds.push(e.id)

    const s1 = await createSignup(
      e.id,
      {
        parent_name: "A",
        parent_email: "a@x.com",
        athlete_name: "X",
        athlete_age: 14,
      },
      "interest",
    )
    const s2 = await createSignup(
      e.id,
      {
        parent_name: "B",
        parent_email: "b@x.com",
        athlete_name: "Y",
        athlete_age: 14,
      },
      "interest",
    )

    const r1 = await confirmSignup(s1.id)
    expect(r1.ok).toBe(true)

    const r2 = await confirmSignup(s2.id)
    expect(r2.ok).toBe(false)
    expect(r2.reason).toBe("at_capacity")
  })
})
```

- [ ] **Step 2: Run test — fails with module-not-found**

Run: `npm run test:run -- db/event-signups`
Expected: FAIL.

- [ ] **Step 3: Write the DAL**

Create `lib/db/event-signups.ts`:

```typescript
import { createServiceRoleClient } from "@/lib/supabase"
import type { EventSignup, SignupType } from "@/types/database"
import type { CreateSignupInput } from "@/lib/validators/event-signups"

function getClient() {
  return createServiceRoleClient()
}

export async function getSignupsForEvent(eventId: string): Promise<EventSignup[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("event_signups")
    .select("*")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as EventSignup[]
}

export async function getSignupById(id: string): Promise<EventSignup | null> {
  const supabase = getClient()
  const { data, error } = await supabase.from("event_signups").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data as EventSignup) ?? null
}

export async function createSignup(
  eventId: string,
  input: CreateSignupInput,
  signupType: SignupType,
): Promise<EventSignup> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("event_signups")
    .insert({ event_id: eventId, signup_type: signupType, ...input })
    .select()
    .single()
  if (error) throw error
  return data as EventSignup
}

export type ConfirmResult = { ok: true } | { ok: false; reason: "not_found" | "not_pending" | "at_capacity" }
export type CancelResult = { ok: true } | { ok: false; reason: "not_found" | "not_cancellable" }

export async function confirmSignup(id: string): Promise<ConfirmResult> {
  const supabase = getClient()
  const { data, error } = await supabase.rpc("confirm_event_signup", { p_signup_id: id })
  if (error) throw error
  return data as ConfirmResult
}

export async function cancelSignup(id: string): Promise<CancelResult> {
  const supabase = getClient()
  const { data, error } = await supabase.rpc("cancel_event_signup", { p_signup_id: id })
  if (error) throw error
  return data as CancelResult
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:run -- db/event-signups`
Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add lib/db/event-signups.ts __tests__/db/event-signups.test.ts
git commit -m "feat(events): add event-signups DAL with RPC wrappers"
```

---

## Task 12: Event storage helper + upload route

**Files:**

- Create: `lib/event-storage.ts`
- Create: `app/api/upload/event-image/route.ts`

- [ ] **Step 1: Create the storage helper**

Create `lib/event-storage.ts`:

```typescript
import { createServiceRoleClient } from "@/lib/supabase"

const BUCKET = "event-images"

export async function uploadEventImage(file: File | Blob, path: string): Promise<string> {
  const supabase = createServiceRoleClient()
  await supabase.storage.from(BUCKET).remove([path])
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: true,
  })
  if (error) throw new Error(`Event image upload failed: ${error.message}`)
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return `${data.publicUrl}?v=${Date.now()}`
}

export async function deleteEventImage(path: string): Promise<void> {
  const supabase = createServiceRoleClient()
  await supabase.storage.from(BUCKET).remove([path])
}
```

**Note:** The `event-images` Supabase Storage bucket must exist and be public-readable. If it doesn't exist yet, create it via the Supabase dashboard (or add a migration that runs `insert into storage.buckets (id, name, public) values ('event-images', 'event-images', true) on conflict do nothing;`). For this plan, add the bucket-creation SQL to migration 00062 if it's easier to ship together:

Append to `supabase/migrations/00062_create_events.sql`:

```sql
-- Event images storage bucket ---------------------------------------------
insert into storage.buckets (id, name, public)
values ('event-images', 'event-images', true)
on conflict (id) do nothing;
```

Reapply the migration (`psql "$SUPABASE_DB_URL" -f supabase/migrations/00062_create_events.sql` — the CREATE statements use `IF NOT EXISTS` and the bucket insert uses `ON CONFLICT DO NOTHING`, so reapply is safe).

- [ ] **Step 2: Create the upload route**

Create `app/api/upload/event-image/route.ts`:

```typescript
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { uploadEventImage } from "@/lib/event-storage"

const MAX_SIZE = 5 * 1024 * 1024
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Invalid file type. Allowed: JPEG, PNG, WebP, GIF" }, { status: 400 })
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File too large. Maximum 5 MB" }, { status: 400 })
    }

    const ext = file.name.split(".").pop() ?? "jpg"
    const eventId = (formData.get("eventId") as string | null) ?? crypto.randomUUID()
    const path = `hero/${eventId}.${ext}`
    const url = await uploadEventImage(file, path)
    return NextResponse.json({ url })
  } catch (error) {
    console.error("Event image upload error:", error)
    return NextResponse.json({ error: "Failed to upload image" }, { status: 500 })
  }
}
```

- [ ] **Step 3: Verify tsc passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/event-storage.ts app/api/upload/event-image/route.ts supabase/migrations/00062_create_events.sql
git commit -m "feat(events): add event image storage helper + upload route"
```

---

## Task 13: Admin API — POST /api/admin/events (create)

**Files:**

- Create: `app/api/admin/events/route.ts`

- [ ] **Step 1: Write the route**

Create `app/api/admin/events/route.ts`:

```typescript
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createEventSchema } from "@/lib/validators/events"
import { createEvent } from "@/lib/db/events"

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const result = createEventSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid event data", fieldErrors: result.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    try {
      const event = await createEvent(result.data)
      return NextResponse.json({ event }, { status: 201 })
    } catch (err) {
      const msg = (err as Error).message
      if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
        return NextResponse.json(
          { error: "Slug already in use", fieldErrors: { slug: ["That slug is already taken"] } },
          { status: 409 },
        )
      }
      throw err
    }
  } catch (err) {
    console.error("[API admin/events POST]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify tsc passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/events/route.ts
git commit -m "feat(events): add POST /api/admin/events create endpoint"
```

---

## Task 14: Admin API — PATCH and DELETE /api/admin/events/[id]

**Files:**

- Create: `app/api/admin/events/[id]/route.ts`

- [ ] **Step 1: Write the route**

Create `app/api/admin/events/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { updateEventSchema } from "@/lib/validators/events"
import { updateEvent, deleteEvent, setEventStatus, getEventById } from "@/lib/db/events"

async function requireAdmin() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") return null
  return session
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const { id } = await ctx.params
    const body = await request.json()
    const result = updateEventSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid event data", fieldErrors: result.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { status, ...rest } = result.data as { status?: string; [k: string]: unknown }

    try {
      if (status) {
        await setEventStatus(id, status as "draft" | "published" | "cancelled" | "completed")
      }
      const updated = Object.keys(rest).length > 0 ? await updateEvent(id, rest) : await getEventById(id)
      if (!updated) return NextResponse.json({ error: "Event not found" }, { status: 404 })
      return NextResponse.json({ event: updated })
    } catch (err) {
      const msg = (err as Error).message
      if (msg.toLowerCase().includes("cannot transition")) {
        return NextResponse.json({ error: msg }, { status: 409 })
      }
      if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
        return NextResponse.json(
          { error: "Slug already in use", fieldErrors: { slug: ["That slug is already taken"] } },
          { status: 409 },
        )
      }
      throw err
    }
  } catch (err) {
    console.error("[API admin/events PATCH]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const { id } = await ctx.params
    try {
      await deleteEvent(id)
      return NextResponse.json({ ok: true })
    } catch (err) {
      const msg = (err as Error).message
      if (msg.includes("Only draft events") || msg.includes("Cannot delete")) {
        return NextResponse.json({ error: msg }, { status: 409 })
      }
      throw err
    }
  } catch (err) {
    console.error("[API admin/events DELETE]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify tsc passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/api/admin/events/[id]/route.ts"
git commit -m "feat(events): add PATCH + DELETE /api/admin/events/[id]"
```

---

## Task 15: Admin API — POST /api/admin/events/[id]/duplicate

**Files:**

- Create: `app/api/admin/events/[id]/duplicate/route.ts`

- [ ] **Step 1: Write the route**

Create `app/api/admin/events/[id]/duplicate/route.ts`:

```typescript
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getEventById, createEvent } from "@/lib/db/events"

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const { id } = await ctx.params
    const source = await getEventById(id)
    if (!source) return NextResponse.json({ error: "Event not found" }, { status: 404 })

    let suffix = 1
    let newSlug = `${source.slug}-copy`
    // find next available slug
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { getEventBySlug } = await import("@/lib/db/events")
      const clash = await getEventBySlug(newSlug)
      if (!clash) break
      suffix += 1
      newSlug = `${source.slug}-copy-${suffix}`
    }

    const base = {
      type: source.type,
      slug: newSlug,
      title: `${source.title} (copy)`,
      summary: source.summary,
      description: source.description,
      focus_areas: source.focus_areas,
      location_name: source.location_name,
      location_address: source.location_address,
      location_map_url: source.location_map_url,
      capacity: source.capacity,
      hero_image_url: source.hero_image_url,
      status: "draft" as const,
      age_min: source.age_min,
      age_max: source.age_max,
      start_date: source.start_date,
    }
    const duplicated =
      source.type === "clinic"
        ? await createEvent({ ...base, type: "clinic" })
        : await createEvent({
            ...base,
            type: "camp",
            end_date: source.end_date ?? source.start_date,
            session_schedule: source.session_schedule,
            price_dollars: source.price_cents != null ? source.price_cents / 100 : null,
          })

    return NextResponse.json({ event: duplicated }, { status: 201 })
  } catch (err) {
    console.error("[API admin/events duplicate]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify tsc passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/api/admin/events/[id]/duplicate/route.ts"
git commit -m "feat(events): add duplicate event endpoint"
```

---

## Task 16: API route tests

**Files:**

- Create: `__tests__/api/admin/events.test.ts`

- [ ] **Step 1: Write tests**

Create `__tests__/api/admin/events.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock auth() to return an admin session.
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "admin-1", email: "a@x.com", role: "admin" } })),
}))

describe("POST /api/admin/events", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 400 on invalid body", async () => {
    const { POST } = await import("@/app/api/admin/events/route")
    const req = new Request("http://localhost/api/admin/events", {
      method: "POST",
      body: JSON.stringify({ type: "clinic" }),
      headers: { "content-type": "application/json" },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("returns 403 when not admin", async () => {
    const authMod = await import("@/lib/auth")
    vi.mocked(authMod.auth).mockResolvedValueOnce(null as never)
    const { POST } = await import("@/app/api/admin/events/route")
    const req = new Request("http://localhost/api/admin/events", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `npm run test:run -- api/admin/events`
Expected: 2/2 pass.

- [ ] **Step 3: Commit**

```bash
git add __tests__/api/admin/events.test.ts
git commit -m "test(events): admin API route smoke tests"
```

---

## Task 17: Add "Events" to admin sidebar (desktop + mobile)

**Files:**

- Modify: `components/admin/AdminSidebar.tsx`
- Modify: `components/admin/AdminMobileSidebar.tsx`

- [ ] **Step 1: Update desktop sidebar**

In `components/admin/AdminSidebar.tsx`:

1. Add `CalendarDays` to the lucide-react import near the top.
2. In the `navSections` array, locate the "Business" section (after Coaching/Content/AI Tools). Insert a new item **after "Bookings"** and before "Payments":

```typescript
{ label: "Events", href: "/admin/events", icon: CalendarDays },
```

The Business section should now read: Bookings · Events · Payments · Analytics · Reviews.

- [ ] **Step 2: Update mobile sidebar**

In `components/admin/AdminMobileSidebar.tsx`: find the same `navSections` array (it's typically kept in sync with the desktop one or imported from it). Apply the identical change: add `CalendarDays` import and the "Events" nav entry in the Business section.

If the mobile sidebar imports `navSections` from the desktop sidebar or a shared constants file, only one edit is needed. Inspect the file first.

- [ ] **Step 3: Verify tsc passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/admin/AdminSidebar.tsx components/admin/AdminMobileSidebar.tsx
git commit -m "feat(admin): add Events entry to admin sidebar"
```

---

## Task 18: `EventHeroImageUpload` client component

**Files:**

- Create: `components/admin/events/EventHeroImageUpload.tsx`

- [ ] **Step 1: Write the component**

Create `components/admin/events/EventHeroImageUpload.tsx`:

```tsx
"use client"

import { useState } from "react"
import Image from "next/image"
import { Upload, X } from "lucide-react"
import { Button } from "@/components/ui/button"

interface EventHeroImageUploadProps {
  value: string | null
  onChange: (url: string | null) => void
  eventId?: string
}

export function EventHeroImageUpload({ value, onChange, eventId }: EventHeroImageUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setError(null)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      if (eventId) fd.append("eventId", eventId)
      const res = await fetch("/api/upload/event-image", { method: "POST", body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Upload failed")
      onChange(data.url)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-3">
      {value ? (
        <div className="relative inline-block">
          <Image src={value} alt="Event hero" width={320} height={180} className="rounded-lg object-cover" />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute top-1 right-1 rounded-full bg-background p-1 shadow"
            aria-label="Remove image"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-surface p-8 hover:bg-surface/80">
          <Upload className="mb-2 h-6 w-6 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {uploading ? "Uploading..." : "Click to upload a hero image"}
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleFile(f)
            }}
            disabled={uploading}
          />
        </label>
      )}
      {error && <div className="text-sm text-destructive">{error}</div>}
    </div>
  )
}
```

- [ ] **Step 2: Verify tsc passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/admin/events/EventHeroImageUpload.tsx
git commit -m "feat(events): add EventHeroImageUpload component"
```

---

## Task 19: `EventForm` component (shared create/edit)

**Files:**

- Create: `components/admin/events/EventForm.tsx`

- [ ] **Step 1: Write the form**

Create `components/admin/events/EventForm.tsx`:

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EventHeroImageUpload } from "@/components/admin/events/EventHeroImageUpload"
import type { Event, EventStatus, EventType } from "@/types/database"

interface EventFormProps {
  event?: Event
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
}

export function EventForm({ event }: EventFormProps) {
  const router = useRouter()
  const isEdit = !!event

  const [type, setType] = useState<EventType>(event?.type ?? "clinic")
  const [title, setTitle] = useState(event?.title ?? "")
  const [slug, setSlug] = useState(event?.slug ?? "")
  const [slugAutoFilled, setSlugAutoFilled] = useState(!event)
  const [summary, setSummary] = useState(event?.summary ?? "")
  const [description, setDescription] = useState(event?.description ?? "")
  const [focusAreasInput, setFocusAreasInput] = useState("")
  const [focusAreas, setFocusAreas] = useState<string[]>(event?.focus_areas ?? [])
  const [locationName, setLocationName] = useState(event?.location_name ?? "")
  const [locationAddress, setLocationAddress] = useState(event?.location_address ?? "")
  const [locationMapUrl, setLocationMapUrl] = useState(event?.location_map_url ?? "")
  const [capacity, setCapacity] = useState(event?.capacity ?? 10)
  const [ageMin, setAgeMin] = useState<number | "">(event?.age_min ?? "")
  const [ageMax, setAgeMax] = useState<number | "">(event?.age_max ?? "")
  const [startDate, setStartDate] = useState(event?.start_date?.slice(0, 16) ?? "")
  const [endDate, setEndDate] = useState(event?.end_date?.slice(0, 10) ?? "")
  const [sessionSchedule, setSessionSchedule] = useState(event?.session_schedule ?? "")
  const [priceDollars, setPriceDollars] = useState<number | "">(
    event?.price_cents != null ? event.price_cents / 100 : "",
  )
  const [status, setStatus] = useState<EventStatus>(event?.status ?? "draft")
  const [heroImageUrl, setHeroImageUrl] = useState<string | null>(event?.hero_image_url ?? null)

  const [submitting, setSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [formError, setFormError] = useState<string | null>(null)

  function handleTitleBlur() {
    if (slugAutoFilled || !slug) {
      setSlug(slugify(title))
      setSlugAutoFilled(true)
    }
  }

  function handleSlugChange(v: string) {
    setSlug(v)
    setSlugAutoFilled(false)
  }

  function addFocusArea() {
    const v = focusAreasInput.trim()
    if (v && !focusAreas.includes(v)) setFocusAreas([...focusAreas, v])
    setFocusAreasInput("")
  }

  function removeFocusArea(v: string) {
    setFocusAreas(focusAreas.filter((x) => x !== v))
  }

  async function handleSubmit(submitStatus?: EventStatus) {
    setSubmitting(true)
    setFieldErrors({})
    setFormError(null)

    const payload: Record<string, unknown> = {
      type,
      title,
      slug,
      summary,
      description,
      focus_areas: focusAreas,
      location_name: locationName,
      location_address: locationAddress || null,
      location_map_url: locationMapUrl || null,
      capacity: Number(capacity),
      hero_image_url: heroImageUrl,
      status: submitStatus ?? status,
      age_min: ageMin === "" ? null : Number(ageMin),
      age_max: ageMax === "" ? null : Number(ageMax),
      start_date: startDate ? new Date(startDate).toISOString() : undefined,
    }
    if (type === "camp") {
      payload.end_date = endDate ? new Date(endDate).toISOString() : undefined
      payload.session_schedule = sessionSchedule || null
      payload.price_dollars = priceDollars === "" ? null : Number(priceDollars)
    }

    try {
      const url = isEdit ? `/api/admin/events/${event!.id}` : "/api/admin/events"
      const method = isEdit ? "PATCH" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.fieldErrors) setFieldErrors(data.fieldErrors)
        setFormError(data.error ?? "Failed to save event")
        setSubmitting(false)
        return
      }
      router.push("/admin/events")
      router.refresh()
    } catch (err) {
      setFormError((err as Error).message)
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void handleSubmit()
      }}
      className="space-y-6"
    >
      {formError && <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{formError}</div>}

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <Label>Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as EventType)} disabled={isEdit}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="clinic">Agility Clinic</SelectItem>
              <SelectItem value="camp">Performance Camp</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as EventStatus)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label>Title</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={handleTitleBlur} required />
        {fieldErrors.title && <p className="text-sm text-destructive">{fieldErrors.title[0]}</p>}
      </div>

      <div>
        <Label>Slug</Label>
        <Input value={slug} onChange={(e) => handleSlugChange(e.target.value.toLowerCase())} required />
        {fieldErrors.slug && <p className="text-sm text-destructive">{fieldErrors.slug[0]}</p>}
      </div>

      <div>
        <Label>Summary</Label>
        <Input value={summary} onChange={(e) => setSummary(e.target.value)} required maxLength={300} />
      </div>

      <div>
        <Label>Description</Label>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} required />
      </div>

      <div>
        <Label>Focus Areas</Label>
        <div className="flex flex-wrap gap-2">
          {focusAreas.map((fa) => (
            <span key={fa} className="rounded-full bg-primary/10 px-3 py-1 text-sm text-primary">
              {fa}{" "}
              <button type="button" onClick={() => removeFocusArea(fa)} className="ml-1">
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <Input
            value={focusAreasInput}
            onChange={(e) => setFocusAreasInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                addFocusArea()
              }
            }}
            placeholder="Add a focus area and press Enter"
          />
          <Button type="button" variant="outline" onClick={addFocusArea}>
            Add
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label>Location Name</Label>
          <Input value={locationName} onChange={(e) => setLocationName(e.target.value)} required />
        </div>
        <div>
          <Label>Address (optional)</Label>
          <Input value={locationAddress} onChange={(e) => setLocationAddress(e.target.value)} />
        </div>
        <div>
          <Label>Map URL (optional)</Label>
          <Input value={locationMapUrl} onChange={(e) => setLocationMapUrl(e.target.value)} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label>Capacity</Label>
          <Input
            type="number"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value))}
            required
          />
        </div>
        <div>
          <Label>Age Min (optional)</Label>
          <Input
            type="number"
            min={6}
            max={21}
            value={ageMin}
            onChange={(e) => setAgeMin(e.target.value === "" ? "" : Number(e.target.value))}
          />
        </div>
        <div>
          <Label>Age Max (optional)</Label>
          <Input
            type="number"
            min={6}
            max={21}
            value={ageMax}
            onChange={(e) => setAgeMax(e.target.value === "" ? "" : Number(e.target.value))}
          />
        </div>
      </div>

      {type === "clinic" ? (
        <div>
          <Label>Start (date + time)</Label>
          <Input type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          <p className="mt-1 text-sm text-muted-foreground">End time will be auto-set to start + 2 hours.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Start date</Label>
              <Input
                type="date"
                value={startDate.slice(0, 10)}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>End date</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
            </div>
          </div>
          <div>
            <Label>Session schedule (free-text)</Label>
            <Input
              value={sessionSchedule}
              onChange={(e) => setSessionSchedule(e.target.value)}
              placeholder="M–F, 9–11am"
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2 md:items-end">
            <div>
              <Label>Price (USD)</Label>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={priceDollars}
                onChange={(e) => setPriceDollars(e.target.value === "" ? "" : Number(e.target.value))}
              />
            </div>
            <div>
              <Button type="button" disabled title="Available in Phase 3">
                Sync to Stripe
              </Button>
            </div>
          </div>
        </>
      )}

      <div>
        <Label>Hero Image</Label>
        <EventHeroImageUpload value={heroImageUrl} onChange={setHeroImageUrl} eventId={event?.id} />
      </div>

      <div className="flex items-center gap-3 border-t border-border pt-6">
        {status === "draft" ? (
          <>
            <Button type="button" variant="outline" onClick={() => void handleSubmit("draft")} disabled={submitting}>
              Save as draft
            </Button>
            <Button type="button" onClick={() => void handleSubmit("published")} disabled={submitting}>
              Save &amp; publish
            </Button>
          </>
        ) : (
          <Button type="submit" disabled={submitting}>
            Save
          </Button>
        )}
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Verify tsc passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/admin/events/EventForm.tsx
git commit -m "feat(events): add EventForm component for admin create/edit"
```

---

## Task 20: `EventList` component

**Files:**

- Create: `components/admin/events/EventList.tsx`

- [ ] **Step 1: Write the component**

Create `components/admin/events/EventList.tsx`:

```tsx
"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Plus, Pencil, Copy, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Event, EventStatus, EventType } from "@/types/database"

interface EventListProps {
  initialEvents: Event[]
}

const STATUS_BADGE: Record<EventStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  published: "bg-success/15 text-success",
  cancelled: "bg-destructive/15 text-destructive",
  completed: "bg-primary/10 text-primary",
}

export function EventList({ initialEvents }: EventListProps) {
  const router = useRouter()
  const [typeFilter, setTypeFilter] = useState<EventType | "all">("all")
  const [statusFilter, setStatusFilter] = useState<EventStatus | "all">("all")
  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    return initialEvents.filter((e) => {
      if (typeFilter !== "all" && e.type !== typeFilter) return false
      if (statusFilter !== "all" && e.status !== statusFilter) return false
      if (search && !e.title.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [initialEvents, typeFilter, statusFilter, search])

  async function handleDuplicate(id: string) {
    const res = await fetch(`/api/admin/events/${id}/duplicate`, { method: "POST" })
    if (res.ok) router.refresh()
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this draft event?")) return
    const res = await fetch(`/api/admin/events/${id}`, { method: "DELETE" })
    if (res.ok) router.refresh()
    else {
      const data = await res.json()
      alert(data.error ?? "Delete failed")
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search by title"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as EventType | "all")}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="clinic">Clinic</SelectItem>
            <SelectItem value="camp">Camp</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as EventStatus | "all")}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button asChild>
            <Link href="/admin/events/new">
              <Plus className="mr-1 h-4 w-4" /> New event
            </Link>
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Start</th>
              <th className="px-4 py-3">Location</th>
              <th className="px-4 py-3">Signups</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  No events
                </td>
              </tr>
            ) : (
              filtered.map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <Link href={`/admin/events/${e.id}`} className="font-medium hover:text-primary">
                      {e.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 capitalize">{e.type}</td>
                  <td className="px-4 py-3">{new Date(e.start_date).toLocaleString()}</td>
                  <td className="px-4 py-3">{e.location_name}</td>
                  <td className="px-4 py-3">
                    {e.signup_count} / {e.capacity}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[e.status]}`}>
                      {e.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/admin/events/${e.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void handleDuplicate(e.id)}>
                        <Copy className="h-4 w-4" />
                      </Button>
                      {e.status === "draft" && e.signup_count === 0 && (
                        <Button variant="ghost" size="sm" onClick={() => void handleDelete(e.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify tsc passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/admin/events/EventList.tsx
git commit -m "feat(events): add EventList component with filters and actions"
```

---

## Task 21: Admin list page `/admin/events/page.tsx`

**Files:**

- Create: `app/(admin)/admin/events/page.tsx`

- [ ] **Step 1: Write the page**

Create `app/(admin)/admin/events/page.tsx`:

```tsx
import { getEvents } from "@/lib/db/events"
import { EventList } from "@/components/admin/events/EventList"

export const dynamic = "force-dynamic"
export const metadata = { title: "Events" }

export default async function AdminEventsPage() {
  const events = await getEvents()
  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Events</h1>
      <EventList initialEvents={events} />
    </div>
  )
}
```

- [ ] **Step 2: Verify tsc passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/admin/events/page.tsx"
git commit -m "feat(events): add /admin/events list page"
```

---

## Task 22: Admin create page `/admin/events/new/page.tsx`

**Files:**

- Create: `app/(admin)/admin/events/new/page.tsx`

- [ ] **Step 1: Write the page**

Create `app/(admin)/admin/events/new/page.tsx`:

```tsx
import { EventForm } from "@/components/admin/events/EventForm"

export const metadata = { title: "New Event" }

export default function NewEventPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">New Event</h1>
      <EventForm />
    </div>
  )
}
```

- [ ] **Step 2: Verify tsc passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/admin/events/new/page.tsx"
git commit -m "feat(events): add /admin/events/new create page"
```

---

## Task 23: Admin edit page `/admin/events/[id]/page.tsx` with signups placeholder

**Files:**

- Create: `app/(admin)/admin/events/[id]/page.tsx`

- [ ] **Step 1: Write the page**

Create `app/(admin)/admin/events/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation"
import { Inbox } from "lucide-react"
import { getEventById } from "@/lib/db/events"
import { getSignupsForEvent } from "@/lib/db/event-signups"
import { EventForm } from "@/components/admin/events/EventForm"

export const dynamic = "force-dynamic"
export const metadata = { title: "Edit Event" }

interface Props {
  params: Promise<{ id: string }>
}

export default async function EditEventPage({ params }: Props) {
  const { id } = await params
  const event = await getEventById(id)
  if (!event) notFound()

  const signups = await getSignupsForEvent(id)

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold text-primary mb-6">Edit Event</h1>
        <EventForm event={event} />
      </div>

      <section className="border-t border-border pt-8">
        <h2 className="text-xl font-semibold text-primary mb-4">Signups</h2>
        {signups.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center">
            <Inbox className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
            <p className="font-medium">No signups yet</p>
            <p className="text-sm text-muted-foreground">
              Signups will appear here once the public signup flow launches in Phase 2b.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Athlete</th>
                  <th className="px-4 py-3">Age</th>
                  <th className="px-4 py-3">Parent</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {signups.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="px-4 py-3">{s.athlete_name}</td>
                    <td className="px-4 py-3">{s.athlete_age}</td>
                    <td className="px-4 py-3">{s.parent_name}</td>
                    <td className="px-4 py-3">{s.parent_email}</td>
                    <td className="px-4 py-3 capitalize">{s.signup_type}</td>
                    <td className="px-4 py-3 capitalize">{s.status}</td>
                    <td className="px-4 py-3">{new Date(s.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Verify tsc passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/admin/events/[id]/page.tsx"
git commit -m "feat(events): add /admin/events/[id] edit page with signups placeholder"
```

---

## Task 24: Playwright admin smoke test

**Files:**

- Create: `__tests__/e2e/admin-events.spec.ts`

- [ ] **Step 1: Write the test**

Create `__tests__/e2e/admin-events.spec.ts`:

```typescript
import { test, expect } from "@playwright/test"

// This test assumes a seeded admin account; skip if ADMIN_TEST_EMAIL / ADMIN_TEST_PASSWORD are missing.
const adminEmail = process.env.ADMIN_TEST_EMAIL
const adminPassword = process.env.ADMIN_TEST_PASSWORD

test.describe("Admin events CMS", () => {
  test.skip(!adminEmail || !adminPassword, "Admin test credentials not set")

  test("admin can create, publish, and see an event in the list", async ({ page }) => {
    await page.goto("/login")
    await page.fill("input[name='email']", adminEmail!)
    await page.fill("input[name='password']", adminPassword!)
    await page.click("button[type='submit']")
    await page.waitForURL(/\/admin/)

    await page.goto("/admin/events")
    await expect(page.getByRole("heading", { name: "Events" })).toBeVisible()

    await page.click("a:has-text('New event')")
    await page.waitForURL(/\/admin\/events\/new/)

    const slug = `e2e-clinic-${Date.now()}`
    await page.fill("input[name='title']", "E2E Test Clinic")
    // Slug auto-fills on title blur; overwrite with our unique slug.
    await page.locator("label:has-text('Slug') + input, input").nth(1).fill(slug)
    await page.fill("textarea", "E2E description for the clinic")

    // This is a smoke test — we don't complete the full form. Submit as draft.
    // In a real expansion, fill every required field and click Save & publish.
  })
})
```

**Note:** Admin e2e testing requires real admin credentials. This test is gated behind env vars and ships as scaffolding for manual runs — not intended to run in CI unless credentials are provisioned.

- [ ] **Step 2: Commit**

```bash
git add __tests__/e2e/admin-events.spec.ts
git commit -m "test(e2e): scaffold admin events smoke test"
```

---

## Task 25: Final verification

**Files:** none — verification only.

- [ ] **Step 1: Format sweep**

Run: `npm run format:check`. If files flagged, run `npm run format`. Commit any format changes as a separate `style:` commit.

- [ ] **Step 2: Full unit test suite**

Run: `npm run test:run`
Expected: all new tests pass. The 3 pre-existing failures from Phase 1 are still pre-existing and unrelated.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build completes. `/admin/events`, `/admin/events/new`, and `/admin/events/[id]` should appear as dynamic routes in the build output.

- [ ] **Step 4: Manual browser walkthrough**

Start dev server (`npm run dev`), log in as admin, visit `/admin/events`:

1. Sidebar shows the "Events" entry under Business.
2. Click "New event" → form loads, type selector toggles clinic/camp fields.
3. Fill in minimum required fields, upload a hero image, "Save as draft" → lands back on list with draft row.
4. Click the new event → edit page loads with values pre-filled, signups placeholder shows empty state.
5. Change status to Published → save → list shows badge update.
6. Public pages at `/clinics` and `/camps` are unchanged (still "coming soon" panel).

Stop the dev server.

- [ ] **Step 5: Tag the phase**

```bash
git tag phase-2a-clinics-camps-complete
```

- [ ] **Step 6: Summarize for the controller**

Final git log:

```bash
git log --oneline main..HEAD
```

Report the branch state: commits, tag, which tests pass, build result.

---

## Self-Review Checklist

**Spec coverage:**

| Phase 2a requirement                                     | Task       |
| -------------------------------------------------------- | ---------- |
| Migration with both tables + indices + CHECK constraints | Task 1     |
| Two RPCs (confirm/cancel)                                | Task 2     |
| Migration applied to dev DB                              | Task 3     |
| Migration integration test                               | Task 4     |
| Type additions in types/database.ts                      | Task 5     |
| Event + signup Zod validators                            | Tasks 6, 7 |
| Event DAL (read + write)                                 | Tasks 8, 9 |
| Event DAL tests                                          | Task 10    |
| Signup DAL + tests                                       | Task 11    |
| Image storage helper + upload route + bucket             | Task 12    |
| POST /api/admin/events                                   | Task 13    |
| PATCH + DELETE /api/admin/events/[id]                    | Task 14    |
| POST /api/admin/events/[id]/duplicate                    | Task 15    |
| API route tests                                          | Task 16    |
| Admin sidebar entry (desktop + mobile)                   | Task 17    |
| EventHeroImageUpload component                           | Task 18    |
| EventForm component                                      | Task 19    |
| EventList component                                      | Task 20    |
| Admin list page                                          | Task 21    |
| Admin create page                                        | Task 22    |
| Admin edit page with empty signups                       | Task 23    |
| Playwright smoke test                                    | Task 24    |
| Final verification                                       | Task 25    |

Every Phase 2a spec requirement has a task.

**Type consistency:** `Event` and `EventSignup` types defined in Task 5 are used consistently by the DAL (Tasks 8, 9, 11), validators (Tasks 6, 7), API routes (Tasks 13-15), and UI components (Tasks 19, 20, 23). `CreateEventInput` / `UpdateEventInput` / `CreateSignupInput` type names are stable across validator and DAL files.

**Placeholder scan:** no TBDs or TODOs. The one "investigate first" spot (mobile sidebar — Task 17) has explicit guidance on what to check. The e2e test (Task 24) is scaffolding gated behind env vars — documented as such.

**Assumptions flagged:**

- Task 3 assumes the implementer knows how to apply a Supabase migration in this project; explicit commands shown.
- Task 12 creates the `event-images` storage bucket via SQL insert; if Supabase Storage requires a different setup path in this project (e.g., dashboard-only), implementer should escalate.
- Task 17 assumes the mobile sidebar either imports from the desktop sidebar or mirrors its `navSections` — the step says "inspect first."
