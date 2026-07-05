import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { recurringSessionsEnabled } from "@/lib/packs/flags"
import { recurringSlotUpdateSchema } from "@/lib/validators/sessions"
import { updateRecurringSession, deleteRecurringSession, getRecurringSessionById } from "@/lib/db/recurring-sessions"
import { getAssignmentById } from "@/lib/db/assignments"
import { recordAudit } from "@/lib/audit/record"

async function guard() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") return { error: "Unauthorized", status: 403 as const }
  if (!(await recurringSessionsEnabled())) return { error: "Not enabled", status: 403 as const }
  return { session }
}

/** PATCH — edit or pause a standing slot. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status })
  const { id } = await ctx.params
  const parsed = recurringSlotUpdateSchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: "Invalid update" }, { status: 400 })
  const p = parsed.data
  const patch: Record<string, unknown> = {}
  if (p.dayOfWeek !== undefined) patch.day_of_week = p.dayOfWeek
  if (p.startTime !== undefined) patch.start_time = p.startTime
  if (p.durationMinutes !== undefined) patch.duration_minutes = p.durationMinutes
  if (p.location !== undefined) patch.location = p.location
  if (p.notes !== undefined) patch.notes = p.notes
  if (p.status !== undefined) patch.status = p.status
  if (p.assignmentId !== undefined) {
    if (p.assignmentId === null) {
      patch.assignment_id = null
    } else {
      // Hybrid link: only an assignment belonging to the slot's client may be linked.
      const [slotRow, assignment] = await Promise.all([getRecurringSessionById(id), getAssignmentById(p.assignmentId)])
      if (!slotRow || !assignment || assignment.user_id !== slotRow.client_user_id) {
        return NextResponse.json({ error: "Assignment does not belong to this client" }, { status: 400 })
      }
      patch.assignment_id = p.assignmentId
    }
  }
  const slot = await updateRecurringSession(id, patch)
  void recordAudit({
    action: "session.slot_updated",
    category: "admin_write",
    outcome: "success",
    target: { type: "recurring_session", id },
    request,
  })
  return NextResponse.json({ slot })
}

/** DELETE — remove a standing slot (future generated occurrences keep their own rows). */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status })
  const { id } = await ctx.params
  await deleteRecurringSession(id)
  void recordAudit({
    action: "session.slot_updated",
    category: "admin_write",
    outcome: "success",
    target: { type: "recurring_session", id },
    metadata: { deleted: true },
    request,
  })
  return NextResponse.json({ ok: true })
}
