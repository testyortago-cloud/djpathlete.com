import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { updateBookingStatus } from "@/lib/db/bookings"
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

    const booking = await updateBookingStatus(result.data.id, result.data.status, result.data.notes)
    return NextResponse.json({ success: true, booking })
  } catch {
    return NextResponse.json({ error: "Failed to update booking" }, { status: 500 })
  }
}
