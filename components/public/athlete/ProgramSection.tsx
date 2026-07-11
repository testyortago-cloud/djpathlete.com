import { CheckCircle2 } from "lucide-react"
import { FadeIn } from "@/components/shared/FadeIn"
import type { AthleteProfileData } from "@/lib/profile-share/data"

const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })

function prettify(value: string): string {
  return value
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

/** Current program with week progress, plus the athlete's completed-program "career". */
export function ProgramSection({
  program,
  career,
}: {
  program: AthleteProfileData["program"]
  career: AthleteProfileData["career"]
}) {
  const pct = program ? Math.min(100, Math.round((program.currentWeek / program.totalWeeks) * 100)) : 0
  const caption = program
    ? [program.difficulty ? prettify(program.difficulty) : null, ...program.categories.map(prettify), program.splitType ? `${prettify(program.splitType)} Split` : null]
        .filter(Boolean)
        .join(" · ")
    : ""

  return (
    <FadeIn>
      <section aria-label="Training program" className="mt-12">
        {program && (
          <>
            <p className="djp-eyebrow">Current Program</p>
            <div className="mt-4 rounded-xl bg-surface p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-heading text-base font-semibold text-primary md:text-lg">{program.name}</h2>
                <span className="font-mono text-xs tracking-widest text-primary">
                  WEEK {program.currentWeek} / {program.totalWeeks}
                </span>
              </div>
              <div
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                className="mt-3 h-2 overflow-hidden rounded-full bg-border"
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-[width]"
                  style={{ width: `${pct}%` }}
                />
              </div>
              {caption && <p className="mt-2.5 text-xs text-muted-foreground">{caption}</p>}
            </div>
          </>
        )}

        {career.length > 0 && (
          <div className={program ? "mt-8" : ""}>
            <p className="djp-eyebrow">Career</p>
            <ul className="mt-3">
              {career.map((c) => (
                <li
                  key={`${c.name}-${c.completedAt}`}
                  className="flex items-center gap-3 border-b border-border/70 py-2.5 text-sm last:border-b-0"
                >
                  <CheckCircle2 className="size-4 shrink-0 text-accent" strokeWidth={1.5} />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    completed {MONTH_YEAR.format(new Date(c.completedAt))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </FadeIn>
  )
}
