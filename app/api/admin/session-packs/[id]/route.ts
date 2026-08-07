import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getClientPackageByIdMaybe, deleteClientPackage } from "@/lib/db/client-packages"
import { stripe } from "@/lib/stripe"
import { recordAudit } from "@/lib/audit/record"
import { canAccessAdminPath } from "@/lib/permissions/guard"

/**
 * DELETE — remove a session pack entirely (test packs, mis-sold packs).
 * Check-ins cascade with the row.
 *
 * For packs still awaiting a card payment, the outstanding Checkout session is
 * verified FIRST and the delete refuses to proceed unless that link is dead:
 * - session already paid ("complete") → 409: the webhook is about to promote
 *   this pack; deleting now would strand a real payment and put the webhook
 *   into a retry loop (it throws when no pack matches the session id).
 * - session still open → it must expire successfully before we delete, else
 *   the client could pay a link whose pack no longer exists.
 */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
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

    if (pack.payment_method === "stripe" && pack.payment_status === "pending" && pack.stripe_session_id) {
      let checkout
      try {
        checkout = await stripe.checkout.sessions.retrieve(pack.stripe_session_id)
      } catch (err) {
        console.warn("[delete pack] could not verify checkout session:", err)
        return NextResponse.json(
          { error: "Couldn't verify this pack's payment link with Stripe — try again in a moment" },
          { status: 502 },
        )
      }
      if (checkout.status === "complete") {
        return NextResponse.json(
          { error: "This pack was just paid — refresh the page instead of deleting it" },
          { status: 409 },
        )
      }
      if (checkout.status === "open") {
        try {
          await stripe.checkout.sessions.expire(pack.stripe_session_id)
        } catch (err) {
          console.warn("[delete pack] could not expire checkout session:", err)
          return NextResponse.json(
            { error: "Couldn't cancel this pack's payment link — try again in a moment" },
            { status: 502 },
          )
        }
      }
    }

    await deleteClientPackage(id)

    void recordAudit({
      action: "pack.deleted",
      category: "commerce",
      outcome: "success",
      target: { type: "client_package", id, label: pack.session_type },
      metadata: {
        client_user_id: pack.client_user_id,
        credits_total: pack.credits_total,
        credits_used: pack.credits_used,
        payment_status: pack.payment_status,
        payment_method: pack.payment_method,
        price_cents: pack.price_cents,
      },
      request,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Delete pack error:", error)
    return NextResponse.json({ error: "Failed to delete pack" }, { status: 500 })
  }
}
