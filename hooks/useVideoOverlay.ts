"use client"

import { useMemo } from "react"
import type { DrawingJson, TeamVideoCommentWithAnnotation } from "@/types/database"

/** Window (seconds) around currentTime within which an annotation is rendered. */
export const VISIBILITY_WINDOW_S = 0.5

/**
 * Filter comments down to ones whose annotation should be visible at currentTime,
 * and merge their drawings into a single DrawingJson for read-only render.
 */
export function useVisibleAnnotations(
  comments: TeamVideoCommentWithAnnotation[],
  currentTime: number,
): { visible: TeamVideoCommentWithAnnotation[]; merged: DrawingJson } {
  return useMemo(() => {
    const visible = comments.filter(
      (c) =>
        c.status === "open" &&
        c.timecode_seconds != null &&
        c.annotation != null &&
        Math.abs(currentTime - c.timecode_seconds) <= VISIBILITY_WINDOW_S,
    )
    const merged: DrawingJson = {
      paths: visible.flatMap((c) => c.annotation?.paths ?? []),
    }
    return { visible, merged }
  }, [comments, currentTime])
}
