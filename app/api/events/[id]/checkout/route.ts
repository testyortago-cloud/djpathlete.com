import { NextResponse } from "next/server"
import { createEventSignupSchema } from "@/lib/validators/event-signups"
import { getEventById } from "@/lib/db/events"
import { countPendingPaidSignups, createSignup } from "@/lib/db/event-signups"
import { createEventCheckoutSession } from "@/lib/stripe"
import { createServiceRoleClient } from "@/lib/supabase"

function getBaseUrl() {
  return process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params

    const body = (await request.json()) as Record<string, unknown>

    if (typeof body.website === "string" && body.website.length > 0) {
      return NextResponse.json({ ok: true })
    }
    delete body.website

    const parsed = createEventSignupSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid signup data", fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const event = await getEventById(id)
    if (!event || event.status !== "published") {
      return NextResponse.json({ error: "Event not available" }, { status: 404 })
    }
    if (event.type !== "camp") {
      return NextResponse.json({ error: "Only camps support paid checkout" }, { status: 400 })
    }
    if (!event.stripe_price_id) {
      return NextResponse.json(
        { error: "This camp is not yet available for booking" },
        { status: 400 },
      )
    }

    const pendingPaid = await countPendingPaidSignups(id)
    if (event.signup_count + pendingPaid >= event.capacity) {
      return NextResponse.json({ error: "at_capacity" }, { status: 409 })
    }

    const signup = await createSignup(id, parsed.data, "paid")

    let session
    try {
      session = await createEventCheckoutSession({
        event,
        signup,
        parentEmail: parsed.data.parent_email,
        baseUrl: getBaseUrl(),
      })
    } catch (err) {
      console.error("[api/events/checkout] Stripe error", err)
      return NextResponse.json(
        { error: "Payment provider unavailable, please try again" },
        { status: 502 },
      )
    }

    const supabase = createServiceRoleClient()
    await supabase
      .from("event_signups")
      .update({ stripe_session_id: session.id, updated_at: new Date().toISOString() })
      .eq("id", signup.id)

    return NextResponse.json({ sessionUrl: session.url, signupId: signup.id })
  } catch (err) {
    console.error("[api/events/checkout] unexpected error", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
