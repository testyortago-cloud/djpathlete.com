import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getClientPackageByIdMaybe, updateClientPackage } from "@/lib/db/client-packages"
import { stripe, createPackCheckoutSession } from "@/lib/stripe"
import { recordAudit } from "@/lib/audit/record"

/**
 * POST — get a shareable payment link for an awaiting-payment pack.
 * Returns the existing Checkout session's URL while it is still open. A fresh
 * session is minted ONLY when the old one is verifiably dead ("expired") —
 * never on a transient Stripe error, and never when the old session is
 * "complete" (paid, webhook in flight): repointing stripe_session_id in either
 * case would strand the real payment and put the webhook into a retry loop.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    const { id } = await ctx.params

    const pack = await getClientPackageByIdMaybe(id)
    if (!pack) {
      return NextResponse.json({ error: "Pack not found" }, { status: 404 })
    }
    if (pack.payment_method !== "stripe" || pack.payment_status !== "pending") {
      return NextResponse.json({ error: "This pack is not awaiting a card payment" }, { status: 409 })
    }

    if (pack.stripe_session_id) {
      let existing
      try {
        existing = await stripe.checkout.sessions.retrieve(pack.stripe_session_id)
      } catch (err) {
        console.warn("[payment link] could not retrieve existing checkout session:", err)
        return NextResponse.json(
          { error: "Couldn't check the existing payment link with Stripe — try again in a moment" },
          { status: 502 },
        )
      }
      if (existing.status === "open" && existing.url) {
        return NextResponse.json({ url: existing.url, refreshed: false })
      }
      if (existing.status === "complete") {
        return NextResponse.json(
          { error: "This pack was already paid — it may take a moment to show as paid here" },
          { status: 409 },
        )
      }
      // status "expired" (or open-without-url, which shouldn't happen) → mint fresh below.
    }

    const checkout = await createPackCheckoutSession({
      clientUserId: pack.client_user_id,
      name: `${pack.credits_total}× ${pack.session_type}`,
      sessionType: pack.session_type,
      credits: pack.credits_total,
      priceCents: pack.price_cents,
      validityDays: null,
      productId: pack.product_id,
      // The link is paid by the CLIENT — land them on their own packs page.
      returnUrl: "/client/sessions",
      cancelUrl: "/client/sessions",
    })
    await updateClientPackage(id, { stripe_session_id: checkout.id })

    void recordAudit({
      action: "pack.payment_link_refreshed",
      category: "commerce",
      outcome: "success",
      target: { type: "client_package", id, label: pack.session_type },
      metadata: { client_user_id: pack.client_user_id, stripe_session_id: checkout.id },
      request,
    })

    return NextResponse.json({ url: checkout.url, refreshed: true })
  } catch (error) {
    console.error("Pack payment link error:", error)
    return NextResponse.json({ error: "Failed to get payment link" }, { status: 500 })
  }
}
