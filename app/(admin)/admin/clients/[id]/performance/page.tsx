import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getLatest, getReadinessTrend } from "@/lib/db/daily-readiness"
import { listByUser, getActive } from "@/lib/db/injuries"
import { getPRsByUser, listByUser as listTests } from "@/lib/db/performance-tests"
import { listByUser as listTrainingSessions } from "@/lib/db/training-sessions"
import { getOpenByUser } from "@/lib/db/risk-flags"
import {
  dailyLoads,
  acuteLoad,
  chronicLoad,
  acwr,
  rollingAverage,
} from "@/lib/coach-intel/load"
import { weeklyStats } from "@/lib/coach-intel/monotony"
import { weekOverWeek } from "@/lib/coach-intel/week-over-week"
import {
  ACUTE_WINDOW_DAYS,
  CHRONIC_WINDOW_DAYS,
} from "@/lib/coach-intel/thresholds"
import { AthletePerformanceHub } from "@/components/admin/performance/athlete-performance-hub"

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export default async function AdminPerformanceHubPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") redirect("/login")
  const { id } = await params
  const { tab = "overview" } = await searchParams

  const today = new Date().toISOString().slice(0, 10)
  const from = addDays(today, -(CHRONIC_WINDOW_DAYS + 7))

  const [
    latestReadiness,
    trend,
    allInjuries,
    activeInjuries,
    prs,
    recentTests,
    trainingSessions,
    openFlags,
  ] = await Promise.all([
    getLatest(id),
    getReadinessTrend(id, 30),
    listByUser(id),
    getActive(id),
    getPRsByUser(id),
    listTests(id).then((t) => t.slice(0, 10)),
    listTrainingSessions(id, { from, to: today }),
    getOpenByUser(id),
  ])

  const daily = dailyLoads(trainingSessions, from, today)
  const acute = rollingAverage(daily, ACUTE_WINDOW_DAYS)
  const chronic = rollingAverage(daily, CHRONIC_WINDOW_DAYS)
  const currentWeekStart = addDays(today, -6)
  const week = weeklyStats(daily, currentWeekStart)
  const wow = weekOverWeek(daily, currentWeekStart)

  const visibleFrom = addDays(today, -29)
  const trimDaily = daily.filter((d) => d.date >= visibleFrom)
  const trimAcute = acute.filter((d) => d.date >= visibleFrom)
  const trimChronic = chronic.filter((d) => d.date >= visibleFrom)

  return (
    <AthletePerformanceHub
      clientUserId={id}
      tab={tab}
      latestReadiness={latestReadiness}
      readinessTrend={trend}
      activeInjuries={activeInjuries}
      allInjuries={allInjuries}
      prs={prs}
      recentTests={recentTests}
      coachIntel={{
        acuteLoad: Math.round(acuteLoad(daily, today)),
        chronicLoad: Math.round(chronicLoad(daily, today)),
        acwr: acwr(daily, today),
        weeklyTotal: week.totalLoad,
        monotony: week.monotony,
        strain: week.strain,
        weekOverWeek: wow,
        dailyLoadSeries: trimDaily,
        acuteSeries: trimAcute,
        chronicSeries: trimChronic,
        openFlags,
      }}
    />
  )
}
