# Clinics & Camps Phase 3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable paid camp bookings via guest-friendly Stripe Checkout with auto-sync of Stripe Products/Prices, webhook-driven signup confirmation, refund handling, and an event-specific success page.

**Architecture:** Additive only. New migration adds `events.stripe_product_id`, new DAL helpers track paid-signup capacity windowing, new helpers in `lib/stripe.ts` create Event-scoped Products and Checkout Sessions, the existing webhook gains an `event_signup` branch (existing program branches untouched), the existing PATCH admin events route auto-syncs on publish/price-change, and the public modal/cards switch from "Coming soon" to a real Stripe redirect when a camp is priced and synced.

**Tech Stack:** Stripe SDK (existing), Supabase (existing), Next.js 16 App Router, shadcn/ui (Dialog, Button, Card), sonner toast, Vitest with mocked Stripe + auth, Playwright (scaffold only).

---

## Spec Reference

Source: [docs/superpowers/specs/2026-04-14-clinics-and-camps-phase-3-design.md](docs/superpowers/specs/2026-04-14-clinics-and-camps-phase-3-design.md). Parents: [master](docs/superpowers/specs/2026-04-14-clinics-and-camps-design.md), [Phase 2a](docs/superpowers/specs/2026-04-14-clinics-and-camps-phase-2a-design.md), [Phase 2b](docs/superpowers/specs/2026-04-14-clinics-and-camps-phase-2b-design.md).

## Phase 2a/2b inventory — what you can assume exists

- `events` + `event_signups` tables, with `stripe_price_id`, `stripe_session_id`, `stripe_payment_intent_id`, `amount_paid_cents` columns.
- RPCs: `confirm_event_signup`, `cancel_event_signup` (Phase 2a, both with `IF NOT FOUND` correctness fix from the post-review).
- DAL: `lib/db/events.ts` (CRUD + `ALLOWED_STATUS_TRANSITIONS`), `lib/db/event-signups.ts` (`getSignupsForEvent`, `getSignupById`, `createSignup`, `confirmSignup`, `cancelSignup`).
- Validators: `lib/validators/events.ts`, `lib/validators/event-signups.ts` (`createEventSignupSchema`).
- Types: `Event`, `EventSignup`, etc. in `types/database.ts`.
- Email templates: `sendEventSignupReceivedEmail`, `sendEventSignupConfirmedEmail`, `sendAdminNewSignupEmail` in `lib/email.ts`.
- Public: `/clinics`, `/camps`, `/clinics/[slug]`, `/camps/[slug]`, `EventCard`, `EventCardCta`, `EventDetailHero`, `EventSignupCard`, `EventSignupModal`, `EventsComingSoonPanel`.
- Admin: `/admin/events*` routes, `EventForm` (with disabled "Sync to Stripe" button), `EventList`, `SignupsTable`, `EventHeroImageUpload`.
- API: `POST /api/events/[id]/signup` (interest), `PATCH /api/admin/events/[id]` (event update with status transitions), `PATCH /api/admin/events/[id]/signups/[signupId]` (admin confirm/cancel), `POST /api/admin/events`, `DELETE /api/admin/events/[id]`, `POST /api/admin/events/[id]/duplicate`, `POST /api/upload/event-image`.
- Stripe: `lib/stripe.ts` with `stripe` client, `verifyWebhookSignature`, `createStripeProductAndPrice` (program-scoped), `archiveAndCreateNewPrice`, etc. Existing webhook at `app/api/stripe/webhook/route.ts` with `metadata.type` dispatch (`"week_access"`, etc.).

## File Structure

**New files:**

| path | responsibility |
|---|---|
| `supabase/migrations/00063_events_stripe_product_id.sql` | Add `events.stripe_product_id` column + index |
| `app/api/events/[id]/checkout/route.ts` | Public POST — guest-friendly Stripe Session creation |
| `app/api/admin/events/[id]/stripe-sync/route.ts` | Admin POST — manual Resync helper |
| `app/(marketing)/camps/[slug]/success/page.tsx` | Server-rendered post-checkout confirmation |
| `__tests__/api/events/checkout.test.ts` | Public checkout route tests |
| `__tests__/api/admin/events-stripe-sync.test.ts` | Admin sync route tests |
| `__tests__/api/stripe/webhook-events.test.ts` | Webhook event_signup branch tests |
| `__tests__/e2e/camps-paid.spec.ts` | Playwright scaffold for the booking flow |

**Modified files:**

| path | change |
|---|---|
| `types/database.ts` | Add `stripe_product_id: string \| null` to `Event` |
| `lib/db/events.ts` | `createEvent` and `updateEvent` thread the new column |
| `lib/db/event-signups.ts` | Add `countPendingPaidSignups`, `getEventSignupByStripeSessionId`, `getEventSignupByPaymentIntent`; embed on-read sweep inside `getSignupsForEvent` |
| `__tests__/db/event-signups.test.ts` | Extend with tests for the three new functions + sweep |
| `lib/stripe.ts` | Add `syncEventToStripe` + `createEventCheckoutSession` helpers |
| `app/api/admin/events/[id]/route.ts` | PATCH triggers auto-sync on publish + auto-resync on price change |
| `app/api/stripe/webhook/route.ts` | Two new branches: `event_signup` checkout completion + `charge.refunded` for events |
| `components/admin/events/EventForm.tsx` | Re-enable "Resync with Stripe" button + wire to admin sync route |
| `components/admin/events/SignupsTable.tsx` | "Paid" indicator + Stripe dashboard link for paid signups |
| `components/public/EventCardCta.tsx` | Camp button: enabled "Book camp — $X" when `stripe_price_id` is set |
| `components/public/EventSignupCard.tsx` | Same camp button logic |
| `components/public/EventSignupModal.tsx` | Paid-flow branch: different submit URL + button label + full-page redirect |
| `app/(marketing)/camps/[slug]/page.tsx` | Show `?checkout=cancelled` info banner above the hero |

---

## Task 1: Migration 00063 — add `stripe_product_id`

**Why:** `lib/stripe.ts`'s `archiveAndCreateNewPrice(opts)` takes `productId` as input — we need to track the camp's Stripe Product separately from its Price so price changes can rotate the Price without orphaning the Product.

**Files:**
- Create: `supabase/migrations/00063_events_stripe_product_id.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/00063_events_stripe_product_id.sql`:

```sql
-- Phase 3: track Stripe Product id separately from Price id on events.
-- Stripe Prices are immutable, so price changes rotate Price ids while the
-- Product stays stable. Tracking both lets us archive-and-create-new-price
-- without orphaning Stripe Products.

alter table events add column if not exists stripe_product_id text;
create index if not exists idx_events_stripe_product_id on events (stripe_product_id);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/00063_events_stripe_product_id.sql
git commit -m "feat(events): add events.stripe_product_id column (phase 3)"
```

**Migration is NOT applied here.** Task 2 is the operational apply step (user runs psql or Supabase CLI). Subsequent tasks depend on the column existing.

---

## Task 2: Apply migration 00063

**Why:** Subsequent tasks read/write `stripe_product_id` and DAL tests will fail until the column exists.

**Files:** none — operational step.

- [ ] **Step 1: Apply via Supabase CLI or SQL Editor**

```bash
# Option 1 — Supabase CLI
npx supabase db push

# Option 2 — direct psql
psql "$SUPABASE_DB_URL" -f supabase/migrations/00063_events_stripe_product_id.sql

# Option 3 — Supabase Dashboard SQL Editor: paste contents of the migration file, run.
```

- [ ] **Step 2: Sanity check**

```bash
psql "$SUPABASE_DB_URL" -c "\d events" | grep stripe_product_id
```

Expected: a row showing `stripe_product_id | text |` (column exists).

No commit. Hand off to Task 3 once the column is live.

---

## Task 3: Add `stripe_product_id` to the `Event` type

**Why:** TypeScript needs to know the column exists so DAL writes and reads don't trip the type checker.

**Files:**
- Modify: `types/database.ts`

- [ ] **Step 1: Edit the Event interface**

In `types/database.ts`, find the `export interface Event { ... }` block. Add this field directly above the existing `stripe_price_id` field for grouping:

```typescript
  stripe_product_id: string | null
```

The two fields (product + price) will sit next to each other, both nullable.

- [ ] **Step 2: tsc**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add types/database.ts
git commit -m "feat(events): add stripe_product_id to Event type"
```

---

## Task 4: DAL extensions — capacity counter, lookups by Stripe ids, on-read sweep

**Why:** The checkout route needs to count pending paid signups within a time window for capacity reservation. The webhook needs to look up signups by Stripe session id (success page) and by payment intent id (refund handler). The admin signups view needs stale paid-pending rows to age out.

**Files:**
- Modify: `lib/db/event-signups.ts`
- Modify: `__tests__/db/event-signups.test.ts`

- [ ] **Step 1: Write failing tests for the three new DAL functions + sweep**

Append to `__tests__/db/event-signups.test.ts` (inside the existing `describe("event-signups DAL", ...)` block):

```typescript
  it("countPendingPaidSignups counts only paid+pending within last hour", async () => {
    const { countPendingPaidSignups } = await import("@/lib/db/event-signups")
    const e = await createEvent({
      type: "camp",
      slug: `cap-window-${randomUUID()}`,
      title: "T", summary: "S", description: "D", focus_areas: [],
      start_date: new Date(Date.now() + 86400000).toISOString(),
      end_date: new Date(Date.now() + 7 * 86400000).toISOString(),
      location_name: "L", capacity: 10, status: "draft", price_dollars: 100,
    })
    extraEventIds.push(e.id)

    // Recent paid pending — should count
    await createSignup(e.id, {
      parent_name: "A", parent_email: "a@x.com", athlete_name: "X", athlete_age: 14,
    }, "paid")
    // Recent interest pending — should NOT count
    await createSignup(e.id, {
      parent_name: "B", parent_email: "b@x.com", athlete_name: "Y", athlete_age: 14,
    }, "interest")

    const count = await countPendingPaidSignups(e.id)
    expect(count).toBe(1)
  })

  it("getEventSignupByStripeSessionId returns the matching signup", async () => {
    const { getEventSignupByStripeSessionId, createSignup } = await import("@/lib/db/event-signups")
    const e = await createEvent({
      type: "camp",
      slug: `lookup-session-${randomUUID()}`,
      title: "T", summary: "S", description: "D", focus_areas: [],
      start_date: new Date(Date.now() + 86400000).toISOString(),
      end_date: new Date(Date.now() + 7 * 86400000).toISOString(),
      location_name: "L", capacity: 10, status: "draft", price_dollars: 100,
    })
    extraEventIds.push(e.id)

    const sig = await createSignup(e.id, {
      parent_name: "A", parent_email: "a@x.com", athlete_name: "X", athlete_age: 14,
    }, "paid")

    // Manually attach a session id (the route does this in production)
    const { createServiceRoleClient } = await import("@/lib/supabase")
    const supabase = createServiceRoleClient()
    const sessionId = `cs_test_${randomUUID()}`
    await supabase.from("event_signups").update({ stripe_session_id: sessionId }).eq("id", sig.id)

    const fetched = await getEventSignupByStripeSessionId(sessionId)
    expect(fetched?.id).toBe(sig.id)
  })

  it("getEventSignupByPaymentIntent returns the matching signup", async () => {
    const { getEventSignupByPaymentIntent, createSignup } = await import("@/lib/db/event-signups")
    const e = await createEvent({
      type: "camp",
      slug: `lookup-pi-${randomUUID()}`,
      title: "T", summary: "S", description: "D", focus_areas: [],
      start_date: new Date(Date.now() + 86400000).toISOString(),
      end_date: new Date(Date.now() + 7 * 86400000).toISOString(),
      location_name: "L", capacity: 10, status: "draft", price_dollars: 100,
    })
    extraEventIds.push(e.id)

    const sig = await createSignup(e.id, {
      parent_name: "A", parent_email: "a@x.com", athlete_name: "X", athlete_age: 14,
    }, "paid")

    const { createServiceRoleClient } = await import("@/lib/supabase")
    const supabase = createServiceRoleClient()
    const piId = `pi_test_${randomUUID()}`
    await supabase
      .from("event_signups")
      .update({ stripe_payment_intent_id: piId })
      .eq("id", sig.id)

    const fetched = await getEventSignupByPaymentIntent(piId)
    expect(fetched?.id).toBe(sig.id)
  })
```

- [ ] **Step 2: Run tests — fail with "is not a function" or undefined imports**

Run: `npm run test:run -- db/event-signups`
Expected: 3 new tests fail; existing 3 pass (total: 3 pass, 3 fail).

- [ ] **Step 3: Add the three functions + on-read sweep**

Open `lib/db/event-signups.ts`. Replace the existing `getSignupsForEvent` with a version that runs the sweep first, and add the three new exports at the bottom:

```typescript
export async function getSignupsForEvent(eventId: string): Promise<EventSignup[]> {
  const supabase = getClient()

  // On-read sweep: stale paid pending rows (>1 hour old) become cancelled.
  // The capacity guard's time window already excludes them; this keeps the
  // admin table tidy without a scheduled job.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  await supabase
    .from("event_signups")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("event_id", eventId)
    .eq("signup_type", "paid")
    .eq("status", "pending")
    .lt("created_at", oneHourAgo)

  const { data, error } = await supabase
    .from("event_signups")
    .select("*")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as EventSignup[]
}

export async function countPendingPaidSignups(eventId: string): Promise<number> {
  const supabase = getClient()
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count, error } = await supabase
    .from("event_signups")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .eq("signup_type", "paid")
    .eq("status", "pending")
    .gte("created_at", oneHourAgo)
  if (error) throw error
  return count ?? 0
}

export async function getEventSignupByStripeSessionId(sessionId: string): Promise<EventSignup | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("event_signups")
    .select("*")
    .eq("stripe_session_id", sessionId)
    .maybeSingle()
  if (error) throw error
  return (data as EventSignup) ?? null
}

export async function getEventSignupByPaymentIntent(piId: string): Promise<EventSignup | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("event_signups")
    .select("*")
    .eq("stripe_payment_intent_id", piId)
    .maybeSingle()
  if (error) throw error
  return (data as EventSignup) ?? null
}
```

- [ ] **Step 4: Run tests — all pass**

Run: `npm run test:run -- db/event-signups`
Expected: 6/6 pass (3 existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add lib/db/event-signups.ts __tests__/db/event-signups.test.ts
git commit -m "feat(events): add Stripe-id lookups + paid capacity counter + on-read sweep"
```

---

## Task 5: `lib/stripe.ts` helpers — `syncEventToStripe` + `createEventCheckoutSession`

**Why:** Two routes (PATCH admin events for auto-sync, manual Resync) and the public checkout route need shared Stripe helpers. Centralize in `lib/stripe.ts` so the call sites are thin.

**Files:**
- Modify: `lib/stripe.ts`

- [ ] **Step 1: Append two new helpers**

Open `lib/stripe.ts`. Add these imports at the top if not already present:

```typescript
import type { Event, EventSignup } from "@/types/database"
```

Append at the end of the file:

```typescript
// ─── Event sync (Phase 3) ────────────────────────────────────────────────────

/**
 * Idempotent sync of an Event to a Stripe Product + Price.
 * - If event has no stripe_product_id, creates a new Product + Price.
 * - If event has stripe_product_id but the Product is missing/archived in Stripe,
 *   creates a fresh Product + Price.
 * - If event has stripe_product_id but no stripe_price_id, creates a Price under
 *   the existing Product.
 * - If event has both ids, no-op (returns the existing ids).
 *
 * Caller is responsible for persisting the returned ids on the event row.
 */
export async function syncEventToStripe(event: Event): Promise<{ productId: string; priceId: string }> {
  if (event.price_cents == null || event.price_cents <= 0) {
    throw new Error("Cannot sync event without a positive price_cents")
  }

  let productId = event.stripe_product_id
  let needFreshProduct = !productId

  if (productId) {
    try {
      const product = await stripe.products.retrieve(productId)
      if (!product.active) needFreshProduct = true
    } catch {
      // Product missing entirely → create fresh.
      needFreshProduct = true
    }
  }

  if (needFreshProduct) {
    const product = await stripe.products.create({
      name: event.title,
      description: event.summary || undefined,
      metadata: { eventId: event.id, type: "event" },
    })
    productId = product.id
  }

  // Always create a fresh Price when product is fresh; reuse existing price
  // when product was already valid AND a price id is on file.
  if (event.stripe_price_id && !needFreshProduct) {
    return { productId: productId!, priceId: event.stripe_price_id }
  }

  const price = await stripe.prices.create({
    product: productId!,
    unit_amount: event.price_cents,
    currency: "usd",
  })

  return { productId: productId!, priceId: price.id }
}

/**
 * Create a guest-friendly Stripe Checkout Session for a paid camp signup.
 * - mode: "payment" (one-shot, no subscription)
 * - customer_email pre-fills the parent's address
 * - metadata.type = "event_signup" so the webhook dispatcher routes to our handler
 */
export async function createEventCheckoutSession(opts: {
  event: Event
  signup: EventSignup
  parentEmail: string
  baseUrl: string
}): Promise<Stripe.Checkout.Session> {
  if (!opts.event.stripe_price_id) {
    throw new Error("Cannot create checkout: event has no stripe_price_id")
  }
  return stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [{ price: opts.event.stripe_price_id, quantity: 1 }],
    customer_email: opts.parentEmail,
    metadata: {
      type: "event_signup",
      event_signup_id: opts.signup.id,
      event_id: opts.event.id,
    },
    success_url: `${opts.baseUrl}/camps/${opts.event.slug}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${opts.baseUrl}/camps/${opts.event.slug}?checkout=cancelled`,
  })
}
```

- [ ] **Step 2: tsc**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/stripe.ts
git commit -m "feat(stripe): add syncEventToStripe + createEventCheckoutSession helpers"
```

---

## Task 6: Public checkout route — `POST /api/events/[id]/checkout`

**Why:** Backend for the paid camp flow. Receives form data from the modal, validates, enforces capacity reservation, creates a pending paid signup, mints a Stripe Checkout Session, returns the session URL for the modal to redirect to.

**Files:**
- Create: `app/api/events/[id]/checkout/route.ts`
- Test: `__tests__/api/events/checkout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/events/checkout.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

const getEventByIdMock = vi.fn()
const createSignupMock = vi.fn()
const countPendingPaidSignupsMock = vi.fn()
const createEventCheckoutSessionMock = vi.fn()
const updateSignupSessionMock = vi.fn(async () => undefined)

vi.mock("@/lib/db/events", () => ({ getEventById: (...a: unknown[]) => getEventByIdMock(...a) }))
vi.mock("@/lib/db/event-signups", () => ({
  createSignup: (...a: unknown[]) => createSignupMock(...a),
  countPendingPaidSignups: (...a: unknown[]) => countPendingPaidSignupsMock(...a),
}))
vi.mock("@/lib/stripe", () => ({
  createEventCheckoutSession: (...a: unknown[]) => createEventCheckoutSessionMock(...a),
}))
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      update: () => ({ eq: updateSignupSessionMock }),
    }),
  }),
}))

const publishedCamp = {
  id: "evt-1",
  slug: "summer-camp",
  type: "camp",
  status: "published",
  capacity: 10,
  signup_count: 3,
  title: "Summer Camp", summary: "", description: "", focus_areas: [],
  start_date: new Date(Date.now() + 86400000).toISOString(),
  end_date: new Date(Date.now() + 7 * 86400000).toISOString(),
  session_schedule: null,
  location_name: "L", location_address: null, location_map_url: null,
  age_min: null, age_max: null,
  price_cents: 29900,
  stripe_price_id: "price_test_1",
  stripe_product_id: "prod_test_1",
  hero_image_url: null, created_at: "", updated_at: "",
}

function makeReq(body: Record<string, unknown>) {
  return new Request("http://localhost/api/events/evt-1/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const ctx = { params: Promise.resolve({ id: "evt-1" }) }
const validBody = {
  parent_name: "Alex", parent_email: "a@x.com",
  athlete_name: "Sam", athlete_age: 14,
}

describe("POST /api/events/[id]/checkout", () => {
  beforeEach(() => {
    getEventByIdMock.mockReset()
    createSignupMock.mockReset()
    countPendingPaidSignupsMock.mockReset()
    createEventCheckoutSessionMock.mockReset()
    updateSignupSessionMock.mockClear()
  })

  it("silent-drops on honeypot", async () => {
    const { POST } = await import("@/app/api/events/[id]/checkout/route")
    const res = await POST(makeReq({ ...validBody, website: "spam" }), ctx)
    expect(res.status).toBe(200)
    expect(createSignupMock).not.toHaveBeenCalled()
  })

  it("400 on invalid body", async () => {
    const { POST } = await import("@/app/api/events/[id]/checkout/route")
    const res = await POST(makeReq({ parent_email: "bad" }), ctx)
    expect(res.status).toBe(400)
  })

  it("404 on draft event", async () => {
    getEventByIdMock.mockResolvedValueOnce({ ...publishedCamp, status: "draft" })
    const { POST } = await import("@/app/api/events/[id]/checkout/route")
    const res = await POST(makeReq(validBody), ctx)
    expect(res.status).toBe(404)
  })

  it("400 if event is not a camp", async () => {
    getEventByIdMock.mockResolvedValueOnce({ ...publishedCamp, type: "clinic" })
    const { POST } = await import("@/app/api/events/[id]/checkout/route")
    const res = await POST(makeReq(validBody), ctx)
    expect(res.status).toBe(400)
  })

  it("400 if camp has no stripe_price_id", async () => {
    getEventByIdMock.mockResolvedValueOnce({ ...publishedCamp, stripe_price_id: null })
    const { POST } = await import("@/app/api/events/[id]/checkout/route")
    const res = await POST(makeReq(validBody), ctx)
    expect(res.status).toBe(400)
  })

  it("409 at_capacity when confirmed + pending paid >= capacity", async () => {
    getEventByIdMock.mockResolvedValueOnce({ ...publishedCamp, signup_count: 9 })
    countPendingPaidSignupsMock.mockResolvedValueOnce(1)
    const { POST } = await import("@/app/api/events/[id]/checkout/route")
    const res = await POST(makeReq(validBody), ctx)
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.error).toBe("at_capacity")
  })

  it("happy path creates pending paid signup, stores session id, returns sessionUrl", async () => {
    getEventByIdMock.mockResolvedValueOnce(publishedCamp)
    countPendingPaidSignupsMock.mockResolvedValueOnce(0)
    createSignupMock.mockResolvedValueOnce({ id: "sig-1", event_id: "evt-1" })
    createEventCheckoutSessionMock.mockResolvedValueOnce({
      id: "cs_test_xyz",
      url: "https://checkout.stripe.com/cs_test_xyz",
    })
    const { POST } = await import("@/app/api/events/[id]/checkout/route")
    const res = await POST(makeReq(validBody), ctx)
    expect(res.status).toBe(200)
    expect(createSignupMock).toHaveBeenCalledWith("evt-1", expect.objectContaining({ parent_email: "a@x.com" }), "paid")
    const data = await res.json()
    expect(data.sessionUrl).toBe("https://checkout.stripe.com/cs_test_xyz")
    expect(data.signupId).toBe("sig-1")
  })

  it("502 when Stripe throws", async () => {
    getEventByIdMock.mockResolvedValueOnce(publishedCamp)
    countPendingPaidSignupsMock.mockResolvedValueOnce(0)
    createSignupMock.mockResolvedValueOnce({ id: "sig-1", event_id: "evt-1" })
    createEventCheckoutSessionMock.mockRejectedValueOnce(new Error("stripe down"))
    const { POST } = await import("@/app/api/events/[id]/checkout/route")
    const res = await POST(makeReq(validBody), ctx)
    expect(res.status).toBe(502)
  })
})
```

- [ ] **Step 2: Run — fail with module not found**

Run: `npm run test:run -- api/events/checkout`
Expected: FAIL.

- [ ] **Step 3: Implement the route**

Create `app/api/events/[id]/checkout/route.ts`:

```typescript
import { NextResponse } from "next/server"
import { createEventSignupSchema } from "@/lib/validators/event-signups"
import { getEventById } from "@/lib/db/events"
import { countPendingPaidSignups, createSignup } from "@/lib/db/event-signups"
import { createEventCheckoutSession } from "@/lib/stripe"
import { createServiceRoleClient } from "@/lib/supabase"

function getBaseUrl() {
  return process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params

    const body = (await request.json()) as Record<string, unknown>

    if (typeof body.website === "string" && body.website.length > 0) {
      return NextResponse.json({ ok: true })
    }
    delete body.website

    const parsed = createEventSignupSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid signup data", fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const event = await getEventById(id)
    if (!event || event.status !== "published") {
      return NextResponse.json({ error: "Event not available" }, { status: 404 })
    }
    if (event.type !== "camp") {
      return NextResponse.json({ error: "Only camps support paid checkout" }, { status: 400 })
    }
    if (!event.stripe_price_id) {
      return NextResponse.json(
        { error: "This camp is not yet available for booking" },
        { status: 400 },
      )
    }

    const pendingPaid = await countPendingPaidSignups(id)
    if (event.signup_count + pendingPaid >= event.capacity) {
      return NextResponse.json({ error: "at_capacity" }, { status: 409 })
    }

    const signup = await createSignup(id, parsed.data, "paid")

    let session
    try {
      session = await createEventCheckoutSession({
        event,
        signup,
        parentEmail: parsed.data.parent_email,
        baseUrl: getBaseUrl(),
      })
    } catch (err) {
      console.error("[api/events/checkout] Stripe error", err)
      return NextResponse.json(
        { error: "Payment provider unavailable, please try again" },
        { status: 502 },
      )
    }

    const supabase = createServiceRoleClient()
    await supabase
      .from("event_signups")
      .update({ stripe_session_id: session.id, updated_at: new Date().toISOString() })
      .eq("id", signup.id)

    return NextResponse.json({ sessionUrl: session.url, signupId: signup.id })
  } catch (err) {
    console.error("[api/events/checkout] unexpected error", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:run -- api/events/checkout`
Expected: 8/8 pass.

- [ ] **Step 5: tsc**

Run: `npx tsc --noEmit`
Expected: no errors. If `mock.calls[0][0]` typing complains, type the `vi.fn` mocks explicitly per the Phase 2b precedent.

- [ ] **Step 6: Commit**

```bash
git add "app/api/events/[id]/checkout/route.ts" "__tests__/api/events/checkout.test.ts"
git commit -m "feat(events): add public Stripe checkout route for paid camps"
```

---

## Task 7: Admin Stripe sync route — `POST /api/admin/events/[id]/stripe-sync`

**Why:** Backend for the manual "Resync with Stripe" button on the admin form. Idempotent: creates Product + Price when missing, refreshes the Price when product exists but price is stale.

**Files:**
- Create: `app/api/admin/events/[id]/stripe-sync/route.ts`
- Test: `__tests__/api/admin/events-stripe-sync.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/admin/events-stripe-sync.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getEventByIdMock = vi.fn()
const updateEventMock = vi.fn()
const syncEventToStripeMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: (...a: unknown[]) => authMock(...a) }))
vi.mock("@/lib/db/events", () => ({
  getEventById: (...a: unknown[]) => getEventByIdMock(...a),
  updateEvent: (...a: unknown[]) => updateEventMock(...a),
}))
vi.mock("@/lib/stripe", () => ({
  syncEventToStripe: (...a: unknown[]) => syncEventToStripeMock(...a),
}))

const camp = {
  id: "evt-1",
  type: "camp",
  price_cents: 29900,
  stripe_product_id: null,
  stripe_price_id: null,
}

function makeReq() {
  return new Request("http://localhost/api/admin/events/evt-1/stripe-sync", { method: "POST" })
}
const ctx = { params: Promise.resolve({ id: "evt-1" }) }

describe("POST /api/admin/events/[id]/stripe-sync", () => {
  beforeEach(() => {
    authMock.mockReset()
    getEventByIdMock.mockReset()
    updateEventMock.mockReset()
    syncEventToStripeMock.mockReset()
    authMock.mockResolvedValue({ user: { id: "u1", role: "admin" } })
  })

  it("403 when not admin", async () => {
    authMock.mockResolvedValueOnce(null)
    const { POST } = await import("@/app/api/admin/events/[id]/stripe-sync/route")
    const res = await POST(makeReq(), ctx)
    expect(res.status).toBe(403)
  })

  it("400 if event is a clinic", async () => {
    getEventByIdMock.mockResolvedValueOnce({ ...camp, type: "clinic" })
    const { POST } = await import("@/app/api/admin/events/[id]/stripe-sync/route")
    const res = await POST(makeReq(), ctx)
    expect(res.status).toBe(400)
  })

  it("400 if camp has no price_cents", async () => {
    getEventByIdMock.mockResolvedValueOnce({ ...camp, price_cents: null })
    const { POST } = await import("@/app/api/admin/events/[id]/stripe-sync/route")
    const res = await POST(makeReq(), ctx)
    expect(res.status).toBe(400)
  })

  it("happy path syncs and persists ids", async () => {
    getEventByIdMock.mockResolvedValueOnce(camp)
    syncEventToStripeMock.mockResolvedValueOnce({ productId: "prod_x", priceId: "price_x" })
    updateEventMock.mockResolvedValueOnce({ ...camp, stripe_product_id: "prod_x", stripe_price_id: "price_x" })
    const { POST } = await import("@/app/api/admin/events/[id]/stripe-sync/route")
    const res = await POST(makeReq(), ctx)
    expect(res.status).toBe(200)
    expect(updateEventMock).toHaveBeenCalledWith("evt-1", { stripe_product_id: "prod_x", stripe_price_id: "price_x" })
  })

  it("502 when Stripe sync throws", async () => {
    getEventByIdMock.mockResolvedValueOnce(camp)
    syncEventToStripeMock.mockRejectedValueOnce(new Error("stripe down"))
    const { POST } = await import("@/app/api/admin/events/[id]/stripe-sync/route")
    const res = await POST(makeReq(), ctx)
    expect(res.status).toBe(502)
  })
})
```

- [ ] **Step 2: Run — fail**

Run: `npm run test:run -- api/admin/events-stripe-sync`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `app/api/admin/events/[id]/stripe-sync/route.ts`:

```typescript
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getEventById, updateEvent } from "@/lib/db/events"
import { syncEventToStripe } from "@/lib/stripe"

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { id } = await ctx.params
    const event = await getEventById(id)
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 })
    if (event.type !== "camp") {
      return NextResponse.json({ error: "Only camps can be synced to Stripe" }, { status: 400 })
    }
    if (!event.price_cents || event.price_cents <= 0) {
      return NextResponse.json({ error: "Event has no price configured" }, { status: 400 })
    }

    let result
    try {
      result = await syncEventToStripe(event)
    } catch (err) {
      console.error("[admin stripe-sync] Stripe error", err)
      return NextResponse.json({ error: "Stripe sync failed — try again" }, { status: 502 })
    }

    const updated = await updateEvent(id, {
      stripe_product_id: result.productId,
      stripe_price_id: result.priceId,
    })
    return NextResponse.json({ event: updated })
  } catch (err) {
    console.error("[admin stripe-sync] unexpected error", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
```

**Note:** `updateEvent` from Phase 2a iterates input entries — passing `stripe_product_id` and `stripe_price_id` directly will pass them through to the DB update.

- [ ] **Step 4: Run tests**

Run: `npm run test:run -- api/admin/events-stripe-sync`
Expected: 5/5 pass.

- [ ] **Step 5: tsc**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add "app/api/admin/events/[id]/stripe-sync/route.ts" "__tests__/api/admin/events-stripe-sync.test.ts"
git commit -m "feat(events): add admin Stripe sync route for camp pricing"
```

---

## Task 8: Webhook extension — event_signup checkout completion + refund

**Why:** Stripe asynchronously confirms payments and refunds. The webhook handler routes events by `metadata.type`; we add the `"event_signup"` branch and a refund branch that checks for matching event signups.

**Files:**
- Modify: `app/api/stripe/webhook/route.ts`
- Test: `__tests__/api/stripe/webhook-events.test.ts`

- [ ] **Step 1: Write tests for the new branches**

Create `__tests__/api/stripe/webhook-events.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

const verifyMock = vi.fn()
const getSignupByIdMock = vi.fn()
const confirmSignupMock = vi.fn()
const cancelSignupMock = vi.fn()
const getEventByIdMock = vi.fn()
const getSignupByPiMock = vi.fn()
const sendConfirmedMock = vi.fn(async () => undefined)
const updateSignupMock = vi.fn(async () => undefined)

vi.mock("@/lib/stripe", () => ({
  verifyWebhookSignature: (...a: unknown[]) => verifyMock(...a),
}))
vi.mock("@/lib/db/event-signups", () => ({
  getSignupById: (...a: unknown[]) => getSignupByIdMock(...a),
  confirmSignup: (...a: unknown[]) => confirmSignupMock(...a),
  cancelSignup: (...a: unknown[]) => cancelSignupMock(...a),
  getEventSignupByPaymentIntent: (...a: unknown[]) => getSignupByPiMock(...a),
}))
vi.mock("@/lib/db/events", () => ({ getEventById: (...a: unknown[]) => getEventByIdMock(...a) }))
vi.mock("@/lib/email", () => ({
  sendEventSignupConfirmedEmail: (...a: unknown[]) => sendConfirmedMock(...a),
  // The webhook also imports other email functions for program flows — stub them
  sendCoachPurchaseNotification: vi.fn(async () => undefined),
}))
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      update: () => ({ eq: updateSignupMock }),
    }),
  }),
}))
// Stub other DB modules the webhook imports to prevent real DB calls
vi.mock("@/lib/db/payments", () => ({
  createPayment: vi.fn(), getPaymentByStripeId: vi.fn(), updatePayment: vi.fn(),
}))
vi.mock("@/lib/db/assignments", () => ({
  createAssignment: vi.fn(), getAssignmentByUserAndProgram: vi.fn(), updateAssignment: vi.fn(),
}))
vi.mock("@/lib/db/week-access", () => ({
  updateWeekAccess: vi.fn(), createWeekAccessBulk: vi.fn(),
}))
vi.mock("@/lib/db/subscriptions", () => ({
  createSubscription: vi.fn(), getSubscriptionByStripeId: vi.fn(), updateSubscriptionByStripeId: vi.fn(),
}))
vi.mock("@/lib/db/users", () => ({ getUserById: vi.fn() }))
vi.mock("@/lib/db/client-profiles", () => ({ getProfileByUserId: vi.fn() }))
vi.mock("@/lib/db/programs", () => ({ getProgramById: vi.fn() }))
vi.mock("@/lib/ghl", () => ({ ghlCreateContact: vi.fn(), ghlTriggerWorkflow: vi.fn() }))

function makeReq(body: string = "{}") {
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "test_sig" },
    body,
  })
}

describe("Stripe webhook — event_signup branches", () => {
  beforeEach(() => {
    verifyMock.mockReset()
    getSignupByIdMock.mockReset()
    confirmSignupMock.mockReset()
    cancelSignupMock.mockReset()
    getEventByIdMock.mockReset()
    getSignupByPiMock.mockReset()
    sendConfirmedMock.mockClear()
    updateSignupMock.mockClear()
  })

  it("checkout.session.completed with event_signup metadata confirms signup + sends email", async () => {
    verifyMock.mockReturnValueOnce({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { type: "event_signup", event_signup_id: "sig-1", event_id: "evt-1" },
          payment_intent: "pi_test_1",
          amount_total: 29900,
        },
      },
    })
    confirmSignupMock.mockResolvedValueOnce({ ok: true })
    getSignupByIdMock.mockResolvedValueOnce({ id: "sig-1", parent_email: "a@x.com", status: "confirmed" })
    getEventByIdMock.mockResolvedValueOnce({ id: "evt-1", title: "Camp", type: "camp", slug: "c", start_date: "" })

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(confirmSignupMock).toHaveBeenCalledWith("sig-1")
    expect(sendConfirmedMock).toHaveBeenCalled()
  })

  it("checkout.session.completed without event_signup metadata is unchanged", async () => {
    verifyMock.mockReturnValueOnce({
      type: "checkout.session.completed",
      data: { object: { mode: "payment", metadata: {}, payment_intent: "pi_x" } },
    })
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeReq())
    // The existing branch handles it; we just ensure no event_signup-side effects
    expect(confirmSignupMock).not.toHaveBeenCalled()
    expect(sendConfirmedMock).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
  })

  it("idempotent: confirmSignup returning not_pending does not throw", async () => {
    verifyMock.mockReturnValueOnce({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { type: "event_signup", event_signup_id: "sig-1", event_id: "evt-1" },
          payment_intent: "pi_x", amount_total: 29900,
        },
      },
    })
    confirmSignupMock.mockResolvedValueOnce({ ok: false, reason: "not_pending" })
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(sendConfirmedMock).not.toHaveBeenCalled()
  })

  it("charge.refunded matching an event signup flips status to refunded", async () => {
    verifyMock.mockReturnValueOnce({
      type: "charge.refunded",
      data: { object: { payment_intent: "pi_test_1" } },
    })
    getSignupByPiMock.mockResolvedValueOnce({ id: "sig-1", status: "confirmed" })
    cancelSignupMock.mockResolvedValueOnce({ ok: true })

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(cancelSignupMock).toHaveBeenCalledWith("sig-1")
    // The handler also runs UPDATE event_signups SET status='refunded' which goes through the
    // mocked supabase chain; we just assert it was invoked.
    expect(updateSignupMock).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — fails because new branches/imports don't exist**

Run: `npm run test:run -- stripe/webhook-events`
Expected: FAIL.

- [ ] **Step 3: Extend the webhook handler**

Open `app/api/stripe/webhook/route.ts`. Add these imports near the top with the existing imports:

```typescript
import {
  confirmSignup,
  cancelSignup,
  getSignupById,
  getEventSignupByPaymentIntent,
} from "@/lib/db/event-signups"
import { getEventById as getEventByIdForSignup } from "@/lib/db/events"
import { sendEventSignupConfirmedEmail } from "@/lib/email"
import { createServiceRoleClient as createSupabaseServiceClient } from "@/lib/supabase"
```

(Use the aliased imports if `getEventById` and `createServiceRoleClient` are already imported elsewhere in the file with different scopes — otherwise use the bare names.)

In the `switch (event.type)` block, modify the `case "checkout.session.completed":` to dispatch on the event_signup metadata BEFORE the existing branches:

```typescript
case "checkout.session.completed": {
  const session = event.data.object as Stripe.Checkout.Session

  if (session.metadata?.type === "event_signup") {
    await handleEventSignupCheckout(session)
    break
  }

  // existing branches (week_access / subscription / one-time) follow unchanged
  if (session.metadata?.type === "week_access") {
    await handleWeekAccessCheckout(session)
    break
  }

  if (session.mode === "subscription") {
    await handleSubscriptionCheckout(session)
  } else {
    await handleOneTimeCheckout(session)
  }
  break
}
```

In the `case "charge.refunded":` branch, add the event-signup check AFTER the existing payment-refund logic:

```typescript
case "charge.refunded": {
  const charge = event.data.object as Stripe.Charge
  const stripePaymentId = charge.payment_intent as string

  if (stripePaymentId) {
    const payment = await getPaymentByStripeId(stripePaymentId)
    if (payment) {
      await updatePayment(payment.id, { status: "refunded" })
    }

    // Check if this refund matches an event signup
    await handleEventSignupRefund(stripePaymentId)
  }

  break
}
```

At the end of the file (after the existing `handleOneTimeCheckout`, `handleSubscriptionCheckout`, etc. helpers), add the two new helper functions:

```typescript
async function handleEventSignupCheckout(session: Stripe.Checkout.Session) {
  const signupId = session.metadata?.event_signup_id
  if (!signupId) {
    console.error("[webhook event_signup] missing event_signup_id in metadata")
    return
  }

  const result = await confirmSignup(signupId)
  if (!result.ok) {
    if (result.reason !== "not_pending") {
      console.error(`[webhook event_signup] confirmSignup failed: ${result.reason} for signup ${signupId}`)
    }
    // Idempotent — second delivery sees not_pending and exits silently.
    return
  }

  const supabase = createSupabaseServiceClient()
  await supabase
    .from("event_signups")
    .update({
      stripe_payment_intent_id: session.payment_intent,
      amount_paid_cents: session.amount_total,
      updated_at: new Date().toISOString(),
    })
    .eq("id", signupId)

  const updated = await getSignupById(signupId)
  const eventId = session.metadata?.event_id
  if (updated && eventId) {
    const ev = await getEventByIdForSignup(eventId)
    if (ev) {
      try {
        await sendEventSignupConfirmedEmail(updated, ev)
      } catch (err) {
        console.error(`[webhook event_signup] email failed for signup ${signupId}`, err)
      }
    }
  }
}

async function handleEventSignupRefund(paymentIntentId: string) {
  const signup = await getEventSignupByPaymentIntent(paymentIntentId)
  if (!signup) return
  if (signup.status === "refunded") return

  if (signup.status === "confirmed") {
    const result = await cancelSignup(signup.id)
    if (!result.ok) {
      console.error(`[webhook event refund] cancelSignup failed: ${result.reason}`)
    }
  }

  const supabase = createSupabaseServiceClient()
  await supabase
    .from("event_signups")
    .update({ status: "refunded", updated_at: new Date().toISOString() })
    .eq("id", signup.id)
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:run -- stripe/webhook-events`
Expected: 4/4 pass.

- [ ] **Step 5: tsc**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/stripe/webhook/route.ts __tests__/api/stripe/webhook-events.test.ts
git commit -m "feat(stripe): webhook handlers for event_signup checkout + refund"
```

---

## Task 9: Auto-sync on publish + auto-resync on price change in admin PATCH

**Why:** Frictionless sync — admin doesn't need to click anything. Publishing a priced camp triggers Stripe sync; changing a synced price triggers Stripe Price rotation.

**Files:**
- Modify: `app/api/admin/events/[id]/route.ts`

- [ ] **Step 1: Read the current PATCH handler**

The Phase 2a handler currently extracts `status` from the body, validates the transition via `ALLOWED_STATUS_TRANSITIONS`, and calls `updateEvent` once with all fields including status. We're inserting Stripe sync logic into that flow.

- [ ] **Step 2: Add Stripe imports + auto-sync logic**

In `app/api/admin/events/[id]/route.ts`, add imports near the top:

```typescript
import { syncEventToStripe, archiveAndCreateNewPrice, stripe } from "@/lib/stripe"
```

Replace the inner try block of the PATCH function (the part that does the transition validation and `updateEvent` call) with this expanded version that handles auto-sync:

```typescript
    const { status, price_dollars, ...rest } = result.data as {
      status?: string
      price_dollars?: number | null
      [k: string]: unknown
    }

    try {
      const merged: Record<string, unknown> = { ...rest }

      // Load the current event up-front so we can detect price changes and validate transitions.
      const current = await getEventById(id)
      if (!current) {
        return NextResponse.json({ error: "Event not found" }, { status: 404 })
      }

      // Validate status transition (read-only, no DB write yet).
      if (status) {
        const allowed = ALLOWED_STATUS_TRANSITIONS[current.status]
        if (!allowed.includes(status as "draft" | "published" | "cancelled" | "completed")) {
          return NextResponse.json(
            { error: `Cannot transition event from ${current.status} to ${status}` },
            { status: 409 },
          )
        }
        merged.status = status
      }

      // Carry the price_dollars-to-price_cents conversion that updateEvent normally does.
      const priceChanged =
        price_dollars !== undefined &&
        Math.round((price_dollars ?? 0) * 100) !== (current.price_cents ?? 0)
      if (price_dollars !== undefined) {
        merged.price_cents = price_dollars == null ? null : Math.round(price_dollars * 100)
      }

      // Auto-resync on price change for already-synced camps.
      if (
        priceChanged &&
        current.type === "camp" &&
        current.stripe_product_id &&
        current.stripe_price_id &&
        merged.price_cents != null &&
        (merged.price_cents as number) > 0
      ) {
        try {
          const newPriceId = await archiveAndCreateNewPrice({
            productId: current.stripe_product_id,
            oldPriceId: current.stripe_price_id,
            priceCents: merged.price_cents as number,
            paymentType: "one_time",
            billingInterval: null,
          })
          merged.stripe_price_id = newPriceId
        } catch (err) {
          console.error("[admin events PATCH] auto-resync failed", err)
          return NextResponse.json(
            { error: "Stripe sync failed — try again or use the Resync button" },
            { status: 502 },
          )
        }
      }

      // Auto-sync on publish for camps with a price and no existing sync.
      const transitionToPublished = status === "published" && current.status !== "published"
      if (
        transitionToPublished &&
        current.type === "camp" &&
        current.price_cents &&
        !current.stripe_price_id
      ) {
        try {
          // Use the merged price_cents if it's being set in the same request, else current's value.
          const eventForSync = {
            ...current,
            ...(typeof merged.price_cents === "number" ? { price_cents: merged.price_cents } : {}),
          }
          const synced = await syncEventToStripe(eventForSync)
          merged.stripe_product_id = synced.productId
          merged.stripe_price_id = synced.priceId
        } catch (err) {
          console.error("[admin events PATCH] auto-sync on publish failed", err)
          return NextResponse.json(
            { error: "Stripe sync failed — try again or use the Resync button" },
            { status: 502 },
          )
        }
      }

      // Auto-archive Stripe product when cancelling a synced camp.
      if (status === "cancelled" && current.type === "camp" && current.stripe_product_id) {
        try {
          await stripe.products.update(current.stripe_product_id, { active: false })
        } catch (err) {
          // Non-fatal — log and continue cancellation.
          console.error("[admin events PATCH] Stripe product archive failed (non-fatal)", err)
        }
      }

      if (Object.keys(merged).length === 0) {
        return NextResponse.json({ event: current })
      }

      const updated = await updateEvent(id, merged)
      return NextResponse.json({ event: updated })
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
```

The key shape: read current event first → validate transition (read-only) → determine if price changed and trigger archive-and-create-new-price → determine if transitioning to published and trigger first-time sync → on cancel-of-synced-camp, archive Stripe product → finally a single `updateEvent` write.

**Note:** `updateEvent` needs to accept `stripe_product_id` and `stripe_price_id` directly. That works because the Phase 2a `updateEvent` iterates `Object.entries(input)` and writes anything not undefined — passing these two columns through is automatic. The `updateEventSchema` Zod validator does NOT include them, so when the client sends them they'd be stripped. The only callers passing them are server-side (this route + Task 7's stripe-sync route), so they bypass Zod validation.

Actually — re-checking: the client-side admin form CAN'T send these fields because they're not in the schema and Zod with `.partial()` strips unknowns. So passing them in `merged` here works because we built `merged` server-side. Good.

- [ ] **Step 3: tsc**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run existing PATCH tests to confirm no regressions**

Run: `npm run test:run -- api/admin/events`
Expected: previous Phase 2a tests still pass (the existing 2 tests cover create — they don't exercise PATCH, so this is a smoke check). The webhook tests added in Task 8 also pass.

- [ ] **Step 5: Commit**

```bash
git add "app/api/admin/events/[id]/route.ts"
git commit -m "feat(events): auto-sync to Stripe on publish + auto-resync on price change"
```

---

## Task 10: EventForm — re-enable "Resync with Stripe" button

**Why:** The button currently exists but is disabled. Wire it up to the new sync route.

**Files:**
- Modify: `components/admin/events/EventForm.tsx`

- [ ] **Step 1: Add toast import and update the camp branch**

Open `components/admin/events/EventForm.tsx`. Add at the top with other imports:

```typescript
import { toast } from "sonner"
```

Find the camp-only fields section that includes the disabled button:

```tsx
<div>
  <Button type="button" disabled title="Available in Phase 3">Sync to Stripe</Button>
</div>
```

Replace that single block with a small inline component-state-driven button. First add a piece of state near the other useStates in the EventForm function:

```typescript
const [syncing, setSyncing] = useState(false)
```

Then replace the camp-specific Stripe-sync block JSX with:

```tsx
<div className="flex flex-col gap-1">
  <Button
    type="button"
    variant="outline"
    disabled={syncing || !isEdit}
    onClick={async () => {
      if (!event) return
      setSyncing(true)
      const id = toast.loading("Syncing to Stripe...")
      try {
        const res = await fetch(`/api/admin/events/${event.id}/stripe-sync`, { method: "POST" })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error ?? "Sync failed")
        toast.success("Synced with Stripe", { id })
        router.refresh()
      } catch (err) {
        toast.error((err as Error).message, { id })
      } finally {
        setSyncing(false)
      }
    }}
    title={
      !isEdit
        ? "Save the event first, then sync"
        : "Create or refresh the Stripe Product + Price"
    }
  >
    {syncing ? "Syncing..." : "Resync with Stripe"}
  </Button>
  {event?.stripe_price_id && (
    <p className="text-xs text-muted-foreground">
      Synced · {event.stripe_price_id.slice(-8)}
    </p>
  )}
</div>
```

The button is disabled in the create flow (when `event` is undefined / `isEdit === false`) because there's no event id to sync against yet — admin must save first.

- [ ] **Step 2: tsc**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/admin/events/EventForm.tsx
git commit -m "feat(admin): re-enable Resync with Stripe button on EventForm"
```

---

## Task 11: SignupsTable — Paid badge + Stripe dashboard link

**Why:** Visual cue for which signups came through Stripe and a quick jump to the Stripe payment for refund / dispute lookup.

**Files:**
- Modify: `components/admin/events/SignupsTable.tsx`

- [ ] **Step 1: Update the Status cell to include the Paid badge and PI link**

Open `components/admin/events/SignupsTable.tsx`. Find the Status `<td>` (the one that renders the colored status badge). Replace its current contents with:

```tsx
<td className="px-4 py-3">
  <div className="flex flex-col gap-1">
    <span className={`inline-block w-fit rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[s.status] ?? ""}`}>
      {s.status}
    </span>
    {s.signup_type === "paid" && (
      <span className="inline-block w-fit rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
        Paid
      </span>
    )}
    {s.stripe_payment_intent_id && (
      <a
        href={`https://dashboard.stripe.com/payments/${s.stripe_payment_intent_id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-muted-foreground hover:text-primary"
        title="Open in Stripe dashboard"
      >
        {s.stripe_payment_intent_id.slice(-8)}
      </a>
    )}
  </div>
</td>
```

The Type column already shows `signup_type` capitalized (interest/paid). The new badge under Status reinforces the visual.

- [ ] **Step 2: tsc**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/admin/events/SignupsTable.tsx
git commit -m "feat(admin): add Paid badge + Stripe dashboard link to SignupsTable"
```

---

## Task 12: EventCardCta + EventSignupCard — enable Book Camp button when priced

**Why:** The disabled "Book — coming soon" buttons become functional CTAs that open the modal for paid camps with a configured Stripe price.

**Files:**
- Modify: `components/public/EventCardCta.tsx`
- Modify: `components/public/EventSignupCard.tsx`

- [ ] **Step 1: Helper for price formatting**

Both files already have a small `formatPrice(cents)` helper. Confirm the helper exists in both. If not, add it; if yes, no edit.

- [ ] **Step 2: Update EventCardCta camp branch**

Open `components/public/EventCardCta.tsx`. Find:

```typescript
if (isCamp && !isFull) {
  return (
    <Button disabled title="Paid camp booking opens in Phase 3" className="w-full">
      Book — coming soon
    </Button>
  )
}
```

Replace with:

```typescript
if (isCamp && !isFull) {
  if (!event.stripe_price_id) {
    return (
      <Button disabled title="Pricing not yet configured" className="w-full">
        Book — coming soon
      </Button>
    )
  }
  const priceLabel = event.price_cents != null ? formatPrice(event.price_cents) : null
  return (
    <>
      <Button className="w-full" onClick={() => setOpen(true)}>
        {priceLabel ? `Book camp — ${priceLabel}` : "Book camp"}
      </Button>
      <EventSignupModal event={event} open={open} onOpenChange={setOpen} isWaitlist={false} />
    </>
  )
}
```

The interface that `EventCardCta` accepts (`EventSignupModalEvent & { type: "clinic" | "camp" }`) needs `stripe_price_id` and `price_cents` exposed. The full `Event` type already has them; since `EventCardCta` receives `event: Event` from `EventCard`, the fields are present at runtime — but the typed prop interface needs them. Update the prop interface in `EventCardCta.tsx`:

```typescript
import type { EventSignupModalEvent } from "@/components/public/EventSignupModal"

interface EventCardCtaProps {
  event: EventSignupModalEvent & {
    type: "clinic" | "camp"
    stripe_price_id: string | null
    price_cents: number | null
  }
}
```

If the file already has a `formatPrice` import or local helper, reuse it. If not, add a small local helper:

```typescript
function formatPrice(cents: number) {
  const dollars = cents / 100
  return dollars % 1 === 0 ? `$${dollars}` : `$${dollars.toFixed(2)}`
}
```

- [ ] **Step 3: Update EventSignupCard camp branch**

Open `components/public/EventSignupCard.tsx`. Find the `cta()` function with the camp branch:

```typescript
function cta() {
  if (isCamp && !isFull) {
    return (
      <Button disabled title="Paid camp booking opens in Phase 3" className="w-full">
        Book — coming soon
      </Button>
    )
  }
  return (
    <Button className="w-full" onClick={() => setOpen(true)}>
      {isFull ? "Full — join waitlist" : "Register your interest"}
    </Button>
  )
}
```

Replace with:

```typescript
function cta() {
  if (isCamp && !isFull) {
    if (!event.stripe_price_id) {
      return (
        <Button disabled title="Pricing not yet configured" className="w-full">
          Book — coming soon
        </Button>
      )
    }
    const priceLabel = event.price_cents != null ? formatPrice(event.price_cents) : null
    return (
      <Button className="w-full" onClick={() => setOpen(true)}>
        {priceLabel ? `Book camp — ${priceLabel}` : "Book camp"}
      </Button>
    )
  }
  return (
    <Button className="w-full" onClick={() => setOpen(true)}>
      {isFull ? "Full — join waitlist" : "Register your interest"}
    </Button>
  )
}
```

The `formatPrice(cents)` helper that EventSignupCard already has handles `null` differently (returns null) — check the existing local helper signature and adapt. If existing helper signature is `formatPrice(cents: number | null): string | null`, the call above needs a guard, which the `event.price_cents != null` check provides.

- [ ] **Step 4: tsc**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/public/EventCardCta.tsx components/public/EventSignupCard.tsx
git commit -m "feat(public): enable Book Camp button when stripe_price_id is set"
```

---

## Task 13: EventSignupModal — paid-flow branch

**Why:** Same modal serves interest and paid flows. For paid camps, the submit button label becomes "Continue to payment", the POST target swaps to `/checkout`, and on success we redirect to Stripe instead of showing in-modal confirmation.

**Files:**
- Modify: `components/public/EventSignupModal.tsx`

- [ ] **Step 1: Update the modal interface**

Open `components/public/EventSignupModal.tsx`. The `EventSignupModalEvent` interface currently has 5 fields. Extend it to expose `stripe_price_id` and `price_cents`:

```typescript
export interface EventSignupModalEvent {
  id: string
  title: string
  type: "clinic" | "camp"
  capacity: number
  signup_count: number
  stripe_price_id?: string | null
  price_cents?: number | null
}
```

The `?` on the new fields keeps backward compatibility with callers that don't provide them (clinic flows).

- [ ] **Step 2: Compute isPaidFlow inside the component**

Inside `EventSignupModal`, near the top of the function body:

```typescript
const isPaidFlow =
  event.type === "camp" &&
  !!event.stripe_price_id &&
  !isWaitlist &&
  !forcedWaitlist
```

- [ ] **Step 3: Branch the submit URL and result handling**

Find the `submit` function. Replace the existing fetch block with:

```typescript
    const query = waitlist || isWaitlist || forcedWaitlist ? "?waitlist=true" : ""
    const url = isPaidFlow && !query
      ? `/api/events/${event.id}/checkout`
      : `/api/events/${event.id}/signup${query}`

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))

      if (res.status === 409 && data.error === "at_capacity") {
        setPhase("at_capacity")
        return
      }
      if (!res.ok) {
        if (data.fieldErrors) setFieldErrors(data.fieldErrors)
        setFormError(data.error ?? "Something went wrong")
        setPhase("form")
        return
      }

      // Paid flow: data.sessionUrl points at Stripe — redirect.
      if (data.sessionUrl) {
        window.location.href = data.sessionUrl
        return
      }

      setPhase("success")
    } catch (err) {
      setFormError((err as Error).message)
      setPhase("form")
    }
```

The `query &&` guard ensures the waitlist flow always uses `/api/events/[id]/signup?waitlist=true` regardless of `isPaidFlow` — waitlist is always interest-style, not Stripe.

- [ ] **Step 4: Update the submit button label**

Find the submit button in the form (currently shows "Submitting..." / "Join waitlist" / "Submit"). Update to:

```tsx
<Button type="submit" disabled={phase === "submitting"}>
  {phase === "submitting"
    ? "Submitting..."
    : isWaitlist || forcedWaitlist
      ? "Join waitlist"
      : isPaidFlow
        ? "Continue to payment"
        : "Submit"}
</Button>
```

Update the dialog description for paid-flow context too. Find:

```tsx
<DialogDescription>
  {isWaitlist || forcedWaitlist
    ? `${event.title} is currently full. Leave your details and we'll reach out if a spot opens.`
    : `${event.title} — tell us about the athlete and we'll follow up within 48 hours.`}
</DialogDescription>
```

Replace with:

```tsx
<DialogDescription>
  {isWaitlist || forcedWaitlist
    ? `${event.title} is currently full. Leave your details and we'll reach out if a spot opens.`
    : isPaidFlow
      ? `${event.title} — fill in your details to proceed to secure payment.`
      : `${event.title} — tell us about the athlete and we'll follow up within 48 hours.`}
</DialogDescription>
```

- [ ] **Step 5: tsc**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/public/EventSignupModal.tsx
git commit -m "feat(events): add paid-flow branch to EventSignupModal (Stripe redirect)"
```

---

## Task 14: Camp detail page — `?checkout=cancelled` banner

**Why:** Visitors who bail at Stripe land back on the camp detail page. Show a small inline banner so they know cancellation registered (and can try again).

**Files:**
- Modify: `app/(marketing)/camps/[slug]/page.tsx`

- [ ] **Step 1: Read async searchParams and render banner**

Open `app/(marketing)/camps/[slug]/page.tsx`. The page currently has signature:

```typescript
export default async function CampDetailPage(
  { params }: { params: Promise<{ slug: string }> },
) {
```

Update it to also accept searchParams:

```typescript
export default async function CampDetailPage(
  { params, searchParams }: {
    params: Promise<{ slug: string }>
    searchParams: Promise<{ checkout?: string }>
  },
) {
  const { slug } = await params
  const { checkout } = await searchParams
  // ... existing event lookup
```

After the `<EventDetailHero event={event} />` line and BEFORE the main grid div, insert:

```tsx
{checkout === "cancelled" && (
  <div className="border-b border-accent/30 bg-accent/10">
    <div className="mx-auto max-w-7xl px-4 py-3 text-sm text-foreground md:px-6">
      Checkout was cancelled — feel free to try again when you're ready.
    </div>
  </div>
)}
```

- [ ] **Step 2: tsc**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(marketing)/camps/[slug]/page.tsx"
git commit -m "feat(public): show cancelled-checkout banner on camp detail page"
```

---

## Task 15: Camp success page — `/camps/[slug]/success`

**Why:** Where Stripe redirects buyers after successful payment. Server-rendered, status-aware, no client polling.

**Files:**
- Create: `app/(marketing)/camps/[slug]/success/page.tsx`

- [ ] **Step 1: Implement the page**

Create `app/(marketing)/camps/[slug]/success/page.tsx`:

```tsx
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { CalendarDays, MapPin, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { getEventBySlug } from "@/lib/db/events"
import { getEventSignupByStripeSessionId } from "@/lib/db/event-signups"

export const metadata: Metadata = {
  title: "Booking confirmed",
  robots: { index: false, follow: false },
}

interface PageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ session_id?: string }>
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  })
}

export default async function CampBookingSuccessPage({ params, searchParams }: PageProps) {
  const { slug } = await params
  const { session_id } = await searchParams

  const event = await getEventBySlug(slug)
  if (!event || event.type !== "camp") notFound()

  const signup = session_id ? await getEventSignupByStripeSessionId(session_id) : null

  return (
    <div className="bg-surface min-h-[calc(100vh-80px)] py-12 md:py-20">
      <div className="mx-auto max-w-3xl px-4 md:px-6">
        <Card className="rounded-3xl border-border bg-background">
          <CardContent className="p-8 text-center md:p-12">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success">
              <CheckCircle2 className="h-7 w-7" />
            </div>

            <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
              You're in.
            </h1>

            {signup ? (
              <>
                <p className="mt-3 text-lg text-muted-foreground">
                  {signup.athlete_name} is booked for {event.title}.
                </p>

                <div className="mt-8 grid gap-3 text-left">
                  <div className="flex items-center gap-3 rounded-xl border border-border p-4">
                    <CalendarDays className="h-5 w-5 flex-shrink-0 text-primary" />
                    <span className="text-sm">{formatDate(event.start_date)}</span>
                  </div>
                  <div className="flex items-start gap-3 rounded-xl border border-border p-4">
                    <MapPin className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
                    <div className="text-sm">
                      <div>{event.location_name}</div>
                      {event.location_address && (
                        <div className="mt-0.5 text-muted-foreground">{event.location_address}</div>
                      )}
                    </div>
                  </div>
                </div>

                {signup.status === "confirmed" && (
                  <p className="mt-6 text-sm text-muted-foreground">
                    A confirmation email is on its way to {signup.parent_email}.
                  </p>
                )}
                {signup.status === "pending" && (
                  <div className="mt-6 rounded-xl border border-accent/30 bg-accent/10 p-4 text-sm text-foreground">
                    We're still processing your payment — this usually finishes within a few seconds.
                    You'll receive a confirmation email shortly. You can refresh this page to check the latest status.
                  </div>
                )}
                {(signup.status === "cancelled" || signup.status === "refunded") && (
                  <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-foreground">
                    This booking has been {signup.status} — please contact Darren if this is unexpected.
                  </div>
                )}
              </>
            ) : (
              <p className="mt-3 text-lg text-muted-foreground">
                Payment received. Check your email for a confirmation within a few minutes.
              </p>
            )}

            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Button asChild variant="outline">
                <Link href="/camps">Browse more camps</Link>
              </Button>
              <Button asChild>
                <Link href="/">Back to home</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: tsc**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(marketing)/camps/[slug]/success/page.tsx"
git commit -m "feat(public): add /camps/[slug]/success post-checkout confirmation page"
```

---

## Task 16: Playwright scaffold

**Why:** Smoke test scaffolding for the public booking flow. Real Stripe interaction is gated behind env vars; the scaffold asserts the "Book camp — $X" button renders for a known test camp.

**Files:**
- Create: `__tests__/e2e/camps-paid.spec.ts`

- [ ] **Step 1: Write the scaffold test**

Create `__tests__/e2e/camps-paid.spec.ts`:

```typescript
import { test, expect } from "@playwright/test"

// Needs a published camp seeded with stripe_price_id. Skip if PAID_CAMP_TEST_SLUG is missing.
const slug = process.env.PAID_CAMP_TEST_SLUG

test.describe("Paid camp booking", () => {
  test.skip(!slug, "PAID_CAMP_TEST_SLUG not set — scaffolding only")

  test("camp detail renders Book button with price label", async ({ page }) => {
    await page.goto(`/camps/${slug}`)

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()

    // The book button should include "$" in its label and not be disabled
    const bookBtn = page.getByRole("button", { name: /book camp — \$/i }).first()
    await expect(bookBtn).toBeVisible()
    await expect(bookBtn).toBeEnabled()
  })

  test("cancelled checkout banner renders when ?checkout=cancelled is set", async ({ page }) => {
    await page.goto(`/camps/${slug}?checkout=cancelled`)
    await expect(page.getByText(/checkout was cancelled/i)).toBeVisible()
  })
})
```

- [ ] **Step 2: tsc**

Run: `npx tsc --noEmit`
Expected: no errors. Do not run Playwright (port + Stripe issues).

- [ ] **Step 3: Commit**

```bash
git add "__tests__/e2e/camps-paid.spec.ts"
git commit -m "test(e2e): scaffold paid camp booking smoke test"
```

---

## Task 17: Final verification + phase tag

**Why:** Sanity check before opening the PR.

**Files:** none — verification only.

- [ ] **Step 1: Format sweep (narrow scope)**

Run: `npm run format:check`.

If files flagged, run `npm run format`, then stage ONLY the Phase 3 files (don't `git add -A`):

```bash
git add supabase/migrations/00063_events_stripe_product_id.sql \
  types/database.ts lib/db/events.ts lib/db/event-signups.ts lib/stripe.ts \
  "app/api/events/[id]/checkout/route.ts" "app/api/admin/events/[id]/stripe-sync/route.ts" \
  "app/api/admin/events/[id]/route.ts" app/api/stripe/webhook/route.ts \
  components/admin/events/EventForm.tsx components/admin/events/SignupsTable.tsx \
  components/public/EventCardCta.tsx components/public/EventSignupCard.tsx \
  components/public/EventSignupModal.tsx \
  "app/(marketing)/camps/[slug]/page.tsx" "app/(marketing)/camps/[slug]/success/page.tsx" \
  __tests__/db/event-signups.test.ts __tests__/api/events/checkout.test.ts \
  __tests__/api/admin/events-stripe-sync.test.ts __tests__/api/stripe/webhook-events.test.ts \
  __tests__/e2e/camps-paid.spec.ts
git commit -m "style: prettier format phase 3 files"
```

Skip if `format:check` was clean.

- [ ] **Step 2: Unit tests**

Run: `npm run test:run`

Expected new Phase 3 tests (all should pass):
- `__tests__/db/event-signups.test.ts` — 6 total (3 existing + 3 new)
- `__tests__/api/events/checkout.test.ts` — 8
- `__tests__/api/admin/events-stripe-sync.test.ts` — 5
- `__tests__/api/stripe/webhook-events.test.ts` — 4

Total new: 20 tests. Pre-existing failures from earlier phases (3 ai-schemas, 1 coach-ai-policy, 3 exercise-usage) remain — not regressions.

- [ ] **Step 3: Production build**

Run: `npm run build`

Expected: clean build. Look for these new routes:
- `/camps/[slug]/success` (dynamic)
- `/api/events/[id]/checkout` (dynamic)
- `/api/admin/events/[id]/stripe-sync` (dynamic)

- [ ] **Step 4: Manual smoke checklist (NOT a test command — for the human to run after merge)**

Document in your PR description:
1. In Stripe test mode dashboard, confirm the webhook endpoint `/api/stripe/webhook` is registered for events: `checkout.session.completed`, `charge.refunded`.
2. Create a draft camp in admin with a real price (e.g. $10), publish — verify auto-sync fires (check Stripe dashboard for new Product + Price under the event id metadata).
3. Visit `/camps/[your-slug]` — verify "Book camp — $10" button renders and is enabled.
4. Click → fill modal → click "Continue to payment" → land on Stripe Checkout (test mode card 4242 4242 4242 4242).
5. Pay → land on success page → see "You're in. {athlete} is booked for {camp}".
6. In admin signups table for that event, see the row with status `confirmed` and a "Paid" badge + Stripe payment intent link.
7. Issue a refund from Stripe dashboard → verify the row flips to `refunded`.

- [ ] **Step 5: Tag the phase**

```bash
git tag phase-3-clinics-camps-complete
```

- [ ] **Step 6: Git log**

```bash
git log --oneline main..HEAD
```

Report the commit list.

---

## Self-Review Checklist

**Spec coverage:**

| Phase 3 spec requirement | Task |
|---|---|
| `events.stripe_product_id` migration + index | Tasks 1, 2 |
| `Event.stripe_product_id` type | Task 3 |
| `countPendingPaidSignups` DAL | Task 4 |
| `getEventSignupByStripeSessionId` DAL | Task 4 |
| `getEventSignupByPaymentIntent` DAL | Task 4 |
| On-read sweep in `getSignupsForEvent` | Task 4 |
| `syncEventToStripe` helper | Task 5 |
| `createEventCheckoutSession` helper | Task 5 |
| `POST /api/events/[id]/checkout` | Task 6 |
| `POST /api/admin/events/[id]/stripe-sync` | Task 7 |
| Webhook `event_signup` checkout branch | Task 8 |
| Webhook `charge.refunded` event branch | Task 8 |
| Auto-sync on publish | Task 9 |
| Auto-resync on price change | Task 9 |
| Auto-archive Stripe product on cancel | Task 9 |
| EventForm Resync button enabled | Task 10 |
| SignupsTable Paid badge + dashboard link | Task 11 |
| EventCardCta + EventSignupCard book-camp button | Task 12 |
| EventSignupModal paid-flow branch (label, URL, redirect) | Task 13 |
| `?checkout=cancelled` banner on camp detail | Task 14 |
| `/camps/[slug]/success` page | Task 15 |
| Playwright scaffold | Task 16 |
| Final verification + tag | Task 17 |

All Phase 3 spec items covered.

**Placeholder scan:** no TBD/TODO/etc. in any task. Every code step has complete code.

**Type consistency:** `EventSignupModalEvent` interface in Task 13 adds `stripe_price_id?: string | null` and `price_cents?: number | null` — used by `EventCardCta` (Task 12) and `EventSignupCard` (Task 12). Both pass the full `Event` type which structurally includes these fields. `syncEventToStripe` returns `{ productId, priceId }` — consumed by Task 7 admin route and Task 9 PATCH route. `ConfirmResult` / `CancelResult` from Phase 2a still used in webhook (Task 8).

**Known limitations / accepted trade-offs:**
- Race condition: two visitors pass capacity guard for last spot, both pay. Loser refunded manually from Stripe dashboard — webhook flips status. Documented in spec section 5.
- Pending paid rows linger in admin table until next admin visit (on-read sweep). No scheduled cleanup in Phase 3.
- Cancel-of-synced-camp Stripe product archive is non-fatal (logged, doesn't block).
- Webhook branch tests depend on heavy mocking of unrelated DB modules — fragile if those modules add new exports. Acceptable for unit tests; e2e + manual smoke covers real wiring.
