import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getBusiness } from "@/lib/db/businesses"
import { createInvite } from "@/lib/db/team-invites"
import { removeBusinessMember, countBusinessMembers } from "@/lib/db/business-members"
import { businessMemberInviteSchema, businessMemberRemoveSchema } from "@/lib/validators/business"
import { resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"
import { recordAudit } from "@/lib/audit/record"
import { isPgUniqueViolation } from "@/lib/supabase-errors"

/**
 * Same allowed-set check every /api/admin/businesses/[id]/* route runs (Task
 * 5's [id]/route.ts): the operator may act on any business, anyone else only
 * inside their own allowed set, and the id in the URL is caller-controlled --
 * without this a coach could invite (or remove) someone into a business that
 * isn't theirs by typing a different id.
 */
async function checkPermitted(request: Request, id: string) {
  const session = await auth()
  if (!session?.user?.id) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

  let tenant
  try {
    tenant = await resolveAdminTenantForRequest(request)
  } catch (err) {
    if (err instanceof NoAccessibleBusinessError) {
      return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
    }
    throw err
  }

  const permitted = tenant.isOperator || tenant.choices.some((c) => c.id === id)
  if (!permitted) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }

  return { session }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const check = await checkPermitted(request, id)
  if (check.error) return check.error
  const { session } = check

  const business = await getBusiness(id)
  if (!business) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const parsed = businessMemberInviteSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the form", issues: parsed.error.issues }, { status: 400 })
  }

  let invite
  try {
    invite = await createInvite({
      email: parsed.data.email,
      invitedBy: session!.user.id,
      permissions: parsed.data.permissions,
      businessId: id,
      businessRole: parsed.data.businessRole,
    })
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      return NextResponse.json({ error: "An open invite already exists for this email." }, { status: 409 })
    }
    throw err
  }

  await recordAudit({
    action: "business.member_invited",
    category: "admin_write",
    outcome: "success",
    target: { type: "business", id, label: business.name },
    metadata: { email: invite.email, business_role: invite.business_role },
    request,
  })

  // The token so the operator can copy the link -- the same thing
  // /api/admin/team/invites already returns. Email delivery here would be a
  // second thing that can silently fail; the link works whether or not it does.
  return NextResponse.json({ invite }, { status: 201 })
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const check = await checkPermitted(request, id)
  if (check.error) return check.error

  const business = await getBusiness(id)
  if (!business) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const parsed = businessMemberRemoveSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the request", issues: parsed.error.issues }, { status: 400 })
  }

  // Refuse to empty a business's member list. Without a real membership row
  // left, its own coach resolves NoAccessibleBusinessError on every admin
  // surface (step 13 removed the singleton fallback) with hand-written SQL
  // as the only way back in.
  const memberCount = await countBusinessMembers(id)
  if (memberCount <= 1) {
    return NextResponse.json(
      { error: "This is the only person left on this business — add someone else before removing them." },
      { status: 409 },
    )
  }

  // Deletes the membership row only -- NEVER the user, who may belong to
  // another business (or be the operator's own admin account).
  await removeBusinessMember(id, parsed.data.userId)

  await recordAudit({
    action: "business.member_removed",
    category: "admin_write",
    outcome: "success",
    target: { type: "business", id, label: business.name },
    metadata: { user_id: parsed.data.userId },
    request,
  })

  return NextResponse.json({ ok: true })
}
