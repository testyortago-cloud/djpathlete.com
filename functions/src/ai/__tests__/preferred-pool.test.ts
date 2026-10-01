import { describe, it, expect } from "vitest"
import { withPreferredPool, buildPreferredPoolWarnings, buildPreferredPoolPlanSection } from "../shared-helpers.js"

/**
 * Replay of Darren's run on the fixed filters (2026-10-01): all 6 pool exercises reached the
 * selector, and it used none — the architect, never told about a PREFERRED pool, had planned a
 * shoulder day that no lunge/squat pool exercise fitted. The selector can only put a pool
 * exercise into a slot that matches it, so the architect has to plan those slots.
 */
describe("buildPreferredPoolPlanSection", () => {
  const pool = [
    { name: "Ab squats_Core", movement_pattern: "squat", primary_muscles: ["quadriceps", "core"] },
    { name: "Bench hip abductions_Hip", movement_pattern: "lunge", primary_muscles: ["glutes"] },
  ]

  it("lists each pool exercise with its pattern and muscles", () => {
    const s = buildPreferredPoolPlanSection(pool)
    expect(s).toContain("Ab squats_Core (squat; quadriceps, core)")
    expect(s).toContain("Bench hip abductions_Hip (lunge; glutes)")
  })

  it("asks for a slot each pool exercise fits, and leaves the rest to the usual plan", () => {
    const s = buildPreferredPoolPlanSection(pool)
    expect(s).toMatch(/plan a slot that each of these exercises fits/i)
    expect(s).toMatch(/remaining slots/i)
  })

  it("is empty with no pool", () => {
    expect(buildPreferredPoolPlanSection([])).toBe("")
  })
})

/**
 * 2026-10-01, Chris H: a Preferred pool of 6 exercises, every one needing kit or rated
 * "advanced", on a program with no client. The guessed difficulty and equipment filters
 * removed all six before the AI saw the library, the pool "rescue" could only re-inject
 * from what survived, and the coach got a day with none of them and no warning.
 */
describe("withPreferredPool", () => {
  it("lets the coach's pool through the guess-based filters alongside named exercises", () => {
    const unlocked = new Set(["named"])
    const merged = withPreferredPool(unlocked, new Set(["p1", "p2"]))
    expect([...merged].sort()).toEqual(["named", "p1", "p2"])
  })

  it("does not mutate the unlocked set the caller still reports from", () => {
    const unlocked = new Set(["named"])
    withPreferredPool(unlocked, new Set(["p1"]))
    expect([...unlocked]).toEqual(["named"])
  })

  it("is the unlocked set unchanged when there is no preferred pool", () => {
    const unlocked = new Set(["named"])
    expect([...withPreferredPool(unlocked, undefined)]).toEqual(["named"])
  })
})

describe("buildPreferredPoolWarnings", () => {
  const nameById = new Map([
    ["a", "Ab squats_Core"],
    ["b", "Bench hip abductions_Hip"],
    ["c", "Ballerina bulgarians_quadriceps"],
  ])
  const base = { poolIds: ["a", "b", "c"], nameById, scopeLabel: "Monday" }

  it("is silent when every pool exercise was offered and used", () => {
    expect(
      buildPreferredPoolWarnings({
        ...base,
        offeredIds: new Set(["a", "b", "c", "x"]),
        usedIds: new Set(["a", "b", "c", "x"]),
        excludedIds: new Set(),
      }),
    ).toEqual([])
  })

  it("names pool exercises the AI was never offered, and why", () => {
    const [w] = buildPreferredPoolWarnings({
      ...base,
      offeredIds: new Set(["a"]),
      usedIds: new Set(["a"]),
      excludedIds: new Set(["b"]),
    })
    expect(w).toContain("2 of your 3 Exercise Pool exercises were not offered to the AI for Monday")
    expect(w).toContain("Bench hip abductions_Hip (used in a nearby week, or blocked)")
    expect(w).toContain(
      "Ballerina bulgarians_quadriceps (excluded by an equipment setting, the client's injuries, or no longer in the library)",
    )
  })

  it("says so when the AI was offered the pool and used none of it", () => {
    const warnings = buildPreferredPoolWarnings({
      ...base,
      offeredIds: new Set(["a", "b", "c"]),
      usedIds: new Set(["zzz"]),
      excludedIds: new Set(),
    })
    expect(warnings).toEqual([
      "The AI used none of your 3 Exercise Pool exercises for Monday. Turn on Strict pool to use only those exercises.",
    ])
  })

  // Replay on the fixed code used 4 of 6; the two left out were offered and simply not chosen.
  it("names pool exercises that were offered but not used, when some were used", () => {
    const warnings = buildPreferredPoolWarnings({
      ...base,
      offeredIds: new Set(["a", "b", "c"]),
      usedIds: new Set(["a"]),
      excludedIds: new Set(),
    })
    expect(warnings).toEqual([
      "The AI used 1 of your 3 Exercise Pool exercises for Monday. Not used: Bench hip abductions_Hip; Ballerina bulgarians_quadriceps.",
    ])
  })

  it("does not claim 'used none' when none could be offered — the first warning already explains it", () => {
    const warnings = buildPreferredPoolWarnings({
      ...base,
      offeredIds: new Set(),
      usedIds: new Set(),
      excludedIds: new Set(),
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("3 of your 3")
  })
})
