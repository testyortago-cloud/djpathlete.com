import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createBusiness, SlugTakenError } from "@/lib/db/businesses"
import { businessCreateSchema } from "@/lib/validators/business"
import { resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"
import { recordAudit } from "@/lib/audit/record"

export async function POST(request: Request, _ctx: { params: Promise<Record<string, string>> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Creating a tenant is the operator's job. isOperator comes from the
  // session's role, never from the request. The allowed set can also come
  // back empty (e.g. a coach whose only membership points at a business that
  // was since paused) -- resolveAdminTenantForRequest throws rather than
  // inventing an id, and a caller with no accessible business is refused
  // exactly like a non-operator: 403, not a 500.
  let tenant
  try {
    tenant = await resolveAdminTenantForRequest(request)
  } catch (err) {
    if (err instanceof NoAccessibleBusinessError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    throw err
  }
  if (!tenant.isOperator) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const parsed = businessCreateSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the form", issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const business = await createBusiness({
      ...parsed.data,
      // From the SESSION. A createdBy in the body would let the operator
      // attribute a tenant to someone else.
      createdBy: session.user.id,
    })
    await recordAudit({
      action: "business.created",
      category: "admin_write",
      outcome: "success",
      target: { type: "business", id: business.id, label: business.name },
      metadata: { slug: business.slug },
    })
    return NextResponse.json({ business }, { status: 201 })
  } catch (err) {
    if (err instanceof SlugTakenError) {
      return NextResponse.json({ error: err.message, field: "slug" }, { status: 409 })
    }
    throw err
  }
}
