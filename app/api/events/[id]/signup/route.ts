import { NextResponse } from "next/server"
import { createEventSignupSchema } from "@/lib/validators/event-signups"
import { getEventById } from "@/lib/db/events"
import { createSignup } from "@/lib/db/event-signups"
import { getActiveDocument } from "@/lib/db/legal-documents"
import { sendEventSignupReceivedEmail, sendAdminNewSignupEmail } from "@/lib/email"
import { withAudit } from "@/lib/audit/with-audit"
import { captureLead } from "@/lib/lead-engine/capture"
import { recordConsent } from "@/lib/db/contact-consents"
import { getBusinessSettings } from "@/lib/db/businesses"
import { hasSmsConsentDisplayName, renderSmsConsentWording } from "@/lib/lead-engine/sms-consent-wording"

export const POST = withAudit(
  {
    action: "event_signup.created",
    category: "marketing",
    target: async (_request, ctx) => {
      const { id } = await ctx.params
      return { type: "event", id }
    },
  },
  async (request, ctx) => {
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
      const { waiver_accepted: _waiver_accepted, sms_consent, ...signupInput } = parsed.data

      const signup = await createSignup(id, signupInput, "interest", {
        document_id: waiverDoc?.id ?? null,
        ip_address: ipAddress,
        user_agent: userAgent,
      })

      // Join the contact spine (Lead Engine Stage 4). captureLead never throws
      // (lib/lead-engine/capture.ts swallows its own errors), so a contact-write
      // failure here can never change this route's response or the emails
      // below. Read from the SIGNUP ROW just created, not `parsed.data` — the
      // row is the thing that actually exists now, and the two agree anyway
      // since the DAL just echoes the insert back.
      const contactId = await captureLead({
        source: "event_signup",
        email: signup.parent_email,
        phone: signup.parent_phone,
        name: signup.parent_name,
      })

      // SMS consent (Lead Engine Stage 4). FIRE AND FORGET, same reasoning as
      // recordInquirySmsConsent (app/api/inquiry/route.ts): the lead is
      // already captured, and a consent-row failure must never turn "you're
      // signed up" into an error for someone who already handed over their
      // phone number. Only fires when there is a contact to attach the row
      // to, a phone that was actually submitted, and the box was actually
      // ticked — an unchecked or absent box writes no row at all.
      if (contactId && signup.parent_phone && sms_consent === true) {
        void recordEventSignupSmsConsent({ contactId, ip: ipAddress, userAgent }).catch((err) => {
          console.error("[api/events/signup] sms consent write failed (the signup was saved):", err)
        })
      }

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
  },
)

/**
 * Writes the SMS consent row for an interest/waitlist event signup whose
 * parent ticked the opt-in box next to the phone field.
 *
 * The wording is re-rendered HERE, from `business_settings.display_name`
 * through the exact same `renderSmsConsentWording` the modal used to show
 * it — never passed through from the client, which cannot be trusted to
 * relay what it actually rendered. Evidence of consent is what was shown;
 * re-deriving it from the same input is how both sides of that claim stay
 * provably identical.
 *
 * MIRRORS THE MODAL'S OWN GATE (`hasSmsConsentDisplayName`, checked before
 * the checkbox is even shown — see components/public/EventSignupCard.tsx's
 * server parent pages): if `display_name` reads back blank here, no row is
 * filed, even though `sms_consent` came in `true`. Skipping is logged,
 * never thrown — the signup was already saved and the lead already
 * captured by the caller before this ever runs, so a missing business name
 * is not a reason to lose either of those.
 *
 * Mirrors app/api/inquiry/route.ts's recordInquirySmsConsent and
 * app/api/events/[id]/checkout/route.ts's own copy exactly — this route has
 * no `form_context`-style variant to thread through, so `source` is the
 * fixed literal "event_signup" rather than a resolved value.
 */
async function recordEventSignupSmsConsent(input: {
  contactId: string
  ip: string | null
  userAgent: string | null
}): Promise<void> {
  const settings = await getBusinessSettings()
  if (!hasSmsConsentDisplayName(settings.display_name)) {
    console.warn("[api/events/signup] sms consent skipped: business_settings.display_name is blank")
    return
  }
  await recordConsent({
    contactId: input.contactId,
    channel: "sms",
    granted: true,
    source: "event_signup",
    wordingShown: renderSmsConsentWording(settings.display_name),
    ip: input.ip,
    userAgent: input.userAgent,
  })
}
