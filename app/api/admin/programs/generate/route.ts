import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { aiGenerationRequestSchema } from "@/lib/validators/ai-generation"
import { generateProgram } from "@/lib/ai/orchestrator"
import { createAssignment } from "@/lib/db/assignments"
import { getUserById } from "@/lib/db/users"
import { getProgramById } from "@/lib/db/programs"
import { sendProgramReadyEmail } from "@/lib/email"

export const maxDuration = 120 // Allow up to 120 seconds for AI generation

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
    console.log("[generate] Request body:", JSON.stringify(body, null, 2))

    const result = aiGenerationRequestSchema.safeParse(body)

    if (!result.success) {
      console.log("[generate] Validation failed:", result.error.flatten().fieldErrors)
      return NextResponse.json(
        {
          error: "Invalid request data",
          details: result.error.flatten().fieldErrors,
        },
        { status: 400 }
      )
    }

    console.log("[generate] Starting orchestration for client:", result.data.client_id)
    const startTime = Date.now()

    // Run the AI program generation pipeline
    const orchestrationResult = await generateProgram(
      result.data,
      session.user.id
    )

    console.log(`[generate] Complete in ${Date.now() - startTime}ms — program_id: ${orchestrationResult.program_id}`)

    // Auto-assign program to the client
    try {
      await createAssignment({
        program_id: orchestrationResult.program_id,
        user_id: result.data.client_id,
        assigned_by: session.user.id,
        start_date: new Date().toISOString().split("T")[0],
        end_date: null,
        status: "active",
        notes: "Auto-assigned from AI program generation",
      })
      console.log(`[generate] Program auto-assigned to client ${result.data.client_id}`)
    } catch (assignError) {
      console.error("[generate] Failed to auto-assign program:", assignError)
    }

    // Send email notification to the client
    try {
      const [client, program] = await Promise.all([
        getUserById(result.data.client_id),
        getProgramById(orchestrationResult.program_id),
      ])
      await sendProgramReadyEmail(client.email, client.first_name, program.name)
      console.log(`[generate] Notification email sent to ${client.email}`)
    } catch (emailError) {
      console.error("[generate] Failed to send notification email:", emailError)
    }

    return NextResponse.json(
      {
        program_id: orchestrationResult.program_id,
        validation: orchestrationResult.validation,
        token_usage: orchestrationResult.token_usage,
        duration_ms: orchestrationResult.duration_ms,
        retries: orchestrationResult.retries,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("[generate] AI program generation failed:", error)

    const message =
      error instanceof Error
        ? error.message
        : "An unexpected error occurred during program generation."
    console.error("[generate] Returning error to client:", message)

    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
