import { notFound } from "next/navigation"
import { Inbox } from "lucide-react"
import { getEventById } from "@/lib/db/events"
import { getSignupsForEvent } from "@/lib/db/event-signups"
import { EventForm } from "@/components/admin/events/EventForm"

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
        {signups.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center">
            <Inbox className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
            <p className="font-medium">No signups yet</p>
            <p className="text-sm text-muted-foreground">
              Signups will appear here once the public signup flow launches in Phase 2b.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Athlete</th>
                  <th className="px-4 py-3">Age</th>
                  <th className="px-4 py-3">Parent</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {signups.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="px-4 py-3">{s.athlete_name}</td>
                    <td className="px-4 py-3">{s.athlete_age}</td>
                    <td className="px-4 py-3">{s.parent_name}</td>
                    <td className="px-4 py-3">{s.parent_email}</td>
                    <td className="px-4 py-3 capitalize">{s.signup_type}</td>
                    <td className="px-4 py-3 capitalize">{s.status}</td>
                    <td className="px-4 py-3">{new Date(s.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
