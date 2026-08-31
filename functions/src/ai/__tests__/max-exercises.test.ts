import { describe, it, expect } from "vitest"
import { getMaxExercises } from "../exercise-filter.js"

/**
 * The candidate library must leave the selector — and the post-hoc deduper —
 * real alternatives per slot. Sizing it off the LIBRARY alone (15%, floor 80)
 * handed a 72-slot week only 80 candidates, so once a collision had to be
 * repaired there was nothing left that matched the slot's movement pattern and
 * the deduper substituted across patterns (chest press -> split squat jumps).
 * Measured 2026-08-31 on a 6-day x 12-slot week: 27 of 72 slots swapped.
 */
describe("getMaxExercises", () => {
  it("keeps the old floor for small weeks, where slots were never the binding constraint", () => {
    // 3 days x 6 slots against a 900-exercise library: 15% = 135.
    expect(getMaxExercises(900, 18)).toBe(135)
  })

  it("gives a big week materially more candidates than it has slots", () => {
    // The failure shape: 72 slots, 408 candidates after the equipment filter.
    // 15% of 408 = 61, so the old floor of 80 left 8 spares for 72 slots.
    const max = getMaxExercises(408, 72)
    expect(max).toBeGreaterThanOrEqual(72 * 2)
  })

  it("never returns fewer than the old floor, unless the library itself is smaller", () => {
    expect(getMaxExercises(100, 1)).toBeGreaterThanOrEqual(80)
    // A 10-exercise library cannot yield 80. The library bound wins over the
    // floor — asking for headroom that does not exist just truncates anyway.
    expect(getMaxExercises(10, 0)).toBe(10)
  })

  it("never asks for more exercises than the library holds", () => {
    // Asking for 200 out of a 90-exercise library just truncates; the cap must
    // not claim headroom that does not exist.
    expect(getMaxExercises(90, 72)).toBeLessThanOrEqual(90)
  })

  it("stays bounded so a huge week cannot blow up the prompt", () => {
    expect(getMaxExercises(5000, 500)).toBeLessThanOrEqual(300)
  })

  it("is monotonic in slot count — more slots never means fewer candidates", () => {
    let prev = 0
    for (const slots of [0, 10, 25, 50, 72, 120]) {
      const v = getMaxExercises(2000, slots)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })
})
