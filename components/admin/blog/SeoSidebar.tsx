"use client"

import { X, ExternalLink } from "lucide-react"
import type { SeoMetadata } from "@/types/database"

interface SeoSidebarProps {
  seoMetadata: SeoMetadata | null
  onClose: () => void
}

export function SeoSidebar({ seoMetadata, onClose }: SeoSidebarProps) {
  const suggestions = seoMetadata?.internal_link_suggestions ?? []

  return (
    <aside
      className="w-80 shrink-0 border-l border-border bg-surface/50 flex flex-col overflow-hidden"
      aria-label="SEO sidebar"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="text-sm font-semibold text-primary">Internal links</div>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-primary"
          aria-label="Close SEO sidebar"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No link suggestions yet — publish the post to generate.
          </p>
        ) : (
          suggestions.map((s) => (
            <div key={s.blog_post_id} className="border border-border rounded-md bg-card p-3 text-sm">
              <div className="flex items-start gap-2 justify-between">
                <div className="font-medium text-primary flex-1 truncate">{s.title}</div>
                <span className="shrink-0 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                  {s.overlap_score}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{s.reason}</p>
              <a
                href={`/admin/blog/${s.blog_post_id}/edit`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ExternalLink className="size-3" />
                Open
              </a>
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
