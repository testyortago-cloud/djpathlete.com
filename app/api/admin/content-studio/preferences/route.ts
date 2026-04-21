import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  getPreferences,
  upsertPreferences,
  type PreferencesPatch,
} from "@/lib/db/user-preferences"
import type { CalendarDefaultView } from "@/types/database"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const prefs = await getPreferences(session.user.id)
  return NextResponse.json(prefs)
}

export async function PATCH(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const patch: PreferencesPatch = {}
  if (body.calendar_default_view !== undefined) {
    const v = body.calendar_default_view
    if (v !== "month" && v !== "week" && v !== "day") {
      return NextResponse.json(
        { error: "calendar_default_view must be month|week|day" },
        { status: 400 },
      )
    }
    patch.calendar_default_view = v as CalendarDefaultView
  }
  if (body.last_pipeline_filters !== undefined) {
    if (
      typeof body.last_pipeline_filters !== "object" ||
      Array.isArray(body.last_pipeline_filters) ||
      body.last_pipeline_filters === null
    ) {
      return NextResponse.json(
        { error: "last_pipeline_filters must be an object" },
        { status: 400 },
      )
    }
    patch.last_pipeline_filters = body.last_pipeline_filters as Record<string, unknown>
  }
  if (body.pipeline_lanes_collapsed !== undefined) {
    if (
      typeof body.pipeline_lanes_collapsed !== "object" ||
      Array.isArray(body.pipeline_lanes_collapsed) ||
      body.pipeline_lanes_collapsed === null
    ) {
      return NextResponse.json(
        { error: "pipeline_lanes_collapsed must be an object" },
        { status: 400 },
      )
    }
    patch.pipeline_lanes_collapsed = body.pipeline_lanes_collapsed as Record<string, boolean>
  }

  const updated = await upsertPreferences(session.user.id, patch)
  return NextResponse.json(updated)
}
