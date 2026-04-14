import { NextResponse } from "next/server"
import { updateTestimonial, deleteTestimonial } from "@/lib/db/testimonials"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()

    const allowedFields = [
      "name",
      "role",
      "sport",
      "quote",
      "rating",
      "is_featured",
      "is_active",
      "display_order",
    ] as const

    const updates: Record<string, unknown> = {}
    for (const field of allowedFields) {
      if (field in body) {
        updates[field] = body[field]
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update." }, { status: 400 })
    }

    const testimonial = await updateTestimonial(id, updates)
    return NextResponse.json(testimonial)
  } catch {
    return NextResponse.json({ error: "Failed to update testimonial." }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await deleteTestimonial(id)
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Failed to delete testimonial." }, { status: 500 })
  }
}
