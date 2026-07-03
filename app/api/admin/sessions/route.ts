import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { recurringSessionsEnabled } from "@/lib/packs/flags"
import { recurringSlotSchema } from "@/lib/validators/sessions"
import { createRecurringSession } from "@/lib/db/recurring-sessions"
import { ensureUpcomingSessions } from "@/lib/services/session-schedule"
import { listScheduledInRange } from "@/lib/db/scheduled-sessions"
import { recordAudit } from "@/lib/audit/record"

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** GET — occurrences in [from,to] (defaults today..+14d). Generates on load. */
export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }
  if (!(await recurringSessionsEnabled())) return NextResponse.json({ error: "Not enabled" }, { status: 403 })

  const url = new URL(request.url)
  const now = new Date()
  const from = url.searchParams.get("from") ?? isoDate(now)
  const to = url.searchParams.get("to") ?? isoDate(new Date(now.getTime() + 14 * 86_400_000))
  await ensureUpcomingSessions(now, 14)
  return NextResponse.json({ sessions: await listScheduledInRange(from, to) })
}

/** POST — create a standing weekly slot for a client. */
export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }
  if (!(await recurringSessionsEnabled())) return NextResponse.json({ error: "Not enabled" }, { status: 403 })

  const parsed = recurringSlotSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid slot", details: parsed.error.flatten().fieldErrors }, { status: 400 })
  }
  const p = parsed.data
  const slot = await createRecurringSession({
    client_user_id: p.clientUserId,
    day_of_week: p.dayOfWeek,
    start_time: p.startTime,
    duration_minutes: p.durationMinutes,
    location: p.location ?? null,
    notes: p.notes ?? null,
    status: "active",
    created_by: session.user.id,
  })
  void recordAudit({
    action: "session.slot_created",
    category: "admin_write",
    outcome: "success",
    target: { type: "recurring_session", id: slot.id },
    metadata: { client_user_id: p.clientUserId, day_of_week: p.dayOfWeek, start_time: p.startTime },
    request,
  })
  return NextResponse.json({ slot }, { status: 201 })
}
