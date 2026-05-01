import { NextResponse } from "next/server"
import { createEventSignupSchema } from "@/lib/validators/event-signups"
import { getEventById } from "@/lib/db/events"
import { createSignup } from "@/lib/db/event-signups"
import { getActiveDocument } from "@/lib/db/legal-documents"
import { sendEventSignupReceivedEmail, sendAdminNewSignupEmail } from "@/lib/email"

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const url = new URL(request.url)
    const waitlist = url.searchParams.get("waitlist") === "true"

    const body = (await request.json()) as Record<string, unknown>

    // Honeypot — silent success, no DB touch, no email.
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

    if (!waitlist && event.signup_count >= event.capacity) {
      return NextResponse.json({ error: "at_capacity" }, { status: 409 })
    }

    const waiverDoc = await getActiveDocument("liability_waiver")
    const ipAddress = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || null
    const userAgent = request.headers.get("user-agent") || null
    const { waiver_accepted: _waiver_accepted, ...signupInput } = parsed.data

    const signup = await createSignup(id, signupInput, "interest", {
      document_id: waiverDoc?.id ?? null,
      ip_address: ipAddress,
      user_agent: userAgent,
    })

    const [receivedRes, adminRes] = await Promise.allSettled([
      sendEventSignupReceivedEmail(signup, event),
      sendAdminNewSignupEmail(signup, event),
    ])
    if (receivedRes.status === "rejected") {
      console.error(`[api/events/signup] received email failed for signup ${signup.id}`, receivedRes.reason)
    }
    if (adminRes.status === "rejected") {
      console.error(`[api/events/signup] admin email failed for signup ${signup.id}`, adminRes.reason)
    }

    return NextResponse.json({ ok: true, signupId: signup.id })
  } catch (err) {
    console.error("[api/events/signup] unexpected error", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
