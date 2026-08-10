"use client"

// A funnel/page card with a live preview of the actual page.
//
// The preview is a same-origin iframe of the real route, scaled down — not a
// screenshot service. A funnel page IS html, so the truest thumbnail is the page
// itself, and this needs no capture pipeline, no storage and no staleness. CSP
// already allows `frame-src 'self'`.
//
// Note on the house style rule: /admin lists use components/ui/data-table.tsx.
// That rule exists so lists don't each invent their own TABLE chrome. This is a
// deliberate exception the owner asked for — a funnel is a visual artifact, and
// a row of slugs tells you nothing about which page you are looking for.

import { useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { ExternalLink, Trash2, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DataTableBadge, type DataTableBadgeTone } from "@/components/ui/data-table"

export interface PreviewCardProps {
  title: string
  subtitle?: string
  /** Same-origin path to render in the preview. null = nothing published yet. */
  previewUrl: string | null
  /** Where the primary button goes (editor or funnel detail). */
  href: string
  primaryLabel?: string
  /** Shown as an open-in-new-tab button when the page is reachable. */
  publicUrl?: string | null
  badgeLabel: string
  badgeTone: DataTableBadgeTone
  leadCount?: number
  /** Where the lead count points. Omitted = render it as plain text. */
  leadsHref?: string
  onDelete?: () => void | Promise<void>
  deleteLabel?: string
  /** Rendered next to the primary button — e.g. a link to funnel settings. */
  secondaryAction?: ReactNode
}

/**
 * The iframe renders at desktop width and is scaled down, so the thumbnail has
 * the same proportions a visitor sees. Scaling the iframe element itself (rather
 * than loading it narrow) avoids triggering the page's mobile breakpoints — load
 * it narrow and the thumbnail stops showing what a desktop visitor sees, which
 * is the whole point of it.
 */
const PREVIEW_WIDTH = 1280

/**
 * Fallback only, for the first paint before the container has been measured and
 * for environments with no ResizeObserver (jsdom).
 *
 * The scale MUST be derived from the container's real width, not fixed. It used
 * to be a hard-coded 0.32, which renders the iframe at exactly
 * 1280 * 0.32 = 409.6px no matter how wide the card is. That happens to fill a
 * card in the funnels LIST grid, which is why it survived — but on the funnel
 * DETAIL page the card is much wider, so the thumbnail filled the left ~410px
 * and left a dead strip of background for the rest. A constant can only ever be
 * right at one container width.
 */
const FALLBACK_PREVIEW_SCALE = 0.32

/** The thumbnail's fixed rendered height, in CSS pixels. */
const PREVIEW_BOX_HEIGHT = 200

export function PreviewCard({
  title,
  subtitle,
  previewUrl,
  href,
  primaryLabel = "Open",
  publicUrl,
  badgeLabel,
  badgeTone,
  leadCount,
  leadsHref,
  onDelete,
  deleteLabel = "Delete",
  secondaryAction,
}: PreviewCardProps) {
  const [deleting, setDeleting] = useState(false)

  // Scale the thumbnail to whatever width the card actually got. The card is
  // responsive (grid on the list page, full width on the detail page, and both
  // reflow when the sidebar collapses), so a one-shot measure on mount goes
  // stale — hence the observer rather than a single read.
  const frameBoxRef = useRef<HTMLDivElement | null>(null)
  const [previewScale, setPreviewScale] = useState(FALLBACK_PREVIEW_SCALE)

  useEffect(() => {
    const box = frameBoxRef.current
    if (!box || typeof ResizeObserver === "undefined") return
    const apply = (width: number) => {
      if (width > 0) setPreviewScale(width / PREVIEW_WIDTH)
    }
    apply(box.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) apply(entry.contentRect.width)
    })
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  async function handleDelete() {
    if (!onDelete || deleting) return
    setDeleting(true)
    try {
      await onDelete()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-white shadow-sm">
      <div ref={frameBoxRef} className="relative h-[200px] overflow-hidden border-b border-border bg-surface/50">
        {previewUrl ? (
          <iframe
            src={previewUrl}
            title={`Preview of ${title}`}
            loading="lazy"
            aria-hidden
            tabIndex={-1}
            scrolling="no"
            // Same-origin but inert: the thumbnail must never run a form
            // submission or navigate the admin page.
            sandbox="allow-same-origin"
            className="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
            style={{
              width: PREVIEW_WIDTH,
              // Height is tied to the SAME scale, so the scaled result always
              // lands on the container's fixed height rather than under- or
              // over-shooting it as the width changes.
              height: PREVIEW_BOX_HEIGHT / previewScale,
              transform: `scale(${previewScale})`,
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No preview yet</div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={href} className="block truncate font-medium text-primary hover:underline">
              {title}
            </Link>
            {subtitle ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
          <DataTableBadge tone={badgeTone}>{badgeLabel}</DataTableBadge>
        </div>

        {/* A LINK, not a label. This count was the only lead surface in the
            app and it went nowhere: it told you leads existed and gave you no
            way to read one. It now opens the inbox filtered to this page. */}
        {typeof leadCount === "number" ? (
          leadsHref ? (
            <Link
              href={leadsHref}
              className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-primary hover:underline"
            >
              <Users className="size-3.5" aria-hidden />
              {leadCount} {leadCount === 1 ? "lead" : "leads"}
            </Link>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="size-3.5" aria-hidden />
              {leadCount} {leadCount === 1 ? "lead" : "leads"}
            </p>
          )
        ) : null}

        <div className="mt-auto flex items-center gap-2">
          <Button asChild size="sm">
            <Link href={href}>{primaryLabel}</Link>
          </Button>
          {publicUrl ? (
            <Button asChild variant="outline" size="sm" aria-label={`Open ${title} in a new tab`}>
              <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" />
              </a>
            </Button>
          ) : null}
          {secondaryAction}
          {onDelete ? (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-muted-foreground hover:text-[var(--error)]"
              onClick={handleDelete}
              disabled={deleting}
              aria-label={deleteLabel}
            >
              <Trash2 className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
