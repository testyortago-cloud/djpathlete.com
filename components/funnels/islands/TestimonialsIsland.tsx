// Pulls testimonials at render time so a published funnel page stays current
// as the library grows, without the owner re-editing the page.

import { getTestimonials, getFeaturedTestimonials } from "@/lib/db/testimonials"
import type { Testimonial } from "@/types/database"

interface TestimonialsIslandProps {
  props: Record<string, unknown>
}

export async function TestimonialsIsland({ props }: TestimonialsIslandProps) {
  const limit = typeof props.limit === "number" ? props.limit : 3
  const featuredOnly = props.featuredOnly === true

  let rows: Testimonial[] = []
  try {
    rows = ((featuredOnly
      ? await getFeaturedTestimonials()
      : await getTestimonials(true)) ?? []) as Testimonial[]
  } catch {
    return null
  }

  const shown = rows.slice(0, limit)
  if (shown.length === 0) return null

  return (
    <div data-djp-island="testimonials">
      {shown.map((testimonial) => (
        <figure key={testimonial.id} data-djp-testimonial>
          <blockquote>{testimonial.quote}</blockquote>
          <figcaption>
            {testimonial.name}
            {testimonial.sport ? ` · ${testimonial.sport}` : ""}
          </figcaption>
        </figure>
      ))}
    </div>
  )
}
