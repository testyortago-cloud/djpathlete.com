import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getClientPackageByIdMaybe, updateClientPackage } from "@/lib/db/client-packages"
import { stripe } from "@/lib/stripe"
import { recordAudit } from "@/lib/audit/record"
import { canAccessAdminPath } from "@/lib/permissions/guard"

/**
 * POST — manually mark an awaiting-payment pack as paid (Venmo/cash arrived).
 * Works for offline "owed" packs and for stripe-link packs the client ended up
 * paying another way. Idempotent: an already-paid pack returns success.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    const { id } = await ctx.params

    const pack = await getClientPackageByIdMaybe(id)
    if (!pack) {
      return NextResponse.json({ error: "Pack not found" }, { status: 404 })
    }
    if (pack.payment_status === "paid" || pack.payment_status === "not_required") {
      return NextResponse.json({ package: pack, alreadyPaid: true })
    }
    if (pack.payment_status === "refunded") {
      return NextResponse.json({ error: "This pack was refunded — sell a new one instead" }, { status: 409 })
    }

    // Stripe-link pack paid offline: kill the open checkout session first so the
    // client can't double-pay through a still-live link. Best-effort — an
    // already-expired/complete session or a Stripe hiccup must not block the
    // coach from recording money they actually received.
    if (pack.payment_method === "stripe" && pack.stripe_session_id) {
      try {
        await stripe.checkout.sessions.expire(pack.stripe_session_id)
      } catch (err) {
        console.warn("[mark paid] could not expire checkout session (continuing):", err)
      }
    }

    const updated = await updateClientPackage(id, { payment_status: "paid" })

    void recordAudit({
      action: "pack.marked_paid",
      category: "commerce",
      outcome: "success",
      target: { type: "client_package", id, label: pack.session_type },
      metadata: {
        client_user_id: pack.client_user_id,
        payment_method: pack.payment_method,
        price_cents: pack.price_cents,
      },
      request,
    })

    return NextResponse.json({ package: updated })
  } catch (error) {
    console.error("Mark pack paid error:", error)
    return NextResponse.json({ error: "Failed to mark pack paid" }, { status: 500 })
  }
}
