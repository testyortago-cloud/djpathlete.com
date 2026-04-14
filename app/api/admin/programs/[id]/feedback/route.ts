import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { programFeedbackSubmitSchema } from "@/lib/validators/ai-program-feedback"
import { submitProgramFeedback, getProgramFeedback } from "@/lib/db/ai-program-feedback"
import { getProgramById } from "@/lib/db/programs"
import { getGenerationLogById } from "@/lib/db/ai-generation-log"
import { embedProgramFeedback } from "@/lib/ai/program-feedback"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
    }

    const { id: programId } = await params
    const body = await request.json()
    const parsed = programFeedbackSubmitSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body.", details: parsed.error.issues }, { status: 400 })
    }

    // Look up the program to get generation context
    const program = await getProgramById(programId)
    if (!program) {
      return NextResponse.json({ error: "Program not found." }, { status: 404 })
    }

    // Try to find generation log for this program
    let generationLogId: string | null = null
    let splitType: string | null = null
    let difficulty: string | null = null

    if (program.is_ai_generated) {
      // The generation_log_id might be stored on the program or we search by program_id
      // Try to get split_type and difficulty from the program itself
      splitType = ((program as unknown as Record<string, unknown>).split_type as string) ?? null
      difficulty = program.difficulty ?? null
    }

    const feedback = await submitProgramFeedback({
      program_id: programId,
      generation_log_id: generationLogId,
      reviewer_id: session.user.id,
      overall_rating: parsed.data.overall_rating,
      balance_quality: parsed.data.balance_quality ?? null,
      exercise_selection_quality: parsed.data.exercise_selection_quality ?? null,
      periodization_quality: parsed.data.periodization_quality ?? null,
      difficulty_appropriateness: parsed.data.difficulty_appropriateness ?? null,
      split_type: splitType,
      difficulty,
      specific_issues: parsed.data.specific_issues,
      corrections_made: parsed.data.corrections_made,
      notes: parsed.data.notes ?? null,
    })

    // Fire-and-forget: embed the feedback for future vector search
    embedProgramFeedback(feedback.id).catch(() => {})

    return NextResponse.json({ success: true, feedback })
  } catch (error) {
    console.error("[Program Feedback] Error:", error)
    return NextResponse.json({ error: "Failed to submit program feedback." }, { status: 500 })
  }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
    }

    const { id: programId } = await params
    const feedback = await getProgramFeedback(programId)

    return NextResponse.json({ feedback })
  } catch (error) {
    console.error("[Program Feedback] Error:", error)
    return NextResponse.json({ error: "Failed to fetch program feedback." }, { status: 500 })
  }
}
