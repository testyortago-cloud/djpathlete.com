import { NextResponse } from "next/server"
import { hash } from "bcryptjs"
import { getInviteByToken, inviteStatus, markInviteUsed } from "@/lib/db/team-invites"
import { getUserByEmail, createUser } from "@/lib/db/users"
import { claimInviteSchema } from "@/lib/validators/team-invite"

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
  const user = await createUser({
    email: invite.email,
    password_hash,
    first_name: parsed.data.firstName,
    last_name: parsed.data.lastName,
    role: invite.role, // 'editor'
  })

  await markInviteUsed(invite.id)

  return NextResponse.json({ user: { id: user.id, email: user.email } }, { status: 201 })
}
