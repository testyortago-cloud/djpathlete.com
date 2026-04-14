import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { EventForm } from "@/components/admin/events/EventForm"

export const metadata = { title: "New Event" }

export default function NewEventPage() {
  return (
    <div>
      <div className="mb-6">
        <Link
          href="/admin/events"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary mb-3"
        >
          <ArrowLeft className="size-4" />
          Back to Events
        </Link>
        <h1 className="text-2xl font-semibold text-primary">New Event</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Create a clinic or camp. Draft first — publish when details are final.
        </p>
      </div>
      <EventForm />
    </div>
  )
}
