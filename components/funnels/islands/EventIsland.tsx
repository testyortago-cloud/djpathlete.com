// Live camp/clinic details pulled at render time, linking to the event page
// that already owns registration (EventSignupCard / EventSignupModal).

import Link from "next/link"
import { ctaClassFor } from "@/lib/funnels/cta-class"
import { getEventById } from "@/lib/db/events"
import { formatEventWhen } from "@/lib/events/format"

interface EventIslandProps {
  props: Record<string, unknown>
}

export async function EventIsland({ props }: EventIslandProps) {
  const eventId = typeof props.eventId === "string" ? props.eventId : ""
  const showSpots = props.showSpots !== false
  const label = typeof props.label === "string" ? props.label : "Register"

  if (!eventId) return null

  let event
  try {
    event = await getEventById(eventId)
  } catch {
    // A page must not 500 because one embedded event failed to load.
    return null
  }
  if (!event || event.status !== "published") return null

  const spotsLeft = Math.max(0, event.capacity - event.signup_count)
  const soldOut = spotsLeft === 0
  const href = `/${event.type}s/${event.slug}`

  return (
    <div data-djp-island="event" data-djp-event={event.slug}>
      <h3>{event.title}</h3>
      <p data-djp-event-when>{formatEventWhen(event)}</p>
      <p data-djp-event-where>{event.location_name}</p>
      {showSpots ? (
        <p data-djp-event-spots>
          {soldOut ? "Sold out" : `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left`}
        </p>
      ) : null}
      {/* The card is the island; only its REGISTER LINK is the CTA, so the
          variant lands here and not on the wrapper. */}
      {soldOut ? null : (
        <Link href={href} className={ctaClassFor(props.variant) || undefined}>
          {label}
        </Link>
      )}
    </div>
  )
}
