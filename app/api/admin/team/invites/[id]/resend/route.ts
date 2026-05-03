import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getInviteById, rotateInviteToken } from "@/lib/db/team-invites"
import { sendTeamInviteEmail } from "@/lib/email"

function getBaseUrl() {
  return process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await ctx.params
  const invite = await getInviteById(id)
  if (!invite) return NextResponse.json({ error: "Invite not found" }, { status: 404 })
  if (invite.used_at) {
    return NextResponse.json({ error: "Invite already accepted" }, { status: 409 })
  }

  const { token, expiresAt } = await rotateInviteToken(id)
  const inviteUrl = `${getBaseUrl()}/invite/${token}`
  try {
    await sendTeamInviteEmail({
      to: invite.email,
      inviteUrl,
      inviterName: session.user.name ?? "Darren Paul",
      expiresAt,
    })
  } catch (err) {
    console.error("[invite-resend] email failed:", err)
  }
  return NextResponse.json({ ok: true })
}
