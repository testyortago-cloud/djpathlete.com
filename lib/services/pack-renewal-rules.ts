import type { ClientPackage } from "@/types/database"

export type RenewalDecision =
  | { attempt: true }
  | { attempt: false; reason: "disabled" | "not_armed" | "unpaid" | "expired" | "not_depleted" | "zero_price" }

/**
 * Pure gate for "should this pack buy itself again". Ordered cheapest-first so
 * the reason returned is the most fundamental one. Expiry loses to nothing:
 * a pack that ran out of TIME rather than credits is a reason to stop, not to
 * charge someone for another one.
 */
export function shouldAttemptRenewal(pkg: ClientPackage, flagEnabled: boolean): RenewalDecision {
  if (!flagEnabled) return { attempt: false, reason: "disabled" }
  if (!pkg.auto_renew) return { attempt: false, reason: "not_armed" }
  // A pack that was never actually paid for (still "pending", or "refunded")
  // must never ground an auto-renewal charge. auto_renew is now stamped on
  // the pack at CHECKOUT-CREATION time (buildPackageInsert), before payment
  // completes — so a link that's minted with the box ticked but never paid
  // can still reach "depleted" if the coach lets the client check in anyway.
  // Without this gate that unpaid pack would auto-renew and bill a card for a
  // replacement of a pack that was never bought. "not_required" (comp packs)
  // is a legitimate non-charge, not an unpaid state, so it passes.
  if (pkg.payment_status !== "paid" && pkg.payment_status !== "not_required") {
    return { attempt: false, reason: "unpaid" }
  }
  if (pkg.status === "expired") return { attempt: false, reason: "expired" }

  // Inlined rather than imported from "@/lib/services/session-credits": a later
  // task makes session-credits.ts import the renewal service, which imports
  // this module. Importing remainingCredits back from session-credits would
  // close a cycle (session-credits -> pack-renewal -> pack-renewal-rules ->
  // session-credits) that Vitest/Next can break on unpredictably. Do not "fix"
  // this back into an import.
  const remaining = Math.max(0, pkg.credits_total - pkg.credits_used)
  if (remaining > 0) return { attempt: false, reason: "not_depleted" }

  if (pkg.price_cents <= 0) return { attempt: false, reason: "zero_price" }
  return { attempt: true }
}

/**
 * M3: carry the source pack's validity WINDOW forward, not its expiry date —
 * a 90-day pack should renew into another 90-day pack (starting from `now`),
 * not one that expires immediately (if computed from the OLD purchased_at)
 * or never (the previous bug: expires_at was hardcoded null).
 *
 * Derived from the source row's own purchased_at -> expires_at gap rather
 * than a session_pack_products.validity_days lookup: product_id can be null
 * (ad-hoc packs), and even when set, the product's validity_days can have
 * changed since purchase (price/terms edits) — the pack's OWN recorded
 * window is the more reliable record of what validity it actually got. It
 * also needs no IO, so buildRenewalPack stays a pure function.
 */
function renewedExpiry(source: ClientPackage, now: Date): string | null {
  if (!source.expires_at) return null
  const purchasedMs = Date.parse(source.purchased_at)
  const expiresMs = Date.parse(source.expires_at)
  if (!Number.isFinite(purchasedMs) || !Number.isFinite(expiresMs) || expiresMs <= purchasedMs) return null
  return new Date(now.getTime() + (expiresMs - purchasedMs)).toISOString()
}

/**
 * The renewal buys a clone of what ran out — same session type, credits and
 * price. Stripe ids are deliberately NOT copied: they identify the old payment,
 * and carrying them over would make getPackageByStripePaymentId return the wrong
 * pack.
 */
export function buildRenewalPack(
  source: ClientPackage,
  opts: { paid: boolean; now: Date },
): Omit<ClientPackage, "id" | "created_at" | "updated_at"> {
  return {
    client_user_id: source.client_user_id,
    product_id: source.product_id,
    assignment_id: null, // a renewal is not automatically tied to the old program
    session_type: source.session_type,
    credits_total: source.credits_total,
    credits_used: 0,
    price_cents: source.price_cents,
    payment_method: "stripe",
    payment_status: opts.paid ? "paid" : "pending",
    stripe_session_id: null,
    stripe_payment_id: null,
    purchased_at: opts.now.toISOString(),
    expires_at: renewedExpiry(source, opts.now),
    status: "active",
    last_reminded_threshold: null,
    notes: null,
    bill_to_email: source.bill_to_email,
    bill_to_emailed_at: null,
    created_by: null,
    auto_renew: source.auto_renew,
    renewed_from_package_id: source.id,
    renewal_attempted_at: null,
  }
}
