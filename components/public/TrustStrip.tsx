import { GraduationCap, Award, Trophy, MapPin, Clock } from "lucide-react"
import { BUSINESS_INFO } from "@/lib/business-info"

interface TrustStripProps {
  /** Visual variant. "compact" = single row of pills; "full" = bigger 3-col grid. */
  variant?: "compact" | "full"
  className?: string
}

const ITEMS = [
  { icon: GraduationCap, label: "Darren J Paul, PhD", aria: "Doctorate" },
  { icon: Award, label: "CSCS · NASM · USAW Level 2", aria: "Industry certifications" },
  { icon: Trophy, label: "500+ athletes · 15+ sports", aria: "Coaching experience" },
  {
    icon: MapPin,
    label: `${BUSINESS_INFO.address.addressLocality}, ${BUSINESS_INFO.address.addressRegion} · Tampa Bay`,
    aria: "Location",
  },
  { icon: Clock, label: "Application response within 48h", aria: "Response time" },
]

/**
 * Tight, scannable trust signals to surface alongside testimonials and
 * Google Reviews. Each pill conveys a single E-E-A-T credential or fact.
 *
 * Use `compact` near the testimonials title; `full` near the bottom of
 * a service page.
 */
export function TrustStrip({ variant = "compact", className = "" }: TrustStripProps) {
  if (variant === "full") {
    return (
      <ul className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 ${className}`}>
        {ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <li
              key={item.label}
              className="flex items-center gap-3 rounded-2xl border border-border bg-white px-4 py-3"
            >
              <Icon className="size-4 text-accent shrink-0" aria-hidden />
              <span className="text-sm text-foreground">{item.label}</span>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <ul
      className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs sm:text-sm text-muted-foreground ${className}`}
      aria-label="Credentials and trust signals"
    >
      {ITEMS.map((item, i) => {
        const Icon = item.icon
        return (
          <li key={item.label} className="flex items-center">
            {i > 0 && <span aria-hidden className="mr-4 size-1 rounded-full bg-border" />}
            <span className="inline-flex items-center gap-1.5">
              <Icon className="size-3.5 text-accent shrink-0" aria-hidden />
              <span aria-label={item.aria}>{item.label}</span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
