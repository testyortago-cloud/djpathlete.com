import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getProgress, getWorkoutStreak } from "@/lib/db/progress"
import { getTrackedExercisesForUser } from "@/lib/db/tracked-exercises"
import { getAchievementsByType } from "@/lib/db/achievements"
import { estimate1RM } from "@/lib/weight-recommendation"
import { EmptyState } from "@/components/ui/empty-state"
import { KeyLiftCard } from "@/components/client/KeyLiftCard"
import {
  TrendingUp,
  Activity,
  Calendar,
  Target,
  Trophy,
  Flame,
  ArrowRight,
} from "lucide-react"
import Link from "next/link"
import type { ExerciseProgress, Exercise } from "@/types/database"

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
  allProgress: ProgressWithExercise[]
): KeyLiftData {
  const entries = allProgress
    .filter((p) => p.exercise_id === exerciseId)
    .sort(
      (a, b) =>
        new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime()
    )

  const weights = entries
    .filter((e) => e.weight_kg != null)
    .map((e) => e.weight_kg!)

  const currentBest = weights.length > 0 ? Math.max(...weights) : null
  const allTimePR = currentBest

  // Estimated 1RM from the best entry (by weight)
  let estimated1RM: number | null = null
  const bestEntry = entries.find(
    (e) => e.weight_kg != null && e.weight_kg === currentBest
  )
  if (bestEntry?.weight_kg && bestEntry.reps_completed) {
    const repsMatch = bestEntry.reps_completed.match(/(\d+)/)
    if (repsMatch) {
      estimated1RM = Math.round(
        estimate1RM(bestEntry.weight_kg, parseInt(repsMatch[1], 10))
      )
    }
  }

  const totalSessions = entries.length

  // Last 10 entries with weight for sparkline (oldest first for chart)
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

export default async function ClientProgressPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const userId = session.user.id

  let progress: ProgressWithExercise[] = []
  let totalWorkouts = 0
  let thisMonthWorkouts = 0
  let uniqueExercises = 0
  let prCount = 0
  let currentStreak = 0
  let keyLifts: KeyLiftData[] = []

  try {
    const [allProgress, streak, prAchievements, trackedExercises] =
      await Promise.all([
        getProgress(userId) as Promise<ProgressWithExercise[]>,
        getWorkoutStreak(userId),
        getAchievementsByType(userId, "pr"),
        getTrackedExercisesForUser(userId),
      ])

    progress = allProgress
    totalWorkouts = progress.length
    currentStreak = streak
    prCount = prAchievements.length

    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    thisMonthWorkouts = progress.filter(
      (p) => new Date(p.completed_at) >= startOfMonth
    ).length
    uniqueExercises = new Set(progress.map((p) => p.exercise_id)).size

    // Compute key lift stats for each tracked exercise
    if (trackedExercises && trackedExercises.length > 0) {
      keyLifts = trackedExercises.map((te: { exercise_id: string; exercises: Exercise | null }) =>
        computeKeyLiftStats(
          te.exercise_id,
          (te.exercises as Exercise | null)?.name ?? "Unknown Exercise",
          progress
        )
      )
    }
  } catch {
    // DB tables may not exist yet -- render gracefully with empty data
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Progress</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-border p-4 flex items-center gap-4">
          <div className="flex items-center justify-center size-10 rounded-full bg-primary/10">
            <Activity className="size-5 text-primary" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-2xl font-semibold text-foreground">
              {totalWorkouts}
            </p>
            <p className="text-sm text-muted-foreground">Total Workouts</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-4 flex items-center gap-4">
          <div className="flex items-center justify-center size-10 rounded-full bg-success/10">
            <Calendar className="size-5 text-success" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-2xl font-semibold text-foreground">
              {thisMonthWorkouts}
            </p>
            <p className="text-sm text-muted-foreground">This Month</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-4 flex items-center gap-4">
          <div className="flex items-center justify-center size-10 rounded-full bg-accent/10">
            <Target className="size-5 text-accent" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-2xl font-semibold text-foreground">
              {uniqueExercises}
            </p>
            <p className="text-sm text-muted-foreground">Exercises Tracked</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-4 flex items-center gap-4">
          <div className="flex items-center justify-center size-10 rounded-full bg-amber-500/10">
            <Trophy className="size-5 text-amber-500" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-2xl font-semibold text-foreground">{prCount}</p>
            <p className="text-sm text-muted-foreground">Personal Records</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-4 flex items-center gap-4">
          <div className="flex items-center justify-center size-10 rounded-full bg-orange-500/10">
            <Flame className="size-5 text-orange-500" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-2xl font-semibold text-foreground">
              {currentStreak}
            </p>
            <p className="text-sm text-muted-foreground">Current Streak</p>
          </div>
        </div>
      </div>

      {/* Key Lifts */}
      {keyLifts.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-primary mb-4">Key Lifts</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {keyLifts.map((lift) => (
              <KeyLiftCard key={lift.exerciseId} {...lift} />
            ))}
          </div>
        </section>
      )}

      {/* Achievements link */}
      <div className="mb-8">
        <Link
          href="/client/achievements"
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-3 text-sm font-medium text-primary hover:bg-surface transition-colors"
        >
          <Trophy className="size-4" strokeWidth={1.5} />
          View All Achievements
          <ArrowRight className="size-4" strokeWidth={1.5} />
        </Link>
      </div>

      {/* Recent Activity */}
      <h2 className="text-lg font-semibold text-primary mb-4">
        Recent Activity
      </h2>

      {progress.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          heading="No progress logged"
          description="Your workout history will appear here once you start logging exercises. Keep pushing toward your goals!"
        />
      ) : (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="divide-y divide-border">
            {progress.slice(0, 20).map((entry) => {
              const exercise = entry.exercises
              const date = new Date(entry.completed_at)
              const formattedDate = date.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })

              // Build summary string
              const parts: string[] = []
              if (entry.sets_completed && entry.reps_completed) {
                parts.push(`${entry.sets_completed} x ${entry.reps_completed}`)
              }
              if (entry.weight_kg) {
                parts.push(`${entry.weight_kg} kg`)
              }
              if (entry.duration_seconds) {
                const mins = Math.floor(entry.duration_seconds / 60)
                const secs = entry.duration_seconds % 60
                parts.push(mins > 0 ? `${mins}m ${secs}s` : `${secs}s`)
              }
              if (entry.rpe) {
                parts.push(`RPE ${entry.rpe}`)
              }

              return (
                <div
                  key={entry.id}
                  className="px-4 py-3 flex items-center justify-between gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-foreground text-sm">
                        {exercise?.name ?? "Unknown Exercise"}
                      </p>
                      {entry.is_pr && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
                          <Trophy className="size-2.5" />
                          PR
                        </span>
                      )}
                    </div>
                    {parts.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {parts.join(" / ")}
                      </p>
                    )}
                    {entry.notes && (
                      <p className="text-xs text-muted-foreground mt-0.5 italic">
                        {entry.notes}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {formattedDate}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
