// lib/split-reel/render-gate.ts
// Pure: a Split Reel may render once no b-roll window is still cooking. `ready`,
// `dropped`, and `failed` are all terminal — only `pending`/`generating` block.
export type GateSegment = { status: string }

const IN_FLIGHT = new Set(["pending", "generating"])

export function segmentsRemaining(segments: GateSegment[]): number {
  return segments.filter((s) => IN_FLIGHT.has(s.status)).length
}

export function canRenderSplitReel(segments: GateSegment[]): boolean {
  return segmentsRemaining(segments) === 0
}
