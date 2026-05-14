"use client"

import { useMemo } from "react"
import type { DrawingJson, StoredAnnotation, TeamVideoCommentWithAnnotation } from "@/types/database"

/** Window (seconds) around currentTime within which an annotation is rendered. */
export const VISIBILITY_WINDOW_S = 0.5

/** Narrow a StoredAnnotation to a DrawingJson (drawings only, no image-index). */
function isDrawingAnnotation(a: StoredAnnotation | null | undefined): a is DrawingJson {
  return a != null && !("kind" in a)
}

/**
 * Filter comments down to ones whose annotation should be visible at currentTime,
 * and merge their drawings into a single DrawingJson for read-only render.
 *
 * image_index annotations (image_set submissions) are skipped — they don't
 * have a timecode and aren't rendered on a video frame.
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
        isDrawingAnnotation(c.annotation) &&
        Math.abs(currentTime - c.timecode_seconds) <= VISIBILITY_WINDOW_S,
    )
    const merged: DrawingJson = {
      paths: visible.flatMap((c) =>
        isDrawingAnnotation(c.annotation) ? c.annotation.paths : [],
      ),
    }
    return { visible, merged }
  }, [comments, currentTime])
}
