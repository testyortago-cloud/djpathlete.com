import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createEventSchema } from "@/lib/validators/events"
import { createEvent, updateEvent } from "@/lib/db/events"
import { syncEventToStripe } from "@/lib/stripe"

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const result = createEventSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid event data", fieldErrors: result.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    try {
      const event = await createEvent(result.data)

      // Auto-sync to Stripe when the new event is created in published+priced
      // state (i.e. admin clicked "Save & publish" with a price set). Without
      // this, the row lands as published+priced+unsynced and the listing card
      // shows "Book — coming soon" until the admin re-saves the event.
      if (event.status === "published" && (event.price_cents ?? 0) > 0) {
        try {
          const synced = await syncEventToStripe(event)
          const stripeFields: Record<string, unknown> = {
            stripe_product_id: synced.productId,
            stripe_price_id: synced.priceId,
          }
          const updated = await updateEvent(event.id, stripeFields)
          return NextResponse.json({ event: updated }, { status: 201 })
        } catch (err) {
          console.error("[admin events POST] auto-sync on create failed", err)
          return NextResponse.json(
            {
              error:
                "Event created but Stripe sync failed — open the event from the events list and save again to retry.",
              eventId: event.id,
            },
            { status: 502 },
          )
        }
      }

      return NextResponse.json({ event }, { status: 201 })
    } catch (err) {
      const msg = (err as Error).message
      if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
        return NextResponse.json(
          { error: "Slug already in use", fieldErrors: { slug: ["That slug is already taken"] } },
          { status: 409 },
        )
      }
      throw err
    }
  } catch (err) {
    console.error("[API admin/events POST]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
