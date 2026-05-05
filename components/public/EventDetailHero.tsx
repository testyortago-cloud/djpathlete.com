import Link from "next/link"
import { ChevronRight, CalendarDays, MapPin, Users, UserRound } from "lucide-react"
import type { Event } from "@/types/database"

interface EventDetailHeroProps {
  event: Event
}

function formatDateLong(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })
}

function formatEventWhen(event: Event) {
  if (event.type === "clinic") {
    const datePart = formatDateLong(event.start_date)
    const startTime = formatTime(event.start_date)
    if (event.end_date) {
      return `${datePart} · ${startTime} – ${formatTime(event.end_date)}`
    }
    return `${datePart} · ${startTime}`
  }
  if (event.end_date) {
    const start = new Date(event.start_date)
    const end = new Date(event.end_date)
    const sameYear = start.getFullYear() === end.getFullYear()
    const startLabel = start.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    })
    const endLabel = end.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    })
    return `${startLabel} – ${endLabel}`
  }
  return formatDateLong(event.start_date)
}

function formatDuration(event: Event) {
  if (event.type === "clinic") return "2-hour clinic"
  if (event.end_date) {
    const days = Math.max(
      1,
      Math.round((new Date(event.end_date).getTime() - new Date(event.start_date).getTime()) / (1000 * 60 * 60 * 24)),
    )
    return `${days}-day camp`
  }
  return "Performance camp"
}

function formatAgeRange(min: number | null, max: number | null): string | null {
  if (min != null && max != null) return `Ages ${min}–${max}`
  if (min != null) return `Ages ${min}+`
  if (max != null) return `Ages up to ${max}`
  return null
}

export function EventDetailHero({ event }: EventDetailHeroProps) {
  const parentPath = event.type === "clinic" ? "/clinics" : "/camps"
  const parentLabel = event.type === "clinic" ? "Clinics" : "Camps"

  return (
    <section className="relative overflow-hidden bg-primary text-primary-foreground">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at top right, oklch(0.70 0.08 60 / 0.22), transparent 35%), radial-gradient(circle at bottom left, oklch(1 0 0 / 0.08), transparent 30%)",
        }}
      />
      <div className="relative mx-auto max-w-7xl px-4 py-12 md:px-6 md:py-16">
        <nav className="flex items-center gap-1 text-sm text-primary-foreground/70">
          <Link href={parentPath} className="hover:text-primary-foreground">
            {parentLabel}
          </Link>
          <ChevronRight className="h-4 w-4" />
          <span className="truncate">{event.title}</span>
        </nav>

        <h1 className="mt-4 max-w-4xl font-heading text-4xl font-semibold tracking-tight md:text-6xl">{event.title}</h1>

        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-primary-foreground/85 md:text-base">
          <span className="inline-flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> {formatEventWhen(event)}
          </span>
          <span className="inline-flex items-center gap-2">
            <MapPin className="h-4 w-4" /> {event.location_name}
          </span>
          <span className="inline-flex items-center gap-2">
            <Users className="h-4 w-4" /> {formatDuration(event)}
          </span>
        </div>
      </div>
    </section>
  )
}
