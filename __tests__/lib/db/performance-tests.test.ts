import { describe, it, expect, vi, beforeEach } from "vitest"

const supabaseMock = { from: vi.fn() }
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => supabaseMock,
}))

import { computeIsPr, computePctChange } from "@/lib/db/performance-tests"

beforeEach(() => vi.clearAllMocks())

describe("performance-tests helpers", () => {
  describe("computeIsPr", () => {
    it("highest: 40 beats prior max 38 → PR", () => {
      expect(computeIsPr(40, "highest", [38, 35, 30])).toBe(true)
    })
    it("highest: 38 ties prior max 38 → NOT PR (strictly greater)", () => {
      expect(computeIsPr(38, "highest", [38, 35])).toBe(false)
    })
    it("lowest: 4.10 beats prior min 4.15 → PR", () => {
      expect(computeIsPr(4.1, "lowest", [4.15, 4.2, 4.3])).toBe(true)
    })
    it("first ever test → PR", () => {
      expect(computeIsPr(10, "highest", [])).toBe(true)
    })
  })

  describe("computePctChange", () => {
    it("returns ((curr - prev) / prev) * 100", () => {
      expect(computePctChange(110, 100)).toBeCloseTo(10)
      expect(computePctChange(90, 100)).toBeCloseTo(-10)
    })
    it("returns null when prev is null/0", () => {
      expect(computePctChange(50, null)).toBeNull()
      expect(computePctChange(50, 0)).toBeNull()
    })
  })
})
