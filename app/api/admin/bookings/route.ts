import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getBookingById, updateBookingStatus } from "@/lib/db/bookings"
import { recordAudit } from "@/lib/audit/record"
import { z } from "zod"

const updateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["scheduled", "completed", "cancelled", "no_show"]),
  notes: z.string().optional(),
})

export async function PATCH(request: Request) {
  const session = await auth()
  if (!session?.user || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const result = updateSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json({ error: "Invalid data", details: result.error.flatten().fieldErrors }, { status: 400 })
    }

    const { id, status, notes } = result.data

    // Snapshot previous state for transition dispatch.
    const existing = await getBookingById(id).catch(() => null)

    const booking = await updateBookingStatus(id, status, notes)

    // Dispatch audit slug on status transition only (note-only updates aren't audit-worthy).
    if (existing && existing.status !== status) {
      let slug: string | null = null
      if (status === "completed") slug = "booking.completed"
      else if (status === "cancelled") slug = "booking.cancelled"
      else if (status === "no_show") slug = "booking.no_show"

      if (slug) {
        await recordAudit({
          action: slug,
          category: "commerce",
          target: { type: "booking", id, label: existing.booking_date ?? undefined },
          metadata: { from_status: existing.status, to_status: status },
          request,
        })
      }
    }

    return NextResponse.json({ success: true, booking })
  } catch {
    return NextResponse.json({ error: "Failed to update booking" }, { status: 500 })
  }
}
