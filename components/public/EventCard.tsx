import Image from "next/image"
import Link from "next/link"
import { CalendarDays, MapPin } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { EventCardCta } from "@/components/public/EventCardCta"
import type { Event } from "@/types/database"

interface EventCardProps {
  event: Event
  /** Pre-rendered HTML for the active liability waiver. Forwarded into the
   *  signup modal so parents can review it before submitting. Null is
   *  acceptable — the modal renders a short fallback notice. */
  waiverContent: string | null
}

function formatPrice(cents: number | null) {
  if (cents == null) return null
  const dollars = cents / 100
  return dollars % 1 === 0 ? `$${dollars}` : `$${dollars.toFixed(2)}`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function EventCard({ event, waiverContent }: EventCardProps) {
  const isFull = event.signup_count >= event.capacity
  const spotsLeft = Math.max(0, event.capacity - event.signup_count)
  const lowSpots = !isFull && spotsLeft <= 2
  const price = formatPrice(event.price_cents)
  const href = `/${event.type === "clinic" ? "clinics" : "camps"}/${event.slug}`

  return (
    <Card className="flex h-full flex-col overflow-hidden rounded-2xl border-border">
      <Link href={href} className="relative block aspect-[16/9] overflow-hidden bg-primary/5">
        {event.hero_image_url ? (
          <Image
            src={event.hero_image_url}
            alt={event.title}
            fill
            sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw"
            className="object-cover"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-primary/20 to-accent/20" />
        )}
        <span className="absolute left-3 top-3 rounded-full bg-background/90 px-3 py-1 text-xs font-medium capitalize text-foreground">
          {event.type}
        </span>
      </Link>

      <CardContent className="flex flex-1 flex-col p-6">
        <Link href={href} className="hover:text-primary">
          <h3 className="font-heading text-xl font-semibold tracking-tight">{event.title}</h3>
        </Link>

        <div className="mt-3 space-y-1 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            <span>{formatDate(event.start_date)}</span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            <span>{event.location_name}</span>
          </div>
        </div>

        <div className="mt-4">
          {isFull ? (
            <p className="text-sm font-semibold text-accent">Full — join waitlist</p>
          ) : (
            <p className={`text-sm ${lowSpots ? "font-semibold text-accent" : "text-muted-foreground"}`}>
              {spotsLeft} {spotsLeft === 1 ? "spot" : "spots"} left
            </p>
          )}
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div
              className={`h-full ${isFull ? "bg-accent" : "bg-primary"}`}
              style={{ width: `${Math.min(100, (event.signup_count / event.capacity) * 100)}%` }}
            />
          </div>
        </div>

        {price && <p className="mt-4 font-semibold">{price}</p>}

        <div className="mt-6 flex-1" />

        <EventCardCta event={event} waiverContent={waiverContent} />
      </CardContent>
    </Card>
  )
}
