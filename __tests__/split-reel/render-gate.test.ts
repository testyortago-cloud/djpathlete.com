import { describe, it, expect } from "vitest"
import { canRenderSplitReel, segmentsRemaining } from "@/lib/split-reel/render-gate"

const s = (status: string) => ({ status })

describe("canRenderSplitReel", () => {
  it("true when all ready", () => expect(canRenderSplitReel([s("ready"), s("ready")])).toBe(true))
  it("false when a window is still generating", () =>
    expect(canRenderSplitReel([s("ready"), s("generating")])).toBe(false))
  it("false when a window is still pending", () => expect(canRenderSplitReel([s("pending")])).toBe(false))
  it("true with ready+dropped+failed and nothing in flight", () =>
    expect(canRenderSplitReel([s("ready"), s("dropped"), s("failed")])).toBe(true))
  it("true for an empty list (full-frame-only)", () => expect(canRenderSplitReel([])).toBe(true))
})

describe("segmentsRemaining", () => {
  it("counts pending+generating", () =>
    expect(segmentsRemaining([s("pending"), s("generating"), s("ready")])).toBe(2))
})
