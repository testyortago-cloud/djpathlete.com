import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getTeamMember, updateMemberPermissions } from "@/lib/db/team-members"
import { updateMemberPermissionsSchema } from "@/lib/validators/team-invite"
import { recordAudit } from "@/lib/audit/record"

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

  // The schema rejects rather than sanitizes, so a typo'd or owner-only key is
  // reported back instead of quietly vanishing from what the UI just showed.
  const parsed = updateMemberPermissionsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid permissions", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  let updated
  try {
    updated = await updateMemberPermissions(id, parsed.data.permissions, parsed.data.staffRole ?? null)
  } catch (err) {
    console.error("[team-member-permissions] failed:", err)
    return NextResponse.json({ error: "Failed to update permissions" }, { status: 500 })
  }

  // Before/after so the trail can answer "who could see the books in March".
  // The role rides along because this edit is what moves someone between the
  // admin panel and the editor portal — the single most consequential thing
  // this endpoint can do, and not something a permission diff alone shows.
  void recordAudit({
    action: "team.member_permissions_changed",
    category: "admin_write",
    outcome: "success",
    target: { type: "user", id, label: member.email },
    metadata: {
      before: member.permissions,
      after: parsed.data.permissions,
      staff_role: parsed.data.staffRole ?? null,
      before_role: member.role,
      after_role: updated.role,
    },
  })

  return NextResponse.json({ ok: true, permissions: parsed.data.permissions, role: updated.role })
}
