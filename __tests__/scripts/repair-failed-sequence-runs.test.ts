// @vitest-environment node
//
// The selection predicate for the hand-run repair of runs a configuration
// fault destroyed (2026-08-31: 73 sms_repermission runs, all failed on
// "The darrenjpaul.com domain is not verified").
//
// Each predicate gets its own test. A filter with three conditions where only
// one is ever exercised is, for testing purposes, a filter with one condition.
import { describe, it, expect } from "vitest"
import { selectRepairable } from "../../scripts/_repair-failed-sequence-runs-lib.mjs"

const RUN = {
  id: "run-1",
  status: "failed",
  sequence_key: "sms_repermission",
  last_error:
    "sendSequenceEmail failed: The darrenjpaul.com domain is not verified. Please, add and verify your domain on https://resend.com/domains",
}

const ARGS = { sequenceKey: "sms_repermission", errorPattern: "domain is not verified" }

describe("selectRepairable", () => {
  it("selects a run matching all three predicates", () => {
    expect(selectRepairable([RUN], ARGS).map((r) => r.id)).toEqual(["run-1"])
  })

  it("skips a run that is not failed", () => {
    // A live run must never be reset out from under the tick.
    expect(selectRepairable([{ ...RUN, status: "active" }], ARGS)).toEqual([])
  })

  it("skips a run belonging to another sequence", () => {
    expect(selectRepairable([{ ...RUN, sequence_key: "new_lead_nurture" }], ARGS)).toEqual([])
  })

  it("skips a run that failed for a different reason", () => {
    // A genuine bad mailbox is not repaired by fixing the sending domain.
    expect(selectRepairable([{ ...RUN, last_error: "Invalid `to` field." }], ARGS)).toEqual([])
  })

  it("skips a run with no recorded error rather than assuming it matches", () => {
    expect(selectRepairable([{ ...RUN, last_error: null }], ARGS)).toEqual([])
  })

  it("refuses to run at all without a sequence key", () => {
    // An empty filter argument must not silently mean "everything".
    expect(() => selectRepairable([RUN], { sequenceKey: "", errorPattern: "x" })).toThrow()
  })

  it("refuses to run at all without an error pattern", () => {
    expect(() => selectRepairable([RUN], { sequenceKey: "sms_repermission", errorPattern: "" })).toThrow()
  })
})
