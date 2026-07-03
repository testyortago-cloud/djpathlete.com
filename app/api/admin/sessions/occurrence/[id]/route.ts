import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { recurringSessionsEnabled } from "@/lib/packs/flags"
import { scheduledMutationSchema } from "@/lib/validators/sessions"
import {
  markAttended,
  markNoShow,
  cancelSession,
  rescheduleSession,
  reassignSession,
} from "@/lib/services/session-schedule"
import { recordAudit } from "@/lib/audit/record"
import type { AuditAction } from "@/lib/audit/actions"

/** PATCH — one action against a concrete occurrence (attended/no_show/cancel/reschedule/reassign). */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }
  if (!(await recurringSessionsEnabled())) return NextResponse.json({ error: "Not enabled" }, { status: 403 })

  const { id } = await ctx.params
  const parsed = scheduledMutationSchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  const m = parsed.data
  const by = session.user.id

  let action: AuditAction = "session.rescheduled"
  switch (m.action) {
    case "attended":
      await markAttended(id, { by })
      action = "session.attended"
      break
    case "no_show":
      await markNoShow(id, by)
      action = "session.no_show"
      break
    case "cancel":
      await cancelSession(id, { by, reason: m.reason ?? null, now: new Date() })
      action = "session.cancelled"
      break
    case "reschedule":
      await rescheduleSession(id, { date: m.date, time: m.time })
      action = "session.rescheduled"
      break
    case "reassign":
      await reassignSession(id, m.clientUserId)
      action = "session.rescheduled"
      break
  }

  void recordAudit({
    action,
    category: action === "session.rescheduled" ? "admin_write" : "client_action",
    outcome: "success",
    target: { type: "scheduled_session", id },
    metadata: { action: m.action },
    request,
  })
  return NextResponse.json({ ok: true })
}
