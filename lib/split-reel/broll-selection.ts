// lib/split-reel/broll-selection.ts
// Pure post-processing of AI-selected b-roll windows: clamp to duration, drop
// overlaps and min-gap violations, enforce the window cap. Plus a stable cache key.
import { createHash } from "node:crypto"

export type RawWindow = { startMs: number; endMs: number; concept: string; prompt: string }
export type KeptWindow = RawWindow
export type PostProcessResult = { kept: KeptWindow[]; dropped: RawWindow[] }

export function postProcessWindows(
  raw: RawWindow[],
  opts: { maxWindows: number; minGapMs: number; totalMs: number },
): PostProcessResult {
  const { maxWindows, minGapMs, totalMs } = opts
  const dropped: RawWindow[] = []

  // Clamp to [0,totalMs]; drop empty/inverted/past-end.
  const clamped = raw
    .map((r) => ({ ...r, startMs: Math.max(0, Math.min(r.startMs, totalMs)), endMs: Math.max(0, Math.min(r.endMs, totalMs)) }))
    .filter((r) => {
      if (r.endMs > r.startMs) return true
      dropped.push(r)
      return false
    })
    .sort((a, b) => a.startMs - b.startMs)

  const kept: KeptWindow[] = []
  for (const win of clamped) {
    if (kept.length >= maxWindows) { dropped.push(win); continue }
    const last = kept[kept.length - 1]
    if (last && win.startMs < last.endMs + minGapMs) { dropped.push(win); continue }
    kept.push(win)
  }
  return { kept, dropped }
}

export function brollCacheKey(prompt: string, model: string, windowSeconds: number): string {
  return createHash("sha256").update(`${prompt}::${model}::${windowSeconds}`).digest("hex")
}
