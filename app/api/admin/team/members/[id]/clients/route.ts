import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getTeamMember, listAssignedClientIds, setAssignedClients } from "@/lib/db/team-members"
import { assignClientsSchema } from "@/lib/validators/team-invite"
import { recordAudit } from "@/lib/audit/record"

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await ctx.params
  try {
    return NextResponse.json({ clientIds: await listAssignedClientIds(id) })
  } catch (err) {
    console.error("[team-member-clients-list] failed:", err)
    return NextResponse.json({ error: "Failed to load assignments" }, { status: 500 })
  }
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
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

  const parsed = assignClientsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const before = await listAssignedClientIds(id)

  try {
    await setAssignedClients(id, parsed.data.clientIds, session.user.id)
  } catch (err) {
    console.error("[team-member-clients-set] failed:", err)
    return NextResponse.json({ error: "Failed to update assignments" }, { status: 500 })
  }

  void recordAudit({
    action: "team.client_assignments_changed",
    category: "admin_write",
    outcome: "success",
    target: { type: "user", id, label: member.email },
    metadata: {
      before_count: before.length,
      after_count: parsed.data.clientIds.length,
      added: parsed.data.clientIds.filter((c) => !before.includes(c)),
      removed: before.filter((c) => !parsed.data.clientIds.includes(c)),
    },
  })

  return NextResponse.json({ ok: true, clientIds: parsed.data.clientIds })
}
