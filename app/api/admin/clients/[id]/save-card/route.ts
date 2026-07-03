import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { cardOnFileEnabled } from "@/lib/packs/flags"
import { getUserById } from "@/lib/db/users"
import { getOrCreateStripeCustomer, createSetupCheckoutSession } from "@/lib/stripe"

/** Start a hosted setup Checkout so the client can save a card on file. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
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
