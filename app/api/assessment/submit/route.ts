import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { assessmentSubmitSchema } from "@/lib/validators/assessment"
import { getActiveQuestions, getLatestAssessmentResult, createAssessmentResult } from "@/lib/db/assessments"
import { computeAssessmentScores } from "@/lib/assessment-scoring"

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const parsed = assessmentSubmitSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const { assessment_type, answers, feedback } = parsed.data

    // Fetch active questions for scoring
    const questions = await getActiveQuestions()

    // Compute scores
    const { computed_levels, max_difficulty_score } = computeAssessmentScores({
      answers,
      questions,
    })

    // For reassessments, link to the previous assessment
    let previous_assessment_id: string | null = null
    if (assessment_type === "reassessment") {
      const previous = await getLatestAssessmentResult(session.user.id)
      if (previous) {
        previous_assessment_id = previous.id
      }
    }

    // Save result
    const result = await createAssessmentResult({
      user_id: session.user.id,
      assessment_type,
      answers,
      computed_levels,
      max_difficulty_score,
      triggered_program_id: null,
      previous_assessment_id,
      feedback,
      completed_at: new Date().toISOString(),
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    console.error("Assessment submit error:", error)
    return NextResponse.json({ error: "Failed to submit assessment. Please try again." }, { status: 500 })
  }
}
