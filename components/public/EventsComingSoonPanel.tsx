import { CalendarClock } from "lucide-react"

interface EventsComingSoonPanelProps {
  type: "clinic" | "camp"
}

const COPY: Record<EventsComingSoonPanelProps["type"], { title: string; body: string }> = {
  clinic: {
    title: "New clinic dates rolling out soon",
    body: "We're confirming locations and dates across the community. Register your interest below and we'll get in touch as soon as a clinic is scheduled near you.",
  },
  camp: {
    title: "Next camp block being scheduled",
    body: "Off-season and pre-season camp dates are being locked in. Register your interest below and we'll let you know as soon as the next block opens for enrolment.",
  },
}

export function EventsComingSoonPanel({ type }: EventsComingSoonPanelProps) {
  const copy = COPY[type]
  return (
    <div className="rounded-2xl border border-accent/30 bg-accent/10 p-8 md:p-10">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-accent/20 text-accent">
          <CalendarClock className="h-6 w-6" strokeWidth={1.8} />
        </div>
        <div>
          <h3 className="text-2xl font-heading font-semibold tracking-tight text-foreground md:text-3xl">
            {copy.title}
          </h3>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
            {copy.body}
          </p>
        </div>
      </div>
    </div>
  )
}
