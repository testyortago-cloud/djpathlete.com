import { describe, it, expect } from "vitest"

import {
  socialEngagementDelta,
  computeImpactScore,
} from "../social/outcome-scoring.js"

describe("socialEngagementDelta", () => {
  it("returns 0 when impressions is 0", () => {
    expect(
      socialEngagementDelta({ likes: 10, comments: 5, shares: 3, impressions: 0 }),
    ).toBe(0)
  })

  it("weights shares > comments > likes and normalizes per 1000 impressions", () => {
    // weighted = 10 + 2*5 + 3*3 = 29, per-1000 = 29/200 * 1000 = 145
    expect(
      socialEngagementDelta({ likes: 10, comments: 5, shares: 3, impressions: 200 }),
    ).toBe(145)
  })

  it("scales linearly with impressions held constant on raw engagement", () => {
    const a = socialEngagementDelta({ likes: 100, comments: 0, shares: 0, impressions: 1000 })
    const b = socialEngagementDelta({ likes: 200, comments: 0, shares: 0, impressions: 1000 })
    expect(b).toBe(a * 2)
  })
})

describe("computeImpactScore (social mirror)", () => {
  it("returns 0 for zero delta", () => {
    expect(
      computeImpactScore({
        delta: 0,
        predicted_direction: "increase",
        baseline_p95: 10,
        baseline_n_measured: 50,
      }),
    ).toBe(0)
  })

  it("warm-up: returns +/-50 when baseline n_measured < 5", () => {
    expect(
      computeImpactScore({
        delta: 5,
        predicted_direction: "increase",
        baseline_p95: 0,
        baseline_n_measured: 0,
      }),
    ).toBe(50)
    expect(
      computeImpactScore({
        delta: -5,
        predicted_direction: "increase",
        baseline_p95: 0,
        baseline_n_measured: 0,
      }),
    ).toBe(-50)
  })

  it("normalizes delta against p95 with stable baseline", () => {
    // |delta|/p95 = 1.0 -> 100, capped at 100
    expect(
      computeImpactScore({
        delta: 10,
        predicted_direction: "increase",
        baseline_p95: 10,
        baseline_n_measured: 20,
      }),
    ).toBe(100)
  })

  it("clamps to [-100, 100]", () => {
    expect(
      computeImpactScore({
        delta: 200,
        predicted_direction: "increase",
        baseline_p95: 1,
        baseline_n_measured: 20,
      }),
    ).toBe(100)
    expect(
      computeImpactScore({
        delta: -200,
        predicted_direction: "increase",
        baseline_p95: 1,
        baseline_n_measured: 20,
      }),
    ).toBe(-100)
  })
})
