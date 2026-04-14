import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getEventById, updateEvent } from "@/lib/db/events"
import type { UpdateEventInput } from "@/lib/validators/events"
import { syncEventToStripe } from "@/lib/stripe"

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { id } = await ctx.params
    const event = await getEventById(id)
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 })
    if (event.type !== "camp") {
      return NextResponse.json({ error: "Only camps can be synced to Stripe" }, { status: 400 })
    }
    if (!event.price_cents || event.price_cents <= 0) {
      return NextResponse.json({ error: "Event has no price configured" }, { status: 400 })
    }

    let result
    try {
      result = await syncEventToStripe(event)
    } catch (err) {
      console.error("[admin stripe-sync] Stripe error", err)
      return NextResponse.json({ error: "Stripe sync failed — try again" }, { status: 502 })
    }

    const stripeUpdates = {
      stripe_product_id: result.productId,
      stripe_price_id: result.priceId,
    } as unknown as UpdateEventInput
    const updated = await updateEvent(id, stripeUpdates)
    return NextResponse.json({ event: updated })
  } catch (err) {
    console.error("[admin stripe-sync] unexpected error", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
