import { notFound } from "next/navigation"
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
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold text-primary mb-6">Edit Event</h1>
        <EventForm event={event} />
      </div>

      <section className="border-t border-border pt-8">
        <h2 className="text-xl font-semibold text-primary mb-4">Signups</h2>
        <SignupsTable initialSignups={signups} eventId={event.id} />
      </section>
    </div>
  )
}
