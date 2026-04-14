import { EventForm } from "@/components/admin/events/EventForm"

export const metadata = { title: "New Event" }

export default function NewEventPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">New Event</h1>
      <EventForm />
    </div>
  )
}
