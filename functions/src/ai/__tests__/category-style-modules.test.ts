import { describe, it, expect } from "vitest"
import { getCategoryStyleModule, KNOWN_CATEGORIES } from "../category-style-modules.js"

describe("getCategoryStyleModule", () => {
  it("returns rotational-specific guidance for rotational categories", () => {
    const mod = getCategoryStyleModule("Rotational")
    expect(mod).toMatch(/golf|baseball|tennis|hockey/i)
    expect(mod).toMatch(/medicine ball|cable column|rotational/i)
  })

  it("returns comeback/rehab guidance for comeback categories", () => {
    const mod = getCategoryStyleModule("Comeback")
    expect(mod).toMatch(/rehab|recovery|return.to.play|post.injury/i)
    expect(mod).toMatch(/band|controlled|low.load/i)
  })

  it("returns strength guidance for strength categories", () => {
    const mod = getCategoryStyleModule("Strength")
    expect(mod).toMatch(/barbell|deadlift|squat|rack/i)
  })

  it("returns mobility guidance for mobility categories", () => {
    const mod = getCategoryStyleModule("Mobility")
    expect(mod).toMatch(/mobility|warm.?up|range of motion/i)
  })

  it("returns youth guidance for youth-development categories", () => {
    const mod = getCategoryStyleModule("Youth")
    expect(mod).toMatch(/adolescent|teen|youth|age.appropriate/i)
  })

  it("falls back to a generic performance module for unknown categories", () => {
    const mod = getCategoryStyleModule("Mystery Category")
    expect(mod).toMatch(/general athletic performance/i)
  })

  it("matches case-insensitively and tolerates spaces/hyphens", () => {
    expect(getCategoryStyleModule("rotational training")).toBe(getCategoryStyleModule("Rotational"))
    expect(getCategoryStyleModule("come-back")).toBe(getCategoryStyleModule("Comeback"))
  })

  it("exposes KNOWN_CATEGORIES so callers can iterate", () => {
    expect(KNOWN_CATEGORIES).toEqual(
      expect.arrayContaining(["rotational", "comeback", "strength", "mobility", "youth", "recovery"]),
    )
  })
})
