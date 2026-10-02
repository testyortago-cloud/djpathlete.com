import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { getTestimonials, createTestimonial } from "@/lib/db/testimonials"
import { canAccessAdminPath } from "@/lib/permissions/guard"

async function requireAdminResponse() {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  return null
}

// The home page and /testimonials are ISR (`revalidate = 3600`), and that segment
// setting also caches the Supabase read for an hour — without this, a new photo or
// quote stays invisible on the live site for up to an hour after saving.
function revalidateTestimonialPages() {
  revalidatePath("/")
  revalidatePath("/testimonials")
}

export async function GET() {
  const forbidden = await requireAdminResponse()
  if (forbidden) return forbidden
  try {
    const testimonials = await getTestimonials(false)
    return NextResponse.json(testimonials)
  } catch {
    return NextResponse.json({ error: "Failed to fetch testimonials." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const forbidden = await requireAdminResponse()
  if (forbidden) return forbidden
  try {
    const body = await request.json()

    const { name, role, sport, quote, avatar_url, rating, is_featured, is_active, display_order } = body

    if (!name || !quote) {
      return NextResponse.json({ error: "Name and quote are required." }, { status: 400 })
    }

    const testimonial = await createTestimonial({
      name,
      role: role || null,
      sport: sport || null,
      quote,
      avatar_url: avatar_url || null,
      rating: rating ?? 5,
      is_featured: is_featured ?? false,
      is_active: is_active ?? true,
      display_order: display_order ?? 0,
    })

    revalidateTestimonialPages()
    return NextResponse.json(testimonial, { status: 201 })
  } catch {
    return NextResponse.json({ error: "Failed to create testimonial." }, { status: 500 })
  }
}
