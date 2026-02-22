import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getAssignments } from "@/lib/db/assignments"
import { getProgramExercises } from "@/lib/db/program-exercises"
import { getLatestProgressByExercises } from "@/lib/db/progress"
import { getProfileByUserId } from "@/lib/db/client-profiles"
import { getWeightRecommendation } from "@/lib/weight-recommendation"
import type { ClientContext } from "@/lib/weight-recommendation"
import { EmptyState } from "@/components/ui/empty-state"
import { WorkoutTabs } from "@/components/client/WorkoutTabs"
import { Dumbbell } from "lucide-react"
import type { Program, ProgramAssignment, Exercise, ProgramExercise } from "@/types/database"

export const dynamic = "force-dynamic"
export const metadata = { title: "My Workouts | DJP Athlete" }

type AssignmentWithProgram = ProgramAssignment & {
  programs: Program | null
}

type ProgramExerciseWithExercise = ProgramExercise & {
  exercises: Exercise | null
}

const dayLabels: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
}

function getTodayDow(): number {
  const jsDay = new Date().getDay()
  return jsDay === 0 ? 7 : jsDay
}

function getCurrentWeek(startDate: string, totalWeeks: number): number {
  const start = new Date(startDate)
  const now = new Date()
  const daysSinceStart = Math.floor(
    (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
  )
  // If program hasn't started yet, return 0 to signal "not started"
  if (daysSinceStart < 0) return 0
  // Week 1 = first 7 days, clamp to valid range
  const week = Math.floor(daysSinceStart / 7) + 1
  return Math.max(1, Math.min(week, totalWeeks))
}

export default async function ClientWorkoutsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const userId = session.user.id

  let activeAssignments: AssignmentWithProgram[] = []
  let programExercises: { assignment: AssignmentWithProgram; exercises: ProgramExerciseWithExercise[] }[] = []

  try {
    const assignments = (await getAssignments(userId)) as AssignmentWithProgram[]
    activeAssignments = assignments.filter((a) => a.status === "active")

    programExercises = await Promise.all(
      activeAssignments.map(async (assignment) => {
        if (!assignment.programs) return { assignment, exercises: [] }
        const exercises = (await getProgramExercises(
          assignment.program_id
        )) as ProgramExerciseWithExercise[]
        return { assignment, exercises }
      })
    )
  } catch {
    // DB tables may not exist yet — render gracefully with empty data
  }

  // Collect all unique exercise IDs across all programs
  const allExerciseIds = [
    ...new Set(
      programExercises.flatMap(({ exercises }) =>
        exercises
          .map((pe) => pe.exercise_id)
          .filter(Boolean)
      )
    ),
  ]

  // Batch-fetch progress history and client profile in parallel
  let progressByExercise: Record<string, import("@/types/database").ExerciseProgress[]> = {}
  let clientCtx: ClientContext | null = null
  try {
    const [progressResult, profile] = await Promise.all([
      allExerciseIds.length > 0
        ? getLatestProgressByExercises(userId, allExerciseIds, 5)
        : Promise.resolve({} as Record<string, import("@/types/database").ExerciseProgress[]>),
      getProfileByUserId(userId).catch(() => null),
    ])
    progressByExercise = progressResult
    if (profile) {
      clientCtx = {
        weight_kg: profile.weight_kg,
        gender: profile.gender,
        experience_level: profile.experience_level,
      }
    }
  } catch {
    // Tables may not exist yet
  }

  // Check if an exercise was logged today
  const todayStr = new Date().toISOString().slice(0, 10)
  function wasLoggedToday(exerciseId: string): boolean {
    const history = progressByExercise[exerciseId]
    if (!history || history.length === 0) return false
    return history[0].completed_at.slice(0, 10) === todayStr
  }

  // Build structured data — grouped by week then by day
  const tabPrograms = programExercises
    .filter(({ assignment }) => assignment.programs)
    .map(({ assignment, exercises }) => {
      const program = assignment.programs!
      const totalWeeks = program.duration_weeks || 1
      const currentWeek = getCurrentWeek(assignment.start_date, totalWeeks)

      // Group exercises by week_number, then by day_of_week
      const weekMap = new Map<number, Map<number, ProgramExerciseWithExercise[]>>()

      for (const ex of exercises) {
        const week = ex.week_number
        const day = ex.day_of_week
        if (!weekMap.has(week)) weekMap.set(week, new Map())
        const dayMap = weekMap.get(week)!
        if (!dayMap.has(day)) dayMap.set(day, [])
        dayMap.get(day)!.push(ex)
      }

      // Convert to structured weeks → days format
      // If a week has no exercises defined, fall back to the closest
      // earlier week (repeating weekly template pattern).
      const definedWeeks = [...weekMap.keys()].sort((a, b) => a - b)

      const weeks: Record<
        number,
        { day: number; dayLabel: string; assignmentId: string; exercises: ReturnType<typeof buildExerciseData> }[]
      > = {}

      for (let w = 1; w <= totalWeeks; w++) {
        // Find the best source week: exact match, or the closest defined week <= w
        let sourceWeek = definedWeeks[0] ?? 1
        for (const dw of definedWeeks) {
          if (dw <= w) sourceWeek = dw
          else break
        }
        const dayMap = weekMap.get(sourceWeek)
        if (dayMap) {
          const isCurrentWeek = w === currentWeek
          weeks[w] = [...dayMap.keys()]
            .sort((a, b) => a - b)
            .map((day) => ({
              day,
              dayLabel: dayLabels[day] ?? `Day ${day}`,
              assignmentId: assignment.id,
              exercises: buildExerciseData(dayMap.get(day)!, isCurrentWeek),
            }))
        }
      }

      return {
        programName: program.name,
        category: program.category,
        assignmentId: assignment.id,
        currentWeek,
        totalWeeks,
        weeks,
      }
    })

  function buildExerciseData(dayExercises: ProgramExerciseWithExercise[], isCurrentWeek: boolean) {
    return dayExercises
      .filter((pe) => pe.exercises)
      .map((pe) => {
        const exercise = pe.exercises!
        const history = progressByExercise[exercise.id] ?? []
        const recommendation = getWeightRecommendation(history, exercise, pe, clientCtx)
        return {
          programExercise: pe as ProgramExercise,
          exercise,
          recommendation,
          loggedToday: isCurrentWeek && wasLoggedToday(exercise.id),
        }
      })
  }

  return (
    <div>
      <h1 className="text-xl sm:text-2xl font-semibold text-primary mb-4">My Workouts</h1>

      {activeAssignments.length === 0 ? (
        <EmptyState
          icon={Dumbbell}
          heading="No active programs"
          description="You don't have any active workout programs. Once a program is assigned to you, your exercises will appear here."
        />
      ) : (
        <WorkoutTabs programs={tabPrograms} todayDow={getTodayDow()} />
      )}
    </div>
  )
}
