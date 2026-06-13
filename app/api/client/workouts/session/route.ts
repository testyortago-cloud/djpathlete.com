import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { ensureSessionSchema, finishSessionSchema } from "@/lib/validators/workout-session"
import { ensureSession, setPrs, finishSession } from "@/lib/db/workout-sessions"
import { assertAssignmentPayable } from "@/lib/services/access-guard"

/** POST: create-or-find the day's session (and optionally record PRS at start). */
export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const parsed = ensureSessionSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 })
    }
    const { assignment_id, week_number, day_of_week, session_date, prs } = parsed.data

    const { ok } = await assertAssignmentPayable(assignment_id)
    if (!ok) return NextResponse.json({ error: "Payment required to access this program." }, { status: 402 })

    const ws = await ensureSession({
      user_id: session.user.id,
      assignment_id,
      week_number,
      day_of_week,
      session_date,
    })
    // Only record PRS if it was explicitly provided and not already set.
    if (prs !== undefined && ws.prs == null) await setPrs(ws.id, prs)

    return NextResponse.json({ session: { ...ws, prs: prs ?? ws.prs } }, { status: 200 })
  } catch (error) {
    console.error("ensure-session POST error:", error)
    return NextResponse.json({ error: "Failed to start session" }, { status: 500 })
  }
}

/** PATCH: finish the session — capture the single session RPE + volume load. */
export async function PATCH(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const parsed = finishSessionSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 })
    }
    const { session_id, session_rpe, volume_load_kg, duration_seconds } = parsed.data

    const ws = await finishSession(session_id, {
      session_rpe,
      volume_load_kg: volume_load_kg ?? null,
      duration_seconds: duration_seconds ?? null,
    })

    return NextResponse.json({ session: ws }, { status: 200 })
  } catch (error) {
    console.error("finish-session PATCH error:", error)
    return NextResponse.json({ error: "Failed to finish session" }, { status: 500 })
  }
}
