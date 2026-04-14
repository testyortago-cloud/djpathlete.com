# Clinics & Camps Phase 2a — Admin Events CMS Design Spec

**Date:** 2026-04-14
**Status:** Approved design, pending implementation plan
**Parent spec:** [2026-04-14-clinics-and-camps-design.md](2026-04-14-clinics-and-camps-design.md)
**Previous phase:** Phase 1 merged at commit `895ff79`, tagged `phase-1-clinics-camps-complete`.

## Summary

Phase 2 of the original three-phase design is too large for a single implementation plan, so it is split into **2a (this spec)** and **2b (separate spec, forthcoming)**.

**Phase 2a ships:** full schema (`events` + `event_signups` tables + two atomic RPCs), DAL, validators, admin CRUD at `/admin/events`, image upload handler, admin sidebar entry. No public-facing changes — the landing pages continue to render the `EventsComingSoonPanel` from Phase 1.

**Phase 2b ships:** `EventCard` on public landing pages, per-event detail pages at `/clinics/[slug]` and `/camps/[slug]`, signup modal with `POST /api/events/[id]/signup`, admin confirm/cancel handler, three Resend email templates. Covered in a separate spec + plan.

## Goals

- Deliver a production-ready schema and admin CMS that Darren can use immediately to draft clinics and camps, without any user-visible change.
- Build the capacity-guard primitives (`confirm_event_signup`, `cancel_event_signup` RPCs) now so both Phase 2b (admin confirm) and Phase 3 (Stripe webhook) can consume the same atomic operation.
- Keep Phase 2a self-contained and independently testable — merging 2a does not require 2b.

## Non-Goals (deferred to 2b or 3)

- Public `EventCard` + event detail pages — 2b.
- Public signup flow and capacity UX — 2b.
- Email templates (signup received / confirmed / admin notification) — 2b.
- Stripe product sync for camps — Phase 3.
- Rich-text description editor — out of scope (plain textarea in 2a).
- Bulk admin actions, recurring events, image library picker — all deferred.

## Key Decisions (locked during brainstorming)

1. **Split Phase 2 into 2a + 2b.** Admin CMS ships independently with value; public flow layers on top later.
2. **Postgres RPC for atomic capacity logic.** Two functions: `confirm_event_signup(uuid)` and `cancel_event_signup(uuid)`. Matches existing RPC pattern in 3 DAL files.
3. **Hero image via reused upload pattern.** New `/api/upload/event-image` route, mirrors [app/api/upload/blog-image/](app/api/upload/blog-image/). Admin form gets a file picker, not a free-text URL.
4. **Slug auto-suggest from title, editable, DB-unique.** Admin can override for vanity URLs. Unique constraint on `events.slug` surfaces collisions as inline form errors.
5. **Both tables land in one migration.** `00062_create_events.sql` creates `events`, `event_signups`, and both RPCs. Phase 2b adds no schema changes.

## Data Model

Schema unchanged from the master spec; repeated here for reference.

### `events` table

| column | type | notes |
|---|---|---|
| `id` | uuid PK default `gen_random_uuid()` | |
| `type` | text, CHECK IN (`'clinic'`, `'camp'`) | |
| `slug` | text UNIQUE NOT NULL | |
| `title` | text NOT NULL | |
| `summary` | text NOT NULL | short card blurb |
| `description` | text NOT NULL | plain text |
| `focus_areas` | text[] NOT NULL default `'{}'` | |
| `start_date` | timestamptz NOT NULL | |
| `end_date` | timestamptz nullable | |
| `session_schedule` | text nullable | camp only |
| `location_name` | text NOT NULL | |
| `location_address` | text nullable | |
| `location_map_url` | text nullable | |
| `age_min`, `age_max` | int nullable | |
| `capacity` | int NOT NULL CHECK (`capacity > 0`) | |
| `signup_count` | int NOT NULL default 0 CHECK (`signup_count >= 0 AND signup_count <= capacity`) | |
| `price_cents` | int nullable CHECK (`price_cents IS NULL OR price_cents >= 0`) | |
| `stripe_price_id` | text nullable | |
| `status` | text NOT NULL default `'draft'`, CHECK IN (`'draft'`, `'published'`, `'cancelled'`, `'completed'`) | |
| `hero_image_url` | text nullable | |
| `created_at`, `updated_at` | timestamptz NOT NULL default `now()` | |

**Indices:** `idx_events_status` on `status`, `idx_events_type` on `type`, `idx_events_start_date` on `start_date`, unique index on `slug` via the UNIQUE constraint.

### `event_signups` table

| column | type | notes |
|---|---|---|
| `id` | uuid PK default `gen_random_uuid()` | |
| `event_id` | uuid NOT NULL, FK → `events(id)` ON DELETE CASCADE | |
| `signup_type` | text NOT NULL, CHECK IN (`'interest'`, `'paid'`) | |
| `parent_name`, `parent_email`, `parent_phone` | text; email NOT NULL | |
| `athlete_name`, `athlete_age` | text NOT NULL, int NOT NULL | |
| `sport` | text nullable | |
| `notes` | text nullable | |
| `status` | text NOT NULL default `'pending'`, CHECK IN (`'pending'`, `'confirmed'`, `'cancelled'`, `'refunded'`) | |
| `stripe_session_id`, `stripe_payment_intent_id` | text nullable | |
| `amount_paid_cents` | int nullable | |
| `user_id` | uuid nullable, FK → `users(id)` ON DELETE SET NULL | |
| `created_at`, `updated_at` | timestamptz NOT NULL default `now()` | |

**Indices:** `idx_event_signups_event_id` on `event_id`, `idx_event_signups_status` on `status`, `idx_event_signups_email` on `parent_email` (for future lookup).

### RPC functions

**`confirm_event_signup(p_signup_id uuid) RETURNS jsonb`**

```sql
-- Pseudocode; exact SQL in migration.
BEGIN
  SELECT * FROM event_signups WHERE id = p_signup_id FOR UPDATE INTO signup;
  IF signup IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  IF signup.status != 'pending' THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_pending');

  SELECT capacity, signup_count FROM events WHERE id = signup.event_id FOR UPDATE INTO evt;
  IF evt.signup_count >= evt.capacity THEN RETURN jsonb_build_object('ok', false, 'reason', 'at_capacity');

  UPDATE event_signups SET status = 'confirmed', updated_at = now() WHERE id = p_signup_id;
  UPDATE events SET signup_count = signup_count + 1, updated_at = now() WHERE id = signup.event_id;

  RETURN jsonb_build_object('ok', true);
END;
```

Runs as `SECURITY DEFINER` so it can be invoked from service-role contexts without exposing raw UPDATE rights.

**`cancel_event_signup(p_signup_id uuid) RETURNS jsonb`**

```sql
BEGIN
  SELECT * FROM event_signups WHERE id = p_signup_id FOR UPDATE INTO signup;
  IF signup IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  IF signup.status NOT IN ('pending', 'confirmed') THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_cancellable');

  was_confirmed := signup.status = 'confirmed';

  UPDATE event_signups SET status = 'cancelled', updated_at = now() WHERE id = p_signup_id;
  IF was_confirmed THEN
    UPDATE events SET signup_count = signup_count - 1, updated_at = now() WHERE id = signup.event_id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
```

## Validators

### `lib/validators/events.ts`

- `eventBaseSchema` (shared fields): title (2-120), slug (regex `^[a-z0-9-]+$`, 2-120), summary (1-300), description (1-5000), focus_areas (array of non-empty strings), location_name (1-200), location_address (optional), location_map_url (optional, URL), capacity (int, 1-500), hero_image_url (optional, URL), status (enum), age_min (optional int 6-21), age_max (optional int 6-21, >= age_min).
- `clinicEventSchema`: `eventBaseSchema.extend({ type: z.literal('clinic'), start_date: z.string().datetime() })`. API derives `end_date = start_date + 2h` on server.
- `campEventSchema`: `eventBaseSchema.extend({ type: z.literal('camp'), start_date: z.string().datetime(), end_date: z.string().datetime(), session_schedule: z.string().optional(), price_dollars: z.number().nonnegative().optional() })`. API converts `price_dollars` → `price_cents` on write.
- `createEventSchema` = `z.discriminatedUnion('type', [clinicEventSchema, campEventSchema])`.
- `updateEventSchema` = partial version of createEventSchema (type is immutable once created — enforced at API layer, not validator).

### `lib/validators/event-signups.ts`

- `createEventSignupSchema`: parent_name (2-100), parent_email (email), parent_phone (optional, 5-30), athlete_name (2-100), athlete_age (int 6-21), sport (optional, 1-60), notes (optional, 1-1000).

Lands in 2a so Phase 2b's public signup route can import from a stable location.

## DAL

### `lib/db/events.ts`

```typescript
getEvents(filters?: { type?: EventType; status?: EventStatus; search?: string }): Promise<Event[]>
getPublishedEvents(filters?: { type?: EventType; from?: Date }): Promise<Event[]>  // Phase 2b consumer
getEventById(id: string): Promise<Event | null>
getEventBySlug(slug: string): Promise<Event | null>
createEvent(input: CreateEventInput): Promise<Event>
updateEvent(id: string, input: UpdateEventInput): Promise<Event>
deleteEvent(id: string): Promise<void>  // rejects non-draft or events with signups
setEventStatus(id: string, status: EventStatus): Promise<Event>  // validates transitions
```

Status transition rules enforced in `setEventStatus`:
- `draft` → `published`, `cancelled`
- `published` → `cancelled`, `completed`
- `cancelled` → (terminal)
- `completed` → (terminal)

### `lib/db/event-signups.ts`

```typescript
getSignupsForEvent(eventId: string): Promise<EventSignup[]>
getSignupById(id: string): Promise<EventSignup | null>
createSignup(eventId: string, input: CreateSignupInput, signupType: SignupType): Promise<EventSignup>
confirmSignup(id: string): Promise<{ ok: boolean; reason?: 'not_found' | 'not_pending' | 'at_capacity' }>
cancelSignup(id: string): Promise<{ ok: boolean; reason?: 'not_found' | 'not_cancellable' }>
```

`confirmSignup` and `cancelSignup` invoke the RPCs via `supabase.rpc('confirm_event_signup', { p_signup_id: id })`.

All functions use the service-role client (pattern from [lib/db/bookings.ts](lib/db/bookings.ts)).

### Type additions in `types/database.ts`

```typescript
export type EventType = 'clinic' | 'camp'
export type EventStatus = 'draft' | 'published' | 'cancelled' | 'completed'
export type SignupType = 'interest' | 'paid'
export type SignupStatus = 'pending' | 'confirmed' | 'cancelled' | 'refunded'
export type Event = { /* full row shape */ }
export type EventSignup = { /* full row shape */ }
```

## Admin CRUD

### Routes

| route | purpose |
|---|---|
| `app/(admin)/admin/events/page.tsx` | List view with filters + "New event" button |
| `app/(admin)/admin/events/new/page.tsx` | Create form |
| `app/(admin)/admin/events/[id]/page.tsx` | Edit form + signups table (empty state in 2a) |

### List page

**Columns:** Title · Type (badge) · Start date (formatted) · Location · Signups (`3 / 10`) · Status (colored badge) · Actions (edit · duplicate · publish · cancel).

**Sort:** `status='published'` first, then upcoming `start_date` ASC; drafts grouped below; past events (`end_date < now()`) at the bottom.

**Filters (URL query params):** `?type=clinic|camp`, `?status=draft|published|cancelled|completed`, `?search=<title>`. Reset button clears all.

Uses existing shadcn `Table`, `Input`, `Select` components.

### Edit form

React Hook Form + Zod resolver + Supabase mutation pattern.

**Shared fields:**
- title (text input) — on blur, auto-suggest slug if slug empty or last auto-filled
- slug (text input, lowercase enforced; inline error on submit if DB conflict)
- summary (textarea, 1-2 lines)
- description (textarea, 3-10 rows)
- focus_areas (tag input: text field + Enter to add; existing chips have an × to remove)
- location_name (text), location_address (text, optional), location_map_url (URL, optional)
- capacity (int input)
- hero image (file picker → uploads via `/api/upload/event-image` → sets `hero_image_url`; shows preview thumbnail when set)
- age_min / age_max (int inputs, side by side)
- status (select: Draft / Published / Cancelled / Completed; disabled options based on current transition rules)

**Clinic-only:**
- start_date: single `datetime-local` input → API derives `end_date`

**Camp-only:**
- start_date: `date` input
- end_date: `date` input
- session_schedule: text input (placeholder "M–F, 9–11am")
- price (dollars): number input, `step="0.01"` — API converts to cents
- "Sync to Stripe" button: disabled in 2a with tooltip "Available in Phase 3"

**Submit buttons (bottom):**
- If `status === 'draft'`: "Save as draft" + "Save & publish"
- Otherwise: single "Save" button
- "Delete event" (danger, right-aligned): only enabled when `status === 'draft'` and signup_count === 0

**Signups table (below the form):**
Renders `<EmptyState>` in 2a with title "No signups yet" and body "Signups will appear here once the public signup flow launches in Phase 2b."

### Image upload route

`app/api/upload/event-image/route.ts` — mirrors the blog-image handler exactly:
- Requires admin session via `auth()` + role check
- Accepts multipart form-data, single image file
- Validates MIME type (image/*), max size 5MB
- Uploads to the same Supabase Storage bucket the blog handler uses (investigate during implementation; use the identical configuration path)
- Returns `{ url: string }` or 4xx error

### Admin API routes

- `POST /api/admin/events` — validates `createEventSchema`, admin-only, calls `createEvent()`. Returns `{ event }` or `{ error, fieldErrors }`.
- `PATCH /api/admin/events/[id]` — validates `updateEventSchema`, admin-only. If the payload includes a `status` change, the route calls `setEventStatus()` (which enforces transition rules) and then `updateEvent()` for the remaining fields. If `status` is absent, it calls `updateEvent()` only. Same error shape.
- `DELETE /api/admin/events/[id]` — admin-only, calls `deleteEvent()`.
- `POST /api/admin/events/[id]/duplicate` — admin-only convenience: loads event, creates a new draft with `-copy` suffixed slug and `status='draft'`.

All API routes use the same `auth()`-guarded pattern as existing admin routes (see [app/api/admin/programs/](app/api/admin/programs/) for reference).

## Admin Sidebar

Add "Events" entry between "Bookings" and "Clients". Icon: `CalendarDays` from lucide-react. Location depends on where the admin sidebar config lives — investigate in [app/(admin)/admin/layout.tsx](app/(admin)/admin/layout.tsx) or adjacent constants file during implementation.

## Testing

### Unit / integration
- **Validators** (`__tests__/lib/validators/events.test.ts`): discriminated union correctness, age bounds, slug regex, price conversion.
- **DAL events** (`__tests__/db/events.test.ts`): createEvent roundtrip, unique slug conflict surfaces as error, getPublishedEvents excludes draft/past, setEventStatus transition validation.
- **DAL signups** (`__tests__/db/event-signups.test.ts`): createSignup roundtrip, confirmSignup success + at_capacity paths, cancelSignup success + not_cancellable path.
- **RPC SQL test** (`__tests__/migrations/00062.test.ts`): apply migration to a clean test DB, seed event + 2 pending signups with capacity=1, call `confirm_event_signup` twice — assert second returns `{ok:false, reason:'at_capacity'}`. Follow existing migration test pattern.

### API routes
- **POST /api/admin/events**: admin-only, validation errors surface, successful create returns event with id.
- **PATCH /api/admin/events/[id]**: partial update, status transition validation.
- **DELETE /api/admin/events/[id]**: rejects when signups exist, rejects when status != 'draft'.

### E2E (Playwright)
One smoke test: admin logs in, creates a draft clinic, fills all required fields, saves, sees it in the list, opens it, publishes it, lands back on list with the new status badge.

## Migration file

`supabase/migrations/00062_create_events.sql` contains:
1. `CREATE TABLE events (...)` with all columns, constraints, indices.
2. `CREATE TABLE event_signups (...)` with all columns, constraints, indices.
3. `CREATE FUNCTION confirm_event_signup(uuid) RETURNS jsonb` (SECURITY DEFINER).
4. `CREATE FUNCTION cancel_event_signup(uuid) RETURNS jsonb` (SECURITY DEFINER).
5. `updated_at` trigger on both tables (copy whatever pattern other tables use — check existing migrations).

No data seeding.

## Dependencies

Nothing new. Reuses Supabase, NextAuth (admin auth), shadcn/ui (Table, Select, Input, Textarea, Dialog, Button, Card), React Hook Form + Zod, Lucide icons, Framer Motion.

## What Ships After Phase 2a

- Darren can log into admin, create draft clinics and camps with all fields, upload hero images, publish them, move them between status states, delete drafts.
- The DB schema is complete. The RPCs are tested and ready for 2b (admin confirm flow) and Phase 3 (Stripe webhook).
- Public site is unchanged — `/clinics` and `/camps` still render `EventsComingSoonPanel`.
- This phase is independently deployable and rollback-safe (forward migration only; if we need to roll back, we drop the tables in a down migration).

Phase 2b builds on top: it consumes `getPublishedEvents()` on the landing pages, adds `/clinics/[slug]` + `/camps/[slug]` detail pages, wires the signup modal to a new `POST /api/events/[id]/signup` route, and implements the `PATCH /api/admin/events/[id]/signups/[signupId]` admin confirm/cancel handler that invokes `confirmSignup` / `cancelSignup` DAL functions.
