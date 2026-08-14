import type { ClientPackage } from "@/types/database"
import { stripe, createPackCheckoutSession } from "@/lib/stripe"
import { updateClientPackage } from "@/lib/db/client-packages"

export type PackLinkResult =
  | { ok: true; url: string; refreshed: boolean }
  | { ok: false; status: number; error: string }

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
        error: "Couldn't check the existing payment link with Stripe — try again in a moment",
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
    // status "expired" (or open-without-url, which shouldn't happen) → mint fresh below.
  }

  const checkout = await createPackCheckoutSession(checkoutOptsFor(pack, pack.bill_to_email))
  await updateClientPackage(pack.id, { stripe_session_id: checkout.id })
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
export async function changePackBillTo(
  pack: ClientPackage,
  billToEmail: string | null,
): Promise<PackLinkResult> {
  if (pack.payment_method !== "stripe" || pack.payment_status !== "pending") {
    return { ok: false, status: 409, error: "This pack is not awaiting a card payment" }
  }

  if (pack.stripe_session_id) {
    let existing
    try {
      existing = await stripe.checkout.sessions.retrieve(pack.stripe_session_id)
    } catch (err) {
      console.warn("[pack bill-to] could not retrieve existing checkout session:", err)
      return {
        ok: false,
        status: 502,
        error: "Couldn't check the existing payment link with Stripe — try again in a moment",
      }
    }
    if (existing.status === "complete") {
      return {
        ok: false,
        status: 409,
        error: "This pack was already paid — refresh the page instead of changing its billing email",
      }
    }
    if (existing.status === "open") {
      // DETACH BEFORE EXPIRING. Expiring fires `checkout.session.expired`, and
      // handleSessionPackExpired cancels whatever pack still points at that
      // session id — a pending pack with no check-ins is exactly this one. If
      // that webhook beat our repoint below, changing the billing email would
      // silently cancel the pack. Nulling the id first means the webhook finds
      // no pack and no-ops.
      //
      // Deliberately not the other order (mint first, expire last): a failure
      // there would leave an orphaned OPEN link whose payment no webhook could
      // match — money taken, no credits. A detached pack is merely re-mintable.
      await updateClientPackage(pack.id, { stripe_session_id: null })
      try {
        await stripe.checkout.sessions.expire(pack.stripe_session_id)
      } catch (err) {
        console.warn("[pack bill-to] could not expire existing checkout session:", err)
        return {
          ok: false,
          status: 502,
          error: "Couldn't cancel the old payment link — try again in a moment",
        }
      }
    }
  }

  const checkout = await createPackCheckoutSession(checkoutOptsFor(pack, billToEmail))

  // bill_to_emailed_at resets: the address this pack was last emailed to is no
  // longer the address it is billed to.
  await updateClientPackage(pack.id, {
    bill_to_email: billToEmail,
    stripe_session_id: checkout.id,
    bill_to_emailed_at: null,
  })

  return { ok: true, url: checkout.url!, refreshed: true }
}
