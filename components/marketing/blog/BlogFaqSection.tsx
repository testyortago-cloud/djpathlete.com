import type { FaqEntry } from "@/types/database"

interface BlogFaqSectionProps {
  entries: FaqEntry[]
}

/**
 * Renders an "FAQ" section using native <details>/<summary> for zero-JS
 * expand/collapse. Accessible by default (each <summary> is keyboard-
 * focusable and announces "expanded/collapsed" via the browser).
 *
 * Caller skips rendering when entries.length === 0.
 */
export function BlogFaqSection({ entries }: BlogFaqSectionProps) {
  if (entries.length === 0) return null

  return (
    <section className="djp-faq djp-paper-deep djp-grain border-t border-border/70 py-20 lg:py-24 px-4 sm:px-8">
      <div className="max-w-3xl mx-auto">
        <p className="djp-eyebrow">─ Frequently asked</p>
        <h2
          className="mt-5 font-heading font-semibold text-primary tracking-[-0.015em] leading-[1.05]"
          style={{ fontSize: "clamp(1.875rem, 3.6vw, 2.625rem)" }}
        >
          Questions, answered.
        </h2>

        <ul className="mt-10 divide-y divide-border/70 border-y border-border/70">
          {entries.map((entry, idx) => (
            <li key={idx}>
              <details className="group">
                <summary className="cursor-pointer list-none flex items-start justify-between gap-6 py-5 sm:py-6">
                  <div className="flex items-start gap-5 min-w-0">
                    <span
                      aria-hidden
                      className="djp-issue-no text-[11px] text-accent pt-1 tabular-nums"
                    >
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <span className="font-heading text-primary text-base sm:text-lg leading-snug">
                      {entry.question}
                    </span>
                  </div>
                  <span
                    aria-hidden
                    className="shrink-0 text-2xl text-muted-foreground leading-none transition-transform group-open:rotate-45 mt-0.5"
                  >
                    +
                  </span>
                </summary>
                <div className="pl-12 pr-6 pb-6 text-muted-foreground leading-relaxed text-base">
                  {entry.answer}
                </div>
              </details>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
