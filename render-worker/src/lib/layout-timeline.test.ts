import { describe, it, expect } from "vitest"
import { buildLayoutTimeline, modeAtMs } from "./layout-timeline"

describe("buildLayoutTimeline", () => {
  it("returns a single full segment when there are no windows", () => {
    expect(buildLayoutTimeline([], 10_000)).toEqual([
      { mode: "full", startMs: 0, endMs: 10_000 },
    ])
  })

  it("returns [] when totalMs is not positive", () => {
    expect(buildLayoutTimeline([{ startMs: 0, endMs: 1000 }], 0)).toEqual([])
  })

  it("wraps a mid-reel window with full segments on both sides", () => {
    expect(buildLayoutTimeline([{ startMs: 3000, endMs: 5000 }], 10_000)).toEqual([
      { mode: "full", startMs: 0, endMs: 3000 },
      { mode: "split", startMs: 3000, endMs: 5000 },
      { mode: "full", startMs: 5000, endMs: 10_000 },
    ])
  })

  it("does not emit a leading full gap when a window starts at 0", () => {
    expect(buildLayoutTimeline([{ startMs: 0, endMs: 2000 }], 6000)).toEqual([
      { mode: "split", startMs: 0, endMs: 2000 },
      { mode: "full", startMs: 2000, endMs: 6000 },
    ])
  })

  it("does not emit a trailing full gap when a window ends at totalMs", () => {
    expect(buildLayoutTimeline([{ startMs: 4000, endMs: 6000 }], 6000)).toEqual([
      { mode: "full", startMs: 0, endMs: 4000 },
      { mode: "split", startMs: 4000, endMs: 6000 },
    ])
  })

  it("merges overlapping/touching windows", () => {
    expect(
      buildLayoutTimeline(
        [
          { startMs: 1000, endMs: 3000 },
          { startMs: 3000, endMs: 4000 },
          { startMs: 2500, endMs: 3500 },
        ],
        8000,
      ),
    ).toEqual([
      { mode: "full", startMs: 0, endMs: 1000 },
      { mode: "split", startMs: 1000, endMs: 4000 },
      { mode: "full", startMs: 4000, endMs: 8000 },
    ])
  })

  it("clamps windows that run past the total duration and drops empty ones", () => {
    expect(
      buildLayoutTimeline(
        [
          { startMs: 5000, endMs: 99_000 },
          { startMs: 2000, endMs: 2000 }, // empty → dropped
        ],
        6000,
      ),
    ).toEqual([
      { mode: "full", startMs: 0, endMs: 5000 },
      { mode: "split", startMs: 5000, endMs: 6000 },
    ])
  })
})

describe("modeAtMs", () => {
  const segments = buildLayoutTimeline([{ startMs: 3000, endMs: 5000 }], 10_000)

  it("returns the mode covering the timestamp", () => {
    expect(modeAtMs(segments, 0)).toBe("full")
    expect(modeAtMs(segments, 3000)).toBe("split")
    expect(modeAtMs(segments, 4999)).toBe("split")
    expect(modeAtMs(segments, 5000)).toBe("full")
  })

  it("clamps a past-the-end timestamp to the last segment", () => {
    expect(modeAtMs(segments, 999_999)).toBe("full")
  })

  it("returns full for an empty timeline", () => {
    expect(modeAtMs([], 1234)).toBe("full")
  })
})
