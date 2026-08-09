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

import { useState } from "react"
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
  onDelete?: () => void | Promise<void>
  deleteLabel?: string
}

/**
 * The iframe renders at desktop width and is scaled down, so the thumbnail has
 * the same proportions a visitor sees. Scaling the iframe element itself (rather
 * than loading it narrow) avoids triggering the page's mobile breakpoints.
 */
const PREVIEW_WIDTH = 1280
const PREVIEW_SCALE = 0.32

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
  onDelete,
  deleteLabel = "Delete",
}: PreviewCardProps) {
  const [deleting, setDeleting] = useState(false)

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
      <div className="relative h-[200px] overflow-hidden border-b border-border bg-surface/50">
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
              height: 200 / PREVIEW_SCALE,
              transform: `scale(${PREVIEW_SCALE})`,
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No preview yet
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={href} className="block truncate font-medium text-primary hover:underline">
              {title}
            </Link>
            {subtitle ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          <DataTableBadge tone={badgeTone}>{badgeLabel}</DataTableBadge>
        </div>

        {typeof leadCount === "number" ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="size-3.5" aria-hidden />
            {leadCount} {leadCount === 1 ? "lead" : "leads"}
          </p>
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
