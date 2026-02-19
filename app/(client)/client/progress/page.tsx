import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getProgress } from "@/lib/db/progress"
import { EmptyState } from "@/components/ui/empty-state"
import { TrendingUp, Activity, Calendar, Target } from "lucide-react"
import type { ExerciseProgress, Exercise } from "@/types/database"

export const metadata = { title: "Progress | DJP Athlete" }

type ProgressWithExercise = ExerciseProgress & {
  exercises: Exercise | null
}

export default async function ClientProgressPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const userId = session.user.id
  const progress = (await getProgress(userId)) as ProgressWithExercise[]

  // Calculate stats
  const totalWorkouts = progress.length
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const thisMonthWorkouts = progress.filter(
    (p) => new Date(p.completed_at) >= startOfMonth
  ).length
  const uniqueExercises = new Set(progress.map((p) => p.exercise_id)).size

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Progress</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-border p-4 flex items-center gap-4">
          <div className="flex items-center justify-center size-10 rounded-full bg-primary/10">
            <Activity className="size-5 text-primary" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-2xl font-semibold text-foreground">
              {totalWorkouts}
            </p>
            <p className="text-sm text-muted-foreground">
              Total Workouts Logged
            </p>
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
                    <p className="font-medium text-foreground text-sm">
                      {exercise?.name ?? "Unknown Exercise"}
                    </p>
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
