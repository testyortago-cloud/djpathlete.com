import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createInvite, listInvites } from "@/lib/db/team-invites"
import { sendTeamInviteEmail } from "@/lib/email"
import { sendInviteSchema } from "@/lib/validators/team-invite"

function getBaseUrl() {
  return process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
}

function isPgUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  )
}

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
      role: parsed.data.role,
      invitedBy: session.user.id,
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
  const invites = await listInvites()
  return NextResponse.json({ invites })
}
