import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { cardOnFileEnabled } from "@/lib/packs/flags"
import { getUserById } from "@/lib/db/users"
import { getOrCreateStripeCustomer, createSetupCheckoutSession } from "@/lib/stripe"
import { getDefaultPaymentMethod, deletePaymentMethod } from "@/lib/db/payment-methods"
import { canAccessAdminPath } from "@/lib/permissions/guard"

/** Start a hosted setup Checkout so the client can save a card on file. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    if (!(await cardOnFileEnabled())) return NextResponse.json({ error: "Not enabled" }, { status: 403 })

    const { id } = await ctx.params
    const user = await getUserById(id)
    const customerId = await getOrCreateStripeCustomer(id, user.email)
    const checkout = await createSetupCheckoutSession({ customerId, userId: id })
    return NextResponse.json({ url: checkout.url })
  } catch (error) {
    console.error("Save-card checkout error:", error)
    return NextResponse.json({ error: "Failed to start card setup" }, { status: 500 })
  }
}

/** Remove the client's saved default card. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }
  if (!(await cardOnFileEnabled())) return NextResponse.json({ error: "Not enabled" }, { status: 403 })
  const { id } = await ctx.params
  const pm = await getDefaultPaymentMethod(id)
  if (pm) await deletePaymentMethod(pm.id)
  return NextResponse.json({ ok: true })
}
