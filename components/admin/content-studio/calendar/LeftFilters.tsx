"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { useMemo, useState, useCallback } from "react"
import { parseFilters, filtersToSearchParams, type PipelineFilters } from "@/lib/content-studio/pipeline-filters"
import type { SocialPlatform, SocialApprovalStatus, VideoUpload } from "@/types/database"

const PLATFORMS: { id: SocialPlatform; label: string }[] = [
  { id: "instagram", label: "Instagram" },
  { id: "tiktok", label: "TikTok" },
  { id: "facebook", label: "Facebook" },
  { id: "youtube", label: "YouTube" },
  { id: "youtube_shorts", label: "YouTube Shorts" },
  { id: "linkedin", label: "LinkedIn" },
]
const STATUSES: { id: SocialApprovalStatus; label: string }[] = [
  { id: "scheduled", label: "Scheduled" },
  { id: "published", label: "Published" },
  { id: "failed", label: "Failed" },
]

interface LeftFiltersProps {
  videos: VideoUpload[]
}

export function LeftFilters({ videos }: LeftFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const filters = useMemo(() => parseFilters(searchParams), [searchParams])
  const [search, setSearch] = useState("")

  const update = useCallback(
    (next: PipelineFilters) => {
      const sp = filtersToSearchParams(next)
      for (const k of ["tab", "view", "anchor"]) {
        const v = searchParams.get(k)
        if (v) sp.set(k, v)
      }
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  function togglePlatform(id: SocialPlatform) {
    const has = filters.platforms.includes(id)
    update({
      ...filters,
      platforms: has ? filters.platforms.filter((p) => p !== id) : [...filters.platforms, id],
    })
  }
  function toggleStatus(id: SocialApprovalStatus) {
    const has = filters.statuses.includes(id)
    update({
      ...filters,
      statuses: has ? filters.statuses.filter((s) => s !== id) : [...filters.statuses, id],
    })
  }

  const matching = videos.filter((v) => (v.title ?? v.original_filename).toLowerCase().includes(search.toLowerCase()))

  return (
    <aside aria-label="Calendar filters" className="w-60 shrink-0 border-r border-border bg-surface/30 overflow-y-auto">
      <div className="p-3 space-y-5">
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-primary mb-2">Platform</h3>
          <ul className="space-y-1">
            {PLATFORMS.map(({ id, label }) => (
              <li key={id}>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.platforms.includes(id)}
                    onChange={() => togglePlatform(id)}
                    className="size-4 rounded border-border text-primary focus:ring-primary/30"
                  />
                  <span>{label}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-primary mb-2">Status</h3>
          <ul className="space-y-1">
            {STATUSES.map(({ id, label }) => (
              <li key={id}>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.statuses.includes(id)}
                    onChange={() => toggleStatus(id)}
                    className="size-4 rounded border-border text-primary focus:ring-primary/30"
                  />
                  <span>{label}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-primary mb-2">Source video</h3>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search videos"
            className="w-full rounded border border-border px-2 py-1 text-xs mb-2"
          />
          <select
            value={filters.sourceVideoId ?? ""}
            onChange={(e) => update({ ...filters, sourceVideoId: e.target.value || null })}
            className="w-full rounded border border-border px-2 py-1 text-xs"
          >
            <option value="">All videos</option>
            {matching.map((v) => (
              <option key={v.id} value={v.id}>
                {v.title ?? v.original_filename}
              </option>
            ))}
          </select>
        </section>
      </div>
    </aside>
  )
}
