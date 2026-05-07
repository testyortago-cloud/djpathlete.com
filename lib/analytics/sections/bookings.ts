// lib/analytics/sections/bookings.ts
import { getBookingsInRange } from "@/lib/db/bookings"
import { listSignupsCreatedSince } from "@/lib/db/event-signups"
import type { DailyBookingsPayload } from "@/types/coach-emails"

interface Options {
  referenceDate: Date
}

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

function endOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(23, 59, 59, 999)
  return out
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}

export async function buildDailyBookings(opts: Options): Promise<DailyBookingsPayload | null> {
  const dayStart = startOfDay(opts.referenceDate)
  const dayEnd = endOfDay(opts.referenceDate)
  const overnightSince = new Date(opts.referenceDate.getTime() - 24 * 60 * 60 * 1000)

  const [bookings, signups] = await Promise.all([
    getBookingsInRange(dayStart, dayEnd),
    listSignupsCreatedSince(overnightSince),
  ])

  const callsToday = bookings
    .slice()
    .sort((a, b) => {
      const aDate = new Date(a.booking_date as unknown as string).getTime()
      const bDate = new Date(b.booking_date as unknown as string).getTime()
      return aDate - bDate
    })
    .map((b) => ({
      time: fmtTime(b.booking_date as unknown as string),
      clientName: ((b as unknown as { client_name?: string }).client_name ?? "Client").trim(),
      type: ((b as unknown as { booking_type?: string }).booking_type ?? "Session").trim(),
    }))

  const newSignupsOvernight = signups.length

  if (callsToday.length === 0 && newSignupsOvernight === 0) {
    return null
  }
  return { callsToday, newSignupsOvernight }
}
