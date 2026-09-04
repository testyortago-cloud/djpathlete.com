import { NextResponse } from "next/server"
import { hash } from "bcryptjs"
import { getInviteByToken, inviteStatus, markInviteUsed } from "@/lib/db/team-invites"
import { getUserByEmail, createUser } from "@/lib/db/users"
import { claimInviteSchema } from "@/lib/validators/team-invite"
import { isPgUniqueViolation } from "@/lib/supabase-errors"
import { roleForPermissions, sanitizePermissionMap } from "@/lib/permissions/registry"
import { addBusinessMember, linkHostToUser, type BusinessMemberRole } from "@/lib/db/business-members"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

export async function POST(
  request: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params

  const invite = await getInviteByToken(token)
  if (!invite) return NextResponse.json({ error: "Invite not found" }, { status: 404 })

  const status = inviteStatus(invite)
  if (status === "accepted") {
    return NextResponse.json({ error: "Invite already used" }, { status: 410 })
  }
  if (status === "expired") {
    return NextResponse.json({ error: "Invite has expired" }, { status: 410 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = claimInviteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const existing = await getUserByEmail(invite.email)
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists. Please sign in instead." },
      { status: 409 },
    )
  }

  const password_hash = await hash(parsed.data.password, 12)

  // Re-sanitized on the way out of the invite: the row was written by a
  // validated route, but the registry may have changed since the invite was
  // sent, and a permission that no longer exists must not be granted.
  const permissions = sanitizePermissionMap(invite.permissions)
  // The role follows what actually survived that sanitizing, not what the
  // invite said when it was written. An invite whose permissions have since
  // been retired would otherwise create a staff account with an empty map,
  // whose every page bounces to /admin/no-access.
  const role = roleForPermissions(permissions)

  let user
  try {
    user = await createUser({
      email: invite.email,
      password_hash,
      first_name: parsed.data.firstName,
      last_name: parsed.data.lastName,
      role,
      permissions,
      staff_role: role === "staff" ? invite.staff_role : null,
    })
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      return NextResponse.json(
        { error: "An account with this email already exists. Please sign in instead." },
        { status: 409 },
      )
    }
    throw err
  }

  // Every teammate gets a membership row, because ABSENCE of one now means "no
  // access" (the compatibility branch in resolveAdminTenant is gone as of
  // migration 00246). A business-scoped invite names its business; a plain
  // /admin/team invite is platform staff on the singleton.
  //
  // THIS RUNS BEFORE markInviteUsed, DELIBERATELY. If addBusinessMember (or
  // linkHostToUser) throws, the invite must still read as pending, not
  // accepted -- marking it used first would leave a real user account with no
  // membership row and no way back in (step 13 removed the singleton
  // fallback, so that account throws NoAccessibleBusinessError on every
  // admin surface), and no UI path to re-run just the membership write. An
  // unused invite at least leaves the door open for someone to intervene by
  // hand rather than for hand-written SQL to be the ONLY fix.
  const membershipBusinessId = invite.business_id ?? SINGLETON_BUSINESS_ID
  const membershipRole = invite.business_id
    ? ((invite.business_role ?? "coach") as BusinessMemberRole)
    : "staff"
  await addBusinessMember(membershipBusinessId, user.id, membershipRole)
  // A coach is the person whose calendar the bookings land on, so their login
  // claims the host row create_business left unowned. Only coaches: a staff
  // member is not a host.
  if (membershipRole === "coach") await linkHostToUser(membershipBusinessId, user.id)

  await markInviteUsed(invite.id)

  return NextResponse.json({ user: { id: user.id, email: user.email } }, { status: 201 })
}
