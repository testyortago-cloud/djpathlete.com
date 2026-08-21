import { NextResponse } from "next/server"
import { z } from "zod"
import { addSubscriberWithAttribution } from "@/lib/db/newsletter"
import { ghlCreateContact } from "@/lib/ghl"
import { parseAttrCookie } from "@/lib/marketing/cookies"
import { withAudit } from "@/lib/audit/with-audit"
import { captureLead, NEWSLETTER_CONSENT_WORDING } from "@/lib/lead-engine/capture"
import { recordConsent } from "@/lib/db/contact-consents"

const newsletterSchema = z.object({
  email: z.string().email("Invalid email address"),
  consent_marketing: z.boolean().optional().default(false),
  source: z.string().max(60).optional(),
})

export const POST = withAudit({ action: "newsletter.subscribed", category: "marketing" }, async (request) => {
  try {
    const body = await request.json().catch(() => null)
    const result = newsletterSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 })
    }

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
    // this successful subscribe into an error response. The consent row is
    // the same best-effort deal: it depends on captureLead having returned a
    // contactId, and its own failure is caught locally so it cannot either.
    const contactId = await captureLead({ source: "newsletter", email: result.data.email })
    if (contactId) {
      try {
        await recordConsent({
          contactId,
          channel: "email",
          granted: true,
          source: "newsletter",
          wordingShown: NEWSLETTER_CONSENT_WORDING,
          ip,
          userAgent,
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
