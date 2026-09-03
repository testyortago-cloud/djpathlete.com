import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  getBusiness, updateBusiness, getBusinessSettings, updateBusinessSettings, BusinessSettingsMissingError,
} from "@/lib/db/businesses"
import { businessPatchSchema, businessSettingsPatchSchema } from "@/lib/validators/business"
import { resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"
import { recordAudit } from "@/lib/audit/record"
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
    settings = await updateBusinessSettings(parsed.data.settings, id)
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
