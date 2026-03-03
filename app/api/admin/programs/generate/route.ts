import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { aiGenerationRequestSchema } from "@/lib/validators/ai-generation"
import { getAdminFirestore, getAdminRtdb } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"
import { createGenerationLog } from "@/lib/db/ai-generation-log"

export async function POST(request: Request) {
  try {
    // Auth check
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Unauthorized. Admin access required." },
        { status: 403 }
      )
    }

    // Parse and validate request body
    const body = await request.json()
    const result = aiGenerationRequestSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        {
          error: "Invalid request data",
          details: result.error.flatten().fieldErrors,
        },
        { status: 400 }
      )
    }

    // Create Supabase log entry first so we can return log_id for polling
    const log = await createGenerationLog({
      program_id: null,
      client_id: result.data.client_id ?? null,
      requested_by: session.user.id,
      status: "pending",
      input_params: result.data,
      output_summary: null,
      error_message: null,
      model_used: "haiku+sonnet-mixed",
      tokens_used: null,
      duration_ms: null,
      completed_at: null,
      current_step: 0,
      total_steps: 3,
    })

    // Create Firestore job doc — Firebase Function picks it up via onDocumentCreated
    const firestoreDb = getAdminFirestore()
    const jobRef = firestoreDb.collection("ai_jobs").doc()

    await jobRef.set({
      type: "program_generation",
      status: "pending",
      input: {
        request: result.data,
        requestedBy: session.user.id,
        logId: log.id,
      },
      result: null,
      error: null,
      userId: session.user.id,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    // Seed RTDB node so client listener gets immediate data
    try {
      const rtdb = getAdminRtdb()
      await rtdb.ref(`ai_jobs/${jobRef.id}`).set({
        status: "pending",
        progress: { status: "queued", current_step: 0, total_steps: 3 },
        result: null,
        error: null,
        updatedAt: Date.now(),
      })
    } catch (rtdbErr) {
      console.warn("[generate] Failed to seed RTDB node:", rtdbErr)
    }

    return NextResponse.json(
      {
        jobId: jobRef.id,
        log_id: log.id,
        status: "pending",
      },
      { status: 202 }
    )
  } catch (error) {
    console.error("[generate] Failed to create AI job:", error)

    const message =
      error instanceof Error
        ? error.message
        : "An unexpected error occurred during program generation."

    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
