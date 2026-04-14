import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getEventById, getEventBySlug, createEvent } from "@/lib/db/events"

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const { id } = await ctx.params
    const source = await getEventById(id)
    if (!source) return NextResponse.json({ error: "Event not found" }, { status: 404 })

    let suffix = 1
    let newSlug = `${source.slug}-copy`
    while (await getEventBySlug(newSlug)) {
      suffix += 1
      newSlug = `${source.slug}-copy-${suffix}`
    }

    const base = {
      type: source.type,
      slug: newSlug,
      title: `${source.title} (copy)`,
      summary: source.summary,
      description: source.description,
      focus_areas: source.focus_areas,
      location_name: source.location_name,
      location_address: source.location_address,
      location_map_url: source.location_map_url,
      capacity: source.capacity,
      hero_image_url: source.hero_image_url,
      status: "draft" as const,
      age_min: source.age_min,
      age_max: source.age_max,
      start_date: source.start_date,
    }
    const duplicated =
      source.type === "clinic"
        ? await createEvent({ ...base, type: "clinic" })
        : await createEvent({
            ...base,
            type: "camp",
            end_date: source.end_date ?? source.start_date,
            session_schedule: source.session_schedule,
            price_dollars: source.price_cents != null ? source.price_cents / 100 : null,
          })

    return NextResponse.json({ event: duplicated }, { status: 201 })
  } catch (err) {
    console.error("[API admin/events duplicate]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
