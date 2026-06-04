import { describe, it, expect } from "vitest"
import {
  pickEdited,
  resolveTrajectory,
  defaultBrollEdits,
  applyBrollEdits,
  type LoadedReelProject,
} from "./reel-project"
import type { FacePoint } from "./face-track"

const proj = (props: Record<string, unknown>, editedFields: string[]): LoadedReelProject => ({
  props: props as LoadedReelProject["props"],
  editedFields,
})

describe("pickEdited", () => {
  it("returns the derived value when there is no project row", () => {
    expect(pickEdited(null, "accentHex", "#derived")).toBe("#derived")
  })

  it("returns the derived value when the field is not in edited_fields", () => {
    const p = proj({ accentHex: "#saved" }, ["pages"]) // accentHex present but NOT locked
    expect(pickEdited(p, "accentHex", "#derived")).toBe("#derived")
  })

  it("returns the saved value only when the field is locked AND present", () => {
    const p = proj({ accentHex: "#saved" }, ["accentHex"])
    expect(pickEdited(p, "accentHex", "#derived")).toBe("#saved")
  })

  it("falls back to derived when locked but the saved value is missing", () => {
    const p = proj({}, ["accentHex"]) // locked but props has no accentHex
    expect(pickEdited(p, "accentHex", "#derived")).toBe("#derived")
  })
})

describe("resolveTrajectory (tri-state)", () => {
  const sample: FacePoint[] = [{ ms: 0, cx: 0.5, cy: 0.5, size: 0.3 }]

  it("detects when there is no project", async () => {
    let calls = 0
    const out = await resolveTrajectory(null, async () => {
      calls++
      return sample
    })
    expect(calls).toBe(1)
    expect(out).toBe(sample)
  })

  it("detects when saved trajectory is null or absent", async () => {
    let calls = 0
    const detect = async () => {
      calls++
      return sample
    }
    await resolveTrajectory(proj({ trajectory: null }, []), detect)
    await resolveTrajectory(proj({}, []), detect) // absent
    expect(calls).toBe(2)
  })

  it("honours a saved [] (no face) WITHOUT re-detecting", async () => {
    let calls = 0
    const out = await resolveTrajectory(proj({ trajectory: [] }, []), async () => {
      calls++
      return sample
    })
    expect(calls).toBe(0)
    expect(out).toEqual([])
  })

  it("reuses a saved non-empty trajectory WITHOUT re-detecting", async () => {
    let calls = 0
    const out = await resolveTrajectory(proj({ trajectory: sample }, []), async () => {
      calls++
      return []
    })
    expect(calls).toBe(0)
    expect(out).toBe(sample)
  })
})

describe("defaultBrollEdits", () => {
  it("enables every clip at its stored timing", () => {
    const clips = [
      { segmentIndex: 0, startMs: 1000, endMs: 4000 },
      { segmentIndex: 1, startMs: 8000, endMs: 11000 },
    ]
    expect(defaultBrollEdits(clips)).toEqual([
      { segmentIndex: 0, startMs: 1000, endMs: 4000, enabled: true },
      { segmentIndex: 1, startMs: 8000, endMs: 11000, enabled: true },
    ])
  })
})

describe("applyBrollEdits", () => {
  const clips = [
    { segmentIndex: 0, startMs: 1000, endMs: 4000, url: "http://a" },
    { segmentIndex: 1, startMs: 8000, endMs: 11000, url: "http://b" },
  ]

  it("drops disabled windows and applies edited timing to enabled ones", () => {
    const edits = [
      { segmentIndex: 0, startMs: 1500, endMs: 3500, enabled: true }, // retimed
      { segmentIndex: 1, startMs: 8000, endMs: 11000, enabled: false }, // disabled
    ]
    expect(applyBrollEdits(clips, edits)).toEqual([{ startMs: 1500, endMs: 3500, src: "http://a" }])
  })

  it("keeps a clip with no matching edit at its default timing", () => {
    const edits = [{ segmentIndex: 0, startMs: 1000, endMs: 4000, enabled: true }]
    expect(applyBrollEdits(clips, edits)).toEqual([
      { startMs: 1000, endMs: 4000, src: "http://a" },
      { startMs: 8000, endMs: 11000, src: "http://b" }, // segmentIndex 1 unmatched → default
    ])
  })
})
