import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createEventSchema } from "@/lib/validators/events"
import { createEvent } from "@/lib/db/events"

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const result = createEventSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid event data", fieldErrors: result.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    try {
      const event = await createEvent(result.data)
      return NextResponse.json({ event }, { status: 201 })
    } catch (err) {
      const msg = (err as Error).message
      if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
        return NextResponse.json(
          { error: "Slug already in use", fieldErrors: { slug: ["That slug is already taken"] } },
          { status: 409 },
        )
      }
      throw err
    }
  } catch (err) {
    console.error("[API admin/events POST]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
