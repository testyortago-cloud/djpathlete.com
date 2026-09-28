import { describe, it, expect } from "vitest"
import { getCategoryStyleModule, getStyleModuleForPost, KNOWN_CATEGORIES } from "../category-style-modules.js"

describe("getCategoryStyleModule", () => {
  it("returns rotational-specific guidance for rotational categories", () => {
    const mod = getCategoryStyleModule("Rotational")
    expect(mod).toContain("CATEGORY MODULE — Rotational training")
    expect(mod).toMatch(/golf|baseball|tennis|hockey/i)
    expect(mod).toMatch(/medicine ball|cable column|rotational/i)
  })

  it("returns comeback/rehab guidance for comeback categories", () => {
    const mod = getCategoryStyleModule("Comeback")
    expect(mod).toContain("CATEGORY MODULE — Comeback / return-to-play / post-injury")
    expect(mod).toMatch(/rehab|recovery|return.to.play|post.injury/i)
    expect(mod).toMatch(/band|controlled|low.load/i)
  })

  it("returns strength guidance for strength categories", () => {
    const mod = getCategoryStyleModule("Strength")
    expect(mod).toContain("CATEGORY MODULE — Strength training")
    expect(mod).toMatch(/barbell|deadlift|squat|rack/i)
  })

  it("returns mobility guidance for mobility categories", () => {
    const mod = getCategoryStyleModule("Mobility")
    expect(mod).toContain("CATEGORY MODULE — Mobility and warm-up")
    expect(mod).toMatch(/mobility|warm.?up|range of motion/i)
  })

  it("returns youth guidance for youth-development categories", () => {
    const mod = getCategoryStyleModule("Youth")
    expect(mod).toContain("CATEGORY MODULE — Youth development")
    expect(mod).toMatch(/adolescent|teen|youth|age.appropriate/i)
  })

  it("returns recovery-specific guidance for recovery categories", () => {
    const mod = getCategoryStyleModule("Recovery")
    expect(mod).toContain("CATEGORY MODULE — Recovery and sleep")
    expect(mod).toMatch(/percussion gun|foam roller|ice bath|sauna|compression boots/i)
  })

  it("falls back to a generic performance module for unknown categories", () => {
    const mod = getCategoryStyleModule("Mystery Category")
    expect(mod).toMatch(/general athletic performance/i)
  })

  it("matches case-insensitively and tolerates spaces/hyphens", () => {
    expect(getCategoryStyleModule("rotational training")).toBe(getCategoryStyleModule("Rotational"))
    expect(getCategoryStyleModule("come-back")).toBe(getCategoryStyleModule("Comeback"))
  })

  it("getStyleModuleForPost: a rehab title overrides the Recovery category", () => {
    const comeback = getCategoryStyleModule("Comeback")
    expect(getStyleModuleForPost({ category: "Recovery", title: "Sports Rehab: What Actually Gets You Back" })).toBe(
      comeback,
    )
    expect(getStyleModuleForPost({ category: "Performance", title: "Returning to sport after an ACL tear" })).toBe(
      comeback,
    )
  })

  it("getStyleModuleForPost: tags alone are enough", () => {
    expect(
      getStyleModuleForPost({ category: "Recovery", title: "What Actually Gets You Back", tags: ["return to sport"] }),
    ).toBe(getCategoryStyleModule("Comeback"))
  })

  it("getStyleModuleForPost: leaves non-rehab posts on their category", () => {
    expect(getStyleModuleForPost({ category: "Recovery", title: "Why Sleep Is Your Best Recovery Tool" })).toBe(
      getCategoryStyleModule("Recovery"),
    )
    // Word-bounded: "constraint" is not "strain", "Oracle" is not "ACL".
    expect(
      getStyleModuleForPost({ category: "Performance", title: "Constraint-led drills from an Oracle coach" }),
    ).toBe(getCategoryStyleModule("Performance"))
  })

  it("getStyleModuleForPost: Youth keeps its own module even for a rehab topic", () => {
    expect(getStyleModuleForPost({ category: "Youth Development", title: "Rehab for young athletes" })).toBe(
      getCategoryStyleModule("Youth"),
    )
  })

  it("exposes KNOWN_CATEGORIES so callers can iterate", () => {
    expect(KNOWN_CATEGORIES).toEqual(
      expect.arrayContaining(["rotational", "comeback", "strength", "mobility", "youth", "recovery"]),
    )
  })
})
