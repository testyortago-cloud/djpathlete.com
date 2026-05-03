import { Download } from "lucide-react"
import { findRelevantLeadMagnet } from "@/lib/db/lead-magnets"
import type { BlogPost } from "@/types/database"

interface LeadMagnetBlockProps {
  post: BlogPost
}

/**
 * Renders a compact "Free download" callout under the post intro when an
 * active lead_magnet matches the post's tags or category. Returns null when
 * no match exists.
 *
 * The asset_url is a direct link — clicking opens the asset in a new tab.
 * No email gate (intentional Phase 5 choice — gating is a future phase).
 */
export async function LeadMagnetBlock({ post }: LeadMagnetBlockProps) {
  let magnet
  try {
    magnet = await findRelevantLeadMagnet({
      tags: post.tags,
      category: post.category,
    })
  } catch (err) {
    console.warn(`[LeadMagnetBlock] lookup failed: ${(err as Error).message}`)
    return null
  }
  if (!magnet) return null

  return (
    <aside
      aria-label="Free download"
      className="not-prose rounded-xl border border-accent/30 bg-accent/5 p-5 sm:p-6 my-8"
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 size-10 rounded-lg bg-accent/15 flex items-center justify-center">
          <Download className="size-5 text-accent" aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-accent">─ Free download</p>
          <h3 className="mt-1 font-heading text-primary text-base sm:text-lg leading-snug">{magnet.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{magnet.description}</p>
          <a
            href={magnet.asset_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline underline-offset-4"
          >
            Download <Download className="size-3.5" aria-hidden />
          </a>
        </div>
      </div>
    </aside>
  )
}
