import { Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import { ExternalLink } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { FadeIn } from "@/components/shared/FadeIn"
import { EventDetailHero } from "@/components/public/EventDetailHero"
import { EventSignupCard } from "@/components/public/EventSignupCard"
import { ManagedFaqSection } from "@/components/public/ManagedFaqSection"
import { SemanticAnswerBlock } from "@/components/public/SemanticAnswerBlock"
import { BreadcrumbSchema } from "@/components/shared/BreadcrumbSchema"
import { CheckoutCancelledBanner } from "@/components/public/CheckoutCancelledBanner"
import { getEventBySlug, getPublishedEvents } from "@/lib/db/events"
import { campHasDailyTimes, formatEventTime } from "@/lib/events/format"
import { getActiveDocument } from "@/lib/db/legal-documents"
import { renderLegalContent } from "@/lib/legal-content"
import { SITE_URL } from "@/lib/constants"
import { DJP_AUTHOR_PERSON } from "@/lib/brand/author"

export const revalidate = 300

export async function generateStaticParams() {
  const events = await getPublishedEvents({ type: "camp" })
  return events.map((e) => ({ slug: e.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const event = await getEventBySlug(slug)
  if (!event || event.type !== "camp" || event.status !== "published") return {}
  const images = event.hero_image_url ? [{ url: event.hero_image_url }] : []
  return {
    title: event.title,
    description: event.summary,
    alternates: { canonical: `/camps/${event.slug}` },
    openGraph: { title: event.title, description: event.summary, images, type: "website" },
    twitter: { card: "summary_large_image", title: event.title, description: event.summary },
  }
}

/** Age range as a human phrase, e.g. "8–16". Falls back to a sensible default. */
function ageLabel(min: number | null, max: number | null): string {
  if (min && max) return `${min}–${max}`
  if (min) return `${min}+`
  if (max) return `up to ${max}`
  return "8–16"
}

export default async function CampDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const event = await getEventBySlug(slug)
  if (!event || event.type !== "camp" || event.status !== "published") notFound()

  const waiverDoc = await getActiveDocument("liability_waiver")
  const waiverContent = waiverDoc?.content ? renderLegalContent(waiverDoc.content) : null

  const pageUrl = `${SITE_URL}/camps/${event.slug}`
  const spotsLeft = Math.max(0, event.capacity - event.signup_count)
  const priceUsd = event.price_cents != null ? (event.price_cents / 100).toFixed(2) : undefined
  const ages = ageLabel(event.age_min, event.age_max)
  // Only published camps render here (others 404), so the event is scheduled.
  const eventStatusUrl = "https://schema.org/EventScheduled"
  const availabilityUrl = spotsLeft > 0 ? "https://schema.org/InStock" : "https://schema.org/SoldOut"

  // Rich SportsEvent schema — eligible for Google's event rich results / Maps
  // events, and gives AI assistants structured facts (when, where, price, ages).
  const eventSchema = {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: event.title,
    description: event.summary || event.description.slice(0, 300),
    url: pageUrl,
    startDate: event.start_date,
    endDate: event.end_date ?? undefined,
    eventStatus: eventStatusUrl,
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    isAccessibleForFree: false,
    maximumAttendeeCapacity: event.capacity,
    remainingAttendeeCapacity: spotsLeft,
    location: {
      "@type": "Place",
      name: event.location_name,
      address: {
        "@type": "PostalAddress",
        streetAddress: event.location_address ?? event.location_name,
        addressRegion: "FL",
        addressCountry: "US",
      },
      ...(event.location_map_url && { hasMap: event.location_map_url }),
    },
    organizer: {
      "@type": "Organization",
      name: "DJP Athlete",
      url: "https://www.darrenjpaul.com",
    },
    performer: DJP_AUTHOR_PERSON,
    image: event.hero_image_url ? [event.hero_image_url] : undefined,
    ...(priceUsd && {
      offers: {
        "@type": "Offer",
        price: priceUsd,
        priceCurrency: "USD",
        availability: availabilityUrl,
        url: pageUrl,
        validFrom: event.created_at,
      },
    }),
    audience: {
      "@type": "PeopleAudience",
      audienceType: `Youth soccer players aged ${ages}`,
      ...(event.age_min && { suggestedMinAge: event.age_min }),
      ...(event.age_max && { suggestedMaxAge: event.age_max }),
    },
  }

  return (
    <>
      <JsonLd data={eventSchema} />
      <BreadcrumbSchema
        items={[
          { name: "Home", url: "/" },
          { name: "Soccer Camps", url: "/camps" },
          { name: event.title, url: `/camps/${event.slug}` },
        ]}
      />
      <EventDetailHero event={event} />

      <Suspense fallback={null}>
        <CheckoutCancelledBanner />
      </Suspense>

      {/* AEO answer block — extractable definition for "what is a high-performance soccer camp" */}
      <SemanticAnswerBlock
        eyebrow="About this camp"
        question="What is a high-performance soccer camp?"
        answer={`A high-performance soccer camp develops the physical and technical qualities that decide real matches — speed, acceleration, change of direction, conditioning, and executing technique under fatigue and pressure — rather than running generic drills. This camp runs for youth players aged ${ages}, coached by Darren J Paul, PhD (CSCS, NASM), who has coached 500+ athletes across 15+ sports including WTA professionals. Sessions follow a deliberate arc: purposeful movement prep, technical and tactical work, conditioning, then competitive play, so the gains transfer to game day. Players are grouped so each one gets appropriately challenged work — a developing player and a more advanced one both leave better. It's proper athletic development for soccer, calibrated to where the player is right now, with a safety-first, age-appropriate progression. Held in the Tampa Bay area at ${event.location_name}.`}
      />

      <div className="mx-auto max-w-7xl px-4 py-12 md:px-6 md:py-16 pb-32 lg:pb-16">
        <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
          <FadeIn>
            <article className="space-y-10">
              <div className="prose prose-lg max-w-none">
                {event.description.split(/\n\n+/).map((p, i) => (
                  <p key={i} className="text-lg leading-8 text-muted-foreground">
                    {p}
                  </p>
                ))}
              </div>

              {(campHasDailyTimes(event) || event.session_schedule) && (
                <div>
                  <h2 className="font-heading text-2xl font-semibold text-foreground">Schedule</h2>
                  {campHasDailyTimes(event) && (
                    <p className="mt-2 text-muted-foreground">
                      Sessions run {formatEventTime(event.start_date)} –{" "}
                      {formatEventTime(event.end_date ?? event.start_date)} each day.
                    </p>
                  )}
                  {event.session_schedule && (
                    <p className="mt-2 text-muted-foreground">{event.session_schedule}</p>
                  )}
                </div>
              )}

              {event.focus_areas.length > 0 && (
                <div>
                  <h2 className="font-heading text-2xl font-semibold text-foreground">What gets developed</h2>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {event.focus_areas.map((fa) => (
                      <span key={fa} className="rounded-full bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
                        {fa}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {event.audience.length > 0 && (
                <div>
                  <h2 className="font-heading text-2xl font-semibold text-foreground">Who it's for</h2>
                  <ul className="mt-4 space-y-2 text-muted-foreground">
                    {event.audience.map((line) => (
                      <li key={line} className="flex items-start gap-2">
                        <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-accent" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <h2 className="font-heading text-2xl font-semibold text-foreground">Location</h2>
                <div className="mt-3 rounded-xl border border-border p-4">
                  <p className="font-medium">{event.location_name}</p>
                  {event.location_address && (
                    <p className="mt-1 text-sm text-muted-foreground">{event.location_address}</p>
                  )}
                  {event.location_map_url && (
                    <Link
                      href={event.location_map_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      Open map <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>
              </div>

            </article>
          </FadeIn>

          <aside>
            <EventSignupCard event={event} waiverContent={waiverContent} />
          </aside>
        </div>
      </div>

      <ManagedFaqSection
        pageKey={`event/${event.id}`}
        variant="cards"
        eyebrow="Common questions"
        title="Questions, answered."
      />
    </>
  )
}
