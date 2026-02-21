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
      <h1 className="text-xl sm:text-2xl font-semibold text-primary mb-5">Progress</h1>

      {/* Summary Cards — horizontal scroll on mobile */}
      <div className="flex gap-2.5 overflow-x-auto pb-1 mb-6 -mx-1 px-1 scrollbar-none sm:grid sm:grid-cols-3 lg:grid-cols-5 sm:gap-3 sm:overflow-visible sm:mx-0 sm:px-0">
        {([
          { value: totalWorkouts, label: "Workouts", icon: Activity, color: "bg-primary/10 text-primary" },
          { value: thisMonthWorkouts, label: "This Month", icon: Calendar, color: "bg-success/10 text-success" },
          { value: uniqueExercises, label: "Exercises", icon: Target, color: "bg-accent/10 text-accent" },
          { value: prCount, label: "PRs", icon: Trophy, color: "bg-amber-500/10 text-amber-500" },
          { value: currentStreak, label: "Streak", icon: Flame, color: "bg-orange-500/10 text-orange-500" },
        ] as const).map(({ value, label, icon: Icon, color }) => (
          <div
            key={label}
            className="bg-white rounded-xl border border-border p-3 sm:p-4 flex flex-col items-center text-center min-w-[90px] shrink-0 sm:shrink sm:min-w-0 sm:flex-row sm:text-left sm:items-center sm:gap-4"
          >
            <div className={`flex items-center justify-center size-8 sm:size-10 rounded-full shrink-0 ${color.split(" ")[0]}`}>
              <Icon className={`size-4 sm:size-5 ${color.split(" ")[1]}`} strokeWidth={1.5} />
            </div>
            <div className="mt-1.5 sm:mt-0">
              <p className="text-lg sm:text-2xl font-semibold text-foreground leading-none">
                {value}
              </p>
              <p className="text-[10px] sm:text-sm text-muted-foreground leading-tight mt-0.5">
                {label}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Key Lifts — horizontal scroll on mobile */}
      {keyLifts.length > 0 && (
        <section className="mb-6">
          <h2 className="text-base sm:text-lg font-semibold text-primary mb-3">Key Lifts</h2>
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none sm:grid sm:grid-cols-2 lg:grid-cols-3 sm:gap-4 sm:overflow-visible sm:mx-0 sm:px-0">
            {keyLifts.map((lift) => (
              <div key={lift.exerciseId} className="min-w-[260px] shrink-0 sm:shrink sm:min-w-0">
                <KeyLiftCard {...lift} />
              </div>
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

      {/* Recent Activity */}
      <h2 className="text-base sm:text-lg font-semibold text-primary mb-3">
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
              })

              // Build summary parts
              const parts: string[] = []
              if (entry.sets_completed && entry.reps_completed) {
                parts.push(`${entry.sets_completed}x${entry.reps_completed}`)
              }
              if (entry.weight_kg) {
                parts.push(`${entry.weight_kg}kg`)
              }
              if (entry.duration_seconds) {
                const mins = Math.floor(entry.duration_seconds / 60)
                const secs = entry.duration_seconds % 60
                parts.push(mins > 0 ? `${mins}m${secs > 0 ? ` ${secs}s` : ""}` : `${secs}s`)
              }
              if (entry.rpe) {
                parts.push(`RPE ${entry.rpe}`)
              }

              return (
                <div
                  key={entry.id}
                  className="px-3 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="font-medium text-foreground text-xs sm:text-sm truncate">
                        {exercise?.name ?? "Unknown Exercise"}
                      </p>
                      {entry.is_pr && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] sm:text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1 sm:px-1.5 py-0.5 shrink-0">
                          <Trophy className="size-2.5" />
                          PR
                        </span>
                      )}
                    </div>
                    {parts.length > 0 && (
                      <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
                        {parts.join(" · ")}
                      </p>
                    )}
                  </div>
                  <span className="text-[10px] sm:text-xs text-muted-foreground whitespace-nowrap shrink-0">
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
