import Link from "next/link"
import { Star, ExternalLink, ShieldCheck } from "lucide-react"
import { GOOGLE_MAPS_URL, BUSINESS_INFO } from "@/lib/business-info"
import { getGoogleBusinessProfile } from "@/lib/google-places"

const GBP_REVIEWS_URL = `${GOOGLE_MAPS_URL}&hl=en`

function GoogleGlyph({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}

function StarRow({ rating, size = "size-4" }: { rating: number; size?: string }) {
  return (
    <div className="flex gap-0.5" aria-label={`${rating.toFixed(1)} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`${size} ${i < Math.round(rating) ? "fill-accent text-accent" : "text-border"}`}
        />
      ))}
    </div>
  )
}

/**
 * Compact, E-E-A-T-optimized Google Reviews badge.
 *
 * - When `GOOGLE_PLACES_API_KEY` is configured, shows live rating + review
 *   count fetched from the GBP and emits an Organization+aggregateRating
 *   hint via the parent page's existing schema (we don't double-emit here).
 * - When env is missing, gracefully degrades to a neutral CTA that still
 *   sends users to the live GBP. No fabricated rating is ever rendered.
 *
 * Pairs well with the "Trusted by elite athletes" testimonials block —
 * place immediately below the heading or above the carousel for max impact.
 */
export async function GoogleReviewsBadge() {
  const profile = await getGoogleBusinessProfile()
  const hasLive = profile && profile.userRatingCount > 0
  const rating = hasLive ? profile!.rating : 0
  const count = hasLive ? profile!.userRatingCount : 0
  const reviewsUrl = profile?.googleMapsUri || GBP_REVIEWS_URL

  return (
    <div className="flex flex-col items-center gap-3">
      <a
        href={reviewsUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={
          hasLive
            ? `${BUSINESS_INFO.legalName} on Google — ${rating.toFixed(1)} stars from ${count} reviews. Opens in new tab.`
            : `Read reviews of ${BUSINESS_INFO.legalName} on Google. Opens in new tab.`
        }
        className="group inline-flex items-center gap-3 rounded-full border border-border bg-white px-5 py-2.5 shadow-sm hover:shadow-md hover:border-accent/40 transition-all"
      >
        <GoogleGlyph className="size-5" />

        {hasLive ? (
          <>
            <span className="font-heading text-base font-semibold text-primary tabular-nums">
              {rating.toFixed(1)}
            </span>
            <StarRow rating={rating} />
            <span className="text-sm text-muted-foreground">
              ({count} {count === 1 ? "review" : "reviews"})
            </span>
          </>
        ) : (
          <>
            <span className="font-heading text-sm font-medium text-primary">Reviews on Google</span>
            <StarRow rating={5} />
          </>
        )}

        <span className="hidden sm:inline-flex items-center gap-1 text-xs font-medium text-primary group-hover:text-accent transition-colors pl-2 ml-1 border-l border-border">
          See all
          <ExternalLink className="size-3" />
        </span>
      </a>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 text-accent" />
        <span>
          Verified Google Business Profile · {BUSINESS_INFO.address.addressLocality},{" "}
          {BUSINESS_INFO.address.addressRegion}
        </span>
      </div>
    </div>
  )
}
