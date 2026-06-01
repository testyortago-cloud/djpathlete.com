"use client"

import { useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { VideosLane } from "./VideosLane"
import { PostsLane } from "./PostsLane"
import { BulkActionsBar } from "./BulkActionsBar"
import { PipelineFilters } from "./PipelineFilters"
import {
  applyFilters,
  effectiveFilters,
  pruneMissingSourceVideo,
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

  // The effective filter (URL wins, else stored prefs), with a dangling
  // sourceVideoId — one pointing at a since-deleted video — pruned so it can't
  // silently empty the board. The same value drives the filter bar (below), so
  // a stored filter is always visible and clearable.
  const videoIds = useMemo(() => new Set(initialData.videos.map((v) => v.id)), [initialData.videos])
  const filters = useMemo(
    () => pruneMissingSourceVideo(effectiveFilters(searchParams, initialFilters ?? null), videoIds),
    [searchParams, initialFilters, videoIds],
  )

  const filtered = useMemo(() => applyFilters(initialData.videos, initialData.posts, filters), [initialData, filters])

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
      <PipelineFilters videos={initialData.videos} filters={filters} />
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
        thumbnailUrlsByVideo={initialData.thumbnailUrlsByVideo}
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
