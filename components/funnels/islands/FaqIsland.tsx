// Pulls published FAQs for a page key at render time.

import { listFaqsForPage } from "@/lib/db/faqs"
import type { Faq } from "@/types/database"

interface FaqIslandProps {
  props: Record<string, unknown>
}

export async function FaqIsland({ props }: FaqIslandProps) {
  const pageKey = typeof props.pageKey === "string" ? props.pageKey : ""
  const limit = typeof props.limit === "number" ? props.limit : 6
  if (!pageKey) return null

  let rows: Faq[] = []
  try {
    rows = await listFaqsForPage(pageKey, { publishedOnly: true })
  } catch {
    return null
  }

  const shown = rows.slice(0, limit)
  if (shown.length === 0) return null

  return (
    <div data-djp-island="faq" data-djp-faq-page={pageKey}>
      {shown.map((faq) => (
        <details key={faq.id} data-djp-faq>
          <summary>{faq.question}</summary>
          <div>{faq.answer}</div>
        </details>
      ))}
    </div>
  )
}
