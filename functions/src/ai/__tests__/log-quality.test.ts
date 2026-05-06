import { describe, it, expect, vi } from "vitest"

// computeRpeLogQuality is pure but lives in week-orchestrator.ts which imports
// the world. Mock the heavy modules so the import resolves cleanly.
vi.mock("../../lib/supabase.js", () => ({ getSupabase: () => ({}) }))
vi.mock("../anthropic.js", () => ({ callAgent: vi.fn(), MODEL_OPUS: "opus", MODEL_SONNET: "sonnet" }))
vi.mock("../usage-history.js", () => ({
  recordUsageFromFn: vi.fn(),
  getCoachRecentUsageFromFn: vi.fn(async () => new Map()),
  getClientRecentUsageFromFn: vi.fn(async () => new Map()),
}))
vi.mock("../coach-policy.js", () => ({
  getCoachPolicyFromFn: vi.fn(async () => null),
  formatCoachPolicyAsInstructions: () => "",
}))

import { computeRpeLogQuality } from "../week-orchestrator.js"

describe("computeRpeLogQuality", () => {
  it("returns 1.0 with sample 0 when no logs", () => {
    const r = computeRpeLogQuality([])
    expect(r.quality).toBe(1.0)
    expect(r.sample_size).toBe(0)
  })

  it("counts only logs with valid rpe (1-10)", () => {
    const r = computeRpeLogQuality([
      { rpe: 8 },
      { rpe: null },
      { rpe: undefined },
      { rpe: 0 },
      { rpe: 11 },
      { rpe: 7 },
    ])
    expect(r.sample_size).toBe(6)
    expect(r.quality).toBeCloseTo(2 / 6, 4)
  })

  it("returns 1.0 when all logs have valid rpe", () => {
    const r = computeRpeLogQuality([{ rpe: 7 }, { rpe: 8 }])
    expect(r.quality).toBe(1.0)
    expect(r.sample_size).toBe(2)
  })

  it("returns 0 when no logs have valid rpe", () => {
    const r = computeRpeLogQuality([{ rpe: null }, { rpe: undefined }, { rpe: 0 }])
    expect(r.quality).toBe(0)
    expect(r.sample_size).toBe(3)
  })
})
