import { Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import { ExternalLink } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { FadeIn } from "@/components/shared/FadeIn"
import { EventDetailHero } from "@/components/public/EventDetailHero"
import { EventSignupCard } from "@/components/public/EventSignupCard"
import { CheckoutCancelledBanner } from "@/components/public/CheckoutCancelledBanner"
import { getEventBySlug, getPublishedEvents } from "@/lib/db/events"
import { getActiveDocument } from "@/lib/db/legal-documents"
import { renderLegalContent } from "@/lib/legal-content"

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
    openGraph: { title: event.title, description: event.summary, images },
    twitter: { card: "summary_large_image", title: event.title, description: event.summary },
  }
}

export default async function CampDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const event = await getEventBySlug(slug)
  if (!event || event.type !== "camp" || event.status !== "published") notFound()

  const waiverDoc = await getActiveDocument("liability_waiver")
  const waiverContent = waiverDoc?.content ? renderLegalContent(waiverDoc.content) : null

  const eventSchema = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    description: event.summary,
    startDate: event.start_date,
    endDate: event.end_date,
    location: {
      "@type": "Place",
      name: event.location_name,
      address: event.location_address ?? undefined,
    },
    offers:
      event.price_cents != null
        ? {
            "@type": "Offer",
            price: (event.price_cents / 100).toFixed(2),
            priceCurrency: "USD",
            availability: "https://schema.org/PreOrder",
          }
        : undefined,
    organizer: {
      "@type": "Organization",
      name: "DJP Athlete",
      url: "https://www.darrenjpaul.com",
    },
    image: event.hero_image_url ? [event.hero_image_url] : undefined,
  }

  return (
    <>
      <JsonLd data={eventSchema} />
      <EventDetailHero event={event} />

      <Suspense fallback={null}>
        <CheckoutCancelledBanner />
      </Suspense>

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

              {event.session_schedule && (
                <div>
                  <h2 className="font-heading text-2xl font-semibold text-foreground">Schedule</h2>
                  <p className="mt-2 text-muted-foreground">{event.session_schedule}</p>
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
    </>
  )
}
