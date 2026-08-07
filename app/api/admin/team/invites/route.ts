import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createInvite, listInvites } from "@/lib/db/team-invites"
import { sendTeamInviteEmail } from "@/lib/email"
import { isPgUniqueViolation } from "@/lib/supabase-errors"
import { getBaseUrl } from "@/lib/url"
import { sendInviteSchema } from "@/lib/validators/team-invite"
import { recordAudit } from "@/lib/audit/record"

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = sendInviteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  let invite
  try {
    invite = await createInvite({
      email: parsed.data.email,
      invitedBy: session.user.id,
      permissions: parsed.data.permissions,
      staffRole: parsed.data.staffRole ?? null,
    })
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      return NextResponse.json(
        { error: "An open invite already exists for this email." },
        { status: 409 },
      )
    }
    console.error("[invite-create] failed:", err)
    return NextResponse.json({ error: "Failed to create invite" }, { status: 500 })
  }

  // Fire-and-forget email; we surface a 201 even if email transport blips.
  try {
    const inviteUrl = `${getBaseUrl()}/invite/${invite.token}`
    await sendTeamInviteEmail({
      to: invite.email,
      inviteUrl,
      inviterName: session.user.name ?? "Darren Paul",
      expiresAt: invite.expires_at,
    })
  } catch (err) {
    console.error("[invite-email] failed:", err)
  }

  void recordAudit({
    action: "team.invite_sent",
    category: "admin_write",
    outcome: "success",
    target: { type: "team_invite", id: invite.id, label: invite.email },
    metadata: {
      role: invite.role,
      staff_role: invite.staff_role,
      permissions: invite.permissions,
    },
  })

  return NextResponse.json({ invite }, { status: 201 })
}

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  try {
    const invites = await listInvites()
    return NextResponse.json({ invites })
  } catch (err) {
    console.error("[invite-list] failed:", err)
    return NextResponse.json({ error: "Failed to load invites" }, { status: 500 })
  }
}
