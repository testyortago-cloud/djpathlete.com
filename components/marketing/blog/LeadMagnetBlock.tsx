import { Download, ArrowUpRight } from "lucide-react"
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
      className="relative not-prose border border-accent/30 bg-accent/[0.06] p-6 sm:p-7"
    >
      <span
        aria-hidden
        className="absolute -top-3 left-6 djp-issue-no text-[10.5px] uppercase tracking-[0.22em] text-accent bg-[oklch(0.985_0.008_80)] px-2"
      >
        ─ Free download
      </span>

      <div className="flex items-start gap-5">
        <div className="shrink-0 size-12 rounded-md bg-accent/15 flex items-center justify-center">
          <Download className="size-5 text-accent" aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <h3
            className="font-heading font-semibold text-primary leading-[1.15] tracking-[-0.01em]"
            style={{ fontSize: "clamp(1.125rem, 1.8vw, 1.375rem)" }}
          >
            {magnet.title}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            {magnet.description}
          </p>
          <a
            href={magnet.asset_url}
            target="_blank"
            rel="noopener noreferrer"
            className="group mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
          >
            <span className="border-b border-accent pb-0.5 transition-all group-hover:pb-1.5">
              Download the resource
            </span>
            <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </a>
        </div>
      </div>
    </aside>
  )
}
