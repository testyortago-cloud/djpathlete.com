import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  getBusiness,
  updateBusiness,
  getBusinessSettings,
  updateBusinessSettings,
  BusinessSettingsMissingError,
  SmsSenderPhoneTakenError,
} from "@/lib/db/businesses"
import { businessPatchSchema, businessSettingsPatchSchema } from "@/lib/validators/business"
import { resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"
import { recordAudit } from "@/lib/audit/record"
import { listVerifiedSenderDomains, relatedVerifiedDomains, senderDomainVerdict } from "@/lib/email/sender-domains"
import { z } from "zod"

const bodySchema = z.object({
  business: businessPatchSchema.optional(),
  settings: businessSettingsPatchSchema.optional(),
})

export async function PATCH(request: Request, ctx: { params: Promise<Record<string, string>> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await ctx.params

  // The allowed set can come back empty (e.g. a coach whose only membership
  // points at a business that was since paused) -- resolveAdminTenantForRequest
  // throws rather than inventing an id, and that is a 403, not a 500.
  let tenant
  try {
    tenant = await resolveAdminTenantForRequest(request)
  } catch (err) {
    if (err instanceof NoAccessibleBusinessError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    throw err
  }

  // THE ID IN THE URL IS CALLER-CONTROLLED. The operator may patch any
  // business; anyone else may patch only one inside their own allowed set.
  // Without this, a coach could rewrite another coach's sending identity by
  // typing a different id.
  const permitted = tenant.isOperator || tenant.choices.some((c) => c.id === id)
  if (!permitted) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the form", issues: parsed.error.issues }, { status: 400 })
  }

  // businessSettingsPatchSchema's sender_email rule checks FORMAT only ("is
  // this an email address"), not who Resend has verified -- so without this,
  // the 2026-08-31 fault (sender_email on the unverified apex darrenjpaul.com
  // instead of the verified subdomain, 73 sequence sends dropped)
  // can be typed straight back in through this route. Checked before any
  // write (business or settings) so a rejected sender email leaves the whole
  // patch un-applied rather than partially saved. "" (clearing the field) is
  // exempt -- there is no domain to check, and refusing it would make the
  // field unable to be blanked out.
  const senderEmail = parsed.data.settings?.sender_email
  if (senderEmail) {
    const verified = await listVerifiedSenderDomains()
    if (!verified.ok) {
      return NextResponse.json(
        {
          error:
            verified.reason === "no_api_key"
              ? "Email sending is not configured on this server, so the sender domain cannot be checked. The sender email was not changed."
              : "Could not confirm the sender domain with Resend just now. Try again in a minute. The sender email was not changed.",
        },
        { status: 400 },
      )
    }
    const verdict = senderDomainVerdict(senderEmail, verified.domains)
    if (!verdict.ok) {
      // NAMES ONLY WHAT THEY MEANT, NEVER THE ACCOUNT. This used to render
      // `verified.domains.join(", ")` -- the WHOLE verified list -- and Resend
      // domains are account-wide, so it showed one coach every other coach's
      // sending domains. `relatedVerifiedDomains` narrows that to the
      // subdomain/apex of the address actually typed, which is the only part
      // that was ever useful (and is exactly the 08-31 shape: apex typed in
      // where the subdomain is verified).
      const meant = relatedVerifiedDomains(verdict.domain, verified.domains)
      return NextResponse.json(
        {
          error:
            meant.length > 0
              ? `${verdict.domain} is not verified at Resend, so email sent from it would be dropped. Use an address on ${meant.join(" or ")} instead.`
              : `${verdict.domain} is not verified at Resend, so email sent from it would be dropped. Verify that domain at Resend first, or use an address on a domain that is already set up for this business.`,
        },
        { status: 400 },
      )
    }
  }

  let business = await getBusiness(id)
  if (!business) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (parsed.data.business && Object.keys(parsed.data.business).length > 0) {
    business = await updateBusiness(id, parsed.data.business)
    await recordAudit({
      action: "business.updated",
      category: "admin_write",
      outcome: "success",
      target: { type: "business", id, label: business.name },
      metadata: { patch: parsed.data.business },
      request,
    })
  }

  // create_business always writes the settings row; a business without one
  // can only exist if it was created outside that function. Either way, a
  // missing row is a 404, not a 500.
  let settings
  try {
    settings = await getBusinessSettings(id)
  } catch (err) {
    if (err instanceof BusinessSettingsMissingError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    throw err
  }
  if (parsed.data.settings && Object.keys(parsed.data.settings).length > 0) {
    // Field names only -- sender_email and sms_messaging_service_sid are
    // identity configuration, and the metadata scrubber does not cover them
    // by name. The values themselves never go into the audit row.
    try {
      settings = await updateBusinessSettings(parsed.data.settings, id)
    } catch (err) {
      // Reachable more often since G33 saves E.164: "+1 202 555 0123" and
      // "+12025550123" used to be two different strings to 00247's index.
      if (err instanceof SmsSenderPhoneTakenError) {
        return NextResponse.json(
          {
            error:
              "That sender phone number is already used by another business. Each business needs its own number. Nothing was saved.",
          },
          { status: 409 },
        )
      }
      throw err
    }
    await recordAudit({
      action: "business.settings_updated",
      category: "admin_write",
      outcome: "success",
      target: { type: "business", id, label: business.name },
      metadata: { fields: Object.keys(parsed.data.settings) },
      request,
    })
  }

  return NextResponse.json({ business, settings })
}
