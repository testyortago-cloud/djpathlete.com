import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { cardOnFileEnabled } from "@/lib/packs/flags"
import { getUserById } from "@/lib/db/users"
import { getOrCreateStripeCustomer, createSetupCheckoutSession } from "@/lib/stripe"
import { getDefaultPaymentMethod, deletePaymentMethod } from "@/lib/db/payment-methods"

/**
 * Client-side "add card": the athlete saves their OWN card from their portal.
 * Identity comes from the session — a client can only ever save/remove their own
 * card. Opens the same Stripe hosted setup Checkout on the client's device.
 */
export async function POST() {
  try {
    if (!(await cardOnFileEnabled())) return NextResponse.json({ error: "Not enabled" }, { status: 403 })
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (session.user.role !== "client") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const user = await getUserById(session.user.id)
    const customerId = await getOrCreateStripeCustomer(session.user.id, user.email)
    const checkout = await createSetupCheckoutSession({
      customerId,
      userId: session.user.id,
      returnUrl: "/client/sessions",
      cancelUrl: "/client/sessions",
    })
    return NextResponse.json({ url: checkout.url })
  } catch (error) {
    console.error("Client save-card error:", error)
    return NextResponse.json({ error: "Failed to start card setup" }, { status: 500 })
  }
}

/** Remove the client's own saved card. */
export async function DELETE() {
  if (!(await cardOnFileEnabled())) return NextResponse.json({ error: "Not enabled" }, { status: 403 })
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "client") return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const pm = await getDefaultPaymentMethod(session.user.id)
  if (pm) await deletePaymentMethod(pm.id)
  return NextResponse.json({ ok: true })
}
