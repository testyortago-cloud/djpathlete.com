import { describe, it, expect } from "vitest"
import { computeImpactScore } from "@/lib/agents/outcome-scoring"

describe("computeImpactScore", () => {
  it("returns +50 during warm-up when delta is positive in predicted direction", () => {
    expect(
      computeImpactScore({
        delta: 10,
        predicted_direction: "increase",
        baseline_p95: 100,
        baseline_n_measured: 3, // < 5 → warm-up
      }),
    ).toBe(50)
  })

  it("returns -50 during warm-up when delta moves opposite to predicted", () => {
    expect(
      computeImpactScore({
        delta: -5,
        predicted_direction: "increase",
        baseline_p95: 100,
        baseline_n_measured: 2,
      }),
    ).toBe(-50)
  })

  it("returns 0 during warm-up when delta is exactly zero", () => {
    expect(
      computeImpactScore({
        delta: 0,
        predicted_direction: "increase",
        baseline_p95: 100,
        baseline_n_measured: 1,
      }),
    ).toBe(0)
  })

  it("normalizes delta against baseline P95 when n >= 5", () => {
    expect(
      computeImpactScore({
        delta: 50,
        predicted_direction: "increase",
        baseline_p95: 100,
        baseline_n_measured: 8,
      }),
    ).toBe(50)
  })

  it("flips sign when delta opposes predicted direction", () => {
    expect(
      computeImpactScore({
        delta: 30,
        predicted_direction: "decrease",
        baseline_p95: 100,
        baseline_n_measured: 8,
      }),
    ).toBe(-30)
  })

  it("clamps to ±100", () => {
    expect(
      computeImpactScore({
        delta: 200,
        predicted_direction: "increase",
        baseline_p95: 100,
        baseline_n_measured: 8,
      }),
    ).toBe(100)
  })

  it("returns 0 when baseline P95 is 0 (degenerate)", () => {
    expect(
      computeImpactScore({
        delta: 5,
        predicted_direction: "increase",
        baseline_p95: 0,
        baseline_n_measured: 8,
      }),
    ).toBe(0)
  })
})
