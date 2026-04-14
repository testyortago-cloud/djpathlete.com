import Link from "next/link"
import { CalendarDays, CheckCircle2, FileEdit, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import { getEvents } from "@/lib/db/events"
import { EventList } from "@/components/admin/events/EventList"

export const dynamic = "force-dynamic"
export const metadata = { title: "Events" }

export default async function AdminEventsPage() {
  const events = await getEvents()

  const total = events.length
  const published = events.filter((e) => e.status === "published").length
  const drafts = events.filter((e) => e.status === "draft").length
  const totalSignups = events.reduce((s, e) => s + (e.signup_count ?? 0), 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Events</h1>
          <p className="text-sm text-muted-foreground mt-1">Clinics and camps — manage listings, capacity, and signups.</p>
        </div>
        <Button asChild size="sm">
          <Link href="/admin/events/new">
            <Plus className="size-4 mr-1.5" />
            New Event
          </Link>
        </Button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <CalendarDays className="size-3.5 sm:size-4 text-primary" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Total Events</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{total}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-success/10">
            <CheckCircle2 className="size-3.5 sm:size-4 text-success" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Published</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{published}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <FileEdit className="size-3.5 sm:size-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Drafts</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{drafts}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-accent/15">
            <Users className="size-3.5 sm:size-4 text-accent" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Total Signups</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{totalSignups}</p>
          </div>
        </div>
      </div>

      <EventList initialEvents={events} />
    </div>
  )
}
