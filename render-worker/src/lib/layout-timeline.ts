// render-worker/src/lib/layout-timeline.ts
// Pure: turn the selected b-roll windows into a contiguous layout timeline over
// the full reel duration. Everything outside a window is "full" (full-frame
// talking head); each window is "split" (talking head + b-roll). No I/O.

export type LayoutMode = "full" | "split"
export type BrollWindow = { startMs: number; endMs: number }
export type LayoutSegment = { mode: LayoutMode; startMs: number; endMs: number }

export function buildLayoutTimeline(
  windows: BrollWindow[],
  totalMs: number,
): LayoutSegment[] {
  if (!Number.isFinite(totalMs) || totalMs <= 0) return []

  // Clamp to [0, totalMs], drop empty/inverted, sort by start.
  const clean = windows
    .filter((w) => Number.isFinite(w.startMs) && Number.isFinite(w.endMs))
    .map((w) => ({
      startMs: Math.max(0, Math.min(w.startMs, totalMs)),
      endMs: Math.max(0, Math.min(w.endMs, totalMs)),
    }))
    .filter((w) => w.endMs > w.startMs)
    .sort((a, b) => a.startMs - b.startMs)

  // Merge overlapping/touching windows so we never emit a zero-length full gap.
  const merged: BrollWindow[] = []
  for (const w of clean) {
    const last = merged[merged.length - 1]
    if (last && w.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, w.endMs)
    } else {
      merged.push({ ...w })
    }
  }

  // Walk the timeline, filling "full" between (and around) the windows.
  const segments: LayoutSegment[] = []
  let cursor = 0
  for (const w of merged) {
    if (w.startMs > cursor) {
      segments.push({ mode: "full", startMs: cursor, endMs: w.startMs })
    }
    segments.push({ mode: "split", startMs: w.startMs, endMs: w.endMs })
    cursor = w.endMs
  }
  if (cursor < totalMs) {
    segments.push({ mode: "full", startMs: cursor, endMs: totalMs })
  }
  return segments
}

// Which layout mode is active at `ms`. Past the end (last-frame rounding) clamps
// to the final segment; an empty timeline is "full".
export function modeAtMs(segments: LayoutSegment[], ms: number): LayoutMode {
  for (const s of segments) {
    if (ms >= s.startMs && ms < s.endMs) return s.mode
  }
  const last = segments[segments.length - 1]
  return last ? last.mode : "full"
}
