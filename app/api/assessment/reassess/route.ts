import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getLatestAssessmentResult, getActiveQuestions, createAssessmentResult } from "@/lib/db/assessments"
import { getAssignments } from "@/lib/db/assignments"
import { getProgress } from "@/lib/db/progress"
import { computeReassessmentAdjustment, computeAssessmentScores } from "@/lib/assessment-scoring"
import type { AssessmentFeedback, ProgramAssignment } from "@/types/database"

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = session.user.id
    const body = await request.json()

    const {
      answers,
      feedback,
    }: {
      answers: Record<string, string | string[] | number>
      feedback: AssessmentFeedback
    } = body

    if (!answers || !feedback || !feedback.overall_feeling) {
      return NextResponse.json({ error: "Missing required fields: answers, feedback" }, { status: 400 })
    }

    // Get previous assessment result
    const previousResult = await getLatestAssessmentResult(userId)
    if (!previousResult) {
      return NextResponse.json(
        { error: "No previous assessment found. Complete an initial assessment first." },
        { status: 400 },
      )
    }

    // Get all active questions for scoring
    const questions = await getActiveQuestions()

    // Compute new movement scores from re-tested answers
    const { computed_levels: newComputedLevels, max_difficulty_score: newMovementMaxDifficulty } =
      computeAssessmentScores({ answers: answers as Record<string, string>, questions })

    // Get the most recently completed assignment for RPE data
    const allAssignments = await getAssignments(userId)
    const completedAssignment = (allAssignments as ProgramAssignment[]).find((a) => a.status === "completed")

    // Compute average RPE from exercise progress for the completed assignment
    let avgRpe: number = 7 // default mid-range RPE
    if (completedAssignment) {
      try {
        const progressRecords = await getProgress(userId)
        const assignmentProgress = progressRecords.filter(
          (p: { assignment_id: string | null; rpe: number | null }) =>
            p.assignment_id === completedAssignment.id && p.rpe != null,
        )
        if (assignmentProgress.length > 0) {
          avgRpe =
            assignmentProgress.reduce((sum: number, p: { rpe: number | null }) => sum + (p.rpe ?? 0), 0) /
            assignmentProgress.length
        }
      } catch {
        // If progress query fails, use default
      }
    }

    // Check if movement scores improved compared to previous
    const movementImproved = newMovementMaxDifficulty > previousResult.max_difficulty_score

    // Compute the reassessment adjustment (returns a number: the new max difficulty score)
    const newMaxDifficultyScore = computeReassessmentAdjustment({
      feedback,
      avgRpe,
      movementImproved,
      previousMaxDifficulty: previousResult.max_difficulty_score,
    })

    const adjustment = newMaxDifficultyScore - previousResult.max_difficulty_score

    // Create the new assessment result
    const newResult = await createAssessmentResult({
      user_id: userId,
      assessment_type: "reassessment",
      answers: answers as Record<string, string>,
      computed_levels: newComputedLevels,
      max_difficulty_score: newMaxDifficultyScore,
      triggered_program_id: null, // Will be set when AI generates the program
      previous_assessment_id: previousResult.id,
      feedback: {
        ...feedback,
        rpe_average: avgRpe,
      } as Record<string, unknown>,
      completed_at: new Date().toISOString(),
    })

    // TODO: Trigger AI program generation from Phase 3C
    // await triggerProgramGeneration(userId, newResult)

    return NextResponse.json({
      result: newResult,
      adjustment,
      previousMaxDifficulty: previousResult.max_difficulty_score,
      newMaxDifficulty: newMaxDifficultyScore,
    })
  } catch (error) {
    console.error("Reassessment error:", error)
    return NextResponse.json({ error: "Failed to process reassessment. Please try again." }, { status: 500 })
  }
}
