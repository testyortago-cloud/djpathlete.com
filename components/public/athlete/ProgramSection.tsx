import { CheckCircle2 } from "lucide-react"
import { FadeIn } from "@/components/shared/FadeIn"
import { SectionHeading } from "./SectionHeading"
import type { AthleteProfileData } from "@/lib/profile-share/data"

const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })

// Above this, per-week segments become slivers — fall back to a continuous bar.
const MAX_SEGMENTS = 24

function prettify(value: string): string {
  return value
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

/** Current program with a per-week segmented progress bar, plus the completed-program "career" timeline. */
export function ProgramSection({
  program,
  career,
}: {
  program: AthleteProfileData["program"]
  career: AthleteProfileData["career"]
}) {
  const pct = program ? Math.min(100, Math.round((program.currentWeek / program.totalWeeks) * 100)) : 0
  const doneWeeks = program ? Math.min(program.currentWeek, program.totalWeeks) : 0
  const segmented = program !== null && program.totalWeeks <= MAX_SEGMENTS
  const caption = program
    ? [
        program.difficulty ? prettify(program.difficulty) : null,
        ...program.categories.map(prettify),
        program.splitType ? `${prettify(program.splitType)} Split` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : ""

  return (
    <FadeIn>
      <section aria-label="Training program" className="mt-14">
        {program && (
          <>
            <SectionHeading>Current Program</SectionHeading>
            <div className="mt-5 rounded-2xl border border-border bg-card/70 p-5 backdrop-blur-sm md:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-heading text-lg font-semibold text-foreground md:text-xl">{program.name}</h3>
                <span className="font-mono text-xs tracking-widest text-accent">
                  WEEK {program.currentWeek} / {program.totalWeeks}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={`Program progress: week ${program.currentWeek} of ${program.totalWeeks}`}
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                className="mt-4"
              >
                {segmented ? (
                  <div className="flex gap-1">
                    {Array.from({ length: program.totalWeeks }, (_, i) => (
                      <div
                        key={i}
                        className={`h-1.5 flex-1 rounded-full ${
                          i < doneWeeks ? "bg-gradient-to-r from-accent/70 to-accent" : "bg-border"
                        } ${i === doneWeeks - 1 ? "shadow-[0_0_10px_color-mix(in_oklab,var(--accent)_80%,transparent)]" : ""}`}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="h-1.5 overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-accent/50 to-accent"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </div>
              {caption && <p className="mt-3 text-xs text-muted-foreground">{caption}</p>}
            </div>
          </>
        )}

        {career.length > 0 && (
          <div className={program ? "mt-10" : ""}>
            <SectionHeading>Career</SectionHeading>
            <ol className="mt-5">
              {career.map((c, i) => (
                <li key={`${c.name}-${c.completedAt}`} className="relative pb-5 pl-7 last:pb-0">
                  {/* Timeline connector + node. */}
                  {i < career.length - 1 && (
                    <span aria-hidden className="absolute left-[3.5px] top-4 h-full w-px bg-border" />
                  )}
                  <span aria-hidden className="absolute left-0 top-1.5 size-2 rounded-full bg-accent ring-4 ring-accent/15" />
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">{c.name}</span>
                    <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                      <CheckCircle2 className="size-3 text-accent" strokeWidth={2} />
                      completed {MONTH_YEAR.format(new Date(c.completedAt))}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>
    </FadeIn>
  )
}
