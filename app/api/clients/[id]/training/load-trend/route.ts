import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listByUser } from "@/lib/db/training-sessions"
import { dailyLoads, rollingAverage } from "@/lib/coach-intel/load"
import { ACUTE_WINDOW_DAYS, CHRONIC_WINDOW_DAYS } from "@/lib/coach-intel/thresholds"

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  if (session.user.role !== "admin" && session.user.id !== id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const url = new URL(req.url)
  const days = Math.min(Number(url.searchParams.get("days") ?? 30) || 30, 365)
  const today = new Date().toISOString().slice(0, 10)
  const from = addDays(today, -(days + CHRONIC_WINDOW_DAYS))
  const sessions = await listByUser(id, { from, to: today })
  const daily = dailyLoads(sessions, from, today)
  const acute = rollingAverage(daily, ACUTE_WINDOW_DAYS)
  const chronic = rollingAverage(daily, CHRONIC_WINDOW_DAYS)

  const visibleFrom = addDays(today, -(days - 1))
  const filterFn = <T extends { date: string }>(arr: T[]) =>
    arr.filter((d) => d.date >= visibleFrom)
  return NextResponse.json({
    daily: filterFn(daily),
    acute: filterFn(acute),
    chronic: filterFn(chronic),
  })
}
