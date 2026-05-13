import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listByUser } from "@/lib/db/training-sessions"
import { listByUser as listReadiness } from "@/lib/db/daily-readiness"
import { getOpenByUser } from "@/lib/db/risk-flags"
import { dailyLoads, acuteLoad, chronicLoad, acwr } from "@/lib/coach-intel/load"
import { weeklyStats } from "@/lib/coach-intel/monotony"
import { weekOverWeek } from "@/lib/coach-intel/week-over-week"
import { CHRONIC_WINDOW_DAYS } from "@/lib/coach-intel/thresholds"

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const { id } = await params
  const today = new Date().toISOString().slice(0, 10)
  const from = addDays(today, -(CHRONIC_WINDOW_DAYS + 7))

  const [sessions, readiness, openFlags] = await Promise.all([
    listByUser(id, { from, to: today }),
    listReadiness(id, { from, to: today }),
    getOpenByUser(id),
  ])

  const daily = dailyLoads(sessions, from, today)
  const currentWeekStart = addDays(today, -6)
  const week = weeklyStats(daily, currentWeekStart)
  const wow = weekOverWeek(daily, currentWeekStart)

  return NextResponse.json({
    summary: {
      asOf: today,
      acuteLoad: Math.round(acuteLoad(daily, today)),
      chronicLoad: Math.round(chronicLoad(daily, today)),
      acwr: acwr(daily, today),
      weeklyTotal: week.totalLoad,
      monotony: week.monotony,
      strain: week.strain,
      weekOverWeek: wow,
      openFlagCount: openFlags.length,
      openFlags: openFlags.slice(0, 5),
      readingsCount: readiness.length,
    },
  })
}
