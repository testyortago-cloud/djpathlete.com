import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getBookingById, updateBookingStatus } from "@/lib/db/bookings"
import { recordAudit } from "@/lib/audit/record"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { NoAccessibleBusinessError, resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
import { z } from "zod"

const updateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["scheduled", "completed", "cancelled", "no_show"]),
  notes: z.string().optional(),
})

export async function PATCH(request: Request) {
  const session = await auth()
  if (!session?.user || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const result = updateSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json({ error: "Invalid data", details: result.error.flatten().fieldErrors }, { status: 400 })
    }

    const { id, status, notes } = result.data

    // SCOPED BY BUSINESS (G35). `schedule` is a grantable permission (the
    // Coach preset carries it), and this route answers with the booking's
    // contact name, email and phone. It used to resolve no tenant at all, so
    // any holder could change, and read back, any business's booking by id.
    // The tenant comes from the session and the business cookie, never from
    // the body.
    let businessId: string
    try {
      ;({ businessId } = await resolveAdminTenantForRequest(request))
    } catch (err) {
      if (err instanceof NoAccessibleBusinessError) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
      throw err
    }

    // Snapshot previous state for transition dispatch. A booking of another
    // business reads as absent, the same as one that does not exist, and
    // both answer 404 before anything is written. This read used to be
    // `.catch(() => null)`, which also turned a failed read into "no
    // snapshot" and went on to write anyway; a read failure now reaches the
    // 500 below instead.
    const existing = await getBookingById(businessId, id)
    if (!existing) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 })
    }

    // The write carries the same predicate as the read. `null` here means the
    // row stopped matching between the two (deleted in between): still a 404,
    // never a success with no booking in it.
    const booking = await updateBookingStatus(businessId, id, status, notes)
    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 })
    }

    // Dispatch audit slug on status transition only (note-only updates aren't audit-worthy).
    if (existing.status !== status) {
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
