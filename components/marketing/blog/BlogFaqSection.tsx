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
    <section className="djp-faq py-16 lg:py-20 px-4 sm:px-8 bg-surface">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-6">
          Frequently Asked Questions
        </h2>
        <ul className="space-y-3">
          {entries.map((entry, idx) => (
            <li
              key={idx}
              className="rounded-lg border border-border bg-white"
            >
              <details className="group">
                <summary className="cursor-pointer list-none flex items-start justify-between gap-4 p-4 sm:p-5">
                  <span className="font-heading text-primary text-base sm:text-lg leading-snug">
                    {entry.question}
                  </span>
                  <span
                    aria-hidden
                    className="shrink-0 text-2xl text-muted-foreground leading-none transition-transform group-open:rotate-45 mt-0.5"
                  >
                    +
                  </span>
                </summary>
                <div className="px-4 pb-4 sm:px-5 sm:pb-5 text-muted-foreground leading-relaxed text-sm sm:text-base">
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
