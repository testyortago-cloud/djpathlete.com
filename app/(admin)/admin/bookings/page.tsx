import Link from "next/link"
import { Calendar, CalendarCog, Clock, CheckCircle2, XCircle, AlertTriangle } from "lucide-react"
import { getBookings, getBookingStats } from "@/lib/db/bookings"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { BookingList } from "@/components/admin/BookingList"

export const dynamic = "force-dynamic"
export const metadata = { title: "Bookings" }

export default async function BookingsPage() {
  const { businessId } = await resolveAdminTenant()
  const [bookings, stats] = await Promise.all([getBookings(businessId), getBookingStats(businessId)])

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-primary">Bookings</h1>
        {/* The screen a coach connects their own Calendly from. Same `schedule`
            permission as this page, so everyone who can read bookings can reach it. */}
        <Link
          href="/admin/bookings/calendar"
          className="inline-flex items-center gap-2 rounded-md border border-border bg-white px-3 py-2 text-sm font-medium text-primary shadow-sm transition-colors hover:bg-surface/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <CalendarCog className="size-4" />
          Your calendar
        </Link>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4">
          <div className="flex items-center gap-2 sm:gap-3 mb-1.5">
            <div className="flex size-8 sm:size-9 items-center justify-center rounded-lg bg-primary/10">
              <Calendar className="size-3.5 sm:size-4 text-primary" />
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">Upcoming</p>
          </div>
          <p className="text-xl sm:text-2xl font-semibold text-primary">{stats.upcoming}</p>
        </div>

        <div className="bg-white rounded-xl border border-border p-3 sm:p-4">
          <div className="flex items-center gap-2 sm:gap-3 mb-1.5">
            <div className="flex size-8 sm:size-9 items-center justify-center rounded-lg bg-success/10">
              <CheckCircle2 className="size-3.5 sm:size-4 text-success" />
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">Completed</p>
          </div>
          <p className="text-xl sm:text-2xl font-semibold text-primary">{stats.completed}</p>
        </div>

        <div className="bg-white rounded-xl border border-border p-3 sm:p-4">
          <div className="flex items-center gap-2 sm:gap-3 mb-1.5">
            <div className="flex size-8 sm:size-9 items-center justify-center rounded-lg bg-destructive/10">
              <XCircle className="size-3.5 sm:size-4 text-destructive" />
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">Cancelled</p>
          </div>
          <p className="text-xl sm:text-2xl font-semibold text-primary">{stats.cancelled}</p>
        </div>

        <div className="bg-white rounded-xl border border-border p-3 sm:p-4">
          <div className="flex items-center gap-2 sm:gap-3 mb-1.5">
            <div className="flex size-8 sm:size-9 items-center justify-center rounded-lg bg-warning/10">
              <AlertTriangle className="size-3.5 sm:size-4 text-warning" />
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">No Show</p>
          </div>
          <p className="text-xl sm:text-2xl font-semibold text-primary">{stats.noShow}</p>
        </div>
      </div>

      <BookingList bookings={bookings} />
    </div>
  )
}
