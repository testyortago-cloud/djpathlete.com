import { NextResponse } from "next/server"
import { getTestimonials, createTestimonial } from "@/lib/db/testimonials"

export async function GET() {
  try {
    const testimonials = await getTestimonials(false)
    return NextResponse.json(testimonials)
  } catch {
    return NextResponse.json({ error: "Failed to fetch testimonials." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const { name, role, sport, quote, rating, is_featured, is_active, display_order } = body

    if (!name || !quote) {
      return NextResponse.json({ error: "Name and quote are required." }, { status: 400 })
    }

    const testimonial = await createTestimonial({
      name,
      role: role || null,
      sport: sport || null,
      quote,
      avatar_url: null,
      rating: rating ?? 5,
      is_featured: is_featured ?? false,
      is_active: is_active ?? true,
      display_order: display_order ?? 0,
    })

    return NextResponse.json(testimonial, { status: 201 })
  } catch {
    return NextResponse.json({ error: "Failed to create testimonial." }, { status: 500 })
  }
}
