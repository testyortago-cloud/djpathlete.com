import { NextResponse } from "next/server"
import { createEventSignupSchema } from "@/lib/validators/event-signups"
import { getEventById } from "@/lib/db/events"
import { createEventSignupCheckout } from "@/lib/events/checkout"
import { parseAttrCookie } from "@/lib/marketing/cookies"
import { getAttributionBySession } from "@/lib/db/marketing-attribution"

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

    // Resolved from the djp_attr cookie BEFORE the signup is created, so gclid
    // lands on `event_signups` itself and not only on the downstream payments row
    // the Stripe webhook writes.
    const attrSessionId = parseAttrCookie(request.headers.get("cookie"))
    const attrRow = attrSessionId ? await getAttributionBySession(attrSessionId).catch(() => null) : null
    const tracking = attrRow
      ? { gclid: attrRow.gclid, gbraid: attrRow.gbraid, wbraid: attrRow.wbraid, fbclid: attrRow.fbclid }
      : undefined

    // THE SEQUENCE LIVES IN lib/events/checkout.ts, shared with the funnel form
    // that now sells camps directly. What used to be inline here — the price and
    // capacity refusals, the active-waiver lookup, the signup insert with its
    // evidence, the Stripe session, the session-id write — is one call, so the
    // legal gate and the money cannot drift between the two callers.
    //
    // NO `returnUrls`: this route sends the visitor back to the EVENT's own
    // success and cancel pages, which is what the helper defaults to.
    const outcome = await createEventSignupCheckout({
      event,
      input: parsed.data,
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || null,
      userAgent: request.headers.get("user-agent"),
      tracking,
      baseUrl: getBaseUrl(),
    })

    if (!outcome.ok) {
      // `at_capacity` is preserved verbatim: the modal branches on this exact
      // string to tell the visitor the camp filled up rather than showing a
      // generic failure.
      const error = outcome.status === 409 ? "at_capacity" : outcome.error
      return NextResponse.json({ error }, { status: outcome.status })
    }

    return NextResponse.json({ sessionUrl: outcome.sessionUrl, signupId: outcome.signupId })
  } catch (err) {
    console.error("[api/events/checkout] unexpected error", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
