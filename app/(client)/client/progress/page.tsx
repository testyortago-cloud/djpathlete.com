import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getProgress, getWorkoutStreak } from "@/lib/db/progress"
import { getTrackedExercisesForUser } from "@/lib/db/tracked-exercises"
import { getAchievementsByType } from "@/lib/db/achievements"
import { getActiveAssignment } from "@/lib/db/assignments"
import { getProgramExercises } from "@/lib/db/program-exercises"
import { estimate1RM } from "@/lib/weight-recommendation"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/ui/empty-state"
import { KeyLiftCard } from "@/components/client/KeyLiftCard"
import { ExerciseTracker } from "@/components/client/ExerciseTracker"
import { TrendingUp, CalendarCheck, Flame, Trophy, Dumbbell, ArrowRight } from "lucide-react"
import Link from "next/link"
import type { ExerciseProgress, Exercise, ProgramExercise } from "@/types/database"

export const metadata = { title: "Progress | DJP Athlete" }

type ProgressWithExercise = ExerciseProgress & {
  exercises: Exercise | null
}

interface KeyLiftData {
  exerciseName: string
  exerciseId: string
  currentBest: number | null
  allTimePR: number | null
  estimated1RM: number | null
  totalSessions: number
  recentData: Array<{ date: string; weight_kg: number }>
}

function computeKeyLiftStats(
  exerciseId: string,
  exerciseName: string,
  allProgress: ProgressWithExercise[],
): KeyLiftData {
  const entries = allProgress
    .filter((p) => p.exercise_id === exerciseId)
    .sort((a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime())

  const weights = entries.filter((e) => e.weight_kg != null).map((e) => e.weight_kg!)

  const currentBest = weights.length > 0 ? Math.max(...weights) : null
  const allTimePR = currentBest

  let estimated1RM: number | null = null
  const bestEntry = entries.find((e) => e.weight_kg != null && e.weight_kg === currentBest)
  if (bestEntry?.weight_kg && bestEntry.reps_completed) {
    const repsMatch = bestEntry.reps_completed.match(/(\d+)/)
    if (repsMatch) {
      estimated1RM = Math.round(estimate1RM(bestEntry.weight_kg, parseInt(repsMatch[1], 10)))
    }
  }

  const totalSessions = entries.length

  const recentData = entries
    .filter((e) => e.weight_kg != null)
    .slice(0, 10)
    .reverse()
    .map((e) => ({
      date: e.completed_at,
      weight_kg: e.weight_kg!,
    }))

  return {
    exerciseName,
    exerciseId,
    currentBest,
    allTimePR,
    estimated1RM,
    totalSessions,
    recentData,
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function getNextWorkoutDay(workoutDays: number[], todayDow: number): { dayName: string; isToday: boolean } {
  // todayDow: 0=Sun..6=Sat → convert to ISO 1=Mon..7=Sun
  const isoDow = todayDow === 0 ? 7 : todayDow

  if (workoutDays.includes(isoDow)) {
    return { dayName: "Today", isToday: true }
  }

  for (let offset = 1; offset <= 7; offset++) {
    const check = ((isoDow - 1 + offset) % 7) + 1
    if (workoutDays.includes(check)) {
      if (offset === 1) return { dayName: "Tomorrow", isToday: false }
      return { dayName: DAY_NAMES[check], isToday: false }
    }
  }

  return { dayName: "—", isToday: false }
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default async function ClientProgressPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const userId = session.user.id

  let progress: ProgressWithExercise[] = []
  let currentStreak = 0
  let monthlyPrCount = 0
  let keyLifts: KeyLiftData[] = []
  let trackedForComponent: Array<{
    id: string
    exercise_id: string
    exercises: Pick<Exercise, "id" | "name" | "muscle_group" | "equipment"> | null
  }> = []

  // Program info
  let programWeek: string | null = null
  let weeklyConsistency: string | null = null
  let nextWorkout: string | null = null

  try {
    const [allProgress, streak, prAchievements, trackedExercises, assignment] = await Promise.all([
      getProgress(userId) as Promise<ProgressWithExercise[]>,
      getWorkoutStreak(userId),
      getAchievementsByType(userId, "pr"),
      getTrackedExercisesForUser(userId),
      getActiveAssignment(userId),
    ])

    progress = allProgress
    currentStreak = streak

    // PRs this month
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    monthlyPrCount = prAchievements.filter((a) => new Date(a.created_at) >= startOfMonth).length

    // Program-based stats
    if (assignment) {
      const totalWeeks = assignment.total_weeks ?? 1
      const currentWeekNum = assignment.current_week ?? 1
      programWeek = `${currentWeekNum}/${totalWeeks}`

      const programEx = (await getProgramExercises(assignment.program_id)) as (ProgramExercise & {
        exercises: Exercise | null
      })[]

      // Find workout days for the current week (fall back to closest earlier defined week)
      const definedWeeks = [...new Set(programEx.map((e) => e.week_number))].sort((a, b) => a - b)
      let sourceWeek = definedWeeks[0] ?? 1
      for (const dw of definedWeeks) {
        if (dw <= currentWeekNum) sourceWeek = dw
        else break
      }

      const workoutDaysThisWeek = [
        ...new Set(programEx.filter((e) => e.week_number === sourceWeek).map((e) => e.day_of_week)),
      ].sort((a, b) => a - b)

      const totalPlannedDays = workoutDaysThisWeek.length

      if (totalPlannedDays > 0) {
        // Count days logged this program week
        const assignmentStart = new Date(assignment.start_date)
        const weekStartOffset = (currentWeekNum - 1) * 7
        const weekStart = new Date(assignmentStart)
        weekStart.setDate(assignmentStart.getDate() + weekStartOffset)
        const weekEnd = new Date(weekStart)
        weekEnd.setDate(weekStart.getDate() + 7)

        const daysLoggedThisWeek = new Set(
          progress
            .filter((p) => {
              const d = new Date(p.completed_at)
              return d >= weekStart && d < weekEnd
            })
            .map((p) => {
              const d = new Date(p.completed_at)
              const dow = d.getDay()
              return dow === 0 ? 7 : dow
            }),
        )

        const completedDays = workoutDaysThisWeek.filter((d) => daysLoggedThisWeek.has(d)).length
        weeklyConsistency = `${completedDays}/${totalPlannedDays}`

        const todayDow = now.getDay()
        const { dayName } = getNextWorkoutDay(workoutDaysThisWeek, todayDow)
        nextWorkout = dayName
      }
    }

    if (trackedExercises && trackedExercises.length > 0) {
      keyLifts = trackedExercises.map((te: { exercise_id: string; exercises: Exercise | null }) =>
        computeKeyLiftStats(te.exercise_id, (te.exercises as Exercise | null)?.name ?? "Unknown Exercise", progress),
      )

      trackedForComponent = trackedExercises.map(
        (te: { id: string; exercise_id: string; exercises: Exercise | null }) => ({
          id: te.id,
          exercise_id: te.exercise_id,
          exercises: te.exercises
            ? {
                id: te.exercises.id,
                name: te.exercises.name,
                muscle_group: te.exercises.muscle_group,
                equipment: te.exercises.equipment,
              }
            : null,
        }),
      )
    }
  } catch {
    // DB tables may not exist yet -- render gracefully with empty data
  }

  return (
    <div>
      <PageHeader title="Progress" description="Your training journey at a glance." />

      {progress.length === 0 && !programWeek ? (
        <EmptyState
          icon={TrendingUp}
          heading="No progress logged"
          description="Your workout history will appear here once you start logging exercises. Keep pushing toward your goals!"
        />
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3 mb-6">
            {programWeek && (
              <div className="bg-white rounded-xl border border-border p-3 sm:p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="size-7 sm:size-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <CalendarCheck className="size-3.5 sm:size-4 text-primary" strokeWidth={1.5} />
                  </div>
                  <span className="text-[10px] sm:text-xs text-muted-foreground">Program Week</span>
                </div>
                <p className="text-xl sm:text-2xl font-bold text-foreground leading-none">
                  {programWeek.split("/")[0]}
                  <span className="text-sm font-normal text-muted-foreground">/{programWeek.split("/")[1]}</span>
                </p>
              </div>
            )}

            {weeklyConsistency && (
              <div className="bg-white rounded-xl border border-border p-3 sm:p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="size-7 sm:size-8 rounded-full bg-success/10 flex items-center justify-center">
                    <Dumbbell className="size-3.5 sm:size-4 text-success" strokeWidth={1.5} />
                  </div>
                  <span className="text-[10px] sm:text-xs text-muted-foreground">This Week</span>
                </div>
                <p className="text-xl sm:text-2xl font-bold text-foreground leading-none">
                  {weeklyConsistency.split("/")[0]}
                  <span className="text-sm font-normal text-muted-foreground">
                    /{weeklyConsistency.split("/")[1]} done
                  </span>
                </p>
              </div>
            )}

            <div className="bg-white rounded-xl border border-border p-3 sm:p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="size-7 sm:size-8 rounded-full bg-orange-500/10 flex items-center justify-center">
                  <Flame className="size-3.5 sm:size-4 text-orange-500" strokeWidth={1.5} />
                </div>
                <span className="text-[10px] sm:text-xs text-muted-foreground">Streak</span>
              </div>
              <p className="text-xl sm:text-2xl font-bold text-foreground leading-none">
                {currentStreak}
                <span className="text-sm font-normal text-muted-foreground"> day{currentStreak !== 1 ? "s" : ""}</span>
              </p>
            </div>

            <div className="bg-white rounded-xl border border-border p-3 sm:p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="size-7 sm:size-8 rounded-full bg-amber-500/10 flex items-center justify-center">
                  <Trophy className="size-3.5 sm:size-4 text-amber-500" strokeWidth={1.5} />
                </div>
                <span className="text-[10px] sm:text-xs text-muted-foreground">PRs This Month</span>
              </div>
              <p className="text-xl sm:text-2xl font-bold text-foreground leading-none">{monthlyPrCount}</p>
            </div>
          </div>

          {/* Next Workout Banner */}
          {nextWorkout && (
            <Link
              href="/client/workouts"
              className="flex items-center justify-between gap-3 bg-primary/5 border border-primary/15 rounded-xl px-4 py-3 mb-6 hover:bg-primary/10 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="size-9 rounded-full bg-primary/10 flex items-center justify-center">
                  <Dumbbell className="size-4 text-primary" strokeWidth={1.5} />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {nextWorkout === "Today"
                      ? "You have a workout today"
                      : nextWorkout === "Tomorrow"
                        ? "Next workout is tomorrow"
                        : `Next workout: ${nextWorkout}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {nextWorkout === "Today" ? "Tap to get started" : "View your program"}
                  </p>
                </div>
              </div>
              <ArrowRight className="size-4 text-primary shrink-0" strokeWidth={1.5} />
            </Link>
          )}

          {/* Exercise Tracker */}
          <section className="mb-6">
            <ExerciseTracker initialTracked={trackedForComponent} />
          </section>

          {keyLifts.length > 0 && (
            <section className="mb-6">
              <h2 className="text-base sm:text-lg font-semibold text-primary mb-3">Key Lifts</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {keyLifts.map((lift) => (
                  <KeyLiftCard key={lift.exerciseId} {...lift} />
                ))}
              </div>
            </section>
          )}

          {/* Achievements link */}
          <div className="mb-6">
            <Link
              href="/client/achievements"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-medium text-primary hover:bg-surface transition-colors"
            >
              <Trophy className="size-4" strokeWidth={1.5} />
              View All Achievements
              <ArrowRight className="size-3.5" strokeWidth={1.5} />
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
