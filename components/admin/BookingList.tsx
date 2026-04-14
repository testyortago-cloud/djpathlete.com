"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Search, ChevronLeft, ChevronRight, Calendar, Clock, Mail, Phone, MoreHorizontal } from "lucide-react"
import { Input } from "@/components/ui/input"
import { EmptyState } from "@/components/ui/empty-state"
import { toast } from "sonner"
import type { Booking, BookingStatus } from "@/types/database"

interface BookingListProps {
  bookings: Booking[]
}

const STATUS_COLORS: Record<BookingStatus, string> = {
  scheduled: "bg-primary/10 text-primary",
  completed: "bg-success/10 text-success",
  cancelled: "bg-destructive/10 text-destructive",
  no_show: "bg-warning/10 text-warning",
}

const STATUS_LABELS: Record<BookingStatus, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No Show",
}

const FILTER_OPTIONS: { label: string; value: BookingStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Scheduled", value: "scheduled" },
  { label: "Completed", value: "completed" },
  { label: "Cancelled", value: "cancelled" },
  { label: "No Show", value: "no_show" },
]

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatTime(dateString: string): string {
  return new Date(dateString).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })
}

function isUpcoming(dateString: string): boolean {
  return new Date(dateString) > new Date()
}

export function BookingList({ bookings }: BookingListProps) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<BookingStatus | "all">("all")
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  const filtered = bookings.filter((b) => {
    if (filter !== "all" && b.status !== filter) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (
      b.contact_name.toLowerCase().includes(q) ||
      b.contact_email.toLowerCase().includes(q) ||
      (b.contact_phone?.toLowerCase().includes(q) ?? false)
    )
  })

  const totalPages = Math.ceil(filtered.length / perPage)
  const paginated = filtered.slice((page - 1) * perPage, page * perPage)

  async function handleStatusUpdate(id: string, status: BookingStatus) {
    setUpdatingId(id)
    setOpenMenuId(null)
    try {
      const res = await fetch("/api/admin/bookings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      })
      if (!res.ok) throw new Error()
      toast.success(`Booking marked as ${STATUS_LABELS[status].toLowerCase()}`)
      router.refresh()
    } catch {
      toast.error("Failed to update booking status")
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border overflow-visible">
      {/* Toolbar */}
      <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, or phone..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            className="pl-10 h-10"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                setFilter(opt.value)
                setPage(1)
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                filter === opt.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface text-muted-foreground hover:bg-surface/80"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {paginated.length > 0 ? (
        <div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-3 font-medium text-muted-foreground">Contact</th>
                <th className="px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Date & Time</th>
                <th className="px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Duration</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 font-medium text-muted-foreground w-12"></th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((booking) => (
                <tr
                  key={booking.id}
                  className="border-b border-border last:border-0 hover:bg-surface/50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium text-primary">{booking.contact_name}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Mail className="size-3" />
                          {booking.contact_email}
                        </span>
                        {booking.contact_phone && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground hidden lg:flex">
                            <Phone className="size-3" />
                            {booking.contact_phone}
                          </span>
                        )}
                      </div>
                      {/* Mobile date */}
                      <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground sm:hidden">
                        <Calendar className="size-3" />
                        {formatDate(booking.booking_date)} at {formatTime(booking.booking_date)}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <div className="flex items-center gap-1.5 text-primary">
                      <Calendar className="size-3.5" />
                      <span>{formatDate(booking.booking_date)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground text-xs mt-0.5">
                      <Clock className="size-3" />
                      <span>{formatTime(booking.booking_date)}</span>
                      {isUpcoming(booking.booking_date) && booking.status === "scheduled" && (
                        <span className="ml-1 text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                          Upcoming
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">
                    {booking.duration_minutes} min
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[booking.status]}`}
                    >
                      {STATUS_LABELS[booking.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 relative">
                    <button
                      onClick={() => setOpenMenuId(openMenuId === booking.id ? null : booking.id)}
                      disabled={updatingId === booking.id}
                      className="flex size-8 items-center justify-center rounded-lg hover:bg-surface transition-colors disabled:opacity-50"
                    >
                      <MoreHorizontal className="size-4 text-muted-foreground" />
                    </button>
                    {openMenuId === booking.id && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setOpenMenuId(null)} />
                        <div className="absolute right-4 top-12 z-50 bg-white rounded-lg border border-border shadow-lg py-1 min-w-[160px]">
                          {booking.status !== "completed" && (
                            <button
                              onClick={() => handleStatusUpdate(booking.id, "completed")}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-surface transition-colors text-primary"
                            >
                              Mark Completed
                            </button>
                          )}
                          {booking.status !== "cancelled" && (
                            <button
                              onClick={() => handleStatusUpdate(booking.id, "cancelled")}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-surface transition-colors text-destructive"
                            >
                              Mark Cancelled
                            </button>
                          )}
                          {booking.status !== "no_show" && (
                            <button
                              onClick={() => handleStatusUpdate(booking.id, "no_show")}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-surface transition-colors text-warning"
                            >
                              Mark No Show
                            </button>
                          )}
                          {booking.status !== "scheduled" && (
                            <button
                              onClick={() => handleStatusUpdate(booking.id, "scheduled")}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-surface transition-colors text-primary"
                            >
                              Reset to Scheduled
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-8">
          <EmptyState
            icon={Calendar}
            heading="No bookings found"
            description={
              search || filter !== "all"
                ? "Try adjusting your search or filter."
                : "Bookings will appear here when people schedule calls through your booking link."
            }
          />
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, filtered.length)} of {filtered.length}
            </span>
            <select
              value={perPage}
              onChange={(e) => {
                setPerPage(Number(e.target.value))
                setPage(1)
              }}
              className="text-xs border border-border rounded px-1.5 py-1 bg-white"
            >
              {[10, 25, 50].map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
              className="flex size-8 items-center justify-center rounded-lg hover:bg-surface transition-colors disabled:opacity-30"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-xs text-muted-foreground px-2">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page === totalPages}
              className="flex size-8 items-center justify-center rounded-lg hover:bg-surface transition-colors disabled:opacity-30"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
