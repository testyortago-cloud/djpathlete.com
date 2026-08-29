import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { endArrangementSchema } from "@/lib/validators/attendance-arrangements"
import { endArrangement } from "@/lib/db/attendance-arrangements"
import { recordAudit } from "@/lib/audit/record"

/**
 * End an arrangement. Past check-ins keep pointing at it, so the history stays
 * readable; the client is freed to take a new arrangement or buy a pack.
 */
export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const parsed = endArrangementSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    // Scoped to status='active' in SQL, so a double-submit ends it once and the
    // second call answers 409 rather than re-stamping ended_on.
    const ended = await endArrangement(parsed.data.arrangementId, new Date().toISOString().slice(0, 10))
    if (!ended) {
      return NextResponse.json({ error: "No active arrangement to end." }, { status: 409 })
    }

    void recordAudit({
      action: "attendance.arrangement_ended",
      category: "admin_write",
      outcome: "success",
      target: { type: "attendance_arrangement", id: ended.id, label: ended.label ?? "arrangement" },
      metadata: { client_user_id: ended.client_user_id, ended_on: ended.ended_on },
      request,
    })

    return NextResponse.json({ arrangement: ended })
  } catch (error) {
    console.error("End arrangement error:", error)
    return NextResponse.json({ error: "Failed to end the arrangement" }, { status: 500 })
  }
}
