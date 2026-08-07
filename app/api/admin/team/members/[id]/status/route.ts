import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getTeamMember, setMemberStatus } from "@/lib/db/team-members"
import { recordAudit } from "@/lib/audit/record"

const bodySchema = z.object({ status: z.enum(["active", "suspended"]) })

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await ctx.params
  const member = await getTeamMember(id)
  if (!member) return NextResponse.json({ error: "Team member not found" }, { status: 404 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 })
  }

  try {
    await setMemberStatus(id, parsed.data.status)
  } catch (err) {
    console.error("[team-member-status] failed:", err)
    return NextResponse.json({ error: "Failed to update status" }, { status: 500 })
  }

  void recordAudit({
    action: "team.member_suspended",
    category: "admin_write",
    outcome: "success",
    target: { type: "user", id, label: member.email },
    metadata: { status: parsed.data.status },
  })

  return NextResponse.json({ ok: true, status: parsed.data.status })
}
