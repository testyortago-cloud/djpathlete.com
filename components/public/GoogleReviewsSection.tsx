import Link from "next/link"
import { Star, ExternalLink } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { FadeIn } from "@/components/shared/FadeIn"
import { getGoogleBusinessProfile } from "@/lib/google-places"

const MAX_DISPLAYED = 6

function StarRow({ rating, size = "size-4" }: { rating: number; size?: string }) {
  return (
    <div className="flex gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className={`${size} ${i < Math.round(rating) ? "fill-accent text-accent" : "text-border"}`} />
      ))}
    </div>
  )
}

function GoogleGlyph({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
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

export async function GoogleReviewsSection() {
  const profile = await getGoogleBusinessProfile()
  if (!profile || profile.reviews.length === 0) return null

  const reviews = profile.reviews.slice(0, MAX_DISPLAYED)
  const formattedRating = profile.rating.toFixed(1)

  const reviewSchema = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: "Darren J Paul",
    url: "https://www.darrenjpaul.com/about",
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: formattedRating,
      reviewCount: profile.userRatingCount,
      bestRating: 5,
    },
    review: reviews.map((r) => ({
      "@type": "Review",
      author: { "@type": "Person", name: r.authorName },
      datePublished: r.publishTime || undefined,
      reviewRating: {
        "@type": "Rating",
        ratingValue: r.rating,
        bestRating: 5,
      },
      reviewBody: r.text,
    })),
  }

  return (
    <section className="py-16 lg:py-24 px-4 sm:px-8 bg-surface">
      <JsonLd data={reviewSchema} />
      <div className="max-w-6xl mx-auto">
        <FadeIn>
          <div className="text-center mb-12">
            <div className="flex items-center justify-center gap-2 mb-4">
              <GoogleGlyph className="size-5" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">Verified Google Reviews</p>
            </div>
            <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
              Rated {formattedRating} on Google
            </h2>
            <div className="flex items-center justify-center gap-3">
              <StarRow rating={profile.rating} size="size-5" />
              <span className="text-sm text-muted-foreground">
                {profile.userRatingCount} {profile.userRatingCount === 1 ? "review" : "reviews"}
              </span>
            </div>
            {profile.googleMapsUri && (
              <Link
                href={profile.googleMapsUri}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-4 text-sm font-medium text-primary hover:text-accent transition-colors"
              >
                See all reviews on Google
                <ExternalLink className="size-3.5" />
              </Link>
            )}
          </div>
        </FadeIn>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {reviews.map((review, i) => (
            <FadeIn key={`${review.authorName}-${review.publishTime || i}`} delay={i * 0.06}>
              <article className="bg-white rounded-2xl border border-border p-6 h-full flex flex-col">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 overflow-hidden">
                    {review.authorPhotoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={review.authorPhotoUrl}
                        alt={review.authorName}
                        className="size-10 rounded-full object-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span className="text-base font-semibold text-primary">{review.authorName.charAt(0)}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground truncate">{review.authorName}</p>
                    <div className="flex items-center gap-2">
                      <StarRow rating={review.rating} />
                      {review.relativeTimeDescription && (
                        <span className="text-xs text-muted-foreground">{review.relativeTimeDescription}</span>
                      )}
                    </div>
                  </div>
                  <GoogleGlyph className="size-4 shrink-0" />
                </div>
                <blockquote className="flex-1">
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{review.text}</p>
                </blockquote>
              </article>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  )
}
