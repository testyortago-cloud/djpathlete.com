import { describe, it, expect } from "vitest"
import { postProcessWindows, brollCacheKey, type RawWindow } from "@/lib/split-reel/broll-selection"

const w = (startMs: number, endMs: number, concept = "x", prompt = "p"): RawWindow => ({ startMs, endMs, concept, prompt })

describe("postProcessWindows", () => {
  it("keeps non-overlapping windows within the cap and sorts by start", () => {
    const r = postProcessWindows([w(8000, 13000), w(0, 5000)], { maxWindows: 6, minGapMs: 2000, totalMs: 60000 })
    expect(r.kept.map((k) => k.startMs)).toEqual([0, 8000])
    expect(r.dropped).toEqual([])
  })

  it("drops a window that violates the minimum gap from the previous kept window", () => {
    const r = postProcessWindows([w(0, 5000), w(5500, 9000)], { maxWindows: 6, minGapMs: 2000, totalMs: 60000 })
    expect(r.kept.map((k) => k.startMs)).toEqual([0])
    expect(r.dropped).toHaveLength(1)
  })

  it("drops overlapping windows", () => {
    const r = postProcessWindows([w(0, 5000), w(3000, 8000)], { maxWindows: 6, minGapMs: 0, totalMs: 60000 })
    expect(r.kept).toHaveLength(1)
    expect(r.dropped).toHaveLength(1)
  })

  it("enforces the max-windows cap, dropping the overflow", () => {
    const raw = [w(0, 4000), w(10000, 14000), w(20000, 24000), w(30000, 34000)]
    const r = postProcessWindows(raw, { maxWindows: 2, minGapMs: 1000, totalMs: 60000 })
    expect(r.kept).toHaveLength(2)
    expect(r.dropped).toHaveLength(2)
  })

  it("clamps to totalMs and drops windows entirely past the end", () => {
    const r = postProcessWindows([w(58000, 65000), w(70000, 75000)], { maxWindows: 6, minGapMs: 0, totalMs: 60000 })
    expect(r.kept).toEqual([{ startMs: 58000, endMs: 60000, concept: "x", prompt: "p" }])
    expect(r.dropped).toHaveLength(1)
  })
})

describe("brollCacheKey", () => {
  it("is stable for the same inputs and differs when any input changes", () => {
    const a = brollCacheKey("a calm sunrise run", "fal-ai/ltx-video", 5)
    const b = brollCacheKey("a calm sunrise run", "fal-ai/ltx-video", 5)
    const c = brollCacheKey("a calm sunrise run", "fal-ai/ltx-video", 6)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })
})
