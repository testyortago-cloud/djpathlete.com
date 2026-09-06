import { ArrowUp } from "lucide-react"
import { FadeIn } from "@/components/shared/FadeIn"
import { SectionHeading } from "./SectionHeading"
import type { GymRecord, FieldRecord } from "@/lib/profile-share/data"
import type { WeightUnit } from "@/types/database"
import { displayWeight } from "@/lib/weight-utils"

const DAY_MS = 86_400_000
const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })

function isRecent(dateIso: string): boolean {
  const t = new Date(dateIso).getTime()
  if (isNaN(t)) return false
  const age = Date.now() - t
  return age >= 0 && age <= 30 * DAY_MS
}

/**
 * Leaderboard row — mono rank, label, value in ice, optional magnitude bar
 * (gym column only: all values share a unit, so value ÷ column max means
 * something; field tests mix units and directions, so they get no bar).
 */
function RecordRow({
  rank,
  label,
  value,
  date,
  pct,
}: {
  rank: number
  label: string
  value: string
  date: string
  pct: number | null
}) {
  return (
    <li className="border-b border-border/60 py-3 last:border-b-0">
      <div className="flex items-baseline gap-3">
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-accent/80">
          {String(rank).padStart(2, "0")}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">{label}</span>
        {isRecent(date) && (
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-accent/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent">
            <ArrowUp className="size-2.5" strokeWidth={2.5} />
            New
          </span>
        )}
        <span className="shrink-0 font-mono text-base font-semibold tabular-nums text-primary">{value}</span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {MONTH_YEAR.format(new Date(date))}
        </span>
      </div>
      {pct !== null && (
        <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-border/60">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent/40 to-accent"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </li>
  )
}

function ColumnTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1 font-heading text-xs font-semibold uppercase tracking-widest text-foreground/70">
      {children}
    </h3>
  )
}

/** Best lifts + field-test bests, side by side. A column with no rows collapses. */
export function RecordsSection({
  gym,
  field,
  weightUnit,
}: {
  gym: GymRecord[]
  field: FieldRecord[]
  weightUnit: WeightUnit
}) {
  const both = gym.length > 0 && field.length > 0
  // Whole numbers by design on this showcase page, but the conversion itself
  // goes through the shared helper so there is one KG_TO_LBS in the codebase.
  const lift = (kg: number) => `${Math.round(displayWeight(kg, weightUnit) ?? 0)} ${weightUnit}`
  const maxKg = gym.reduce((m, r) => Math.max(m, r.valueKg), 0)
  return (
    <FadeIn>
      <section aria-label="Personal records" className="mt-14">
        <SectionHeading>Personal Records</SectionHeading>
        <div className={`mt-5 grid gap-8 ${both ? "md:grid-cols-2" : "grid-cols-1"}`}>
          {gym.length > 0 && (
            <div>
              <ColumnTitle>In the Gym</ColumnTitle>
              <ul>
                {gym.map((r, i) => (
                  <RecordRow
                    key={r.exercise}
                    rank={i + 1}
                    label={r.exercise}
                    value={lift(r.valueKg)}
                    date={r.date}
                    pct={maxKg > 0 ? Math.round((r.valueKg / maxKg) * 100) : null}
                  />
                ))}
              </ul>
            </div>
          )}
          {field.length > 0 && (
            <div>
              <ColumnTitle>On the Field</ColumnTitle>
              <ul>
                {field.map((r, i) => (
                  <RecordRow
                    key={`${r.label}-${r.date}`}
                    rank={i + 1}
                    label={r.label}
                    value={`${r.value} ${r.unit}`}
                    date={r.date}
                    pct={null}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    </FadeIn>
  )
}
