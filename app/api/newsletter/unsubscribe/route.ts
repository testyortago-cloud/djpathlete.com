import { NextResponse } from "next/server"
import { rateLimit } from "@/lib/shop/rate-limit"
import { z } from "zod"
import { removeSubscriber } from "@/lib/db/newsletter"
import { findContactByIdentifiers } from "@/lib/db/contacts"
import { revokeEmailConsentForContact } from "@/lib/lead-engine/unsubscribe"
import { resolvePublicTenant } from "@/lib/tenancy/public"
import { withAudit } from "@/lib/audit/with-audit"

const schema = z.object({
  email: z.string().email(),
})

/**
 * The wording this person acted on. Not marketing copy — the unsubscribe page
 * is a single field and a button — so what the consent row records is the ACT,
 * in the plainest terms, rather than a sentence nobody was shown.
 */
const NEWSLETTER_FORM_UNSUBSCRIBE_SENTENCE =
  "Entered this email address on the unsubscribe page and asked to stop receiving email."

export const POST = withAudit({ action: "newsletter.unsubscribed", category: "marketing" }, async (request) => {
  try {
    const body = await request.json()
    const result = schema.safeParse(body)

    if (!result.success) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 })
    }

    const email = result.data.email
    const ip = request.headers.get("x-forwarded-for") ?? "unknown"
    const userAgent = request.headers.get("user-agent")

    // THROTTLED, because this endpoint takes a raw email address with no proof
    // the sender owns it. That was already true — the stage1b design said so in
    // writing (decision 6) when it chose the signed-token flow over extending
    // this route — but until G07 the damage was bounded to a newsletter row. It
    // now revokes consent, suppresses an address and destroys sequence runs, so
    // a script's blast radius is worth bounding. Same helper and shape as
    // /api/shop/leads. A wrongful suppression is still undoable: `unsuppress`
    // exists and the contact screen shows the row.
    const { ok: withinRate } = rateLimit(`newsletter-unsubscribe:${ip}`, 5, 60_000)
    if (!withinRate) {
      return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 })
    }

    // The original job of this route, unchanged and FIRST: the person asked
    // to stop, so the subscriber row is updated whatever happens below.
    await removeSubscriber(email)

    // G07 (ledger 2026-09-19, D17). Until now that was the ONLY write, so
    // the Lead Engine never heard about it: no consent revocation, no
    // suppression, no sequence exit. Someone who unsubscribed here kept
    // receiving sequence email — the one outcome an unsubscribe exists to
    // prevent, from the surface most likely to be used by the people who
    // predate the engine entirely.
    //
    // Deliberately the SAME function the signed-token flow calls, not a
    // second implementation of the four writes. lib/lead-engine/unsubscribe.ts
    // says why in its header: two copies of a revocation flow is how one
    // surface ends up suppressing an address while the other only exits a run.
    //
    // Non-blocking. The subscriber row is already updated, and the person is
    // owed a confirmation, not a 500 that tells them it failed and invites a
    // retry. A fault here leaves them unsubscribed from the newsletter and
    // still in the engine — recoverable, and visible in the log.
    try {
      const businessId = await resolvePublicTenant()
      const contactId = await findContactByIdentifiers({ email, businessId })
      if (contactId) {
        await revokeEmailConsentForContact({
          contactId,
          email,
          businessId,
          origin: "newsletter_form",
          wordingShown: NEWSLETTER_FORM_UNSUBSCRIBE_SENTENCE,
          ip,
          userAgent,
        })
      } else {
        // Not silent. `newsletter_subscribers` is GLOBAL — it has no
        // business_id column at all — so the row above was unsubscribed
        // whatever the Host said. The engine revocation is tenant-scoped, so a
        // subscriber whose contact lives under another business is a no-op
        // here: the exact failure G07 exists to fix, just narrowed. No email in
        // the log.
        console.warn(`[newsletter-unsubscribe] no contact in ${businessId}; engine state unchanged`)
      }
    } catch (err) {
      console.error("[newsletter-unsubscribe] engine revocation failed", (err as Error).message)
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
