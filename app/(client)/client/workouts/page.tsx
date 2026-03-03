import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getAssignments } from "@/lib/db/assignments"
import { getProgramExercises } from "@/lib/db/program-exercises"
import { getLatestProgressByExercises } from "@/lib/db/progress"
import { getProfileByUserId } from "@/lib/db/client-profiles"
import { getWeightRecommendation } from "@/lib/weight-recommendation"
import type { ClientContext } from "@/lib/weight-recommendation"
import { EmptyState } from "@/components/ui/empty-state"
import { WorkoutViewToggle } from "@/components/client/WorkoutViewToggle"
import type { WorkoutCalendarDay } from "@/components/client/WorkoutCalendar"
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

/** Build sequential "Day N" labels from the sorted day-of-week values */
function buildDayLabels(days: number[]): Record<number, string> {
  const sorted = [...days].sort((a, b) => a - b)
  const labels: Record<number, string> = {}
  sorted.forEach((dow, i) => {
    labels[dow] = `Day ${i + 1}`
  })
  return labels
}

function getTodayDow(): number {
  const jsDay = new Date().getDay()
  return jsDay === 0 ? 7 : jsDay
}

/** Convert a (startDate, weekNumber, dayOfWeek) triple to an actual calendar Date */
function getDateForWorkoutDay(
  startDate: string,
  weekNumber: number,
  dayOfWeek: number
): Date {
  const start = new Date(startDate)
  // Normalize start to its Monday (ISO week start)
  const jsDay = start.getDay() // 0=Sun..6=Sat
  const mondayOffset = jsDay === 0 ? -6 : 1 - jsDay
  const monday = new Date(start)
  monday.setDate(start.getDate() + mondayOffset)

  // weekNumber is 1-based, dayOfWeek is 1=Mon..7=Sun
  const target = new Date(monday)
  target.setDate(monday.getDate() + (weekNumber - 1) * 7 + (dayOfWeek - 1))
  return target
}

/** Fallback: compute current week from start date if DB current_week is not available */
function getCurrentWeekFromDate(startDate: string, totalWeeks: number): number {
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
      const totalWeeks = assignment.total_weeks ?? program.duration_weeks ?? 1
      // Use DB-tracked current_week; fall back to date-based calculation
      const currentWeek = assignment.current_week ?? getCurrentWeekFromDate(assignment.start_date, totalWeeks)

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
          const sortedDays = [...dayMap.keys()].sort((a, b) => a - b)
          const labels = buildDayLabels(sortedDays)
          weeks[w] = sortedDays
            .map((day) => ({
              day,
              dayLabel: labels[day] ?? `Day ${day}`,
              assignmentId: assignment.id,
              exercises: buildExerciseData(dayMap.get(day)!, isCurrentWeek),
            }))
        }
      }

      return {
        programName: program.name,
        category: program.category,
        difficulty: program.difficulty,
        periodization: program.periodization ?? null,
        splitType: program.split_type ?? null,
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

  // Build calendar day data from the same program/exercise data (no extra DB queries)
  const calendarDays: WorkoutCalendarDay[] = []
  for (const { assignment, exercises } of programExercises) {
    if (!assignment.programs) continue
    const program = assignment.programs
    const totalWeeks = assignment.total_weeks ?? program.duration_weeks ?? 1

    // Collect unique (week, day) combos with counts
    const dayMap = new Map<
      string,
      { weekNumber: number; dayOfWeek: number; exerciseCount: number; completedCount: number }
    >()

    for (const ex of exercises) {
      const key = `${ex.week_number}-${ex.day_of_week}`
      if (!dayMap.has(key)) {
        dayMap.set(key, {
          weekNumber: ex.week_number,
          dayOfWeek: ex.day_of_week,
          exerciseCount: 0,
          completedCount: 0,
        })
      }
      const entry = dayMap.get(key)!
      entry.exerciseCount++
      if (ex.exercise_id && wasLoggedToday(ex.exercise_id)) {
        entry.completedCount++
      }
    }

    // Expand across all weeks (template repetition like tabPrograms does)
    const definedWeeks = [...dayMap.keys()].map((k) => Number(k.split("-")[0]))
    const uniqueDefinedWeeks = [...new Set(definedWeeks)].sort((a, b) => a - b)

    for (let w = 1; w <= totalWeeks; w++) {
      // Find the best source week
      let sourceWeek = uniqueDefinedWeeks[0] ?? 1
      for (const dw of uniqueDefinedWeeks) {
        if (dw <= w) sourceWeek = dw
        else break
      }

      // Get all days for that source week
      for (const [key, entry] of dayMap) {
        if (entry.weekNumber !== sourceWeek) continue
        calendarDays.push({
          date: getDateForWorkoutDay(assignment.start_date, w, entry.dayOfWeek),
          exerciseCount: entry.exerciseCount,
          completedCount: w === (assignment.current_week ?? 1) ? entry.completedCount : 0,
          programName: program.name,
          dayOfWeek: entry.dayOfWeek,
          weekNumber: w,
        })
      }
    }
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
        <WorkoutViewToggle
          tabsProps={{ programs: tabPrograms, todayDow: getTodayDow() }}
          calendarDays={calendarDays}
        />
      )}
    </div>
  )
}
