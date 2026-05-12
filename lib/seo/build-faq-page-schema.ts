import type { FaqEntry } from "@/types/database"

export type FaqPageSchema = {
  "@context": "https://schema.org"
  "@type": "FAQPage"
  mainEntity: Array<{
    "@type": "Question"
    name: string
    acceptedAnswer: {
      "@type": "Answer"
      text: string
    }
  }>
} & Record<string, unknown>

/**
 * Build a Google-compatible FAQPage JSON-LD blob from a post's FAQ array.
 * Returns null when fewer than 3 non-empty entries exist (Google's FAQ
 * rich-result eligibility wants multiple Q&As, and a single Q reads as spam).
 */
export function buildFaqPageSchema(entries: FaqEntry[] | null | undefined): FaqPageSchema | null {
  if (!entries || entries.length === 0) return null
  const cleaned = entries
    .map((e) => ({ question: e.question?.trim() ?? "", answer: e.answer?.trim() ?? "" }))
    .filter((e) => e.question.length > 0 && e.answer.length > 0)
  if (cleaned.length < 3) return null
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: cleaned.map((e) => ({
      "@type": "Question",
      name: e.question,
      acceptedAnswer: { "@type": "Answer", text: e.answer },
    })),
  }
}
