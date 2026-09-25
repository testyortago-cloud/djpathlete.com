// Pulls published FAQs for a page key at render time.

import { listFaqsForPage } from "@/lib/db/faqs"
import { platformBusinessId } from "@/lib/tenancy/platform"
import type { Faq } from "@/types/database"
import type { FunnelRenderContext } from "./index"

interface FaqIslandProps {
  props: Record<string, unknown>
  context: FunnelRenderContext
}

export async function FaqIsland({ props, context }: FaqIslandProps) {
  // THE PLATFORM'S FAQs, ON THE PLATFORM'S PAGES ONLY (G35). `faqs` has no
  // `business_id` column: every row is written for darrenjpaul.com ("What is
  // DJP Athlete?", "Where are you based?"). On another business's page they
  // would read as that coach's own answers, so that page gets NOTHING rather
  // than the platform's — the same call the chat's booking offer makes
  // (lib/calendly/config-for-business.ts).
  //
  // FIRST, before the read: a page that can never show the rows has no reason
  // to fetch them, and a check placed after the read is one refactor away
  // from a render that forgets it.
  //
  // `context.businessId` is the tenant the ROUTE resolved, never the Host read
  // here — see `FunnelRenderContext.businessId` for why that is the one the
  // preview and the live page agree on.
  if (context.businessId !== platformBusinessId()) return null

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
