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

  // Same classes as the authored inline FAQ in `render.ts` — see the note on
  // TestimonialsIsland. `djp-faq-details` is the one addition: a `<details>`
  // needs its UA disclosure triangle replaced, and the inline variant is a
  // `<dl>` with no summary to style.
  return (
    <div className="djp-faq-list" data-djp-island="faq" data-djp-faq-page={pageKey}>
      {shown.map((faq) => (
        <details key={faq.id} className="djp-faq-item djp-faq-details" data-djp-faq>
          <summary className="djp-faq-q">{faq.question}</summary>
          <div className="djp-faq-a">{faq.answer}</div>
        </details>
      ))}
    </div>
  )
}
