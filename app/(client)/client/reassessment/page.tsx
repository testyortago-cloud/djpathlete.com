import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getLatestAssessmentResult, getActiveQuestions } from "@/lib/db/assessments"
import { getAssignments } from "@/lib/db/assignments"
import { getProgramExercises } from "@/lib/db/program-exercises"
import { ReassessmentForm } from "@/components/client/ReassessmentForm"
import { EmptyState } from "@/components/ui/empty-state"
import { ClipboardList } from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader"
import type { ProgramAssignment, Exercise, AssessmentQuestion } from "@/types/database"

export const metadata = { title: "Reassessment | DJP Athlete" }

type ProgramExerciseWithExercise = {
  id: string
  exercise_id: string
  exercises: Exercise | null
}

export default async function ReassessmentPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const userId = session.user.id

  // Get the latest assessment result
  let previousResult
  try {
    previousResult = await getLatestAssessmentResult(userId)
  } catch {
    // No result found
  }

  if (!previousResult) {
    return (
      <div className="max-w-3xl mx-auto">
        <EmptyState
          icon={ClipboardList}
          heading="No Previous Assessment"
          description="You need to complete an initial assessment before taking a reassessment. Please complete the assessment first."
          ctaLabel="Take Assessment"
          ctaHref="/client/questionnaire"
        />
      </div>
    )
  }

  // Get the most recently completed program's exercises
  let programExercises: { id: string; name: string }[] = []
  try {
    const allAssignments = await getAssignments(userId)
    const completedAssignment = (allAssignments as ProgramAssignment[]).find((a) => a.status === "completed")

    if (completedAssignment) {
      const exercises = (await getProgramExercises(completedAssignment.program_id)) as ProgramExerciseWithExercise[]

      // Deduplicate by exercise_id and extract name
      const seen = new Set<string>()
      programExercises = exercises
        .filter((pe) => {
          if (!pe.exercises || seen.has(pe.exercise_id)) return false
          seen.add(pe.exercise_id)
          return true
        })
        .map((pe) => ({
          id: pe.exercise_id,
          name: pe.exercises!.name,
        }))
    }
  } catch {
    // If we can't get exercises, proceed with empty list
  }

  // Get active assessment questions (movement_screen section)
  let assessmentQuestions: AssessmentQuestion[] = []
  try {
    const allQuestions = await getActiveQuestions()
    assessmentQuestions = allQuestions.filter((q) => q.section === "movement_screen")
  } catch {
    // Tables may not exist yet
  }

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Reassessment"
        description="Help us fine-tune your next program based on how the last one went. This takes about 2 minutes."
      />
      <ReassessmentForm
        previousResult={previousResult}
        programExercises={programExercises}
        assessmentQuestions={assessmentQuestions}
      />
    </div>
  )
}
