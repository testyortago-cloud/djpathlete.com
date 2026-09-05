import { NextResponse } from "next/server"
import { z } from "zod"
import { addSubscriberWithAttribution } from "@/lib/db/newsletter"
import { ghlCreateContact } from "@/lib/ghl"
import { parseAttrCookie } from "@/lib/marketing/cookies"
import { withAudit } from "@/lib/audit/with-audit"
import { captureLead, NEWSLETTER_CONSENT_WORDING } from "@/lib/lead-engine/capture"
import {
  renderNewsletterConsentWording,
  hasNewsletterConsentDisplayName,
} from "@/lib/lead-engine/newsletter-consent-wording"
import { recordConsent } from "@/lib/db/contact-consents"
import { getBusinessSettings } from "@/lib/db/businesses"
import { platformBusinessId } from "@/lib/tenancy/platform"

const newsletterSchema = z.object({
  email: z.string().email("Invalid email address"),
  consent_marketing: z.boolean().optional().default(false),
  source: z.string().max(60).optional(),
  // Which surface this submission came from: NewsletterForm.tsx's required
  // legal checkbox, or InlinePostNewsletterCapture.tsx's plain Subscribe
  // button with no checkbox at all. Absent/unrecognized values fall back to
  // the generic act wording — see resolveNewsletterConsentWording below.
  consent_context: z.enum(["checkbox", "inline"]).optional(),
})

/**
 * Resolves the wording to file on the consent row for this submission.
 * Mirrors recordFunnelSmsConsent's own gate
 * (app/api/funnels/submit/route.ts): the checkbox surface's real legal text
 * is only ever filed when a business name is actually configured to fill
 * it — a template that cannot name the business must not render, so a
 * blank business_settings.display_name falls back to the same generic act
 * wording the inline surface always uses, rather than filing a nameless
 * legal sentence as if it were what the visitor saw.
 */
async function resolveNewsletterConsentWording(
  consentContext: "checkbox" | "inline" | undefined,
  businessId: string,
): Promise<string> {
  if (consentContext !== "checkbox") return NEWSLETTER_CONSENT_WORDING
  const settings = await getBusinessSettings(businessId)
  if (!hasNewsletterConsentDisplayName(settings.display_name)) {
    console.warn("[Newsletter] checkbox consent wording skipped: business_settings.display_name is blank")
    return NEWSLETTER_CONSENT_WORDING
  }
  return renderNewsletterConsentWording(settings.display_name)
}

export const POST = withAudit({ action: "newsletter.subscribed", category: "marketing" }, async (request) => {
  try {
    const body = await request.json().catch(() => null)
    const result = newsletterSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 })
    }

    // PUBLIC ROUTE, NO SESSION TO RESOLVE A TENANT FROM. `platformBusinessId()`
    // is the seam until phase 4 resolves a real business off the Host header
    // (lib/tenancy/platform.ts, CANNOT RESOLVE YET). Resolved once here and
    // threaded; the DAL no longer defaults it.
    const businessId = platformBusinessId()

    const cookieHeader = request.headers.get("cookie")
    const sessionId = parseAttrCookie(cookieHeader) ?? undefined
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null
    const userAgent = request.headers.get("user-agent")

    await addSubscriberWithAttribution({
      email: result.data.email,
      session_id: sessionId,
      consent_marketing: result.data.consent_marketing,
      ip_address: ip,
      user_agent: userAgent,
    })

    // Join the contact spine. captureLead never throws (lib/lead-engine/capture.ts
    // swallows its own errors), so a contact-write failure here can never turn
    // this successful subscribe into an error response. The subscriber is
    // still a contact regardless of whether they consented to marketing, so
    // this always runs.
    const contactId = await captureLead({ source: "newsletter", email: result.data.email, businessId })

    // A consent row is only ever filed for an actual consent act. Not
    // ticking the box (or this submission's schema-defaulted-false absence
    // of the field) is not a consent act — absence of consent is a state,
    // not a bug, and writing `granted: true` for it would be fabricated
    // evidence. The write is the same best-effort deal as captureLead: it
    // depends on a contactId, and its own failure is caught locally so a
    // consent-recording problem cannot turn a successful subscribe into an
    // error response either.
    if (contactId && result.data.consent_marketing === true) {
      try {
        const wordingShown = await resolveNewsletterConsentWording(result.data.consent_context, businessId)
        await recordConsent({
          contactId,
          channel: "email",
          granted: true,
          source: "newsletter",
          wordingShown,
          ip,
          userAgent,
          businessId,
        })
      } catch (consentError) {
        console.error("[Newsletter] consent record failed:", consentError)
      }
    }

    // Fire-and-forget GHL sync
    ghlCreateContact({
      email: result.data.email,
      tags: ["newsletter", ...(result.data.source ? [result.data.source] : [])],
      source: result.data.source ?? "website-newsletter",
    }).catch((error) => console.error("[Newsletter] GHL contact creation failed:", error))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[Newsletter] Subscription failed:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
