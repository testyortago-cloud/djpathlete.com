// Pulls testimonials at render time so a published funnel page stays current
// as the library grows, without the owner re-editing the page.

import { getTestimonials, getFeaturedTestimonials } from "@/lib/db/testimonials"
import { platformBusinessId } from "@/lib/tenancy/platform"
import type { Testimonial } from "@/types/database"
import type { FunnelRenderContext } from "./index"

interface TestimonialsIslandProps {
  props: Record<string, unknown>
  context: FunnelRenderContext
}

export async function TestimonialsIsland({ props, context }: TestimonialsIslandProps) {
  // THE PLATFORM'S ATHLETES, ON THE PLATFORM'S PAGES ONLY (G35). `testimonials`
  // has no `business_id` column: every quote is from someone the platform
  // coached. Shown on another business's page they would be presented as that
  // coach's clients — so that page gets nothing. Same rule, same reasons and
  // the same placement (before either read) as FaqIsland.
  if (context.businessId !== platformBusinessId()) return null

  const limit = typeof props.limit === "number" ? props.limit : 3
  const featuredOnly = props.featuredOnly === true

  let rows: Testimonial[] = []
  try {
    rows = ((featuredOnly ? await getFeaturedTestimonials() : await getTestimonials(true)) ?? []) as Testimonial[]
  } catch {
    return null
  }

  const shown = rows.slice(0, limit)
  if (shown.length === 0) return null

  // The SAME classes `render.ts` gives authored quotes, so the live feed and the
  // authored variant are one design rather than two.
  //
  // They were absent, and the result was on a production page: a `testimonial`
  // section with `source: "live"` on a dark band rendered three quotes with no
  // card, no gap and no attribution styling, while the authored variant beside
  // it in the same registry looked finished. An island that renders into a
  // styled section has to speak that section's vocabulary; nothing else in this
  // file needs to change for it to.
  return (
    <div className="djp-testimonial-grid" data-djp-island="testimonials">
      {shown.map((testimonial) => (
        <figure key={testimonial.id} className="djp-quote" data-djp-testimonial>
          <blockquote className="djp-quote-text">{testimonial.quote}</blockquote>
          <figcaption className="djp-quote-attribution">
            <span className="djp-quote-name">{testimonial.name}</span>
            {testimonial.sport ? <span className="djp-quote-detail">{testimonial.sport}</span> : null}
          </figcaption>
        </figure>
      ))}
    </div>
  )
}
