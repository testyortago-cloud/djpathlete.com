import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { aiGenerationRequestSchema } from "@/lib/validators/ai-generation"
import { getAdminFirestore, getAdminRtdb } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"
import { createGenerationLog } from "@/lib/db/ai-generation-log"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { enqueueGenerationTask, GENERATION_QUEUES } from "@/lib/ai-task-queue"
import { resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
import { formatClientQuizResult, getClientQuizResult } from "@/lib/quizzes/client-result"
import type { AiGenerationRequest } from "@/lib/validators/ai-generation"

/**
 * The client's own quiz result as a prompt section. Skipped with "ignore profile", which means "assume
 * nothing about this client". A failed read only drops the section: it must never fail a generation.
 */
async function selfAssessmentSection(request: Request, data: AiGenerationRequest): Promise<string | null> {
  if (!data.client_id || data.ignore_profile) return null
  try {
    const { businessId } = await resolveAdminTenantForRequest(request)
    const result = await getClientQuizResult(businessId, data.client_id)
    return result ? formatClientQuizResult(result) : null
  } catch (error) {
    console.error("[generate] self-assessment read failed:", error instanceof Error ? error.message : error)
    return null
  }
}

export async function POST(request: Request) {
  try {
    // Auth check
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
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
        { status: 400 },
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
      cache_creation_tokens: null,
      cache_read_tokens: null,
      duration_ms: null,
      completed_at: null,
      current_step: 0,
      total_steps: 3,
    })

    // Set by the server after Zod parsing, which strips a browser-sent key of the same name. Spread, not
    // assigned: Firestore refuses an undefined field.
    const selfAssessment = await selfAssessmentSection(request, result.data)

    // Create Firestore job doc — Firebase Function picks it up via onDocumentCreated
    const firestoreDb = getAdminFirestore()
    const jobRef = firestoreDb.collection("ai_jobs").doc()

    await jobRef.set({
      type: "program_generation",
      status: "pending",
      // Executed by programGenerationTask (Cloud Tasks, 1800s), NOT by the
      // Firestore create trigger (Eventarc, 540s hard cap). The trigger checks
      // this field and yields, so the job cannot run twice.
      dispatch: "task",
      input: {
        request: { ...result.data, ...(selfAssessment ? { self_assessment: selfAssessment } : {}) },
        requestedBy: session.user.id,
        logId: log.id,
        notify_email: result.data.notify_email ?? null,
      },
      result: null,
      error: null,
      userId: session.user.id,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    // Hand the job to Cloud Tasks. `dispatch: "task"` above tells the Firestore
    // create trigger to leave it alone, so this enqueue is now the ONLY thing
    // that will run it — a failure here leaves a job nothing will ever pick up,
    // which the coach experiences as a spinner that never resolves. Mark it
    // failed and say so, rather than answering 202 for work that will not start.
    try {
      await enqueueGenerationTask(GENERATION_QUEUES.program, jobRef.id)
    } catch (enqueueError) {
      const detail = enqueueError instanceof Error ? enqueueError.message : String(enqueueError)
      console.error("[generate] enqueue failed:", detail)
      await jobRef.update({
        status: "failed",
        error: `Could not queue the generation: ${detail}`,
        updatedAt: FieldValue.serverTimestamp(),
      })
      return NextResponse.json(
        { error: "Could not queue the generation. The AI functions may not be deployed yet." },
        { status: 503 },
      )
    }

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
      { status: 202 },
    )
  } catch (error) {
    console.error("[generate] Failed to create AI job:", error)

    const message = error instanceof Error ? error.message : "An unexpected error occurred during program generation."

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
