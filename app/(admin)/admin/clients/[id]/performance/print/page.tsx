import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getUserById } from "@/lib/db/users"
import { listByUser as listTests, getPRsByUser } from "@/lib/db/performance-tests"
import { listByUser as listGoals } from "@/lib/db/athlete-goals"
import { getLatest, getReadinessTrend } from "@/lib/db/daily-readiness"
import { listByUser as listTrainingSessions } from "@/lib/db/training-sessions"
import { getActive as activeInjuries } from "@/lib/db/injuries"
import { dailyLoads, acwr } from "@/lib/coach-intel/load"
import { weeklyStats } from "@/lib/coach-intel/monotony"
import { CHRONIC_WINDOW_DAYS } from "@/lib/coach-intel/thresholds"
import { TEST_TYPE_LABELS } from "@/lib/validators/performance-test"
import { goalLabel } from "@/lib/goals/format"
import { goalProgressPct, currentGoalValue, latestTestValueByType } from "@/lib/goals/progress"
import { PrintToolbar } from "@/components/admin/performance/print-toolbar"
import type { PerformanceTest, PerformanceTestPR, TestType } from "@/types/database"

export const metadata = { title: "Athlete results | DJP Athlete" }

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function testLabel(t: { test_type: TestType; custom_name: string | null }): string {
  if (t.test_type === "custom") return t.custom_name ?? "Custom test"
  return TEST_TYPE_LABELS[t.test_type] ?? t.test_type
}

// Custom tests all share test_type === "custom"; disambiguate by name like the rest of the app.
function testKey(t: { test_type: TestType; custom_name: string | null }): string {
  return t.test_type === "custom" ? `custom:${t.custom_name ?? ""}` : t.test_type
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="font-heading text-xl font-bold">{value}</p>
    </div>
  )
}

export default async function AthleteResultPrintPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") redirect("/login")
  const { id } = await params

  const today = new Date().toISOString().slice(0, 10)
  const from = addDays(today, -(CHRONIC_WINDOW_DAYS + 7))

  let user: Awaited<ReturnType<typeof getUserById>> | null = null
  try {
    user = await getUserById(id)
  } catch {
    user = null
  }

  const [tests, prs, goals, latestReadiness, readinessTrend, sessions, injuries] = await Promise.all([
    listTests(id),
    getPRsByUser(id),
    listGoals(id),
    getLatest(id),
    getReadinessTrend(id, 30),
    listTrainingSessions(id, { from, to: today }),
    activeInjuries(id),
  ])

  const activeGoals = goals.filter((g) => g.status === "active")

  const daily = dailyLoads(sessions, from, today)
  const currentWeekStart = addDays(today, -6)
  const weeklyTotal = weeklyStats(daily, currentWeekStart).totalLoad
  const acwrVal = acwr(daily, today)

  const metricContext = {
    latestTestValueByType: latestTestValueByType(tests),
    latestReadiness: latestReadiness?.readiness_score ?? null,
    currentWeekLoad: weeklyTotal,
  }

  const avgReadiness = readinessTrend.length
    ? Math.round(readinessTrend.reduce((s, r) => s + r.readiness_score, 0) / readinessTrend.length)
    : null

  // One row per test (custom tests disambiguated by name): latest result + PR.
  const latestByType = new Map<string, PerformanceTest>()
  for (const t of tests) {
    const key = testKey(t)
    if (!latestByType.has(key)) latestByType.set(key, t)
  }
  const prByType = new Map<string, PerformanceTestPR>()
  for (const p of prs) prByType.set(testKey(p), p)
  const typeKeys = Array.from(new Set<string>([...latestByType.keys(), ...prByType.keys()]))

  const athleteName = user ? `${user.first_name} ${user.last_name}`.trim() : "Athlete"

  return (
    <div>
      <PrintToolbar />
      <div className="print-document mx-auto max-w-3xl bg-white text-black">
        <header className="mb-8 border-b pb-4">
          <p className="font-heading text-primary text-sm font-bold uppercase tracking-[0.2em]">
            DJP Athlete
          </p>
          <h1 className="font-heading mt-1 text-3xl font-bold">Athlete results</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {athleteName}
            {user?.email ? ` · ${user.email}` : ""}
          </p>
          <p className="text-muted-foreground text-xs">Generated {today}</p>
        </header>

        <section className="mb-8">
          <h2 className="font-heading mb-3 text-lg font-semibold">Performance tests &amp; PRs</h2>
          {typeKeys.length === 0 ? (
            <p className="text-muted-foreground text-sm">No tests recorded.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-1 pr-4 font-medium">Test</th>
                  <th className="py-1 pr-4 font-medium">Latest</th>
                  <th className="py-1 pr-4 font-medium">PR</th>
                  <th className="py-1 font-medium">Latest date</th>
                </tr>
              </thead>
              <tbody>
                {typeKeys.map((key) => {
                  const latest = latestByType.get(key)
                  const pr = prByType.get(key)
                  const ref = latest ?? pr
                  const label = ref ? testLabel(ref) : key
                  return (
                    <tr key={key} className="border-b">
                      <td className="py-1 pr-4">{label}</td>
                      <td className="py-1 pr-4">
                        {latest ? `${latest.result_value} ${latest.result_unit}` : "—"}
                      </td>
                      <td className="py-1 pr-4">{pr ? `${pr.result_value} ${pr.result_unit}` : "—"}</td>
                      <td className="py-1">{latest?.test_date ?? "—"}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className="mb-8">
          <h2 className="font-heading mb-3 text-lg font-semibold">Goals &amp; progress</h2>
          {activeGoals.length === 0 ? (
            <p className="text-muted-foreground text-sm">No active goals.</p>
          ) : (
            <ul className="space-y-3">
              {activeGoals.map((g) => {
                const current = currentGoalValue(g, metricContext)
                const pct = goalProgressPct(g, current)
                return (
                  <li key={g.id} className="text-sm">
                    <div className="flex justify-between gap-4">
                      <span className="font-medium">{goalLabel(g)}</span>
                      <span>
                        {current !== null ? `${current} / ` : ""}
                        {g.target_value} {g.target_unit}
                      </span>
                    </div>
                    {pct !== null && (
                      <div className="bg-muted mt-1 h-2 overflow-hidden rounded-full">
                        <div className="bg-primary h-full" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="mb-8">
          <h2 className="font-heading mb-3 text-lg font-semibold">Readiness &amp; training load</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Latest readiness"
              value={latestReadiness ? `${latestReadiness.readiness_score}` : "—"}
            />
            <Stat label="30-day avg" value={avgReadiness !== null ? `${avgReadiness}` : "—"} />
            <Stat label="This week load" value={weeklyTotal ? `${Math.round(weeklyTotal)}` : "—"} />
            <Stat label="ACWR" value={acwrVal !== null ? acwrVal.toFixed(2) : "—"} />
          </div>
        </section>

        <section className="mb-8">
          <h2 className="font-heading mb-3 text-lg font-semibold">Injury / body status</h2>
          {injuries.length === 0 ? (
            <p className="text-muted-foreground text-sm">No active injuries.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {injuries.map((inj) => (
                <li key={inj.id}>
                  {inj.body_region} ({inj.side}) — {inj.injury_type}, {inj.severity} · since{" "}
                  {inj.date_occurred}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
