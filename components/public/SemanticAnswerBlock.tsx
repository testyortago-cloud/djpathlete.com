import { FadeIn } from "@/components/shared/FadeIn"

interface SemanticAnswerBlockProps {
  /** The exact question this block answers, mirroring user search syntax. */
  question: string
  /**
   * Self-contained 134–167 word answer that requires no external context.
   * Per 2026 AI Overview research, this length performs best as an extracted
   * "semantic unit." The first 200 characters should directly state the answer.
   */
  answer: string
  /** Optional small label above the question (e.g. "Quick answer", "What this is"). */
  eyebrow?: string
  className?: string
}

/**
 * Semantic Answer Block — a self-contained 134–167 word answer placed near
 * the top of money pages, immediately under the editorial hero. Designed to
 * be the extracted snippet for AI Overviews and rich snippet eligibility.
 *
 * Reference: 2026 research shows pages with semantic-completeness scores of
 * 8.5/10+ are 4.2× more likely to be cited in Google AI Overviews. The
 * 134–167 word range matches the favored AI Overview extract length.
 */
export function SemanticAnswerBlock({
  question,
  answer,
  eyebrow = "Quick answer",
  className = "",
}: SemanticAnswerBlockProps) {
  return (
    <section
      aria-labelledby="quick-answer-heading"
      className={`py-12 lg:py-16 px-4 sm:px-8 bg-surface border-y border-border ${className}`}
    >
      <FadeIn className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-px w-12 bg-accent" />
          <p className="text-[11px] font-medium text-accent uppercase tracking-[0.25em]">{eyebrow}</p>
        </div>
        <h2
          id="quick-answer-heading"
          className="text-xl sm:text-2xl font-heading font-semibold text-primary tracking-tight mb-4"
        >
          {question}
        </h2>
        <p className="text-base sm:text-lg text-foreground leading-relaxed">{answer}</p>
      </FadeIn>
    </section>
  )
}
