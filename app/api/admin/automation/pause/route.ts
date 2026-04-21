// app/api/admin/automation/pause/route.ts
// Admin-session toggle for the global automation_paused flag. GET returns
// the current value; POST { paused: boolean } updates it.

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getSetting, setSetting } from "@/lib/db/system-settings"

const BodySchema = z.object({ paused: z.boolean() })

export async function GET() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
  }

  try {
    const paused = await getSetting<boolean>("automation_paused", false)
    return NextResponse.json({ paused })
  } catch (err) {
    console.error("[automation/pause GET]", err)
    return NextResponse.json({ error: "Failed to read setting." }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
  }

  const raw = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body — { paused: boolean } required" }, { status: 400 })
  }

  try {
    await setSetting("automation_paused", parsed.data.paused, session.user.id)
    return NextResponse.json({ paused: parsed.data.paused })
  } catch (err) {
    console.error("[automation/pause POST]", err)
    return NextResponse.json({ error: "Failed to update setting." }, { status: 500 })
  }
}
