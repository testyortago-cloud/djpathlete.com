import { getEvents } from "@/lib/db/events"
import { EventList } from "@/components/admin/events/EventList"

export const dynamic = "force-dynamic"
export const metadata = { title: "Events" }

export default async function AdminEventsPage() {
  const events = await getEvents()
  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Events</h1>
      <EventList initialEvents={events} />
    </div>
  )
}
