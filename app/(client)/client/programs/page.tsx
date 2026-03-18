import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { getPublicPrograms, getTargetedPrograms } from "@/lib/db/programs"
import { getAssignments } from "@/lib/db/assignments"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/ui/empty-state"
import { Clock, CalendarDays, ShoppingBag, CheckCircle2, ArrowRight, Star, History } from "lucide-react"
import type { Program, ProgramAssignment } from "@/types/database"

export const dynamic = "force-dynamic"
export const metadata = { title: "Browse Programs | DJP Athlete" }

const CATEGORY_LABELS: Record<string, string> = {
  strength: "Strength",
  conditioning: "Conditioning",
  sport_specific: "Sport Specific",
  recovery: "Recovery",
  nutrition: "Nutrition",
  hybrid: "Hybrid",
}

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  elite: "Elite",
}

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: "bg-success/10 text-success",
  intermediate: "bg-warning/10 text-warning",
  advanced: "bg-destructive/10 text-destructive",
  elite: "bg-primary/10 text-primary",
}

function formatPrice(cents: number | null): string {
  if (cents == null) return "Free"
  return `$${(cents / 100).toFixed(2)}`
}

type AssignmentWithProgram = ProgramAssignment & {
  programs: Program | null
}

export default async function ClientProgramsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const userId = session.user.id

  let currentPrograms: AssignmentWithProgram[] = []
  let previousPrograms: AssignmentWithProgram[] = []
  let availablePrograms: Program[] = []

  try {
    // Fetch independently so a single failure doesn't wipe all data
    const [assignmentsResult, publicResult, targetedResult] = await Promise.allSettled([
      getAssignments(userId),
      getPublicPrograms(),
      getTargetedPrograms(userId),
    ])

    const assignments = assignmentsResult.status === "fulfilled" ? assignmentsResult.value : []
    const publicPrograms = publicResult.status === "fulfilled" ? publicResult.value : []
    const targetedPrograms = targetedResult.status === "fulfilled" ? targetedResult.value : []

    // Log any failures for debugging
    if (assignmentsResult.status === "rejected") console.error("[browse] getAssignments failed:", assignmentsResult.reason)
    if (publicResult.status === "rejected") console.error("[browse] getPublicPrograms failed:", publicResult.reason)
    if (targetedResult.status === "rejected") console.error("[browse] getTargetedPrograms failed:", targetedResult.reason)

    // Debug: log what each query returned
    console.log("[browse] userId:", userId)
    console.log("[browse] assignments:", (assignments as Array<Record<string, unknown>>).length, (assignments as Array<Record<string, unknown>>).map((a) => ({ program_id: a.program_id, status: a.status, payment_status: a.payment_status })))
    console.log("[browse] publicPrograms:", publicPrograms.length)
    console.log("[browse] targetedPrograms:", targetedPrograms.length, targetedPrograms.map((p) => ({ id: p.id, name: p.name })))

    const typedAssignments = assignments as AssignmentWithProgram[]
    currentPrograms = typedAssignments.filter((a) => a.status === "active" && a.payment_status !== "pending")
    previousPrograms = typedAssignments.filter((a) => a.status === "completed")

    // Build set of all assigned program IDs (active + completed, excluding pending payment) to exclude from available
    const assignedIds = new Set(
      typedAssignments
        .filter((a) => a.payment_status !== "pending")
        .map((a) => a.program_id)
    )

    // Merge public + targeted + pending-payment programs, deduplicate, exclude owned
    const mergedMap = new Map<string, Program>()
    for (const p of publicPrograms) mergedMap.set(p.id, p as Program)
    for (const p of targetedPrograms) mergedMap.set(p.id, p as Program)
    // Include programs from pending-payment assignments so they appear in "Available for Purchase"
    for (const a of typedAssignments) {
      if (a.payment_status === "pending" && a.programs) mergedMap.set(a.program_id, a.programs)
    }
    availablePrograms = Array.from(mergedMap.values()).filter((p) => !assignedIds.has(p.id))
  } catch (err) {
    console.error("[browse] Unexpected error loading programs:", err)
  }

  return (
    <div>
      <PageHeader
        title="Programs"
        description="Browse available training programs or view the ones you already own. Your coach may also create custom programs just for you."
      />

      {/* Current Programs */}
      {currentPrograms.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base sm:text-lg font-semibold text-foreground mb-3">
            Current Programs
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {currentPrograms.map((assignment) => {
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
                  className="bg-white rounded-xl border border-border p-4 sm:p-5 flex flex-col"
                >
                  <div className="flex flex-wrap items-center gap-1.5 mb-2">
                    {(Array.isArray(program.category) ? program.category : [program.category]).map((cat) => (
                      <span key={cat} className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] sm:text-xs font-medium bg-primary/10 text-primary">
                        {CATEGORY_LABELS[cat] ?? cat}
                      </span>
                    ))}
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] sm:text-xs font-medium ${DIFFICULTY_COLORS[program.difficulty] ?? "bg-muted text-muted-foreground"}`}
                    >
                      {DIFFICULTY_LABELS[program.difficulty] ?? program.difficulty}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] sm:text-xs font-medium bg-success/10 text-success ml-auto">
                      <CheckCircle2 className="size-3" />
                      Active
                    </span>
                  </div>

                  <h3 className="font-semibold text-foreground text-sm sm:text-base leading-snug mb-1">
                    {program.name}
                  </h3>

                  {program.description && (
                    <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 mb-3 sm:mb-4">
                      {program.description}
                    </p>
                  )}

                  {/* Progress bar */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between text-[10px] sm:text-xs text-muted-foreground mb-1">
                      <span>Progress</span>
                      <span>
                        Week {Math.min(weeksElapsed, program.duration_weeks)} of{" "}
                        {program.duration_weeks}
                      </span>
                    </div>
                    <div className="h-1.5 bg-surface rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-auto pt-3 border-t border-border flex items-center justify-between">
                    <div className="flex items-center gap-3 text-[10px] sm:text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="size-3 sm:size-3.5" />
                        {program.duration_weeks}w
                      </span>
                      <span className="flex items-center gap-1">
                        <CalendarDays className="size-3 sm:size-3.5" />
                        {program.sessions_per_week}x/wk
                      </span>
                    </div>
                    <Link
                      href="/client/workouts"
                      className="inline-flex items-center gap-1 rounded-full bg-success px-3 py-1 text-xs sm:text-sm font-medium text-white hover:bg-success/90 transition-colors"
                    >
                      {weeksElapsed > 1 ? "Resume" : "Start Program"}
                      <ArrowRight className="size-3 sm:size-3.5" />
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Previous Programs */}
      {previousPrograms.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base sm:text-lg font-semibold text-foreground mb-3">
            Previous Programs
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {previousPrograms.map((assignment) => {
              const program = assignment.programs
              if (!program) return null

              return (
                <div
                  key={assignment.id}
                  className="bg-white rounded-xl border border-border p-4 sm:p-5 flex flex-col opacity-80"
                >
                  <div className="flex flex-wrap items-center gap-1.5 mb-2">
                    {(Array.isArray(program.category) ? program.category : [program.category]).map((cat) => (
                      <span key={cat} className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] sm:text-xs font-medium bg-primary/10 text-primary">
                        {CATEGORY_LABELS[cat] ?? cat}
                      </span>
                    ))}
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] sm:text-xs font-medium ${DIFFICULTY_COLORS[program.difficulty] ?? "bg-muted text-muted-foreground"}`}
                    >
                      {DIFFICULTY_LABELS[program.difficulty] ?? program.difficulty}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] sm:text-xs font-medium bg-muted text-muted-foreground ml-auto">
                      <History className="size-3" />
                      Completed
                    </span>
                  </div>

                  <h3 className="font-semibold text-foreground text-sm sm:text-base leading-snug mb-1">
                    {program.name}
                  </h3>

                  {program.description && (
                    <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 mb-3 sm:mb-4">
                      {program.description}
                    </p>
                  )}

                  <div className="mt-auto pt-3 border-t border-border flex items-center justify-between">
                    <div className="flex items-center gap-3 text-[10px] sm:text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="size-3 sm:size-3.5" />
                        {program.duration_weeks}w
                      </span>
                      <span className="flex items-center gap-1">
                        <CalendarDays className="size-3 sm:size-3.5" />
                        {program.sessions_per_week}x/wk
                      </span>
                    </div>
                    <span className="text-xs sm:text-sm text-muted-foreground">
                      Finished {new Date(assignment.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Available for Purchase */}
      <section>
        <h2 className="text-base sm:text-lg font-semibold text-foreground mb-3">
          {currentPrograms.length > 0 || previousPrograms.length > 0
            ? "Available for Purchase"
            : "Browse Programs"}
        </h2>

        {availablePrograms.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {availablePrograms.map((program) => (
              <Link
                key={program.id}
                href={`/client/programs/${program.id}`}
                className="group bg-white rounded-xl border border-border p-4 sm:p-5 hover:shadow-md transition-shadow flex flex-col"
              >
                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                  {(Array.isArray(program.category) ? program.category : [program.category]).map((cat) => (
                    <span key={cat} className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] sm:text-xs font-medium bg-primary/10 text-primary">
                      {CATEGORY_LABELS[cat] ?? cat}
                    </span>
                  ))}
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] sm:text-xs font-medium ${DIFFICULTY_COLORS[program.difficulty] ?? "bg-muted text-muted-foreground"}`}
                  >
                    {DIFFICULTY_LABELS[program.difficulty] ?? program.difficulty}
                  </span>
                  {program.target_user_id && (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] sm:text-xs font-medium bg-accent/15 text-accent ml-auto">
                      <Star className="size-3" />
                      Created for you
                    </span>
                  )}
                </div>

                <h3 className="font-semibold text-foreground text-sm sm:text-base leading-snug mb-1 group-hover:text-primary transition-colors">
                  {program.name}
                </h3>

                {program.description && (
                  <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 mb-3 sm:mb-4">
                    {program.description}
                  </p>
                )}

                <div className="mt-auto pt-3 border-t border-border flex items-center justify-between">
                  <div className="flex items-center gap-3 text-[10px] sm:text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="size-3 sm:size-3.5" />
                      {program.duration_weeks}w
                    </span>
                    <span className="flex items-center gap-1">
                      <CalendarDays className="size-3 sm:size-3.5" />
                      {program.sessions_per_week}x/wk
                    </span>
                  </div>
                  <span className="text-xs sm:text-sm font-semibold text-primary">
                    {formatPrice(program.price_cents)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : currentPrograms.length > 0 || previousPrograms.length > 0 ? (
          <div className="bg-white rounded-xl border border-border p-4 sm:p-6 text-center">
            <p className="text-xs sm:text-sm text-muted-foreground">
              No new programs available right now. Check back later for new ones!
            </p>
          </div>
        ) : (
          <EmptyState
            icon={ShoppingBag}
            heading="No programs available"
            description="New training programs are coming soon. Check back later or contact your coach for a custom plan."
            ctaLabel="Contact Coach"
            ctaHref="/contact"
          />
        )}
      </section>
    </div>
  )
}
