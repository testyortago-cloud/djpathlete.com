import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getAdminFirestore, getAdminRtdb } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"
import { getActiveUserIdsForProgram } from "@/lib/db/assignments"
import { findInFlightWeekGeneration } from "@/lib/ai-jobs"

const generateWeekSchema = z.object({
  assignment_id: z.string().uuid().optional(),
  client_id: z.string().uuid().optional(),
  admin_instructions: z.string().max(2000).optional(),
  /** When set, AI fills this specific blank week instead of appending a new one */
  target_week_number: z.number().int().min(1).optional(),
  /** When set, AI generates exercises for this single day only (1=Monday … 7=Sunday) */
  target_day_of_week: z.number().int().min(1).max(7).optional(),
  /** When set, AI biases exercise selection toward these exercise IDs (Exercise Pool) */
  pool_exercise_ids: z.array(z.string().uuid()).max(100).optional(),
  /**
   * How the Exercise Pool is enforced:
   * - "preferred" (default) → strong bias + prompt guidance, AI may pick
   *   outside the pool when no pool exercise fits a slot.
   * - "strict" → hard restriction, AI may ONLY pick from the pool.
   */
  pool_mode: z.enum(["preferred", "strict"]).optional(),
  /** When set, AI ignores the client profile and relies on coach instructions */
  ignore_profile: z.boolean().optional(),
  /** When set, the Firebase function emails this address on completion / failure. */
  notify_email: z.string().email().optional().nullable(),
})

/**
 * Is a generation already running for this program/week/day?
 * The dialogs call this on open so a reload or a reopened dialog re-attaches to
 * the running job (spinner) instead of offering a form that would double-queue.
 * Query params: target_week_number, target_day_of_week (both optional).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
    }

    const { id: programId } = await params
    const url = new URL(request.url)
    const rawWeek = url.searchParams.get("target_week_number")
    const rawDay = url.searchParams.get("target_day_of_week")

    // Reject junk rather than coercing NaN, which would silently never match.
    const parseOptionalInt = (raw: string | null): number | null | undefined => {
      if (raw === null || raw === "") return null
      const n = Number(raw)
      return Number.isInteger(n) ? n : undefined
    }

    const targetWeekNumber = parseOptionalInt(rawWeek)
    const targetDayOfWeek = parseOptionalInt(rawDay)
    if (targetWeekNumber === undefined || targetDayOfWeek === undefined) {
      return NextResponse.json({ error: "target_week_number/target_day_of_week must be integers" }, { status: 400 })
    }

    const inFlight = await findInFlightWeekGeneration(programId, targetWeekNumber, targetDayOfWeek)
    return NextResponse.json({ inFlight })
  } catch (error) {
    console.error("[generate-week] in-flight lookup failed:", error)
    // Fail open: a lookup outage must not block the coach from generating.
    return NextResponse.json({ inFlight: null })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Auth check
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
    }

    const { id: programId } = await params
    const body = await request.json()
    const result = generateWeekSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid request data", details: result.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    // Verify the client is actually assigned to this program (only when client_id provided)
    if (result.data.client_id) {
      const activeUserIds = await getActiveUserIdsForProgram(programId)
      if (!activeUserIds.includes(result.data.client_id)) {
        return NextResponse.json(
          { error: "Client does not have an active assignment for this program." },
          { status: 400 },
        )
      }
    }

    const targetWeekNumber = result.data.target_week_number ?? null
    const targetDayOfWeek = result.data.target_day_of_week ?? null

    // Never queue a second generation over a running one. The dialog's own
    // guard is component state, so a reload or a reopened dialog brings the
    // form back — this is the check that actually holds. Returns the existing
    // job so the caller attaches to it instead of getting an error.
    const inFlight = await findInFlightWeekGeneration(programId, targetWeekNumber, targetDayOfWeek)
    if (inFlight) {
      return NextResponse.json(
        { jobId: inFlight.jobId, status: inFlight.status, deduped: true, startedAt: inFlight.startedAt },
        { status: 202 },
      )
    }

    // Create Firestore job doc — Firebase Function picks it up via onDocumentCreated
    const firestoreDb = getAdminFirestore()
    const jobRef = firestoreDb.collection("ai_jobs").doc()

    await jobRef.set({
      type: "week_generation",
      status: "pending",
      input: {
        request: {
          program_id: programId,
          assignment_id: result.data.assignment_id ?? null,
          client_id: result.data.client_id ?? null,
          admin_instructions: result.data.admin_instructions ?? null,
          target_week_number: targetWeekNumber,
          target_day_of_week: targetDayOfWeek,
          pool_exercise_ids: result.data.pool_exercise_ids ?? null,
          pool_mode: result.data.pool_mode ?? "preferred",
          ignore_profile: result.data.ignore_profile ?? false,
        },
        requestedBy: session.user.id,
        notify_email: result.data.notify_email ?? null,
      },
      result: null,
      error: null,
      userId: session.user.id,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    // Seed RTDB node for real-time updates
    try {
      const rtdb = getAdminRtdb()
      await rtdb.ref(`ai_jobs/${jobRef.id}`).set({
        status: "pending",
        progress: { status: "queued", current_step: 0, total_steps: 5 },
        result: null,
        error: null,
        updatedAt: Date.now(),
      })
    } catch (rtdbErr) {
      console.warn("[generate-week] Failed to seed RTDB node:", rtdbErr)
    }

    return NextResponse.json({ jobId: jobRef.id, status: "pending" }, { status: 202 })
  } catch (error) {
    console.error("[generate-week] Failed to create AI job:", error)
    const message = error instanceof Error ? error.message : "An unexpected error occurred."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
