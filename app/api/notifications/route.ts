import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getNotifications, markAsRead, markAllAsRead } from "@/lib/db/notifications"
import { z } from "zod"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const all = await getNotifications(session.user.id)
    const notifications = all.slice(0, 50)
    const unreadCount = all.filter((n) => !n.is_read).length

    return NextResponse.json({ notifications, unreadCount })
  } catch (error) {
    console.error("Notifications GET error:", error)
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 })
  }
}

const patchSchema = z.union([z.object({ id: z.string().uuid() }), z.object({ markAll: z.literal(true) })])

export async function PATCH(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const parsed = patchSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 })
    }

    if ("markAll" in parsed.data) {
      await markAllAsRead(session.user.id)
      return NextResponse.json({ success: true })
    }

    // The caller's own notification only (G45). Someone else's id reads as
    // not found, exactly like a made-up one.
    const notification = await markAsRead(session.user.id, parsed.data.id)
    if (!notification) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 })
    }
    return NextResponse.json({ notification })
  } catch (error) {
    console.error("Notifications PATCH error:", error)
    return NextResponse.json({ error: "Failed to update notification" }, { status: 500 })
  }
}
