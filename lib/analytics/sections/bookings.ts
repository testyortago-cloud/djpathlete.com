// lib/analytics/sections/bookings.ts
import { getBookingsInRange } from "@/lib/db/bookings"
import { listSignupsCreatedSince } from "@/lib/db/event-signups"
import type { DailyBookingsPayload } from "@/types/coach-emails"

interface Options {
  referenceDate: Date
  businessId: string
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

  // BOTH arms read under opts.businessId (G35). The booking arm used to read
  // every business's rows while the signup arm beside it was scoped, so this
  // section listed every business's calls, by the booker's name, next to the
  // platform's own signup count. The caller (lib/analytics/daily-pulse.ts)
  // passes the platform's own business: the Daily Brief is the platform
  // coach's digest, not a per-business email.
  const [bookings, signups] = await Promise.all([
    getBookingsInRange(opts.businessId, dayStart, dayEnd),
    listSignupsCreatedSince(opts.businessId, overnightSince),
  ])

  const callsToday = bookings
    .slice()
    .sort((a, b) => {
      const aDate = new Date(a.booking_date).getTime()
      const bDate = new Date(b.booking_date).getTime()
      return aDate - bDate
    })
    .map((b) => ({
      time: fmtTime(b.booking_date),
      clientName: b.contact_name.trim(),
      type: `${b.duration_minutes} min`,
    }))

  const newSignupsOvernight = signups.length

  if (callsToday.length === 0 && newSignupsOvernight === 0) {
    return null
  }
  return { callsToday, newSignupsOvernight }
}
