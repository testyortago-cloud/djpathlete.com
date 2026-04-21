"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { useMemo, useCallback } from "react"
import { Filter, X } from "lucide-react"
import {
  parseFilters,
  filtersToSearchParams,
  type PipelineFilters as Filters,
} from "@/lib/content-studio/pipeline-filters"
import type { SocialPlatform, SocialApprovalStatus, VideoUpload } from "@/types/database"
import { cn } from "@/lib/utils"

const PLATFORMS: { id: SocialPlatform; label: string }[] = [
  { id: "instagram", label: "Instagram" },
  { id: "tiktok", label: "TikTok" },
  { id: "facebook", label: "Facebook" },
  { id: "youtube", label: "YouTube" },
  { id: "youtube_shorts", label: "YT Shorts" },
  { id: "linkedin", label: "LinkedIn" },
]

// UI chips map to one or more real DB statuses. "Needs Review" collects
// draft + edited; "Approved" includes awaiting_connection (approved posts
// waiting on a platform auth).
const STATUS_CHIPS: { id: string; label: string; statuses: SocialApprovalStatus[] }[] = [
  { id: "needs_review", label: "Needs Review", statuses: ["draft", "edited"] },
  { id: "approved", label: "Approved", statuses: ["approved", "awaiting_connection"] },
  { id: "scheduled", label: "Scheduled", statuses: ["scheduled"] },
  { id: "published", label: "Published", statuses: ["published"] },
  { id: "failed", label: "Failed", statuses: ["failed"] },
]

interface PipelineFiltersProps {
  videos: VideoUpload[]
}

export function PipelineFilters({ videos }: PipelineFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const filters = useMemo(() => parseFilters(searchParams), [searchParams])

  const update = useCallback(
    (next: Filters) => {
      const sp = filtersToSearchParams(next)
      const preserve = ["tab"]
      for (const k of preserve) {
        const v = searchParams.get(k)
        if (v) sp.set(k, v)
      }
      const qs = sp.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
      // Persist the latest filter set to user_preferences. Fire-and-forget —
      // a failed PATCH does not affect the local render.
      fetch("/api/admin/content-studio/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ last_pipeline_filters: next }),
      }).catch(() => {})
    },
    [pathname, router, searchParams],
  )

  function togglePlatform(id: SocialPlatform) {
    const has = filters.platforms.includes(id)
    const next = has ? filters.platforms.filter((p) => p !== id) : [...filters.platforms, id]
    update({ ...filters, platforms: next })
  }

  function toggleStatusChip(chipStatuses: SocialApprovalStatus[]) {
    const allActive = chipStatuses.every((s) => filters.statuses.includes(s))
    const next = allActive
      ? filters.statuses.filter((s) => !chipStatuses.includes(s))
      : Array.from(new Set([...filters.statuses, ...chipStatuses]))
    update({ ...filters, statuses: next })
  }

  const activeCount =
    filters.platforms.length +
    filters.statuses.length +
    (filters.from ? 1 : 0) +
    (filters.to ? 1 : 0) +
    (filters.sourceVideoId ? 1 : 0)

  return (
    <div className="rounded-lg border border-border bg-white p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-2 text-sm text-primary">
          <Filter className="size-4" />
          <span className="font-medium">Filters</span>
          {activeCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">
              {activeCount} active
            </span>
          )}
        </div>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => router.replace(pathname, { scroll: false })}
            className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"
          >
            <X className="size-3" /> Clear all
          </button>
        )}
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Platform</p>
        <div className="flex flex-wrap gap-1">
          {PLATFORMS.map(({ id, label }) => {
            const active = filters.platforms.includes(id)
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => togglePlatform(id)}
                className={cn(
                  "text-xs px-2.5 py-1 rounded-full border transition",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-white text-muted-foreground border-border hover:border-primary/50",
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Status</p>
        <div className="flex flex-wrap gap-1">
          {STATUS_CHIPS.map(({ id, label, statuses }) => {
            const active = statuses.every((s) => filters.statuses.includes(s))
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => toggleStatusChip(statuses)}
                className={cn(
                  "text-xs px-2.5 py-1 rounded-full border transition",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-white text-muted-foreground border-border hover:border-primary/50",
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="text-xs text-muted-foreground">
          From
          <input
            type="date"
            value={filters.from ?? ""}
            onChange={(e) => update({ ...filters, from: e.target.value || null })}
            className="mt-0.5 block w-full rounded border border-border px-2 py-1 text-xs"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          To
          <input
            type="date"
            value={filters.to ?? ""}
            onChange={(e) => update({ ...filters, to: e.target.value || null })}
            className="mt-0.5 block w-full rounded border border-border px-2 py-1 text-xs"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Source video
          <select
            value={filters.sourceVideoId ?? ""}
            onChange={(e) => update({ ...filters, sourceVideoId: e.target.value || null })}
            className="mt-0.5 block w-full rounded border border-border px-2 py-1 text-xs"
          >
            <option value="">All videos</option>
            {videos.map((v) => (
              <option key={v.id} value={v.id}>
                {v.title ?? v.original_filename}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}
