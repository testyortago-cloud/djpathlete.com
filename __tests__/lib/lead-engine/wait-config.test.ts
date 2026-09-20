// @vitest-environment node
import { describe, it, expect } from "vitest"
import { parseWaitConfig, WAIT_ANCHOR_MAX_DAYS_BEFORE } from "@/lib/lead-engine/step-config"

/**
 * G11. A `wait` step is ordinarily relative to the moment the run reached it
 * (`wait_minutes`). An ANCHORED wait is relative to a fixed moment recorded on
 * the run instead — `sequence_runs.anchor_at`, the camp's start date — so
 * "three days before the camp" means three days before the camp for everybody,
 * whether they signed up in March or the night before.
 *
 * Same pure-function rule the rest of this module keeps: `sequence-tick.ts`
 * imports it and may import no IO, and the step editor has to reject exactly
 * what the tick rejects.
 *
 * The `error` strings are read by a COACH on the contact detail page, via
 * `sequence_runs.last_error` — held to the same plain-language bar as
 * `parseTagConfig`'s.
 */
describe("parseWaitConfig", () => {
  it("returns null for an ordinary wait, so nothing changes for the sequences that have one", () => {
    // Not `{ok:false}`: an absent `wait_until` is not a fault, it is the
    // overwhelmingly common case. Only a MALFORMED one is a fault.
    expect(parseWaitConfig({})).toBeNull()
    expect(parseWaitConfig({ some_other_key: 1 })).toBeNull()
  })

  it("accepts a whole number of days before the anchor", () => {
    expect(parseWaitConfig({ wait_until: { days_before_anchor: 14 } })).toEqual({
      ok: true,
      value: { daysBeforeAnchor: 14 },
    })
  })

  it("accepts zero — the moment of the event itself", () => {
    expect(parseWaitConfig({ wait_until: { days_before_anchor: 0 } })).toEqual({
      ok: true,
      value: { daysBeforeAnchor: 0 },
    })
  })

  it("refuses a negative number, which would mean AFTER the event", () => {
    // A deadline chaser that fires after the deadline is the one thing this
    // whole row exists to stop. If "after the camp" is ever wanted it needs
    // its own key, so that it is a decision rather than a sign error.
    const result = parseWaitConfig({ wait_until: { days_before_anchor: -3 } })
    expect(result).toEqual({
      ok: false,
      error: "This sequence's wait step counts days before the event, so it cannot be a negative number.",
    })
  })

  it("refuses a fraction, because a reminder lands on a day and not at 14.5 days", () => {
    expect(parseWaitConfig({ wait_until: { days_before_anchor: 2.5 } })?.ok).toBe(false)
  })

  it("refuses a number of days nobody meant, rather than parking a run for years", () => {
    // An anchored wait sets next_run_at directly. A typo of 3650 would hide a
    // run until 2036 with no error anywhere — a silent park is worse than a
    // visible refusal.
    const result = parseWaitConfig({ wait_until: { days_before_anchor: WAIT_ANCHOR_MAX_DAYS_BEFORE + 1 } })
    expect(result).toEqual({
      ok: false,
      error: `This sequence's wait step says more than ${WAIT_ANCHOR_MAX_DAYS_BEFORE} days before the event, which is further ahead than we can plan for.`,
    })
    // And the control: the boundary itself is allowed, so the message names a
    // limit that is really the limit.
    expect(parseWaitConfig({ wait_until: { days_before_anchor: WAIT_ANCHOR_MAX_DAYS_BEFORE } })).toEqual({
      ok: true,
      value: { daysBeforeAnchor: WAIT_ANCHOR_MAX_DAYS_BEFORE },
    })
  })

  it("refuses a wait_until that is present but says nothing usable", () => {
    // Present-but-malformed is a fault, unlike absent. Each of these is a
    // shape a hand-edited row or an older client could really produce.
    for (const config of [
      { wait_until: {} },
      { wait_until: { days_before_anchor: "14" } },
      { wait_until: { days_before_anchor: null } },
      { wait_until: null },
      { wait_until: "14" },
      { wait_until: [] },
    ]) {
      const result = parseWaitConfig(config as Record<string, unknown>)
      expect(result, JSON.stringify(config)).not.toBeNull()
      expect(result?.ok, JSON.stringify(config)).toBe(false)
    }
  })

  it("refuses NaN and Infinity, which are numbers but not days", () => {
    // `typeof NaN === "number"` and `Number.isInteger(Infinity) === false`,
    // so these die on the integer check — pinned because a future rewrite to
    // `typeof === "number"` alone would let both through and park a run on an
    // Invalid Date.
    expect(parseWaitConfig({ wait_until: { days_before_anchor: NaN } })?.ok).toBe(false)
    expect(parseWaitConfig({ wait_until: { days_before_anchor: Infinity } })?.ok).toBe(false)
  })
})
