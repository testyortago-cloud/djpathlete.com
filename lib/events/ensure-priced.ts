// lib/events/ensure-priced.ts — give a camp its Stripe price rather than refusing it.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS: THE GATE COULD FIX WHAT IT WAS REFUSING.
// ---------------------------------------------------------------------------
// `publishGate` blocks a funnel whose checkout form names a camp with no
// `stripe_price_id`, which is correct — nobody could pay for it. But the owner is
// then told to go and do something the server can do for them, because the camp
// already carries the ONE fact that cannot be invented: `price_cents`.
//
// The gap has a specific cause. `POST /api/admin/events` syncs a new event on
// creation and `PATCH` syncs on publish, so an event made through the form is
// fine. **A DUPLICATED event is not.** `/api/admin/events/[id]/duplicate` copies
// `price_dollars` and deliberately does NOT copy `stripe_product_id` /
// `stripe_price_id` — two events must never share one Stripe price — and it lands
// as a draft, so no sync runs. Publish it later through any path that does not go
// through that PATCH and it is published, priced in dollars, and unsellable.
// The camp in the owner's own funnel was titled "... (copy)".
//
// WHAT THIS WILL NOT DO IS INVENT A PRICE. An event with no `price_cents` is a
// question for the owner, not a default for the server to pick, and it stays a
// publish blocker.

import { getEventById, updateEvent } from "@/lib/db/events"
import { syncEventToStripe } from "@/lib/stripe"

export type EnsurePricedOutcome =
  | { ok: true; changed: boolean }
  /** `no_price` and `not_found` are the owner's to fix; `sync_failed` is Stripe's. */
  | { ok: false; reason: "not_found" | "no_price" | "sync_failed" }

/**
 * Makes sure an event can be paid for, creating its Stripe product and price if
 * that is all it is missing.
 *
 * IDEMPOTENT, because `syncEventToStripe` is: an event that already has a live
 * product and price returns them without calling Stripe, so running this on every
 * publish costs nothing on the common path.
 *
 * NEVER THROWS. It runs inside a publish that is about to report on several pages
 * at once, and one unreachable Stripe must not take that whole report down.
 */
export async function ensureEventPriced(eventId: string): Promise<EnsurePricedOutcome> {
  const event = await getEventById(eventId).catch(() => null)
  if (!event) return { ok: false, reason: "not_found" }

  if (event.stripe_price_id) return { ok: true, changed: false }

  // The one thing the server may not decide. `syncEventToStripe` throws on a
  // missing price, and turning that throw into this reason keeps "you have not
  // said what to charge" distinct from "Stripe is down".
  if ((event.price_cents ?? 0) <= 0) return { ok: false, reason: "no_price" }

  try {
    const synced = await syncEventToStripe(event)
    // Persisted here, not left to the caller: `syncEventToStripe`'s own doc says
    // the caller owns the write, and a sync whose ids are never stored would
    // create a NEW Stripe product on every publish.
    // Typed `Record<string, unknown>` for the same reason
    // `app/api/admin/events/route.ts` does it: `updateEvent`'s parameter type
    // describes the fields an ADMIN edits and does not include the two Stripe
    // columns, which only a sync ever writes. Widening the DAL's own type instead
    // would let any caller set them by hand.
    const stripeFields: Record<string, unknown> = {
      stripe_product_id: synced.productId,
      stripe_price_id: synced.priceId,
    }
    await updateEvent(event.id, stripeFields)
    return { ok: true, changed: true }
  } catch (error) {
    console.error("[events/ensure-priced] Stripe sync failed for event", eventId, error)
    return { ok: false, reason: "sync_failed" }
  }
}
