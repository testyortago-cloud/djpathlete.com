// Recurring in-person session scheduling. Pure helpers live at the top (unit
// tested, no DB, no Date.now()); orchestration that touches DALs follows.
// Naive session_date + start_time are interpreted as UTC for the no-show
// comparison — the buffer absorbs the resulting slack.
import { listActiveRecurringSessions } from "@/lib/db/recurring-sessions"
import {
  upsertScheduledSession,
  updateScheduledSession,
  getScheduledById,
  findScheduledForClientOnDate,
} from "@/lib/db/scheduled-sessions"
import { recurringSessionsEnabled } from "@/lib/packs/flags"

const DAY_MS = 86_400_000

/** ISO (YYYY-MM-DD) dates in [from, to] inclusive whose UTC weekday matches. */
export function datesForSlot(slot: { day_of_week: number }, from: Date, to: Date): string[] {
  const out: string[] = []
  // Normalize to UTC midnight so DST/time-of-day can't skip or double a day.
  let d = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
  for (; d <= end; d += DAY_MS) {
    const day = new Date(d)
    if (day.getUTCDay() === slot.day_of_week) out.push(day.toISOString().slice(0, 10))
  }
  return out
}

export interface ScanSession {
  id: string
  session_date: string
  start_time: string
  duration_minutes: number
  status: string
}

/** Ids of still-`scheduled` sessions whose end time + buffer is already past. */
export function scanNoShows(sessions: ScanSession[], now: Date, bufferMinutes: number): string[] {
  const cutoff = now.getTime()
  const out: string[] = []
  for (const s of sessions) {
    if (s.status !== "scheduled") continue
    const start = new Date(`${s.session_date}T${s.start_time}Z`).getTime()
    if (Number.isNaN(start)) continue
    const overAt = start + (s.duration_minutes + bufferMinutes) * 60_000
    if (overAt < cutoff) out.push(s.id)
  }
  return out
}

// ─── Orchestration (DALs + the pure helpers above) ───────────────────────────

/**
 * Idempotently ensure a `scheduled_sessions` row exists for every active slot
 * on each of its matching weekdays within [now, now+horizonDays]. Safe to run
 * repeatedly (unique index makes the upsert a no-op). Returns the count touched.
 */
export async function ensureUpcomingSessions(now: Date, horizonDays = 14): Promise<number> {
  const to = new Date(now.getTime() + horizonDays * DAY_MS)
  const slots = await listActiveRecurringSessions()
  let touched = 0
  for (const slot of slots) {
    for (const date of datesForSlot(slot, now, to)) {
      await upsertScheduledSession({
        client_user_id: slot.client_user_id,
        recurring_session_id: slot.id,
        session_date: date,
        start_time: slot.start_time,
        duration_minutes: slot.duration_minutes,
        status: "scheduled",
        attended_at: null,
        checkin_id: null,
        cancelled_at: null,
        cancel_reason: null,
        notes: null,
        created_by: null,
      })
      touched++
    }
  }
  return touched
}

export async function markAttended(id: string, opts: { by: string | null; checkinId?: string | null }) {
  return updateScheduledSession(id, {
    status: "attended",
    attended_at: new Date().toISOString(),
    checkin_id: opts.checkinId ?? null,
  })
}

export async function markNoShow(id: string, _by: string | null) {
  return updateScheduledSession(id, { status: "no_show" })
}

/** Cancel an occurrence. `now` is accepted for the late-cancel fee window (phase D). */
export async function cancelSession(id: string, opts: { by: string | null; reason: string | null; now?: Date }) {
  const existing = await getScheduledById(id)
  const updated = await updateScheduledSession(id, {
    status: "cancelled",
    cancelled_at: (opts.now ?? new Date()).toISOString(),
    cancel_reason: opts.reason,
  })
  // Phase D wires the late-cancel fee here (guarded by flag + config + saved card).
  void existing
  return updated
}

export async function rescheduleSession(id: string, opts: { date: string; time: string }) {
  return updateScheduledSession(id, { session_date: opts.date, start_time: opts.time })
}

export async function reassignSession(id: string, newClientUserId: string) {
  return updateScheduledSession(id, { client_user_id: newClientUserId })
}

export async function addAdhocSession(input: {
  client_user_id: string
  session_date: string
  start_time: string
  duration_minutes: number
  created_by: string | null
  notes?: string | null
}) {
  return upsertScheduledSession({
    client_user_id: input.client_user_id,
    recurring_session_id: null,
    session_date: input.session_date,
    start_time: input.start_time,
    duration_minutes: input.duration_minutes,
    status: "scheduled",
    attended_at: null,
    checkin_id: null,
    cancelled_at: null,
    cancel_reason: null,
    notes: input.notes ?? null,
    created_by: input.created_by,
  })
}

/**
 * Best-effort bridge: after a client checks in (any method), mark today's
 * scheduled session attended and link the check-in. Flag-gated and fully
 * swallowed — a scheduling failure must never affect the check-in itself.
 */
export async function bridgeCheckinToSchedule(
  clientUserId: string,
  checkinId: string | null,
  now: Date,
): Promise<void> {
  try {
    if (!(await recurringSessionsEnabled())) return
    const date = now.toISOString().slice(0, 10)
    const session = await findScheduledForClientOnDate(clientUserId, date)
    if (!session) return
    await markAttended(session.id, { by: null, checkinId })
  } catch (err) {
    console.error("[bridgeCheckinToSchedule] failed:", err)
  }
}
