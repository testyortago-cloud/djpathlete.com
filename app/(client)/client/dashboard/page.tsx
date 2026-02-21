import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getAssignments } from "@/lib/db/assignments"
import { getProgress, getWorkoutStreak } from "@/lib/db/progress"
import { getProfileByUserId } from "@/lib/db/client-profiles"
import { getUserById } from "@/lib/db/users"
import { EmptyState } from "@/components/ui/empty-state"
import { EmailVerificationBanner } from "@/components/client/EmailVerificationBanner"
import { LayoutDashboard, Dumbbell, Activity, Flame, ClipboardList } from "lucide-react"
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
  const firstName = session.user.name?.split(" ")[0] ?? "Athlete"

  let emailVerified = true
  try {
    const user = await getUserById(userId)
    emailVerified = user.email_verified ?? true
  } catch {
    // Default to true if we can't check
  }

  let activeAssignments: AssignmentWithProgram[] = []
  let totalWorkouts = 0
  let currentStreak = 0
  let hasCompletedQuestionnaire = false

  try {
    const [assignments, progress, streak, profile] = await Promise.all([
      getAssignments(userId),
      getProgress(userId),
      getWorkoutStreak(userId),
      getProfileByUserId(userId),
    ])

    const typedAssignments = assignments as AssignmentWithProgram[]
    activeAssignments = typedAssignments.filter((a) => a.status === "active")
    totalWorkouts = progress.length
    currentStreak = streak
    hasCompletedQuestionnaire = !!(profile?.goals && profile.goals.trim().length > 0)
  } catch {
    // DB tables may not exist yet — render gracefully with empty data
  }

  return (
    <div>
      <h1 className="text-xl sm:text-2xl font-semibold text-primary mb-5">
        Welcome back, {firstName}
      </h1>

      {!emailVerified && <EmailVerificationBanner userId={userId} />}

      {!hasCompletedQuestionnaire && (
        <Link
          href="/client/questionnaire"
          className="flex items-center gap-4 rounded-xl border border-accent/30 bg-accent/5 p-4 mb-6 hover:bg-accent/10 transition-colors"
        >
          <div className="flex items-center justify-center size-10 shrink-0 rounded-full bg-accent/20">
            <ClipboardList className="size-5 text-accent-foreground" strokeWidth={1.5} />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-foreground text-sm">
              Complete Your Assessment
            </p>
            <p className="text-xs text-muted-foreground">
              Tell us about your goals, experience, and preferences so your coach can build the perfect program for you.
            </p>
          </div>
          <span className="text-sm font-medium text-primary shrink-0">
            Start &rarr;
          </span>
        </Link>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex flex-col items-center text-center sm:flex-row sm:text-left sm:items-center gap-2 sm:gap-4">
          <div className="flex items-center justify-center size-9 sm:size-10 rounded-full bg-primary/10 shrink-0">
            <Dumbbell className="size-4 sm:size-5 text-primary" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-xl sm:text-2xl font-semibold text-foreground">
              {activeAssignments.length}
            </p>
            <p className="text-[10px] sm:text-sm text-muted-foreground leading-tight">Programs</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex flex-col items-center text-center sm:flex-row sm:text-left sm:items-center gap-2 sm:gap-4">
          <div className="flex items-center justify-center size-9 sm:size-10 rounded-full bg-success/10 shrink-0">
            <Activity className="size-4 sm:size-5 text-success" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-xl sm:text-2xl font-semibold text-foreground">
              {totalWorkouts}
            </p>
            <p className="text-[10px] sm:text-sm text-muted-foreground leading-tight">Workouts</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex flex-col items-center text-center sm:flex-row sm:text-left sm:items-center gap-2 sm:gap-4">
          <div className="flex items-center justify-center size-9 sm:size-10 rounded-full bg-accent/10 shrink-0">
            <Flame className="size-4 sm:size-5 text-accent" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-xl sm:text-2xl font-semibold text-foreground">{currentStreak}</p>
            <p className="text-[10px] sm:text-sm text-muted-foreground leading-tight">Streak</p>
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
          ctaLabel="Browse Programs"
          ctaHref="/programs"
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
                className="bg-white rounded-xl border border-border p-4 sm:p-6"
              >
                <div className="mb-3">
                  <h3 className="font-semibold text-foreground text-sm sm:text-base leading-snug">
                    {program.name}
                  </h3>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] sm:text-xs font-medium capitalize whitespace-nowrap">
                      {program.category.replace("_", " ")}
                    </span>
                    <span className="rounded-full bg-accent/10 text-accent px-2 py-0.5 text-[10px] sm:text-xs font-medium capitalize whitespace-nowrap">
                      {program.difficulty}
                    </span>
                  </div>
                </div>

                {program.description && (
                  <p className="text-xs sm:text-sm text-muted-foreground mb-3 sm:mb-4 line-clamp-2">
                    {program.description}
                  </p>
                )}

                <div className="mb-3">
                  <div className="flex items-center justify-between text-xs sm:text-sm text-muted-foreground mb-1">
                    <span>Progress</span>
                    <span>
                      Week {Math.min(weeksElapsed, program.duration_weeks)} of{" "}
                      {program.duration_weeks}
                    </span>
                  </div>
                  <div className="h-1.5 sm:h-2 bg-surface rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-[10px] sm:text-xs text-muted-foreground">
                    {program.sessions_per_week} sessions/week
                  </p>
                  <Link
                    href="/client/workouts"
                    className="text-xs sm:text-sm font-medium text-primary hover:text-primary/80 transition-colors"
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
