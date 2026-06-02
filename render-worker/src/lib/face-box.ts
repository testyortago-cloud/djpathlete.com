// render-worker/src/lib/face-box.ts
// Pure: convert a detector's pixel-space face box into the normalized FacePoint
// the composition consumes. No I/O. Box is [x, y, width, height] in pixels.
import type { FacePoint } from "./face-track.js"

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

export function normalizeFaceBox(
  box: [number, number, number, number],
  frameWidth: number,
  frameHeight: number,
  ms: number,
): FacePoint {
  const [x, y, w, h] = box
  return {
    ms,
    cx: clamp01((x + w / 2) / frameWidth),
    cy: clamp01((y + h / 2) / frameHeight),
    size: clamp01(h / frameHeight),
  }
}
