import { describe, it, expect } from "vitest"
import { planExclusions, remapUncoveredSlotPatterns } from "../shared-helpers.js"

function ex(id: string, movement_pattern: string) {
  return { id, movement_pattern }
}

const CROSS_DAY = ["cross-day-1"]
const BANNED = ["instruction-banned-1"]

describe("planExclusions", () => {
  it("folds all three sources into one exclude set", () => {
    const plan = planExclusions({
      candidates: [ex("a", "push")],
      crossDayExcludeIds: CROSS_DAY,
      instructionBannedIds: BANNED,
      blockedIds: ["blocked-1"],
      poolActive: false,
    })
    expect(plan.excludeIds).toEqual(new Set(["cross-day-1", "instruction-banned-1", "blocked-1"]))
  })

  it("keeps blocks in the set when a strict pool is active", () => {
    // Cross-day variety exclusion IS relaxed for a strict pool (upstream, by
    // resolveCrossDayExcludeIds returning empty). Blocks must NOT be — a block
    // is an explicit standing instruction and outranks the pool.
    const plan = planExclusions({
      candidates: [ex("blocked-1", "push"), ex("keep", "push")],
      crossDayExcludeIds: [],
      instructionBannedIds: [],
      blockedIds: ["blocked-1"],
      poolActive: true,
    })
    expect(plan.excludeIds.has("blocked-1")).toBe(true)
    expect(plan.candidates.map((c) => c.id)).toEqual(["keep"])
  })

  it("drops excluded exercises from the surviving candidates", () => {
    const plan = planExclusions({
      candidates: [ex("a", "push"), ex("blocked-1", "carry"), ex("c", "pull")],
      crossDayExcludeIds: [],
      instructionBannedIds: [],
      blockedIds: ["blocked-1"],
      poolActive: false,
    })
    expect(plan.candidates.map((c) => c.id)).toEqual(["a", "c"])
    // Presence control: an empty result would satisfy the assertion above on
    // its own, so pin that the survivors really did survive.
    expect(plan.candidates.length).toBe(2)
  })

  it("reports a strict pool emptied BY THE BLOCKS as exhausted", () => {
    // This is the ordering bug the extraction exists to prevent: the pool has
    // two exercises and looks healthy until the blocklist is applied.
    const plan = planExclusions({
      candidates: [ex("pool-1", "push"), ex("pool-2", "push")],
      crossDayExcludeIds: [],
      instructionBannedIds: [],
      blockedIds: ["pool-1", "pool-2"],
      poolActive: true,
    })
    expect(plan.poolExhausted).toBe(true)
  })

  it("does not report exhaustion when the pool still has candidates", () => {
    const plan = planExclusions({
      candidates: [ex("pool-1", "push"), ex("pool-2", "push")],
      crossDayExcludeIds: [],
      instructionBannedIds: [],
      blockedIds: ["pool-1"],
      poolActive: true,
    })
    expect(plan.poolExhausted).toBe(false)
  })

  it("never reports exhaustion when no pool is active", () => {
    // An empty candidate set without a pool is the normal-library case, which
    // has its own downstream fallbacks — it must not raise the pool error.
    const plan = planExclusions({
      candidates: [ex("a", "push")],
      crossDayExcludeIds: [],
      instructionBannedIds: [],
      blockedIds: ["a"],
      poolActive: false,
    })
    expect(plan.candidates).toEqual([])
    expect(plan.poolExhausted).toBe(false)
  })

  it("preserves the full exercise shape so the re-route can read movement_pattern", () => {
    // The generic exists for this: an { id }-only return would hand
    // remapUncoveredSlotPatterns objects with no pattern, and the re-route
    // would silently find nothing to route onto.
    const plan = planExclusions({
      candidates: [ex("carry-1", "carry"), ex("push-1", "push")],
      crossDayExcludeIds: [],
      instructionBannedIds: [],
      blockedIds: ["carry-1"],
      poolActive: false,
    })
    expect(plan.candidates[0].movement_pattern).toBe("push")
  })
})

describe("the re-route reads the post-exclusion candidates", () => {
  it("re-routes a slot whose pattern the blocks emptied", () => {
    // Suitcase carry is the only real carry in the library. Block it and a day
    // that asks for a carry has nothing — the re-route must move that slot onto
    // a pattern that does have candidates, rather than dead-ending the selector.
    const weeks = [
      {
        week_number: 1,
        days: [
          {
            day_of_week: 1,
            slots: [{ slot_id: "s1", movement_pattern: "carry", target_muscles: ["core"], role: "accessory" }],
          },
        ],
      },
    ] as unknown as Parameters<typeof remapUncoveredSlotPatterns>[0]

    const plan = planExclusions({
      candidates: [ex("carry-1", "carry"), ex("push-1", "push"), ex("push-2", "push")],
      crossDayExcludeIds: [],
      instructionBannedIds: [],
      blockedIds: ["carry-1"],
      poolActive: false,
    })

    const remaps = remapUncoveredSlotPatterns(weeks, plan.candidates)

    expect(remaps.length).toBe(1)
    expect(remaps[0].from).toBe("carry")
    expect(remaps[0].to).not.toBe("carry")
  })

  it("finds nothing to re-route when the pre-exclusion library is used instead", () => {
    // The control that proves the test above is really about ORDER. Handing the
    // re-route the library BEFORE exclusions makes the carry slot look covered,
    // which is exactly the bug: it fires zero remaps and the selector then has
    // no carry to pick.
    const weeks = [
      {
        week_number: 1,
        days: [
          {
            day_of_week: 1,
            slots: [{ slot_id: "s1", movement_pattern: "carry", target_muscles: ["core"], role: "accessory" }],
          },
        ],
      },
    ] as unknown as Parameters<typeof remapUncoveredSlotPatterns>[0]

    const preExclusion = [ex("carry-1", "carry"), ex("push-1", "push"), ex("push-2", "push")]

    expect(remapUncoveredSlotPatterns(weeks, preExclusion).length).toBe(0)
  })
})
