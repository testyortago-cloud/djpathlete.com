import { NextResponse } from "next/server"
import { createEventSignupSchema } from "@/lib/validators/event-signups"
import { getEventById } from "@/lib/db/events"
import { createEventSignupCheckout } from "@/lib/events/checkout"
import { parseAttrCookie } from "@/lib/marketing/cookies"
import { getAttributionBySession } from "@/lib/db/marketing-attribution"
import { captureLead } from "@/lib/lead-engine/capture"
import { recordConsent } from "@/lib/db/contact-consents"
import { getBusinessSettings } from "@/lib/db/businesses"
import { hasSmsConsentDisplayName, renderSmsConsentWording } from "@/lib/lead-engine/sms-consent-wording"
import { resolvePublicTenant } from "@/lib/tenancy/public"

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

    // PUBLIC ROUTE, NO SESSION. The tenant is resolved from the request's Host
    // by lib/tenancy/public.ts (business_domains), and is the platform's own
    // only when no domain row claims the host. Resolved once here and
    // threaded; the DAL does not default it.
    const businessId = await resolvePublicTenant()

    const event = await getEventById(businessId, id)
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
    const ipAddress = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || null
    const userAgent = request.headers.get("user-agent")
    const outcome = await createEventSignupCheckout(businessId, {
      event,
      input: parsed.data,
      ipAddress,
      userAgent,
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

    // Join the contact spine (Lead Engine Stage 4). captureLead never throws
    // (lib/lead-engine/capture.ts swallows its own errors), so a contact-write
    // failure here can never change this route's response. Read from
    // `parsed.data`, not a re-fetched row: `createEventSignupCheckout`'s
    // outcome carries only `sessionUrl`/`signupId`, and the parent fields it
    // wrote to the signup row are exactly what was validated here.
    //
    // Deliberately NOT wired inside `lib/events/checkout.ts` itself, even
    // though that is where the row is actually inserted: that helper is also
    // called directly (in-process, bypassing this route) by
    // app/api/funnels/submit/route.ts for a funnel's own "Register & pay"
    // step, which already joins the spine under its own source
    // (`captureContactFromSubmission`, source "funnel_form"). Capturing
    // there too would double-record a single funnel checkout as two spine
    // events with two different sources — and could double-enroll it into
    // two different automations. Wiring at each ROUTE instead means only a
    // signup this route itself created (i.e. the one EventSignupModal's paid
    // flow actually posts to) is ever tagged "event_signup".
    const contactId = await captureLead({
      source: "event_signup",
      email: parsed.data.parent_email,
      phone: parsed.data.parent_phone,
      name: parsed.data.parent_name,
      businessId,
    })

    // SMS consent (Lead Engine Stage 4). AWAITED — NOT fire-and-forget like
    // app/api/events/[id]/signup/route.ts's identical-looking block. That
    // route has real runway after its own consent call (the two email sends
    // via Promise.allSettled) for the write to land on before the response
    // goes out; this route returns its NextResponse on the very next
    // statement with nothing in between. In a serverless runtime, work
    // scheduled after the response is handed back is not guaranteed to run
    // at all — an unawaited write here risks silently dropping a
    // genuinely-granted consent row. Awaiting is still safe for the "a
    // consent failure must never fail the checkout" contract: the `.catch`
    // below means this expression can never reject (`recordEventSignupSmsConsent`
    // itself only ever throws inside; nothing after the `.catch` handler
    // does), so awaiting it just adds real latency before the
    // already-decided response, never a new failure mode.
    if (contactId && parsed.data.parent_phone && parsed.data.sms_consent === true) {
      await recordEventSignupSmsConsent({ contactId, ip: ipAddress, userAgent, businessId }).catch((err) => {
        console.error("[api/events/checkout] sms consent write failed (the signup was saved):", err)
      })
    }

    return NextResponse.json({ sessionUrl: outcome.sessionUrl, signupId: outcome.signupId })
  } catch (err) {
    console.error("[api/events/checkout] unexpected error", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Writes the SMS consent row for a paid event signup whose parent ticked
 * the opt-in box next to the phone field before proceeding to Stripe.
 *
 * The wording is re-rendered HERE, from `business_settings.display_name`
 * through the exact same `renderSmsConsentWording` the modal used to show
 * it — never passed through from the client. MIRRORS THE MODAL'S OWN GATE
 * (`hasSmsConsentDisplayName`): if `display_name` reads back blank here, no
 * row is filed, even though `sms_consent` came in `true`. Skipping is
 * logged, never thrown — the signup and the lead are already saved before
 * this ever runs.
 *
 * A byte-for-byte duplicate of app/api/events/[id]/signup/route.ts's own
 * copy — deliberately, not shared, matching this codebase's existing
 * precedent (app/api/inquiry/route.ts vs. app/api/funnels/submit/route.ts):
 * each route keeps its own small, private, independently-readable helper
 * rather than a shared abstraction with no divergence to justify it yet.
 * Only the CALL SITE diverges from the signup route's (`await` here, not
 * `void` — see the comment above this function's call site above).
 */
async function recordEventSignupSmsConsent(input: {
  contactId: string
  ip: string | null
  userAgent: string | null
  businessId: string
}): Promise<void> {
  const settings = await getBusinessSettings(input.businessId)
  if (!hasSmsConsentDisplayName(settings.display_name)) {
    console.warn("[api/events/checkout] sms consent skipped: business_settings.display_name is blank")
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
    businessId: input.businessId,
  })
}
