import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { startArrangementSchema } from "@/lib/validators/attendance-arrangements"
import {
  createArrangement,
  getActiveArrangementForClient,
} from "@/lib/db/attendance-arrangements"
import { getActivePackageForClient } from "@/lib/db/client-packages"
import { recordAudit } from "@/lib/audit/record"

/**
 * Start an attendance arrangement: this client is coached in person but billed
 * by a partner facility, so there is no pack here and nothing to deduct.
 */
export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const parsed = startArrangementSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }
    const { clientUserId, label, sessionType, notes } = parsed.data

    // The DB's partial unique index would reject this anyway; answering here
    // turns a 500 into a sentence the coach can act on.
    const existing = await getActiveArrangementForClient(clientUserId)
    if (existing) {
      return NextResponse.json(
        { error: "This client already has an active attendance arrangement." },
        { status: 409 },
      )
    }

    // Not a hard block — a client may genuinely move onto an arrangement while
    // an old pack still has credits — but the coach should know the pack will
    // keep burning first, because paid credits take precedence at check-in.
    const activePack = await getActivePackageForClient(clientUserId, new Date().toISOString())

    const arrangement = await createArrangement({
      client_user_id: clientUserId,
      label: label ?? null,
      session_type: sessionType ?? "in_person",
      status: "active",
      started_on: new Date().toISOString().slice(0, 10),
      ended_on: null,
      notes: notes ?? null,
      created_by: session.user.id,
    })

    void recordAudit({
      action: "attendance.arrangement_started",
      category: "admin_write",
      outcome: "success",
      target: { type: "attendance_arrangement", id: arrangement.id, label: arrangement.label ?? "arrangement" },
      metadata: { client_user_id: clientUserId, label: arrangement.label, session_type: arrangement.session_type },
      request,
    })

    return NextResponse.json({
      arrangement,
      warning: activePack
        ? "This client still has an active pack. Its credits will be used before attendance is recorded."
        : null,
    })
  } catch (error) {
    console.error("Start arrangement error:", error)
    return NextResponse.json({ error: "Failed to start the arrangement" }, { status: 500 })
  }
}
