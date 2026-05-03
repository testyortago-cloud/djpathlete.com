import { NextResponse } from "next/server"
import { createEventSignupSchema } from "@/lib/validators/event-signups"
import { getEventById } from "@/lib/db/events"
import { createSignup } from "@/lib/db/event-signups"
import { getActiveDocument } from "@/lib/db/legal-documents"
import { createEventCheckoutSession } from "@/lib/stripe"
import { createServiceRoleClient } from "@/lib/supabase"
import { parseAttrCookie } from "@/lib/marketing/cookies"
import { getUnclaimedAttribution } from "@/lib/db/marketing-attribution"

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
    if (!event.stripe_price_id) {
      return NextResponse.json({ error: "This event is not yet available for booking" }, { status: 400 })
    }

    // Capacity check uses confirmed signup_count only — slots are reserved
    // post-payment via the confirm_event_signup RPC (atomic, locks the event
    // row). If two checkouts race for the last slot, the loser's webhook
    // gets at_capacity and triggers an automatic refund. See
    // handleEventSignupCheckout in app/api/stripe/webhook/route.ts.
    if (event.signup_count >= event.capacity) {
      return NextResponse.json({ error: "at_capacity" }, { status: 409 })
    }

    const waiverDoc = await getActiveDocument("liability_waiver")
    const ipAddress = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || null
    const userAgent = request.headers.get("user-agent") || null
    const { waiver_accepted: _waiver_accepted, ...signupInput } = parsed.data

    // Resolve visitor tracking params from djp_attr cookie BEFORE creating the
    // signup row so gclid is persisted on event_signups (not just on the
    // downstream payments row from the Stripe webhook).
    const attrSessionId = parseAttrCookie(request.headers.get("cookie"))
    const attrRow = attrSessionId ? await getUnclaimedAttribution(attrSessionId).catch(() => null) : null
    const tracking = attrRow
      ? { gclid: attrRow.gclid, gbraid: attrRow.gbraid, wbraid: attrRow.wbraid, fbclid: attrRow.fbclid }
      : undefined

    const signup = await createSignup(
      id,
      signupInput,
      "paid",
      {
        document_id: waiverDoc?.id ?? null,
        ip_address: ipAddress,
        user_agent: userAgent,
      },
      tracking,
    )

    let session
    try {
      session = await createEventCheckoutSession({
        event,
        signup,
        parentEmail: parsed.data.parent_email,
        baseUrl: getBaseUrl(),
        tracking,
      })
    } catch (err) {
      console.error("[api/events/checkout] Stripe error", err)
      return NextResponse.json({ error: "Payment provider unavailable, please try again" }, { status: 502 })
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
