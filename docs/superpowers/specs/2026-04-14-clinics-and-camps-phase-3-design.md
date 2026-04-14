# Clinics & Camps Phase 3 — Stripe Guest Checkout Design Spec

**Date:** 2026-04-14
**Status:** Approved design, pending implementation plan
**Parent specs:** [master](2026-04-14-clinics-and-camps-design.md), [Phase 2a](2026-04-14-clinics-and-camps-phase-2a-design.md), [Phase 2b](2026-04-14-clinics-and-camps-phase-2b-design.md)
**Previous phase:** Phase 2b merged at commit `c695769`, tagged `phase-2b-clinics-camps-complete`.

## Summary

Phase 3 turns the disabled "Book camp" button into a working guest-friendly Stripe Checkout flow. Admin publishes a priced camp; the backend auto-syncs a Stripe Product + Price. Parents hit the camp detail page, click "Book camp — $X", fill the modal form, and get redirected to Stripe Checkout. On payment, a webhook confirms the signup and fires the existing Phase 2b confirmation email. Refunds issued from the Stripe dashboard flip the signup to `refunded` and decrement capacity.

Clinics remain on interest-capture forever.

## Goals

- Enable paid camp bookings without requiring visitors to create an account.
- Keep sync friction minimal for Darren — auto-sync on publish, auto-resync on price change, manual "Resync with Stripe" button only for recovery.
- Make the post-checkout experience event-specific (not a generic "thank you") so buyers get confidence their booking is tied to the right camp.
- Preserve Phase 2a capacity primitives — the same `confirm_event_signup` RPC handles both admin-confirmed and webhook-confirmed signups.
- Reuse the Phase 2b `EventSignupModal` and email templates — no parallel paid-only components.

## Non-Goals (deferred / out-of-scope)

- In-app refund flow (manual via Stripe dashboard).
- Multi-athlete / sibling discount pricing.
- Stripe Tax integration beyond whatever the Stripe account already enables at the product level.
- Apple Pay / Google Pay special setup (Stripe Checkout handles wallets automatically if enabled on the account).
- Scheduled Firebase cleanup job. On-read sweep inside `getSignupsForEvent` is sufficient for Phase 3.
- Alternate payment methods (Klarna, Afterpay) — can be enabled later via Stripe product config without code changes.
- A dedicated waitlist payment flow. Waitlists remain interest-only; when Darren has a spot to offer he contacts the family and takes payment manually.

## Key Decisions (locked during brainstorming)

1. **Hybrid Stripe sync** — auto-sync on publish, auto-resync on price change, manual "Resync with Stripe" button for recovery.
2. **Full-redirect Stripe Checkout** (not Stripe Elements, not a separate payment page). Matches existing program-purchase pattern in `app/api/stripe/checkout/route.ts`.
3. **Event-specific success page with status-aware banner.** Stateless server-render keyed on `session_id`; shows a gentle "processing" notice when the webhook hasn't fired yet.
4. **Capacity guard uses a time-windowed query** — `confirmed_count + pending_paid_within_last_hour >= capacity`. Nightly sweep deferred.
5. **Refunds flip signup to `refunded` and decrement capacity** via a call to `cancel_event_signup` RPC then a status-column update.

## Data Model

One additive change:

### Migration `00063_events_stripe_product_id.sql`

```sql
alter table events add column if not exists stripe_product_id text;
create index if not exists idx_events_stripe_product_id on events (stripe_product_id);
```

**Why:** Phase 2a already has `events.stripe_price_id`. Stripe Price objects are rotated when the price changes (Stripe rule — Prices are immutable), while the Product is stable. Tracking `stripe_product_id` separately lets us:
- Reuse the same Product when archive-and-create-new-price happens (`archiveAndCreateNewPrice` already takes `productId` as input).
- Mark the Product as inactive on event cancellation.
- Recover a lost `stripe_price_id` (e.g., after a manual Stripe dashboard edit) by looking up the product and retrieving its active prices.

### Type update

In `types/database.ts`:

```typescript
export interface Event {
  // ... existing fields
  stripe_product_id: string | null
  // ... existing fields
}
```

No changes to `event_signups` — Phase 2a fields (`stripe_session_id`, `stripe_payment_intent_id`, `amount_paid_cents`) cover all Phase 3 needs.

## Stripe Product Sync

### Auto-sync on publish

Inside `PATCH /api/admin/events/[id]/route.ts`, when the incoming `status` transitions the event to `'published'`:

- Clinic → no Stripe action.
- Camp without `price_cents` → no Stripe action. "Book" button stays disabled because `stripe_price_id` is null.
- Camp with `price_cents` AND no `stripe_price_id` → `syncEventToStripe(event)` before applying status.
- Camp with both → no-op.

If `syncEventToStripe` throws, the PATCH responds with 502 `{ error: "Stripe sync failed — try again or use the Resync button" }` and the status change is NOT applied. Admin retries or clicks the manual button.

### Auto-resync on price change

When PATCH body contains `price_dollars` differing from the stored `price_cents` AND the event has an existing `stripe_price_id`:

- Call `archiveAndCreateNewPrice({ productId: event.stripe_product_id, newPriceCents })` (existing helper in `lib/stripe.ts`).
- Update `events.stripe_price_id` to the new Price id atomically with the other update fields.

If the event has no `stripe_price_id` yet, price updates land without calling Stripe — the sync will happen at publish time.

### Manual "Resync with Stripe" button

The button already exists in Phase 2a's `EventForm.tsx`, disabled with a "Coming soon" tooltip. Re-enable it. New route:

`POST /api/admin/events/[id]/stripe-sync`

- Auth guard (admin only).
- Load event. 400 if clinic or no `price_cents`.
- Call `syncEventToStripe(event)` which internally:
  - If `stripe_product_id` is set, `stripe.products.retrieve(id)` → if exists and active, use it; create a new Price only; if archived or missing, create a new Product + Price.
  - If `stripe_product_id` is null, create a Product + Price pair.
- Update event row with the fresh ids.
- Return `{ event }` — the updated row.

Idempotent. One-click repair for any broken-sync state.

### Event cancellation

When PATCH sets `status = 'cancelled'` on a camp with a `stripe_product_id`:

- Call `stripe.products.update(stripe_product_id, { active: false })`.
- Non-fatal — log on failure, continue the cancellation.

### `lib/stripe.ts` additions

```typescript
export async function syncEventToStripe(event: Event): Promise<{ productId: string; priceId: string }>
export async function createEventCheckoutSession(opts: {
  event: Event
  signup: EventSignup
  parentEmail: string
  baseUrl: string
}): Promise<Stripe.Checkout.Session>
```

Both reuse existing helpers where possible (`createStripeProductAndPrice`, `archiveAndCreateNewPrice`).

## Paid Checkout Flow

### `POST /api/events/[id]/checkout` (public, guest-capable)

**Request body:** `createEventSignupSchema` shape + optional `website` honeypot.

**Flow:**

1. `await ctx.params`.
2. Parse body. Honeypot check → silent `200 { ok: true }` if `body.website` is non-empty.
3. Zod validate. 400 on fail.
4. `getEventById(id)`. 404 if null or `status !== 'published'`, 400 if `type !== 'camp'`, 400 if `!stripe_price_id` (with message "This camp is not yet available for booking").
5. Capacity guard:
   - `confirmedCount = event.signup_count`
   - `pendingPaidCount = countPendingPaidSignups(id)` (new DAL helper — counts `signup_type='paid' AND status='pending' AND created_at > NOW() - INTERVAL '1 hour'`)
   - Reject with 409 `{ error: "at_capacity" }` if `confirmedCount + pendingPaidCount >= capacity`.
6. `createSignup(id, validated, 'paid')` → returns pending row.
7. `createEventCheckoutSession({ event, signup, parentEmail: validated.parent_email, baseUrl })` → creates Stripe Session with:
   - `mode: 'payment'`
   - `line_items: [{ price: event.stripe_price_id, quantity: 1 }]`
   - `customer_email: validated.parent_email`
   - `metadata: { type: 'event_signup', event_signup_id: signup.id, event_id: event.id }`
   - `success_url: ${baseUrl}/camps/${event.slug}/success?session_id={CHECKOUT_SESSION_ID}`
   - `cancel_url: ${baseUrl}/camps/${event.slug}?checkout=cancelled`
8. Update the signup row with `stripe_session_id = session.id`.
9. Return `{ sessionUrl: session.url, signupId: signup.id }`.

**Error handling:** Stripe throws → 502 with generic error. The pending row stays; it'll age out of the capacity guard within an hour or be swept by the admin-visit sweep.

### Webhook extension — `app/api/stripe/webhook/route.ts`

Existing file uses `switch (event.type)` + `metadata.type` discriminators (already handles `"week_access"`). Add branches:

**`checkout.session.completed` → new branch when `session.metadata?.type === 'event_signup'`:**

`handleEventSignupCheckout(session)`:
1. `signupId = session.metadata.event_signup_id`. Missing → log + skip.
2. `const result = await confirmSignup(signupId)`.
3. If `!result.ok`:
   - `reason === 'not_pending'` → idempotent retry, log + skip.
   - Any other reason → log as an unexpected failure.
4. Update signup row:
   ```sql
   UPDATE event_signups
     SET stripe_payment_intent_id = <session.payment_intent>,
         amount_paid_cents = <session.amount_total>,
         updated_at = now()
     WHERE id = <signupId>
   ```
5. `sendEventSignupConfirmedEmail(updatedSignup, event)` non-fatally (try/catch).

**`charge.refunded` → new branch checking for event signups:**

`handleEventSignupRefund(charge)`:
1. `paymentIntentId = charge.payment_intent`. Missing → skip.
2. `const signup = await getEventSignupByPaymentIntent(paymentIntentId)` (new DAL).
3. Not found → skip (this refund belongs to another flow).
4. Already `refunded` → skip (idempotent).
5. If `status === 'confirmed'` → call `cancelSignup(signup.id)` to decrement `signup_count` via RPC (flips to `cancelled`). Then a direct `UPDATE event_signups SET status = 'refunded', updated_at = now() WHERE id = <signup.id>` to reach the correct terminal status.
6. If `status === 'pending'` (refunded before webhook confirm — very rare) → direct `UPDATE event_signups SET status = 'refunded'` without the RPC call.

**Webhook idempotency:** Stripe may retry. Both handlers no-op on second invocation (RPC returns `not_pending`, refund handler's status check catches replays).

## Success page — `/camps/[slug]/success`

**File:** `app/(marketing)/camps/[slug]/success/page.tsx` — server component.

**Route:** same dynamic `[slug]` segment as the existing camp detail page. Reads `session_id` from `searchParams` (async Promise in Next 16).

**Flow:**

1. `const { slug } = await params`.
2. `const { session_id } = await searchParams`.
3. `const event = await getEventBySlug(slug)`. `notFound()` if null or `type !== 'camp'`.
4. If no `session_id` → render generic "Payment received, check your email" fallback (no DB lookup).
5. `const signup = await getEventSignupByStripeSessionId(session_id)` (new DAL). Null → same fallback.
6. Render status-aware confirmation:
   - Hero: Green Azure background, check-mark, "You're in." headline, "`${athlete_name}` is booked for `${event.title}`".
   - Event context block (date, location — same formatting as `EventDetailHero`).
   - Banner based on `signup.status`:
     - `confirmed` → "A confirmation email is on its way to `${parent_email}`."
     - `pending` → "We're still processing your payment — this usually finishes within a few seconds. You'll receive a confirmation email shortly."
     - `cancelled` / `refunded` → muted "This booking has been cancelled/refunded — contact Darren if this is unexpected."
   - Links: "Browse more camps" → `/camps`, "Back to home" → `/`.
7. No JavaScript polling. Reload refetches.

### Cancel URL behavior

`cancel_url = /camps/${slug}?checkout=cancelled`. `CampDetailPage` checks for this query param and renders a small inline info banner above the hero: "Checkout was cancelled — feel free to try again when ready." Plain server-side render, no client-side toast (toasts on page load are noisy for a returning visitor). One small branch in the existing detail page.

## Admin UX updates

### `EventForm.tsx`

Re-enable the "Resync with Stripe" button currently disabled in Phase 2a:

- Label: `"Resync with Stripe"` (more accurate than "Sync").
- `onClick` → POST to `/api/admin/events/[id]/stripe-sync`, sonner loading toast, success/error toast on completion, `router.refresh()` on success.
- Always enabled for camps with a `price_cents`; hidden or disabled for clinics / camps without pricing.
- Small text below the button when `stripe_price_id` is set: "Synced · `stripe_price_id.slice(-8)`" as a visual confirmation of the current sync state.

### `SignupsTable.tsx`

For paid signups, add a small visual indicator:
- A "Paid" badge (small, accent-colored) next to the status badge.
- When `stripe_payment_intent_id` is set, link to Stripe dashboard:
  ```tsx
  <a
    href={`https://dashboard.stripe.com/payments/${s.stripe_payment_intent_id}`}
    target="_blank"
    rel="noopener noreferrer"
    className="text-xs text-muted-foreground hover:text-primary"
  >
    {s.stripe_payment_intent_id.slice(-8)}
  </a>
  ```
- Only rendered when `signup_type === 'paid'`.

### No new admin routes beyond `/api/admin/events/[id]/stripe-sync`.

## Client-side button flips

### `EventCardCta.tsx` and `EventSignupCard.tsx`

The disabled "Book — coming soon" state for camps becomes conditional on `stripe_price_id`:

```typescript
if (isCamp && !isFull) {
  if (!event.stripe_price_id) {
    return <Button disabled title="Pricing not yet configured">Book — coming soon</Button>
  }
  return (
    <Button className="w-full" onClick={() => setOpen(true)}>
      Book camp — {formatPrice(event.price_cents)}
    </Button>
  )
}
```

Waitlist (`isFull`) and clinic branches unchanged.

### `EventSignupModal.tsx`

Current modal POSTs to `/api/events/[id]/signup` and shows in-modal success. Add a paid-flow branch:

```typescript
const isPaidFlow =
  event.type === "camp" && !!event.price_cents && !isWaitlist && !forcedWaitlist
```

When `isPaidFlow`:
- Submit button label: `"Continue to payment"` (instead of "Submit").
- POST target: `/api/events/[id]/checkout` (instead of `/api/events/[id]/signup`).
- On `{ sessionUrl }` success → `window.location.href = sessionUrl` (full-page redirect). No in-modal success state.
- On 409 at_capacity → same `at_capacity` phase, same "Continue to waitlist" recovery path (which switches to interest flow and submits to `/api/events/[id]/signup` — interest is not Stripe-gated).
- On other errors → same `fieldErrors` display as interest flow.

One flag, two URL branches, one button-label branch. No new component.

## Capacity guard details

### `lib/db/event-signups.ts` additions

```typescript
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

export async function getEventSignupByStripeSessionId(sessionId: string): Promise<EventSignup | null>
export async function getEventSignupByPaymentIntent(piId: string): Promise<EventSignup | null>
```

### On-read sweep inside `getSignupsForEvent`

Before the `SELECT ... ORDER BY`, run:

```typescript
const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
await supabase
  .from("event_signups")
  .update({ status: "cancelled", updated_at: new Date().toISOString() })
  .eq("event_id", eventId)
  .eq("signup_type", "paid")
  .eq("status", "pending")
  .lt("created_at", oneHourAgo)
```

Narrow, indexed, negligible overhead (runs only on admin edit-page load).

### Race condition window

Two visitors pass the capacity guard for the last spot. Both create Stripe Sessions. Visitor A completes first — webhook increments `signup_count` to `capacity`. Visitor B completes — webhook calls `confirmSignup`, RPC returns `{ok: false, reason: 'at_capacity'}`. Their payment went through but they're not confirmed.

**Resolution:** log the unexpected-at-capacity outcome (signup id + Stripe session id + payment intent), and Darren refunds manually from the Stripe dashboard (which fires `charge.refunded` → our handler flips status to `refunded`). Rare enough in practice that automatic refunds aren't worth building in Phase 3.

## Testing

### Unit / integration

- **`lib/db/event-signups.ts`** (extend existing test file):
  - `countPendingPaidSignups` — seed three rows (one paid-pending within window, one paid-pending older than an hour, one interest-pending within window); assert count is 1.
  - `getEventSignupByStripeSessionId` — create + lookup.
  - `getEventSignupByPaymentIntent` — create + lookup.

- **`POST /api/events/[id]/checkout`** (new test file):
  - Honeypot silent drop.
  - 400 invalid body.
  - 404 unpublished / wrong type / missing `stripe_price_id`.
  - 409 at_capacity (mock `countPendingPaidSignups`).
  - Happy path creates pending signup with `signup_type='paid'`, calls Stripe mock, updates row with `stripe_session_id`, returns `sessionUrl`.

- **Webhook** (new test file):
  - `checkout.session.completed` with `metadata.type = "event_signup"` → calls `confirmSignup`, updates signup, sends email.
  - `checkout.session.completed` without event metadata → existing branches unchanged (regression check).
  - `charge.refunded` matching an event signup → cancelSignup called if confirmed, status flips to refunded.
  - Idempotent confirm (twice invocation returns not_pending on second, handler no-ops).

- **`POST /api/admin/events/[id]/stripe-sync`** (new test file):
  - 403 non-admin.
  - 400 clinic or no price.
  - Happy path with no existing `stripe_product_id` → creates Product + Price.
  - Repair path with archived product → creates fresh Product + Price.

All Stripe calls mocked. No live Stripe calls in unit tests.

### E2E

Playwright smoke scaffold for `/camps/[slug]` asserting "Book camp — $X" button renders when `stripe_price_id` is set. Real Stripe flow requires test-mode cards — documented in the plan as a manual smoke checklist, not an automated test.

## File Inventory

**New files:**
- `supabase/migrations/00063_events_stripe_product_id.sql`
- `app/api/events/[id]/checkout/route.ts`
- `app/api/admin/events/[id]/stripe-sync/route.ts`
- `app/(marketing)/camps/[slug]/success/page.tsx`
- `__tests__/api/events/checkout.test.ts`
- `__tests__/api/admin/events-stripe-sync.test.ts`
- `__tests__/api/stripe/webhook-events.test.ts`

**Modified files:**
- `types/database.ts` — `Event.stripe_product_id`
- `lib/db/events.ts` — `createEvent` / `updateEvent` thread new column
- `lib/db/event-signups.ts` — 3 new exports + on-read sweep
- `lib/stripe.ts` — `syncEventToStripe` + `createEventCheckoutSession`
- `app/api/admin/events/[id]/route.ts` — auto-sync on publish + auto-resync on price
- `app/api/stripe/webhook/route.ts` — 2 new branches (event_signup checkout + charge.refunded)
- `components/admin/events/EventForm.tsx` — enable Resync button
- `components/admin/events/SignupsTable.tsx` — Paid badge + dashboard link
- `components/public/EventCardCta.tsx` — enable book path when priced
- `components/public/EventSignupCard.tsx` — same
- `components/public/EventSignupModal.tsx` — paid-flow branch
- `app/(marketing)/camps/[slug]/page.tsx` — `?checkout=cancelled` banner

**Migration required:** `00063_events_stripe_product_id.sql` — one ALTER TABLE + one index. Safe to re-run.

## Environment / Infra

- `STRIPE_SECRET_KEY` already set (program checkout uses it).
- `STRIPE_WEBHOOK_SECRET` already set.
- Webhook endpoint already registered in Stripe dashboard pointing at `/api/stripe/webhook`.
- No new Stripe products created manually — all flow through `syncEventToStripe`.
- No new env vars.

## What ships after Phase 3

- Darren sets a price on a camp, clicks Publish, the event auto-syncs to Stripe (Product + Price), and the public "Book camp — $X" button is live.
- Parents book guest-style: modal form → Stripe Checkout → success page → confirmation email. No account required.
- Darren sees confirmed paid signups in the admin table with a "Paid" badge and a link to the Stripe dashboard payment. No manual confirm step for paid signups.
- Refunds issued from the Stripe dashboard propagate back to the admin table as `refunded` with capacity restored.
- Clinics unchanged — interest-only.
- Capacity is held per-visitor for up to an hour during active checkout; stale pending paid rows age out without a scheduled job.
