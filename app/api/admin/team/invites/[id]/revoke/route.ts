import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getInviteById, revokeInvite } from "@/lib/db/team-invites"

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await ctx.params
  const invite = await getInviteById(id)
  if (!invite) return NextResponse.json({ error: "Invite not found" }, { status: 404 })

  await revokeInvite(id)
  return NextResponse.json({ ok: true })
}
