import { describe, it, expect } from "vitest"
import { resolveSharedNote } from "@/lib/workout/shared-note"

const ROTATOR_CUE =
  "Working set targeting infraspinatus and teres minor. Lean forward slightly and allow the arm to internally rotate under load."

describe("resolveSharedNote", () => {
  it("returns the cue when every exercise in the day carries the same note", () => {
    expect(resolveSharedNote(["Rest 60s between sets", "Rest 60s between sets", "Rest 60s between sets"])).toBe(
      "Rest 60s between sets",
    )
  })

  it("does NOT hoist a note that belongs to a single exercise in the day", () => {
    // The real regression: 8 exercises, only the last one had a note, and it
    // rendered above the whole list as if it were the day's instructions.
    const day = [null, null, null, null, null, null, null, ROTATOR_CUE]
    expect(resolveSharedNote(day)).toBeNull()
  })

  it("does NOT hoist when most exercises share a note but one differs", () => {
    expect(resolveSharedNote(["Rest 60s", "Rest 60s", "Explosive intent"])).toBeNull()
  })

  it("does NOT hoist when some exercises are missing the otherwise-shared note", () => {
    expect(resolveSharedNote(["Rest 60s", "Rest 60s", null])).toBeNull()
    expect(resolveSharedNote([null, "Rest 60s", "Rest 60s"])).toBeNull()
  })

  it("keeps a lone exercise's note on its own card", () => {
    expect(resolveSharedNote([ROTATOR_CUE])).toBeNull()
  })

  it("ignores whitespace-only notes and trims the shared cue", () => {
    expect(resolveSharedNote(["   ", "   "])).toBeNull()
    expect(resolveSharedNote([" Rest 60s ", "Rest 60s"])).toBe("Rest 60s")
  })

  it("returns null for a day with no exercises", () => {
    expect(resolveSharedNote([])).toBeNull()
  })
})
