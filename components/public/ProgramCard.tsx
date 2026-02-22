import Link from "next/link"
import { Clock, CalendarDays } from "lucide-react"
import type { Program } from "@/types/database"

interface ProgramCardProps {
  program: Program
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

export function ProgramCard({ program }: ProgramCardProps) {
  return (
    <Link
      href={`/programs/${program.id}`}
      className="group bg-white rounded-2xl border border-border p-6 hover:shadow-md transition-shadow flex flex-col"
    >
      <div className="flex items-center gap-2 mb-3">
        {(Array.isArray(program.category) ? program.category : [program.category]).map((cat) => (
          <span key={cat} className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary">
            {CATEGORY_LABELS[cat] ?? cat}
          </span>
        ))}
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${DIFFICULTY_COLORS[program.difficulty] ?? "bg-muted text-muted-foreground"}`}
        >
          {DIFFICULTY_LABELS[program.difficulty] ?? program.difficulty}
        </span>
      </div>

      <h3 className="text-lg font-semibold text-primary mb-2 group-hover:text-accent transition-colors">
        {program.name}
      </h3>

      {program.description && (
        <p className="text-sm text-muted-foreground leading-relaxed mb-4 line-clamp-3">
          {program.description}
        </p>
      )}

      <div className="mt-auto pt-4 border-t border-border flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="size-3.5" />
            {program.duration_weeks}w
          </span>
          <span className="flex items-center gap-1">
            <CalendarDays className="size-3.5" />
            {program.sessions_per_week}x/wk
          </span>
        </div>
        <span className="text-sm font-semibold text-primary">
          {formatPrice(program.price_cents)}
        </span>
      </div>
    </Link>
  )
}
