import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Users } from "lucide-react"
import { getEventById } from "@/lib/db/events"
import { getSignupsForEvent } from "@/lib/db/event-signups"
import { EventForm } from "@/components/admin/events/EventForm"
import { SignupsTable } from "@/components/admin/events/SignupsTable"

export const dynamic = "force-dynamic"
export const metadata = { title: "Edit Event" }

interface Props {
  params: Promise<{ id: string }>
}

export default async function EditEventPage({ params }: Props) {
  const { id } = await params
  const event = await getEventById(id)
  if (!event) notFound()

  const signups = await getSignupsForEvent(id)

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin/events"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary mb-3"
        >
          <ArrowLeft className="size-4" />
          Back to Events
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-primary">Edit Event</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Update details, capacity, scheduling, and publishing status.
            </p>
          </div>
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium capitalize ${
              event.status === "published"
                ? "bg-success/15 text-success"
                : event.status === "cancelled"
                  ? "bg-destructive/15 text-destructive"
                  : event.status === "completed"
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
            }`}
          >
            {event.status}
          </span>
        </div>
      </div>

      <EventForm event={event} />

      <section>
        <div className="flex items-center gap-2 mb-4">
          <Users className="size-5 text-primary" />
          <h2 className="text-lg font-semibold text-primary">Signups</h2>
        </div>
        <SignupsTable initialSignups={signups} eventId={event.id} />
      </section>
    </div>
  )
}
