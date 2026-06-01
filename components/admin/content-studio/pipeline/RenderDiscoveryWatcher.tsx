"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useInFlightCaptionRenderVideoIds } from "@/hooks/use-inflight-caption-renders"
import { hasUntrackedRender } from "@/lib/content-studio/render-discovery"

/**
 * Live-discovers captioned-cut renders that START after the board was
 * server-rendered (e.g. kicked off from the video drawer while the Pipeline tab is
 * already open) and refreshes the route once so getPipelineData re-derives the lane
 * and the card slides into the Rendering column. Complements RenderWatcher, which
 * refreshes when a KNOWN render finishes.
 *
 * `knownRenderingVideoIds` is the server snapshot's in-flight set. Once a refresh
 * folds a newly-seen render into it, hasUntrackedRender goes false and the ref guard
 * resets — so we refresh at most once per newly-seen render, and never loop even if
 * the snapshot can't catch up (e.g. listRecentCaptionRenders degraded to empty).
 */
export function RenderDiscoveryWatcher({ knownRenderingVideoIds }: { knownRenderingVideoIds: Set<string> }) {
  const router = useRouter()
  const live = useInFlightCaptionRenderVideoIds()
  const refreshing = useRef(false)

  useEffect(() => {
    const untracked = hasUntrackedRender(live, knownRenderingVideoIds)
    if (untracked && !refreshing.current) {
      refreshing.current = true
      router.refresh()
    } else if (!untracked) {
      // Server snapshot caught up — re-arm for the next newly-started render.
      refreshing.current = false
    }
  }, [live, knownRenderingVideoIds, router])

  return null
}
