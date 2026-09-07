// __tests__/lib/db/sequence-reporting.test.ts
//
// The reporting read behind /admin/sequences.
//
// `bucketForRun` is where the whole feature lives. `sequence_runs` carries the
// outcome across TWO columns that do not line up with the four outcomes the
// screen promises: "ran to the end" is a status, "unsubscribed" is two
// different reasons, and there is a fifth reason the TypeScript union does not
// declare. Every one of those is a test below.

import { describe, expect, it } from "vitest"
import { bucketForRun, emptyBuckets, OUTCOME_BUCKETS } from "@/lib/db/sequence-reporting"

describe("bucketForRun", () => {
  it("puts a running person in progress", () => {
    expect(bucketForRun("active", null)).toBe("in_progress")
  })

  it("maps the four declared exit reasons", () => {
    expect(bucketForRun("exited", "payment")).toBe("bought")
    expect(bucketForRun("exited", "booking")).toBe("booked")
    expect(bucketForRun("exited", "unsubscribed")).toBe("opted_out")
    expect(bucketForRun("exited", "sms_stop")).toBe("opted_out")
  })

  // The reason SequenceExitReason does not declare. exitRun takes a plain
  // string and lib/automation/sequence-tick.ts:113 writes this one straight
  // past the union, so tsc cannot catch its absence — only this test can.
  it("maps 'suppressed', which the exported union omits", () => {
    expect(bucketForRun("exited", "suppressed")).toBe("opted_out")
  })

  // "Ran to the end" is a STATUS. completeRun writes no exit_reason at all,
  // so a mapping keyed only on exit_reason would lose every finisher.
  it("treats completed as finished regardless of exit_reason", () => {
    expect(bucketForRun("completed", null)).toBe("finished")
    expect(bucketForRun("completed", "payment")).toBe("finished")
  })

  it("treats failed as failed — a failure is not an exit", () => {
    expect(bucketForRun("failed", null)).toBe("failed")
  })

  // A sixth reason added later must be VISIBLE, not silently missing from the
  // totals. This is why "other" exists.
  it("puts an unknown exit reason in other rather than dropping it", () => {
    expect(bucketForRun("exited", "refunded_and_left")).toBe("other")
    expect(bucketForRun("exited", null)).toBe("other")
  })

  it("puts an unknown status in other", () => {
    expect(bucketForRun("paused_by_hand", null)).toBe("other")
  })
})

describe("emptyBuckets", () => {
  it("has a zero for every bucket in OUTCOME_BUCKETS", () => {
    const empty = emptyBuckets()
    expect(Object.keys(empty).sort()).toEqual([...OUTCOME_BUCKETS].sort())
    expect(Object.values(empty).every((n) => n === 0)).toBe(true)
  })

  it("returns a fresh object each call, so two sequences cannot share a tally", () => {
    // MUTANT: `const EMPTY = {...}; return EMPTY`. Every sequence would
    // accumulate into the same object and the first row would hold the totals
    // for all nine.
    const a = emptyBuckets()
    a.bought += 1
    expect(emptyBuckets().bought).toBe(0)
  })
})
