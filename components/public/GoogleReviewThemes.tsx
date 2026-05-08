import Link from "next/link"
import { ExternalLink } from "lucide-react"
import { GBP_REVIEW_THEMES, GBP_TOTAL_REVIEWS } from "@/lib/google-review-themes"
import { GOOGLE_MAPS_URL } from "@/lib/business-info"
import { FadeIn } from "@/components/shared/FadeIn"

function GoogleGlyph({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

interface GoogleReviewThemesProps {
  /** Heading variant — "section" renders an H2; "block" renders an H3. */
  variant?: "section" | "block"
  className?: string
}

/**
 * Surfaces the Google-extracted review topic clusters from the live GBP
 * listing as visible chips. Mirrors the UI Google itself uses on the
 * Reviews tab. Every theme is tied to a real-review count, so this is
 * customer-validated social proof + on-page keyword reinforcement.
 *
 * The Places API does not return these themes; they are hand-curated in
 * lib/google-review-themes.ts and should be refreshed every 30–60 days.
 */
export function GoogleReviewThemes({ variant = "section", className = "" }: GoogleReviewThemesProps) {
  const Heading = variant === "section" ? "h2" : "h3"
  return (
    <section
      aria-labelledby="gbp-review-themes-heading"
      className={`py-16 lg:py-20 px-4 sm:px-8 ${className}`}
    >
      <div className="max-w-5xl mx-auto">
        <FadeIn className="text-center mb-10">
          <div className="flex items-center justify-center gap-2 mb-4">
            <GoogleGlyph className="size-5" />
            <p className="text-sm font-medium text-accent uppercase tracking-widest">What clients say on Google</p>
          </div>
          <Heading
            id="gbp-review-themes-heading"
            className="text-2xl sm:text-3xl lg:text-4xl font-heading font-semibold text-primary tracking-tight mb-3"
          >
            The topics athletes mention most.
          </Heading>
          <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto">
            Pulled directly from {GBP_TOTAL_REVIEWS} verified Google reviews. Every theme below is tied to real
            reviews — counted, not curated.
          </p>
        </FadeIn>

        <FadeIn delay={0.1}>
          <ul className="flex flex-wrap items-center justify-center gap-2.5 max-w-3xl mx-auto">
            {GBP_REVIEW_THEMES.map((theme) => (
              <li key={theme.label}>
                <span
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-white px-4 py-2 text-sm text-foreground shadow-sm"
                  aria-label={`${theme.label}, mentioned in ${theme.count} reviews`}
                >
                  <span className="font-medium text-primary">{theme.label}</span>
                  <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-accent/15 text-[11px] font-semibold text-accent tabular-nums">
                    {theme.count}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </FadeIn>

        <FadeIn delay={0.15}>
          <div className="mt-8 flex justify-center">
            <Link
              href={GOOGLE_MAPS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-accent transition-colors"
            >
              Read all {GBP_TOTAL_REVIEWS} reviews on Google
              <ExternalLink className="size-3.5" />
            </Link>
          </div>
        </FadeIn>
      </div>
    </section>
  )
}
