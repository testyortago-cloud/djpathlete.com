import type { Metadata } from "next"
import { Star } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { getTestimonials } from "@/lib/db/testimonials"

export const metadata: Metadata = {
  title: "Testimonials",
  description:
    "Read what athletes are saying about DJP Athlete. Real stories from real clients — from youth sports to professional competition.",
  openGraph: {
    title: "Testimonials | DJP Athlete",
    description:
      "Read what athletes are saying about DJP Athlete. Real stories from real clients.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Testimonials | DJP Athlete",
    description:
      "Read what athletes are saying about DJP Athlete. Real stories from real clients.",
  },
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`size-4 ${
            i < rating ? "fill-accent text-accent" : "text-border"
          }`}
        />
      ))}
    </div>
  )
}

export default async function TestimonialsPage() {
  let testimonials: Awaited<ReturnType<typeof getTestimonials>> = []

  try {
    testimonials = await getTestimonials()
  } catch {
    // Fallback to empty — page still renders gracefully
  }

  const reviewSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "DJP Athlete",
    url: "https://djpathlete.com",
    aggregateRating:
      testimonials.length > 0
        ? {
            "@type": "AggregateRating",
            ratingValue: (
              testimonials.reduce((sum, t) => sum + (t.rating ?? 5), 0) /
              testimonials.length
            ).toFixed(1),
            reviewCount: testimonials.length,
            bestRating: 5,
          }
        : undefined,
    review: testimonials.map((t) => ({
      "@type": "Review",
      author: { "@type": "Person", name: t.name },
      reviewRating: {
        "@type": "Rating",
        ratingValue: t.rating ?? 5,
        bestRating: 5,
      },
      reviewBody: t.quote,
    })),
  }

  return (
    <>
      <JsonLd data={reviewSchema} />

      {/* Hero */}
      <section className="pt-32 pb-16 lg:pt-40 lg:pb-20 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-sm font-medium text-accent uppercase tracking-wide mb-3">
            Testimonials
          </p>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-semibold text-primary tracking-tight mb-6">
            What our athletes are saying.
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            From youth athletes to seasoned competitors — hear how DJP Athlete
            has helped them train smarter, recover faster, and reach new levels
            of performance.
          </p>
        </div>
      </section>

      {/* Testimonials Grid */}
      <section className="pb-16 lg:pb-24 px-4 sm:px-8">
        <div className="max-w-6xl mx-auto">
          {testimonials.length > 0 ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {testimonials.map((testimonial) => (
                <div
                  key={testimonial.id}
                  className="bg-white rounded-2xl border border-border p-6 flex flex-col"
                >
                  {/* Header with avatar and info */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      {testimonial.avatar_url ? (
                        <img
                          src={testimonial.avatar_url}
                          alt={testimonial.name}
                          className="size-12 rounded-full object-cover"
                        />
                      ) : (
                        <span className="text-lg font-semibold text-primary">
                          {testimonial.name.charAt(0)}
                        </span>
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-foreground">
                        {testimonial.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[testimonial.role, testimonial.sport]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                  </div>

                  {/* Rating */}
                  {testimonial.rating && (
                    <StarRating rating={testimonial.rating} />
                  )}

                  {/* Quote */}
                  <blockquote className="mt-3 flex-1">
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      &ldquo;{testimonial.quote}&rdquo;
                    </p>
                  </blockquote>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-16">
              <p className="text-lg text-muted-foreground">
                Testimonials are coming soon. Check back later!
              </p>
            </div>
          )}
        </div>
      </section>
    </>
  )
}
