import { Calendar, Clock, CheckCircle2, XCircle, AlertTriangle } from "lucide-react"
import { getBookings, getBookingStats } from "@/lib/db/bookings"
import { BookingList } from "@/components/admin/BookingList"

export const dynamic = "force-dynamic"
export const metadata = { title: "Bookings" }

export default async function BookingsPage() {
  const [bookings, stats] = await Promise.all([getBookings(), getBookingStats()])

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Bookings</h1>

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
