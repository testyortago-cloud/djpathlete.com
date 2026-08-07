import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listTeamMembers } from "@/lib/db/team-members"

/**
 * Owner-only — /api/admin/team is in OWNER_ONLY_PREFIXES, so the middleware
 * refuses staff before this handler runs. The role check stays as the
 * independent second layer.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const members = await listTeamMembers()
    return NextResponse.json({ members })
  } catch (err) {
    console.error("[team-members-list] failed:", err)
    return NextResponse.json({ error: "Failed to load team members" }, { status: 500 })
  }
}
