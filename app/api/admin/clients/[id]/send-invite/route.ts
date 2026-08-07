import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getUserById } from "@/lib/db/users"
import { createPasswordResetToken } from "@/lib/db/password-reset-tokens"
import { sendLeadInviteEmail } from "@/lib/email"
import { getBaseUrl } from "@/lib/url"
import { canAccessAdminPath } from "@/lib/permissions/guard"

const INVITE_TOKEN_HOURS = 24 * 7

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
  }

  const { id } = await params

  let user
  try {
    user = await getUserById(id)
  } catch {
    return NextResponse.json({ error: "Client not found." }, { status: 404 })
  }

  if (user.status !== "lead") {
    return NextResponse.json(
      { error: "Invites can only be sent to leads. This account is already active." },
      { status: 400 },
    )
  }

  let token: string
  try {
    token = await createPasswordResetToken(user.id, INVITE_TOKEN_HOURS)
  } catch (err) {
    console.error("[lead-invite] failed to create token:", err)
    return NextResponse.json({ error: "Failed to generate invite link." }, { status: 500 })
  }

  const inviteUrl = `${getBaseUrl()}/reset-password?token=${token}`

  try {
    await sendLeadInviteEmail(user.email, inviteUrl, user.first_name)
  } catch (err) {
    console.error("[lead-invite] failed to send email:", err)
    return NextResponse.json({ error: "Failed to send invite email." }, { status: 502 })
  }

  return NextResponse.json({ success: true })
}
