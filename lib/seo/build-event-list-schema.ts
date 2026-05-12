import type { Event } from "@/types/database"
import { SITE_URL } from "@/lib/constants"

/**
 * Builds an `ItemList` of `SportsEvent` objects for a clinic/camp listing page.
 *
 * Google reads an ItemList of events on a listing page and can surface the
 * events in a list-style rich result (multiple dates under one site). The
 * full per-event detail lives on each `/clinics/[slug]` / `/camps/[slug]` page;
 * here we include just enough (name, url, date, place, offer) to be valid and
 * useful, and let the canonical detail page carry the rest.
 *
 * Returns `null` when there are no published events so callers can skip
 * rendering an empty list.
 */
export function buildEventListSchema(
  events: Event[],
  kind: "clinic" | "camp",
): Record<string, unknown> | null {
  if (!events || events.length === 0) return null

  const basePath = kind === "clinic" ? "/clinics" : "/camps"
  const listName =
    kind === "clinic" ? "Upcoming speed and agility clinics" : "Upcoming high-performance soccer camps"

  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: listName,
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    numberOfItems: events.length,
    itemListElement: events.map((event, i) => {
      const url = `${SITE_URL}${basePath}/${event.slug}`
      const spotsLeft = Math.max(0, event.capacity - event.signup_count)
      const priceUsd = event.price_cents != null ? (event.price_cents / 100).toFixed(2) : undefined
      return {
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "SportsEvent",
          name: event.title,
          description: event.summary,
          url,
          startDate: event.start_date,
          endDate: event.end_date ?? undefined,
          eventStatus: "https://schema.org/EventScheduled",
          eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
          location: {
            "@type": "Place",
            name: event.location_name,
            address: {
              "@type": "PostalAddress",
              streetAddress: event.location_address ?? event.location_name,
              addressRegion: "FL",
              addressCountry: "US",
            },
          },
          organizer: { "@type": "Organization", name: "DJP Athlete", url: SITE_URL },
          image: event.hero_image_url ? [event.hero_image_url] : undefined,
          ...(priceUsd && {
            offers: {
              "@type": "Offer",
              price: priceUsd,
              priceCurrency: "USD",
              availability:
                spotsLeft > 0 ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
              url,
            },
          }),
        },
      }
    }),
  }
}
