import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getAssignments } from "@/lib/db/assignments"
import { getProgress } from "@/lib/db/progress"
import { EmptyState } from "@/components/ui/empty-state"
import { LayoutDashboard, Dumbbell, Activity, Flame } from "lucide-react"
import Link from "next/link"
import type { Program, ProgramAssignment } from "@/types/database"

export const metadata = { title: "Dashboard | DJP Athlete" }

type AssignmentWithProgram = ProgramAssignment & {
  programs: Program | null
}

export default async function ClientDashboardPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const userId = session.user.id

  const [assignments, progress] = await Promise.all([
    getAssignments(userId),
    getProgress(userId),
  ])

  const typedAssignments = assignments as AssignmentWithProgram[]
  const activeAssignments = typedAssignments.filter(
    (a) => a.status === "active"
  )
  const totalWorkouts = progress.length
  const firstName = session.user.name?.split(" ")[0] ?? "Athlete"

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">
        Welcome back, {firstName}
      </h1>

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-border p-4 flex items-center gap-4">
          <div className="flex items-center justify-center size-10 rounded-full bg-primary/10">
            <Dumbbell className="size-5 text-primary" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-2xl font-semibold text-foreground">
              {activeAssignments.length}
            </p>
            <p className="text-sm text-muted-foreground">Active Programs</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-4 flex items-center gap-4">
          <div className="flex items-center justify-center size-10 rounded-full bg-success/10">
            <Activity className="size-5 text-success" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-2xl font-semibold text-foreground">
              {totalWorkouts}
            </p>
            <p className="text-sm text-muted-foreground">Total Workouts</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-4 flex items-center gap-4">
          <div className="flex items-center justify-center size-10 rounded-full bg-accent/10">
            <Flame className="size-5 text-accent" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-2xl font-semibold text-foreground">0</p>
            <p className="text-sm text-muted-foreground">Current Streak</p>
          </div>
        </div>
      </div>

      {/* Active Programs */}
      <h2 className="text-lg font-semibold text-primary mb-4">
        Active Programs
      </h2>

      {activeAssignments.length === 0 ? (
        <EmptyState
          icon={LayoutDashboard}
          heading="No programs yet"
          description="You don't have any active programs. Browse available programs to get started on your training journey."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {activeAssignments.map((assignment) => {
            const program = assignment.programs
            if (!program) return null

            const startDate = new Date(assignment.start_date)
            const now = new Date()
            const weeksElapsed = Math.max(
              1,
              Math.ceil(
                (now.getTime() - startDate.getTime()) /
                  (1000 * 60 * 60 * 24 * 7)
              )
            )
            const progressPercent = Math.min(
              100,
              Math.round((weeksElapsed / program.duration_weeks) * 100)
            )

            return (
              <div
                key={assignment.id}
                className="bg-white rounded-xl border border-border p-6"
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="font-semibold text-foreground">
                    {program.name}
                  </h3>
                  <div className="flex gap-2">
                    <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium capitalize">
                      {program.category.replace("_", " ")}
                    </span>
                    <span className="rounded-full bg-accent/10 text-accent-foreground px-2 py-0.5 text-xs font-medium capitalize">
                      {program.difficulty}
                    </span>
                  </div>
                </div>

                {program.description && (
                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                    {program.description}
                  </p>
                )}

                <div className="mb-3">
                  <div className="flex items-center justify-between text-sm text-muted-foreground mb-1">
                    <span>Progress</span>
                    <span>
                      Week {Math.min(weeksElapsed, program.duration_weeks)} of{" "}
                      {program.duration_weeks}
                    </span>
                  </div>
                  <div className="h-2 bg-surface rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {program.sessions_per_week} sessions/week
                  </p>
                  <Link
                    href="/client/workouts"
                    className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                  >
                    View Program
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
