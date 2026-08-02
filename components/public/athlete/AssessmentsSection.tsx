import { FadeIn } from "@/components/shared/FadeIn"
import { SectionHeading } from "./SectionHeading"
import type { PublicAssessment } from "@/lib/profile-share/data"

const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })

/** Completed assessment batteries — coach-run test days, results only (scrubbed upstream). */
export function AssessmentsSection({ assessments }: { assessments: PublicAssessment[] }) {
  if (assessments.length === 0) return null
  return (
    <FadeIn>
      <section aria-label="Assessments" className="mt-14">
        <SectionHeading>Assessments</SectionHeading>
        <div className="mt-5 grid gap-4">
          {assessments.map((a) => (
            <div key={`${a.title}-${a.date}`} className="rounded-2xl border border-border bg-card/70 p-5 backdrop-blur-sm md:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-heading text-base font-semibold text-foreground md:text-lg">{a.title}</h3>
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {MONTH_YEAR.format(new Date(a.date))}
                </span>
              </div>
              <ul className="mt-3">
                {a.items.map((it) => (
                  <li
                    key={it.name}
                    className="flex items-baseline justify-between gap-3 border-b border-border/60 py-2 text-sm last:border-b-0"
                  >
                    <span className="min-w-0 truncate text-foreground/90">{it.name}</span>
                    <span className="shrink-0 font-mono font-semibold tabular-nums text-primary">
                      {it.value} {it.unit ?? ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </FadeIn>
  )
}
