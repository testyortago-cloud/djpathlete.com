import { ArrowUp } from "lucide-react"
import { FadeIn } from "@/components/shared/FadeIn"
import type { GymRecord, FieldRecord } from "@/lib/profile-share/data"

const DAY_MS = 86_400_000
const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })

function isRecent(dateIso: string): boolean {
  const t = new Date(dateIso).getTime()
  return !isNaN(t) && Date.now() - t <= 30 * DAY_MS
}

function RecordRow({ label, value, date }: { label: string; value: string; date: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-border/70 py-2.5 last:border-b-0">
      <span className="min-w-0 truncate text-sm">{label}</span>
      <span className="flex shrink-0 items-baseline gap-2">
        {isRecent(date) && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-accent/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent-foreground">
            <ArrowUp className="size-2.5" strokeWidth={2.5} />
            New
          </span>
        )}
        <span className="font-mono text-sm font-semibold tabular-nums text-primary">{value}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{MONTH_YEAR.format(new Date(date))}</span>
      </span>
    </li>
  )
}

/** Best lifts + field-test bests, side by side. A column with no rows collapses. */
export function RecordsSection({ gym, field }: { gym: GymRecord[]; field: FieldRecord[] }) {
  const both = gym.length > 0 && field.length > 0
  return (
    <FadeIn>
      <section aria-label="Personal records" className="mt-12">
        <p className="djp-eyebrow">Personal Records</p>
        <div className={`mt-4 grid gap-8 ${both ? "md:grid-cols-2" : "grid-cols-1"}`}>
          {gym.length > 0 && (
            <div>
              <h2 className="mb-1 font-heading text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                In the Gym
              </h2>
              <ul>
                {gym.map((r) => (
                  <RecordRow key={r.exercise} label={r.exercise} value={`${r.valueKg} kg`} date={r.date} />
                ))}
              </ul>
            </div>
          )}
          {field.length > 0 && (
            <div>
              <h2 className="mb-1 font-heading text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                On the Field
              </h2>
              <ul>
                {field.map((r) => (
                  <RecordRow key={`${r.label}-${r.date}`} label={r.label} value={`${r.value} ${r.unit}`} date={r.date} />
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    </FadeIn>
  )
}
