import { NextResponse } from "next/server"
import { updateTestimonial, deleteTestimonial } from "@/lib/db/testimonials"
import { recordAudit } from "@/lib/audit/record"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()

    const allowedFields = [
      "name",
      "role",
      "sport",
      "quote",
      "avatar_url",
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

    // Audit when moderation-relevant flags change (active/featured).
    if ("is_active" in updates || "is_featured" in updates) {
      const decisionParts: string[] = []
      if ("is_active" in updates) decisionParts.push(updates.is_active ? "activated" : "deactivated")
      if ("is_featured" in updates) decisionParts.push(updates.is_featured ? "featured" : "unfeatured")
      await recordAudit({
        action: "testimonial.moderated",
        category: "marketing",
        target: { type: "testimonial", id, label: typeof updates.name === "string" ? updates.name : undefined },
        metadata: {
          decision: decisionParts.join(","),
          is_active: "is_active" in updates ? updates.is_active : undefined,
          is_featured: "is_featured" in updates ? updates.is_featured : undefined,
        },
        request,
      })
    }

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
