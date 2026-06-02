import { describe, it, expect } from "vitest"
import { smoothTrajectory, faceAtMs, cropForMode, type FacePoint } from "./face-track"

const P = (ms: number, cx: number, cy: number, size = 0.3): FacePoint => ({ ms, cx, cy, size })

describe("smoothTrajectory", () => {
  it("returns the input unchanged for <=2 points or a non-positive window", () => {
    const two = [P(0, 0.1, 0.1), P(100, 0.9, 0.9)]
    expect(smoothTrajectory(two, 500)).toEqual(two)
    const many = [P(0, 0.1, 0.1), P(100, 0.5, 0.5), P(200, 0.9, 0.9)]
    expect(smoothTrajectory(many, 0)).toEqual(many)
  })

  it("preserves length and pulls a spike toward its neighbours", () => {
    const pts = [P(0, 0.5, 0.5), P(100, 0.9, 0.9), P(200, 0.5, 0.5)]
    const out = smoothTrajectory(pts, 200)
    expect(out).toHaveLength(3)
    // The middle spike (0.9) is averaged with its 0.5 neighbours → strictly lower.
    expect(out[1].cx).toBeLessThan(0.9)
    expect(out[1].cx).toBeGreaterThan(0.5)
  })
})

describe("faceAtMs", () => {
  it("returns a centered face for an empty trajectory", () => {
    expect(faceAtMs([], 1000)).toMatchObject({ cx: 0.5, cy: 0.5 })
  })

  it("clamps before the first and after the last sample", () => {
    const pts = [P(1000, 0.2, 0.2), P(2000, 0.8, 0.8)]
    expect(faceAtMs(pts, 0)).toMatchObject({ cx: 0.2, cy: 0.2 })
    expect(faceAtMs(pts, 9999)).toMatchObject({ cx: 0.8, cy: 0.8 })
  })

  it("linearly interpolates between samples", () => {
    const pts = [P(0, 0.0, 0.0), P(1000, 1.0, 1.0)]
    const mid = faceAtMs(pts, 500)
    expect(mid.cx).toBeCloseTo(0.5, 5)
    expect(mid.cy).toBeCloseTo(0.5, 5)
  })
})

describe("cropForMode", () => {
  it("uses a tighter zoom for split than for full", () => {
    const face = P(0, 0.5, 0.5)
    expect(cropForMode(face, "split").scale).toBeGreaterThan(
      cropForMode(face, "full").scale,
    )
  })

  it("does not translate horizontally for a horizontally-centered face", () => {
    expect(cropForMode(P(0, 0.5, 0.4), "full").translateXPct).toBeCloseTo(0, 5)
  })

  it("pushes the frame right when the face is on the left, and vice versa", () => {
    expect(cropForMode(P(0, 0.3, 0.5), "full").translateXPct).toBeGreaterThan(0)
    expect(cropForMode(P(0, 0.7, 0.5), "full").translateXPct).toBeLessThan(0)
  })
})
