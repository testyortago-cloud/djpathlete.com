// lib/content-studio/render-progress.ts
// Client-side progress cues for the captioned-cut render. The render ai_job only
// exposes pending → processing → completed/failed (no percentage or per-step), so
// we map that to a coarse phase and pair it with an elapsed timer for an
// "it's alive" cue during the multi-minute wait.
export type RenderPhase = "queued" | "rendering"

export function renderPhase(status: string): RenderPhase {
  // pending = queued in the job runner; anything past that means the Cloud Run
  // render worker has claimed it (processing/streaming).
  return status === "pending" ? "queued" : "rendering"
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}
