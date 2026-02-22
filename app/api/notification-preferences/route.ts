import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  getPreferences,
  upsertPreferences,
} from "@/lib/db/notification-preferences"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const prefs = await getPreferences(session.user.id)
  return NextResponse.json(prefs)
}

export async function PATCH(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()

  // Only allow known preference keys
  const allowed = [
    "notify_new_client",
    "notify_payment_received",
    "notify_program_completed",
    "email_notifications",
    "workout_reminders",
  ] as const

  const updates: Record<string, boolean> = {}
  for (const key of allowed) {
    if (typeof body[key] === "boolean") {
      updates[key] = body[key]
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No valid preferences provided" },
      { status: 400 }
    )
  }

  const prefs = await upsertPreferences(session.user.id, updates)
  return NextResponse.json(prefs)
}
