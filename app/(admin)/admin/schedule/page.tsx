import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { recurringSessionsEnabled } from "@/lib/packs/flags"
import { ensureUpcomingSessions } from "@/lib/services/session-schedule"
import { listScheduledInRange } from "@/lib/db/scheduled-sessions"
import { getUsers } from "@/lib/db/users"
import { ScheduleAgenda, type AgendaSession } from "@/components/admin/schedule/ScheduleAgenda"

export const metadata = { title: "Schedule" }

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export default async function SchedulePage() {
  const session = await auth()
  if (session?.user?.role !== "admin") redirect("/login")
  if (!(await recurringSessionsEnabled())) redirect("/admin/dashboard")

  const now = new Date()
  await ensureUpcomingSessions(now, 14)
  const [sessions, users] = await Promise.all([
    listScheduledInRange(isoDate(now), isoDate(new Date(now.getTime() + 14 * 86_400_000))),
    getUsers(),
  ])
  const nameById = new Map(users.map((u) => [u.id, `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || u.email]))
  const agenda: AgendaSession[] = sessions.map((s) => ({ ...s, clientName: nameById.get(s.client_user_id) ?? "Client" }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Schedule</h1>
        <p className="text-sm text-muted-foreground">
          Standing sessions for the next two weeks. Tap Attended / No-show as clients arrive.
        </p>
      </div>
      <ScheduleAgenda sessions={agenda} />
    </div>
  )
}
