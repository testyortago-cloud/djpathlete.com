import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { listByUser } from "@/lib/db/athlete-goals"
import { listByUser as listTests } from "@/lib/db/performance-tests"
import { getLatest as getLatestReadiness } from "@/lib/db/daily-readiness"
import { listByUser as listSessions } from "@/lib/db/training-sessions"
import { dailyLoads } from "@/lib/coach-intel/load"
import { weeklyStats } from "@/lib/coach-intel/monotony"
import { latestTestValueByType, type GoalMetricContext } from "@/lib/goals/progress"
import { LogGoalForm } from "@/components/client/profile/log-goal-form"
import { GoalsList } from "@/components/client/profile/goals-list"

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export default async function ClientGoalsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login?callbackUrl=/client/goals")
  const uid = session.user.id

  const today = new Date().toISOString().slice(0, 10)
  const from = addDays(today, -13)

  const [goals, tests, latestReadiness, sessions] = await Promise.all([
    listByUser(uid),
    listTests(uid),
    getLatestReadiness(uid),
    listSessions(uid, { from, to: today }),
  ])

  const daily = dailyLoads(sessions, from, today)
  const currentWeekStart = addDays(today, -6)
  const metricContext: GoalMetricContext = {
    latestTestValueByType: latestTestValueByType(tests),
    latestReadiness: latestReadiness?.readiness_score ?? null,
    currentWeekLoad: weeklyStats(daily, currentWeekStart).totalLoad,
  }

  return (
    <div className="container max-w-3xl space-y-8 py-8">
      <h1 className="font-heading text-3xl font-bold">Goals</h1>
      <section>
        <h2 className="font-heading mb-4 text-xl font-semibold">All goals</h2>
        <GoalsList goals={goals} metricContext={metricContext} />
      </section>
      <section>
        <h2 className="font-heading mb-4 text-xl font-semibold">Add a new goal</h2>
        <LogGoalForm />
      </section>
    </div>
  )
}
