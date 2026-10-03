import type { ClientPackage } from "@/types/database"
import { randomUUID } from "node:crypto"
import { stripe, createPackCheckoutSession } from "@/lib/stripe"
import {
  acquirePackPaymentLinkEdit,
  releasePackPaymentLinkEdit,
  updateLeasedPackPaymentLink,
} from "@/lib/db/client-packages"

export type PackLinkResult =
  | { ok: true; url: string; refreshed: boolean }
  | { ok: false; status: number; error: string; retainLock?: true }

export type PackPriceResult =
  | { ok: true; url: string | null; previousPriceCents: number }
  | { ok: false; status: number; error: string; priceSaved?: true; retainLock?: true; previousPriceCents?: number }

type UpdateLeasedPack = (patch: Partial<ClientPackage>) => Promise<ClientPackage>

async function withPaymentLinkEdit<T extends PackLinkResult | PackPriceResult>(
  pack: ClientPackage,
  operation: (fresh: ClientPackage, update: UpdateLeasedPack) => Promise<T>,
): Promise<T | { ok: false; status: number; error: string }> {
  const token = randomUUID()
  const fresh = await acquirePackPaymentLinkEdit(pack, token)
  if (!fresh)
    return {
      ok: false,
      status: 409,
      error: "This pack changed or its payment link is being updated. Refresh and try again",
    }
  let retainLock = false
  try {
    const result = await operation(fresh, (patch) => updateLeasedPackPaymentLink(pack.id, token, patch))
    retainLock = !result.ok && result.retainLock === true
    return result
  } catch (error) {
    // A failed DB response can leave an expired session attached. Keep the
    // expiry guard until a later worker reclaims the lease and reconciles it.
    retainLock = true
    throw error
  } finally {
    if (!retainLock) await releasePackPaymentLinkEdit(pack.id, token)
  }
}

/** Keep the old association until Stripe confirms expiry. This lets payment
 * completion still find its pack if it wins the race. The expiry webhook
 * recognises the edit lease and does not cancel a pack being re-issued. */
async function retirePackCheckout(pack: ClientPackage): Promise<Extract<PackLinkResult, { ok: false }> | null> {
  if (!pack.stripe_session_id) return null
  let existing
  try {
    existing = await stripe.checkout.sessions.retrieve(pack.stripe_session_id)
  } catch {
    return {
      ok: false,
      status: 502,
      retainLock: true,
      error: "Couldn't check the existing payment link with Stripe — wait five minutes, then try again",
    }
  }
  if (existing.status === "complete")
    return { ok: false, status: 409, error: "This pack was already paid — refresh the page" }
  if (existing.status === "expired") return null
  if (existing.status !== "open")
    return { ok: false, status: 502, error: "Couldn't confirm the payment link's status — try again" }
  try {
    await stripe.checkout.sessions.expire(pack.stripe_session_id)
    return null
  } catch {
    try {
      const reconciled = await stripe.checkout.sessions.retrieve(pack.stripe_session_id)
      if (reconciled.status === "expired") return null
      if (reconciled.status === "complete")
        return { ok: false, status: 409, error: "This pack was already paid — refresh the page" }
      if (reconciled.status === "open")
        return { ok: false, status: 502, error: "Couldn't cancel the old payment link — nothing changed. Try again" }
    } catch {
      /* Keep the lease below until a retry can establish Stripe's result. */
    }
    return {
      ok: false,
      status: 502,
      retainLock: true,
      error:
        "Couldn't confirm whether the old payment link was cancelled. Nothing changed. Wait five minutes, then try again",
    }
  }
}

/** Correct an unpaid pack's total without replacing its attendance ledger. */
export async function changePackPrice(pack: ClientPackage, priceCents: number): Promise<PackPriceResult> {
  if (!Number.isSafeInteger(priceCents) || priceCents <= 0 || priceCents > 99999999) {
    return { ok: false, status: 400, error: "Enter a total between $0.01 and $999,999.99" }
  }
  return withPaymentLinkEdit(pack, (fresh, update) => changePackPriceLocked(fresh, priceCents, update))
}

async function changePackPriceLocked(
  pack: ClientPackage,
  priceCents: number,
  update: UpdateLeasedPack,
): Promise<PackPriceResult> {
  if (pack.payment_status !== "pending" || pack.status === "cancelled" || pack.status === "refunded") {
    return { ok: false, status: 409, error: "Only unpaid packs can have their price changed" }
  }
  if (pack.payment_method !== "stripe") {
    await update({ price_cents: priceCents })
    return { ok: true, url: null, previousPriceCents: pack.price_cents }
  }

  const refusal = await retirePackCheckout(pack)
  if (refusal) return refusal

  // Save the correction before minting: if Stripe is unavailable, Copy payment
  // link can retry at the corrected amount, with no stale price to resurrect.
  await update({
    price_cents: priceCents,
    stripe_session_id: null,
    bill_to_emailed_at: null,
  })
  try {
    const checkout = await createPackCheckoutSession(
      checkoutOptsFor({ ...pack, price_cents: priceCents }, pack.bill_to_email),
    )
    try {
      await associateCheckout(checkout.id, update, { stripe_session_id: checkout.id })
    } catch (error) {
      console.error("[pack price] replacement association failed:", error)
      return {
        ok: false,
        status: 502,
        priceSaved: true,
        previousPriceCents: pack.price_cents,
        retainLock: true,
        error:
          "The price was saved, but the replacement link could not be saved. Wait five minutes, then use Copy payment link to retry",
      }
    }
    return { ok: true, url: checkout.url, previousPriceCents: pack.price_cents }
  } catch (error) {
    console.error("[pack price] replacement payment link failed:", error)
    return {
      ok: false,
      status: 502,
      priceSaved: true,
      previousPriceCents: pack.price_cents,
      error:
        "The price was saved, but the replacement link could not be created. Refresh, then use Copy payment link to retry",
    }
  }
}

/** Shape a fresh Checkout session for a pack, addressed to `billToEmail`. */
function checkoutOptsFor(pack: ClientPackage, billToEmail: string | null) {
  return {
    clientUserId: pack.client_user_id,
    name: `${pack.credits_total}× ${pack.session_type}`,
    sessionType: pack.session_type,
    credits: pack.credits_total,
    priceCents: pack.price_cents,
    validityDays: null,
    productId: pack.product_id,
    billToEmail,
    // Consent lives on the pack (set at pending-pack creation — see
    // buildPackageInsert). Carry it forward on every re-mint so an
    // expired-then-refreshed link, or a bill-to change, doesn't silently
    // disarm auto-renew by defaulting createPackCheckoutSession's optional
    // autoRenew back to falsy.
    autoRenew: pack.auto_renew,
    // The link is paid by the CLIENT (or their payer) — land them on their own
    // packs page, never the coach's admin client page.
    returnUrl: "/client/sessions",
    cancelUrl: "/client/sessions",
  }
}

/**
 * The shareable Checkout URL for a pack awaiting card payment.
 *
 * Returns the existing session's URL while it is still open. A fresh session is
 * minted ONLY when the old one is verifiably dead ("expired") — never on a
 * transient Stripe error, and never when the old session is "complete" (paid,
 * webhook in flight): repointing stripe_session_id in either case would strand
 * the real payment and put the webhook into a retry loop.
 *
 * Shared by the copy-link and email-link routes so "what is this pack's link"
 * has exactly one definition. A re-mint carries `pack.bill_to_email` forward,
 * so a link addressed to a parent never silently reverts to the trainee.
 */
export async function resolvePackPaymentLink(pack: ClientPackage): Promise<PackLinkResult> {
  return withPaymentLinkEdit(pack, resolvePackPaymentLinkLocked)
}

async function resolvePackPaymentLinkLocked(pack: ClientPackage, update: UpdateLeasedPack): Promise<PackLinkResult> {
  if (pack.payment_method !== "stripe" || pack.payment_status !== "pending") {
    return { ok: false, status: 409, error: "This pack is not awaiting a card payment" }
  }

  if (pack.stripe_session_id) {
    let existing
    try {
      existing = await stripe.checkout.sessions.retrieve(pack.stripe_session_id)
    } catch (err) {
      console.warn("[pack link] could not retrieve existing checkout session:", err)
      return {
        ok: false,
        status: 502,
        retainLock: true,
        error: "Couldn't check the existing payment link with Stripe — wait five minutes, then try again",
      }
    }
    if (existing.status === "open" && existing.url) {
      return { ok: true, url: existing.url, refreshed: false }
    }
    if (existing.status === "complete") {
      return {
        ok: false,
        status: 409,
        error: "This pack was already paid — it may take a moment to show as paid here",
      }
    }
    if (existing.status !== "expired") {
      return { ok: false, status: 502, error: "Couldn't confirm that the old payment link expired — try again" }
    }
  }

  const checkout = await createPackCheckoutSession(checkoutOptsFor(pack, pack.bill_to_email))
  await associateCheckout(checkout.id, update, { stripe_session_id: checkout.id })
  return { ok: true, url: checkout.url!, refreshed: true }
}

/**
 * Re-address a pack that is still awaiting payment.
 *
 * A pinned customer_email is baked into the Checkout session at creation, so
 * changing the addressee means killing the old session and minting a new one.
 * Same guards as deleting a pending pack: never touch a `complete` session, and
 * never proceed on a Stripe error — two live links for one pack is worse than a
 * failed edit.
 */
export async function changePackBillTo(pack: ClientPackage, billToEmail: string | null): Promise<PackLinkResult> {
  return withPaymentLinkEdit(pack, (fresh, update) => changePackBillToLocked(fresh, billToEmail, update))
}

async function changePackBillToLocked(
  pack: ClientPackage,
  billToEmail: string | null,
  update: UpdateLeasedPack,
): Promise<PackLinkResult> {
  if (pack.payment_method !== "stripe" || pack.payment_status !== "pending") {
    return { ok: false, status: 409, error: "This pack is not awaiting a card payment" }
  }

  const refusal = await retirePackCheckout(pack)
  if (refusal) return refusal

  // Persist the corrected addressee and detach only after verified expiry.
  // A failed mint then leaves a retryable pack with the intended addressee.
  await update({ bill_to_email: billToEmail, stripe_session_id: null, bill_to_emailed_at: null })
  const checkout = await createPackCheckoutSession(checkoutOptsFor(pack, billToEmail))

  // bill_to_emailed_at resets: the address this pack was last emailed to is no
  // longer the address it is billed to.
  await associateCheckout(checkout.id, update, { stripe_session_id: checkout.id })

  return { ok: true, url: checkout.url!, refreshed: true }
}

async function associateCheckout(id: string, update: UpdateLeasedPack, patch: Partial<ClientPackage>) {
  try {
    await update(patch)
  } catch (error) {
    await stripe.checkout.sessions.expire(id)
    // The write may have succeeded even if its response failed. Clear any
    // association with the now-expired replacement before returning an error.
    await update({ stripe_session_id: null })
    throw error
  }
}
