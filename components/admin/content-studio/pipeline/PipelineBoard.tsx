"use client"

import { useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { VideosLane } from "./VideosLane"
import { PostsLane } from "./PostsLane"
import { BulkActionsBar } from "./BulkActionsBar"
import { PipelineFilters } from "./PipelineFilters"
import {
  applyFilters,
  parseFilters,
  type PipelineFilters as Filters,
} from "@/lib/content-studio/pipeline-filters"
import type { PipelineData } from "@/lib/content-studio/pipeline-data"

interface PipelineBoardProps {
  initialData: PipelineData
  /** When the URL has no filter params, fall back to these (from user_preferences). */
  initialFilters?: Filters
}

export function PipelineBoard({ initialData, initialFilters }: PipelineBoardProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const filtersFromUrl = useMemo(() => parseFilters(searchParams), [searchParams])
  const hasAnyUrlFilter =
    searchParams.has("platform") ||
    searchParams.has("status") ||
    searchParams.has("from") ||
    searchParams.has("to") ||
    searchParams.has("sourceVideo")
  const filters = hasAnyUrlFilter || !initialFilters ? filtersFromUrl : initialFilters

  const filtered = useMemo(
    () => applyFilters(initialData.videos, initialData.posts, filters),
    [initialData, filters],
  )

  function toggleSelected(id: string, value: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })
  }

  return (
    <div className="space-y-6">
      <PipelineFilters videos={initialData.videos} />
      <VideosLane
        data={{
          ...initialData,
          videos: filtered.videos,
          posts: filtered.posts,
        }}
      />
      <PostsLane
        posts={filtered.posts}
        selectedIds={selectedIds}
        onToggleSelected={toggleSelected}
      />
      <BulkActionsBar
        selectedIds={selectedIds}
        onClear={() => setSelectedIds(new Set())}
        onApproved={() => {
          setSelectedIds(new Set())
          router.refresh()
        }}
      />
    </div>
  )
}
