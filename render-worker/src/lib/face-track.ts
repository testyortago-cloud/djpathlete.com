// render-worker/src/lib/face-track.ts
// Pure trajectory math for the tracked talking-head crop. The detector that
// PRODUCES the trajectory lands with the worker wiring in Phase 2; this module is
// the deterministic core the composition consumes. No I/O.

// Local 2-value union (kept independent of layout-timeline so this stays a leaf
// module with no cross-file imports — simpler Vitest resolution).
export type CropMode = "full" | "split"

// Normalized face position in the SOURCE frame. cx/cy in [0,1]; size = face-box
// height as a fraction of the frame height.
export type FacePoint = { ms: number; cx: number; cy: number; size: number }

// Transform applied to the <OffthreadVideo> element (which is object-fit: cover).
export type CropRect = { scale: number; translateXPct: number; translateYPct: number }

const CENTER = { cx: 0.5, cy: 0.5, size: 0.3 }

// Where the face should sit vertically inside the visible box.
const ANCHOR_Y: Record<CropMode, number> = { full: 0.42, split: 0.5 }
// Baseline zoom per mode; split is tighter so the head fills the half-height box.
const BASE_SCALE: Record<CropMode, number> = { full: 1.1, split: 1.6 }

// Gaussian moving-average over a +/- windowMs neighbourhood (sigma = windowMs/2).
export function smoothTrajectory(points: FacePoint[], windowMs: number): FacePoint[] {
  if (points.length <= 2 || windowMs <= 0) return points
  const sorted = [...points].sort((a, b) => a.ms - b.ms)
  const sigma = windowMs / 2
  return sorted.map((p) => {
    let cx = 0, cy = 0, size = 0, wsum = 0
    for (const q of sorted) {
      const dt = q.ms - p.ms
      if (Math.abs(dt) > windowMs) continue
      const w = Math.exp(-(dt * dt) / (2 * sigma * sigma))
      cx += q.cx * w; cy += q.cy * w; size += q.size * w; wsum += w
    }
    return { ms: p.ms, cx: cx / wsum, cy: cy / wsum, size: size / wsum }
  })
}

// The (interpolated) face position at an arbitrary timestamp. Clamps outside the
// sampled range; falls back to centered when there are no samples.
export function faceAtMs(points: FacePoint[], ms: number): FacePoint {
  if (points.length === 0) return { ms, ...CENTER }
  const sorted = [...points].sort((a, b) => a.ms - b.ms)
  if (ms <= sorted[0].ms) return sorted[0]
  const lastPt = sorted[sorted.length - 1]
  if (ms >= lastPt.ms) return lastPt
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (ms >= a.ms && ms <= b.ms) {
      const t = (ms - a.ms) / (b.ms - a.ms)
      return {
        ms,
        cx: a.cx + (b.cx - a.cx) * t,
        cy: a.cy + (b.cy - a.cy) * t,
        size: a.size + (b.size - a.size) * t,
      }
    }
  }
  return lastPt
}

// Transform to keep the face on the per-mode anchor. The element is scaled about
// its center, so a face at cx maps toward center via translate (0.5 - cx).
export function cropForMode(point: FacePoint, mode: CropMode): CropRect {
  const scale = BASE_SCALE[mode]
  return {
    scale,
    translateXPct: (0.5 - point.cx) * 100,
    translateYPct: (ANCHOR_Y[mode] - point.cy) * 100,
  }
}
