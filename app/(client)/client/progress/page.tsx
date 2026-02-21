import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getProgress, getWorkoutStreak } from "@/lib/db/progress"
import { getTrackedExercisesForUser } from "@/lib/db/tracked-exercises"
import { getAchievementsByType } from "@/lib/db/achievements"
import { estimate1RM } from "@/lib/weight-recommendation"
import { EmptyState } from "@/components/ui/empty-state"
import { KeyLiftCard } from "@/components/client/KeyLiftCard"
import { RecentActivity } from "@/components/client/RecentActivity"
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
        <RecentActivity
          entries={progress.slice(0, 20).map((entry) => ({
            id: entry.id,
            exercise_name: entry.exercises?.name ?? "Unknown Exercise",
            sets_completed: entry.sets_completed,
            reps_completed: entry.reps_completed,
            weight_kg: entry.weight_kg,
            duration_seconds: entry.duration_seconds,
            rpe: entry.rpe,
            is_pr: entry.is_pr,
            completed_at: entry.completed_at,
          }))}
        />
      )}
    </div>
  )
}
