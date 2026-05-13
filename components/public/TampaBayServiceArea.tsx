import { FadeIn } from "@/components/shared/FadeIn"
import { formattedAddress } from "@/lib/business-info"

/** A city we serve and a rough drive time from the Zephyrhills facility. */
const LOCATIONS: { city: string; drive: string }[] = [
  { city: "Zephyrhills, FL", drive: "On-site" },
  { city: "Wesley Chapel, FL", drive: "~20 min" },
  { city: "Land O' Lakes, FL", drive: "~25 min" },
  { city: "Lakeland, FL", drive: "~30 min" },
  { city: "Tampa, FL", drive: "~35 min" },
  { city: "Brandon, FL", drive: "~35 min" },
  { city: "Riverview, FL", drive: "~40 min" },
  { city: "St. Petersburg, FL", drive: "~50 min" },
]

interface TampaBayServiceAreaProps {
  /** Eyebrow above the heading. */
  eyebrow?: string
  /** Section heading. */
  heading?: string
  /** Intro paragraph rendered under the heading (override per page). */
  intro?: React.ReactNode
  /** Tailwind className extension, e.g. background colour. */
  className?: string
}

/**
 * Local-SEO drive-time grid for the Tampa Bay area. Surfaces the facility
 * NAP and a list of cities within easy reach, giving Google clear local
 * relevance signals and giving prospects a "yes, that's me" check.
 *
 * Reuse on any in-person-relevant page (sport pages, /in-person, /clinics,
 * /camps, future /locations).
 */
export function TampaBayServiceArea({
  eyebrow = "Tampa Bay Service Area",
  heading = "Serving athletes across Tampa Bay, Florida.",
  intro,
  className = "",
}: TampaBayServiceAreaProps) {
  return (
    <section
      aria-labelledby="service-area-heading"
      className={`py-16 lg:py-20 px-4 sm:px-8 ${className}`}
    >
      <div className="max-w-5xl mx-auto">
        <FadeIn>
          <div className="text-center mb-10">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="h-px w-8 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">{eyebrow}</p>
              <div className="h-px w-8 bg-accent" />
            </div>
            <h2
              id="service-area-heading"
              className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-3"
            >
              {heading}
            </h2>
            <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              {intro ?? (
                <>
                  Our facility at <strong>{formattedAddress}</strong> is within driving distance of every
                  major Tampa Bay city. Athletes train here from across the region.
                </>
              )}
            </p>
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 max-w-4xl mx-auto">
            {LOCATIONS.map((loc) => (
              <li key={loc.city} className="rounded-2xl border border-border bg-white px-4 py-3 text-center">
                <p className="text-sm font-semibold text-primary">{loc.city}</p>
                <p className="text-xs text-accent uppercase tracking-widest mt-1">{loc.drive}</p>
              </li>
            ))}
          </ul>
        </FadeIn>

        <FadeIn delay={0.15}>
          <p className="mt-8 text-center text-sm text-muted-foreground max-w-2xl mx-auto">
            Drive times are approximate from city center. Coaching is by application; sessions are scheduled
            around athlete availability and capacity at the facility.
          </p>
        </FadeIn>
      </div>
    </section>
  )
}

/** Cities served — exported so schema/sitemap consumers can stay in sync. */
export const TAMPA_BAY_CITIES = LOCATIONS.map((l) => l.city)
