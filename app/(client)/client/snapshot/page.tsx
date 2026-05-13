import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { listByUser as listTests } from "@/lib/db/performance-tests"
import { listByUser as listSessions } from "@/lib/db/training-sessions"
import { listByUser as listReadiness } from "@/lib/db/daily-readiness"
import { getActive as activeGoals } from "@/lib/db/athlete-goals"
import { dailyLoads } from "@/lib/coach-intel/load"
import { computeBadges } from "@/lib/badges"
import { AthleteRadarCard } from "@/components/client/profile/athlete-radar-card"
import { TrainingStreakHeatmap } from "@/components/client/profile/training-streak-heatmap"
import { BadgeShelfCard } from "@/components/client/profile/badge-shelf-card"
import { OpenGoalsCard } from "@/components/client/profile/open-goals-card"

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const metadata = { title: "Snapshot | DJP Athlete" }

export default async function ClientSnapshotPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login?callbackUrl=/client/snapshot")
  const uid = session.user.id

  const today = new Date().toISOString().slice(0, 10)
  const from = addDays(today, -90)

  const [tests, sessions, readiness, goals] = await Promise.all([
    listTests(uid),
    listSessions(uid, { from, to: today }),
    listReadiness(uid, { from, to: today }),
    activeGoals(uid),
  ])

  const daily = dailyLoads(sessions, from, today)
  const badges = computeBadges({
    asOf: today,
    dailyLoads: daily,
    tests,
    readiness,
    monthlyCompliancePct: null,
  })

  return (
    <div className="container max-w-5xl space-y-6 py-8">
      <h1 className="font-heading text-3xl font-bold">Athlete snapshot</h1>
      <div className="grid gap-6 md:grid-cols-2">
        <AthleteRadarCard tests={tests} />
        <TrainingStreakHeatmap sessions={sessions} />
        <BadgeShelfCard badges={badges} />
        <OpenGoalsCard goals={goals} goalsHref="/client/goals" />
      </div>
    </div>
  )
}
