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
import { getEventBySlug, getPublishedEvents } from "@/lib/db/events"
import { getActiveDocument } from "@/lib/db/legal-documents"
import { renderLegalContent } from "@/lib/legal-content"
import { SITE_URL } from "@/lib/constants"
import { DJP_AUTHOR_PERSON } from "@/lib/brand/author"
import { getBusinessSettings } from "@/lib/db/businesses"
import { hasSmsConsentDisplayName, renderSmsConsentWording } from "@/lib/lead-engine/sms-consent-wording"

export const revalidate = 300

export async function generateStaticParams() {
  const events = await getPublishedEvents({ type: "clinic" })
  return events.map((e) => ({ slug: e.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const event = await getEventBySlug(slug)
  if (!event || event.type !== "clinic" || event.status !== "published") return {}
  const images = event.hero_image_url ? [{ url: event.hero_image_url }] : []
  return {
    title: event.title,
    description: event.summary,
    alternates: { canonical: `/clinics/${event.slug}` },
    openGraph: { title: event.title, description: event.summary, images, type: "website" },
    twitter: { card: "summary_large_image", title: event.title, description: event.summary },
  }
}

/** Age range as a human phrase, e.g. "10–18". Falls back to a sensible default. */
function ageLabel(min: number | null, max: number | null): string {
  if (min && max) return `${min}–${max}`
  if (min) return `${min}+`
  if (max) return `up to ${max}`
  return "10–18"
}

export default async function ClinicDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const event = await getEventBySlug(slug)
  if (!event || event.type !== "clinic" || event.status !== "published") notFound()

  const waiverDoc = await getActiveDocument("liability_waiver")
  const waiverContent = waiverDoc?.content ? renderLegalContent(waiverDoc.content) : null

  // THE SMS CONSENT WORDING IS FETCHED SERVER-SIDE — see camps/[slug]/page.tsx's
  // identical block for the full reasoning (this page is EventSignupCard's
  // nearest server parent, same as that one).
  const businessSettings = await getBusinessSettings().catch(() => null)
  const smsConsentWording = hasSmsConsentDisplayName(businessSettings?.display_name)
    ? renderSmsConsentWording(businessSettings.display_name)
    : undefined

  const pageUrl = `${SITE_URL}/clinics/${event.slug}`
  const spotsLeft = Math.max(0, event.capacity - event.signup_count)
  const priceUsd = event.price_cents != null ? (event.price_cents / 100).toFixed(2) : undefined
  const ages = ageLabel(event.age_min, event.age_max)

  // This page only renders for published events (others 404 above), so the
  // event is always scheduled here.
  const eventStatusUrl = "https://schema.org/EventScheduled"
  const availabilityUrl = spotsLeft > 0 ? "https://schema.org/InStock" : "https://schema.org/SoldOut"

  // Rich Event schema — gets DJP into Google's event rich results / Maps events
  // and gives AI assistants structured event facts (when, where, price, ages).
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
      audienceType: `Youth athletes aged ${ages}`,
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
          { name: "Speed & Agility Clinics", url: "/clinics" },
          { name: event.title, url: `/clinics/${event.slug}` },
        ]}
      />
      <EventDetailHero event={event} />

      {/* AEO answer block — extractable definition for "what is youth speed and agility training" */}
      <SemanticAnswerBlock
        eyebrow="About this clinic"
        question="What is youth speed and agility training?"
        answer={`Youth speed and agility training develops how young athletes accelerate, decelerate, change direction, and react under pressure — the movements that separate players in real sport. This clinic runs for athletes aged ${ages} in small groups (typically 8–12), coached by Darren J Paul, PhD (CSCS, NASM). Each session is structured: purposeful movement prep, technical coaching of starting, stopping, and redirecting, reactive tasks that layer in decision-making, then competitive work so skills transfer to the pitch, court, or field. It is not generic cone drills — it's proper athletic development, calibrated for where the athlete is right now, with a safety-first, age-appropriate progression. Held in the Tampa Bay area at ${event.location_name}.`}
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

              {event.focus_areas.length > 0 && (
                <div>
                  <h2 className="font-heading text-2xl font-semibold text-foreground">What gets coached</h2>
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
            <EventSignupCard event={event} waiverContent={waiverContent} smsConsentWording={smsConsentWording} />
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
