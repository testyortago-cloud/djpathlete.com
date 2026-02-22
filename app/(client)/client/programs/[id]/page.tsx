import { auth } from "@/lib/auth"
import { redirect, notFound } from "next/navigation"
import Link from "next/link"
import { Clock, CalendarDays, BarChart3, ArrowLeft, CheckCircle2, Star } from "lucide-react"
import { getActiveProgramById, getProgramById } from "@/lib/db/programs"
import { getAssignmentByUserAndProgram } from "@/lib/db/assignments"
import { ClientBuyButton } from "./ClientBuyButton"

interface Props {
  params: Promise<{ id: string }>
}

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

export async function generateMetadata({ params }: Props) {
  const { id } = await params
  try {
    const program = await getActiveProgramById(id)
    return { title: `${program.name} | DJP Athlete` }
  } catch {
    return { title: "Program Not Found" }
  }
}

export default async function ClientProgramDetailPage({ params }: Props) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const { id } = await params

  let program
  try {
    program = await getActiveProgramById(id)
  } catch {
    // If getActiveProgramById fails, check if it's a targeted program for this user
    try {
      const p = await getProgramById(id)
      if (p.is_active && p.target_user_id === session.user.id) {
        program = p
      } else {
        notFound()
      }
    } catch {
      notFound()
    }
  }

  // Block access if program is private, not targeted at this user, and not public
  if (!program.is_public && program.target_user_id && program.target_user_id !== session.user.id) {
    notFound()
  }

  const assignment = await getAssignmentByUserAndProgram(session.user.id, program.id)
  const owned = !!assignment
  const isTargeted = program.target_user_id === session.user.id

  return (
    <div>
      <Link
        href="/client/programs"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors mb-6"
      >
        <ArrowLeft className="size-4" />
        All Programs
      </Link>

      {/* Created for you banner */}
      {isTargeted && !owned && (
        <div className="flex items-center gap-2 rounded-lg bg-accent/10 border border-accent/20 px-4 py-3 mb-4">
          <Star className="size-4 text-accent shrink-0" />
          <p className="text-sm text-foreground">
            <span className="font-medium">Created for you by your coach.</span>{" "}
            Purchase this program to get started!
          </p>
        </div>
      )}

      {/* Badges */}
      <div className="flex items-center gap-2 mb-3">
        {(Array.isArray(program.category) ? program.category : [program.category]).map((cat) => (
          <span key={cat} className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-primary/10 text-primary">
            {CATEGORY_LABELS[cat] ?? cat}
          </span>
        ))}
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${DIFFICULTY_COLORS[program.difficulty] ?? "bg-muted text-muted-foreground"}`}
        >
          {DIFFICULTY_LABELS[program.difficulty] ?? program.difficulty}
        </span>
        {owned && (
          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-success/10 text-success">
            <CheckCircle2 className="size-3" />
            Owned
          </span>
        )}
      </div>

      {/* Title */}
      <h1 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-3">
        {program.name}
      </h1>

      {/* Description */}
      {program.description && (
        <p className="text-base text-muted-foreground leading-relaxed mb-6 max-w-3xl">
          {program.description}
        </p>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 max-w-sm mb-8">
        <div className="rounded-xl border border-border bg-white p-4 text-center">
          <Clock className="size-5 text-accent mx-auto mb-1.5" strokeWidth={1.5} />
          <p className="text-xl font-semibold text-primary">
            {program.duration_weeks}
          </p>
          <p className="text-xs text-muted-foreground">Weeks</p>
        </div>
        <div className="rounded-xl border border-border bg-white p-4 text-center">
          <CalendarDays className="size-5 text-accent mx-auto mb-1.5" strokeWidth={1.5} />
          <p className="text-xl font-semibold text-primary">
            {program.sessions_per_week}
          </p>
          <p className="text-xs text-muted-foreground">Sessions/Wk</p>
        </div>
        <div className="rounded-xl border border-border bg-white p-4 text-center">
          <BarChart3 className="size-5 text-accent mx-auto mb-1.5" strokeWidth={1.5} />
          <p className="text-xl font-semibold text-primary capitalize">
            {program.difficulty}
          </p>
          <p className="text-xs text-muted-foreground">Level</p>
        </div>
      </div>

      {/* Price + CTA */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        {owned ? (
          <Link
            href="/client/workouts"
            className="inline-flex items-center gap-2 rounded-full bg-success px-6 py-3 text-sm font-medium text-white hover:bg-success/90 transition-colors"
          >
            <CheckCircle2 className="size-4" />
            Go to Workouts
          </Link>
        ) : (
          <>
            {program.price_cents && (
              <p className="text-3xl font-heading font-semibold text-primary">
                {formatPrice(program.price_cents)}
              </p>
            )}
            {program.price_cents ? (
              <ClientBuyButton programId={program.id} />
            ) : (
              <Link
                href="/contact"
                className="inline-flex items-center rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Contact Coach
              </Link>
            )}
          </>
        )}
      </div>
    </div>
  )
}
