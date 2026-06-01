"use client"

import { useEffect, useState } from "react"
import { ref, onValue } from "firebase/database"
import { rtdb } from "@/lib/firebase"

// Live captioned-cut render progress, streamed by the render worker to Realtime
// Database at renderProgress/{jobId}. RTDB (not Firestore) because progress ticks
// many times during a multi-minute render — high-frequency ephemeral data is what
// RTDB is built for. Returns null until the worker writes its first sample, or if
// progress isn't being published (worker without RTDB configured) — callers should
// fall back to the elapsed timer in that case.
export interface RenderProgress {
  /** 0..1 overall render+encode progress. */
  progress: number
  /** Rounded whole percent (0..100), for display. */
  pct: number
  /** Coarse phase label, e.g. "rendering" | "finalizing". */
  stage: string
  /** epoch ms of the last worker write. */
  updatedAt: number
}

export function useRenderProgress(jobId: string | null): RenderProgress | null {
  const [progress, setProgress] = useState<RenderProgress | null>(null)

  useEffect(() => {
    if (!jobId) {
      setProgress(null)
      return
    }
    const node = ref(rtdb, `renderProgress/${jobId}`)
    const unsub = onValue(
      node,
      (snap) => setProgress(snap.exists() ? (snap.val() as RenderProgress) : null),
      // On a listener error (e.g. rules / connectivity) drop to null so the UI
      // falls back to the timer rather than freezing on a stale value.
      () => setProgress(null),
    )
    return () => unsub()
  }, [jobId])

  return progress
}
