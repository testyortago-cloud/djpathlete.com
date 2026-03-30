import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getAdminFirestore, getAdminRtdb } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"
import { getActiveUserIdsForProgram } from "@/lib/db/assignments"

const generateWeekSchema = z.object({
  assignment_id: z.string().uuid().optional(),
  client_id: z.string().uuid().optional(),
  admin_instructions: z.string().max(2000).optional(),
  /** When set, AI fills this specific blank week instead of appending a new one */
  target_week_number: z.number().int().min(1).optional(),
  /** When set, AI generates exercises for this single day only (1=Monday … 7=Sunday) */
  target_day_of_week: z.number().int().min(1).max(7).optional(),
  /** When set, AI restricts exercise selection to these exercise IDs only */
  pool_exercise_ids: z.array(z.string().uuid()).max(100).optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Auth check
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Unauthorized. Admin access required." },
        { status: 403 }
      )
    }

    const { id: programId } = await params
    const body = await request.json()
    const result = generateWeekSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid request data", details: result.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    // Verify the client is actually assigned to this program (only when client_id provided)
    if (result.data.client_id) {
      const activeUserIds = await getActiveUserIdsForProgram(programId)
      if (!activeUserIds.includes(result.data.client_id)) {
        return NextResponse.json(
          { error: "Client does not have an active assignment for this program." },
          { status: 400 }
        )
      }
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
          target_week_number: result.data.target_week_number ?? null,
          target_day_of_week: result.data.target_day_of_week ?? null,
          pool_exercise_ids: result.data.pool_exercise_ids ?? null,
        },
        requestedBy: session.user.id,
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

    return NextResponse.json(
      { jobId: jobRef.id, status: "pending" },
      { status: 202 }
    )
  } catch (error) {
    console.error("[generate-week] Failed to create AI job:", error)
    const message = error instanceof Error ? error.message : "An unexpected error occurred."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
