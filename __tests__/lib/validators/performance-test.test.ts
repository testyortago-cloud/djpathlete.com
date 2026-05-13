import { describe, it, expect } from "vitest"
import {
  performanceTestFormSchema,
  TEST_TYPES,
  TEST_TYPE_LABELS,
  TEST_TYPE_DEFAULTS,
  reduceTrials,
} from "@/lib/validators/performance-test"

describe("performanceTestFormSchema", () => {
  const valid = {
    test_type: "drop_jump" as const,
    custom_name: null,
    result_value: 38.5,
    result_unit: "cm",
    trial_values: [37.0, 38.5, 38.2],
    best_method: "highest" as const,
    test_date: "2026-05-13",
    body_weight_kg: 78.0,
    notes: null,
    video_url: null,
  }

  it("accepts valid input", () => {
    expect(performanceTestFormSchema.safeParse(valid).success).toBe(true)
  })

  it("rejects test_type=custom without custom_name", () => {
    expect(
      performanceTestFormSchema.safeParse({ ...valid, test_type: "custom", custom_name: null })
        .success,
    ).toBe(false)
  })

  it("TEST_TYPE_DEFAULTS provides unit + best_method for every test_type", () => {
    TEST_TYPES.forEach((t) => {
      expect(TEST_TYPE_DEFAULTS[t]).toBeDefined()
      expect(TEST_TYPE_LABELS[t]).toBeTruthy()
    })
  })
})

describe("reduceTrials", () => {
  it("highest of [4.2, 4.15, 4.18] = 4.2", () => {
    expect(reduceTrials([4.2, 4.15, 4.18], "highest")).toBe(4.2)
  })
  it("lowest of [4.2, 4.15, 4.18] = 4.15", () => {
    expect(reduceTrials([4.2, 4.15, 4.18], "lowest")).toBe(4.15)
  })
  it("mean of [2, 4, 6] = 4", () => {
    expect(reduceTrials([2, 4, 6], "mean")).toBe(4)
  })
  it("median of [1, 2, 5] = 2", () => {
    expect(reduceTrials([1, 2, 5], "median")).toBe(2)
  })
  it("median of [1, 2, 3, 4] = 2.5", () => {
    expect(reduceTrials([1, 2, 3, 4], "median")).toBe(2.5)
  })
})
