import { describe, it, expect } from "vitest"
import { loadTypeMeta } from "@/lib/workout/load-type"

describe("loadTypeMeta", () => {
  it("total: ×1, no client label", () => {
    expect(loadTypeMeta("total")).toEqual({ multiplier: 1, clientLabel: null })
  })
  it("per_dumbbell: ×2, 'per dumbbell' label", () => {
    const m = loadTypeMeta("per_dumbbell")
    expect(m.multiplier).toBe(2)
    expect(m.clientLabel).toMatch(/per dumbbell/i)
  })
  it("per_side: ×2, 'per side' label", () => {
    const m = loadTypeMeta("per_side")
    expect(m.multiplier).toBe(2)
    expect(m.clientLabel).toMatch(/per side/i)
  })
  it("defaults null/undefined to total", () => {
    expect(loadTypeMeta(null).multiplier).toBe(1)
    expect(loadTypeMeta(undefined).multiplier).toBe(1)
  })
})
