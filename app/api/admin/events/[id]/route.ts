import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { updateEventSchema } from "@/lib/validators/events"
import { updateEvent, deleteEvent, setEventStatus, getEventById } from "@/lib/db/events"

async function requireAdmin() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") return null
  return session
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const { id } = await ctx.params
    const body = await request.json()
    const result = updateEventSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid event data", fieldErrors: result.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { status, ...rest } = result.data as { status?: string; [k: string]: unknown }

    try {
      if (status) {
        await setEventStatus(id, status as "draft" | "published" | "cancelled" | "completed")
      }
      const updated = Object.keys(rest).length > 0 ? await updateEvent(id, rest) : await getEventById(id)
      if (!updated) return NextResponse.json({ error: "Event not found" }, { status: 404 })
      return NextResponse.json({ event: updated })
    } catch (err) {
      const msg = (err as Error).message
      if (msg.toLowerCase().includes("cannot transition")) {
        return NextResponse.json({ error: msg }, { status: 409 })
      }
      if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
        return NextResponse.json(
          { error: "Slug already in use", fieldErrors: { slug: ["That slug is already taken"] } },
          { status: 409 },
        )
      }
      throw err
    }
  } catch (err) {
    console.error("[API admin/events PATCH]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const { id } = await ctx.params
    try {
      await deleteEvent(id)
      return NextResponse.json({ ok: true })
    } catch (err) {
      const msg = (err as Error).message
      if (msg.includes("Only draft events") || msg.includes("Cannot delete")) {
        return NextResponse.json({ error: msg }, { status: 409 })
      }
      throw err
    }
  } catch (err) {
    console.error("[API admin/events DELETE]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
