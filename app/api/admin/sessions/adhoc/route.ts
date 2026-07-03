import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { recurringSessionsEnabled } from "@/lib/packs/flags"
import { adhocSessionSchema } from "@/lib/validators/sessions"
import { addAdhocSession } from "@/lib/services/session-schedule"
import { recordAudit } from "@/lib/audit/record"

/** POST — add a one-off (non-recurring) scheduled session. */
export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }
  if (!(await recurringSessionsEnabled())) return NextResponse.json({ error: "Not enabled" }, { status: 403 })

  const parsed = adhocSessionSchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: "Invalid session" }, { status: 400 })
  const p = parsed.data
  const created = await addAdhocSession({
    client_user_id: p.clientUserId,
    session_date: p.date,
    start_time: p.time,
    duration_minutes: p.durationMinutes,
    notes: p.notes ?? null,
    created_by: session.user.id,
  })
  void recordAudit({
    action: "session.slot_created",
    category: "admin_write",
    outcome: "success",
    target: { type: "scheduled_session", id: created?.id ?? null },
    metadata: { adhoc: true, client_user_id: p.clientUserId, date: p.date },
    request,
  })
  return NextResponse.json({ session: created }, { status: 201 })
}
