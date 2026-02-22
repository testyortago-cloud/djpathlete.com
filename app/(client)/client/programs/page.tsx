import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { getPublicPrograms, getClientPrograms } from "@/lib/db/programs"
import { EmptyState } from "@/components/ui/empty-state"
import { Clock, CalendarDays, ShoppingBag, CheckCircle2, ArrowRight } from "lucide-react"
import type { Program } from "@/types/database"

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

export default async function ClientProgramsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const userId = session.user.id

  let ownedPrograms: Program[] = []
  let availablePrograms: Program[] = []

  try {
    const [myPrograms, publicPrograms] = await Promise.all([
      getClientPrograms(userId),
      getPublicPrograms(),
    ])

    ownedPrograms = myPrograms
    const ownedIds = new Set(myPrograms.map((p) => p.id))
    availablePrograms = publicPrograms.filter((p) => !ownedIds.has(p.id))
  } catch {
    // Render gracefully with empty data
  }

  return (
    <div>
      <h1 className="text-xl sm:text-2xl font-semibold text-primary mb-5">Programs</h1>

      {/* My Programs */}
      {ownedPrograms.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base sm:text-lg font-semibold text-foreground mb-3">
            My Programs
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {ownedPrograms.map((program) => (
              <div
                key={program.id}
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
                    Owned
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
                  <Link
                    href="/client/workouts"
                    className="inline-flex items-center gap-1 text-xs sm:text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                  >
                    Go to Workouts
                    <ArrowRight className="size-3 sm:size-3.5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Available Programs */}
      <section>
        <h2 className="text-base sm:text-lg font-semibold text-foreground mb-3">
          {ownedPrograms.length > 0 ? "Available Programs" : "Browse Programs"}
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
        ) : ownedPrograms.length > 0 ? (
          <div className="bg-white rounded-xl border border-border p-4 sm:p-6 text-center">
            <p className="text-xs sm:text-sm text-muted-foreground">
              You own all available programs. Check back later for new ones!
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
