import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { recurringSessionsEnabled } from "@/lib/packs/flags"
import { ensureUpcomingSessions } from "@/lib/services/session-schedule"
import { listScheduledInRange } from "@/lib/db/scheduled-sessions"
import { getUsers } from "@/lib/db/users"
import { calendarRange, type ScheduleView } from "@/lib/schedule-calendar"
import { ScheduleAgenda } from "@/components/admin/schedule/ScheduleAgenda"
import { ScheduleToolbar } from "@/components/admin/schedule/ScheduleToolbar"
import { ScheduleWeekGrid } from "@/components/admin/schedule/ScheduleWeekGrid"
import { ScheduleMonthGrid } from "@/components/admin/schedule/ScheduleMonthGrid"
import type { CalendarSession } from "@/components/admin/schedule/SessionChip"

export const metadata = { title: "Schedule" }

const DAY_MS = 86_400_000
const MAX_GENERATION_DAYS = 62

function parseView(v: string | undefined): ScheduleView {
  return v === "month" || v === "week" ? v : "list"
}

function parseAnchor(a: string | undefined, fallback: string): string {
  return a && /^\d{4}-\d{2}-\d{2}$/.test(a) ? a : fallback
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; anchor?: string }>
}) {
  const session = await auth()
  if (session?.user?.role !== "admin") redirect("/login")
  if (!(await recurringSessionsEnabled())) redirect("/admin/dashboard")

  const params = await searchParams
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const view = parseView(params.view)
  const anchor = parseAnchor(params.anchor, today)
  const range = calendarRange(view, anchor)

  // Generate occurrences up to the visible range end (capped); past ranges
  // need no generation — they only show what was recorded.
  const horizonDays = Math.min(
    Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS),
    MAX_GENERATION_DAYS,
  )
  if (horizonDays > 0) await ensureUpcomingSessions(now, horizonDays)

  const [sessions, users] = await Promise.all([listScheduledInRange(range.from, range.to), getUsers()])
  const nameById = new Map(users.map((u) => [u.id, `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || u.email]))
  const enriched: CalendarSession[] = sessions.map((s) => ({
    ...s,
    clientName: nameById.get(s.client_user_id) ?? "Client",
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Schedule</h1>
        <p className="text-sm text-muted-foreground">
          Standing and one-off sessions. Tap a session to mark it Attended / No-show or cancel it.
        </p>
      </div>
      <ScheduleToolbar view={view} anchor={anchor} today={today} />
      {view === "month" ? (
        <ScheduleMonthGrid anchor={anchor} sessions={enriched} today={today} />
      ) : view === "week" ? (
        <ScheduleWeekGrid anchor={anchor} sessions={enriched} today={today} />
      ) : (
        <ScheduleAgenda sessions={enriched} />
      )}
    </div>
  )
}
