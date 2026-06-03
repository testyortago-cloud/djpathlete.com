import { describe, it, expect } from "vitest"
import { normalizeFaceBox } from "./face-box"

describe("normalizeFaceBox", () => {
  it("maps a centered pixel box to cx/cy ~0.5 and size = boxHeight/frameHeight", () => {
    // 100x100 box centered in a 1000x1000 frame at (450,450)
    const p = normalizeFaceBox([450, 450, 100, 100], 1000, 1000, 2000)
    expect(p.cx).toBeCloseTo(0.5, 5)
    expect(p.cy).toBeCloseTo(0.5, 5)
    expect(p.size).toBeCloseTo(0.1, 5)
    expect(p.ms).toBe(2000)
  })

  it("clamps cx/cy into [0,1] for an out-of-bounds box", () => {
    const p = normalizeFaceBox([-50, -50, 100, 100], 1000, 1000, 0)
    expect(p.cx).toBeGreaterThanOrEqual(0)
    expect(p.cy).toBeGreaterThanOrEqual(0)
  })

  it("puts a left-third face at cx ~0.2", () => {
    const p = normalizeFaceBox([100, 400, 200, 200], 1000, 1000, 0)
    expect(p.cx).toBeCloseTo(0.2, 5)
  })
})
