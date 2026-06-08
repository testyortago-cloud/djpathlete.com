import { describe, it, expect, vi } from "vitest"

// Prevent module-level side effects (Supabase client creation, Resend instantiation)
// when importing the service. Only the pure exported functions are under test here.
vi.mock("@/lib/db/programs", () => ({ getProgramById: vi.fn() }))
vi.mock("@/lib/db/program-week-pricing", () => ({ getPremiumWeeks: vi.fn() }))
vi.mock("@/lib/db/assignments", () => ({
  getAssignmentByUserAndProgram: vi.fn(),
  createAssignment: vi.fn(),
  getActiveAssignmentsForProgram: vi.fn(),
}))
vi.mock("@/lib/db/week-access", () => ({
  createWeekAccessBulk: vi.fn(),
  getWeekAccessByAssignment: vi.fn(),
  createWeekAccess: vi.fn(),
  updateWeekAccessByAssignmentAndWeek: vi.fn(),
}))
vi.mock("@/lib/db/users", () => ({ getUserById: vi.fn() }))
vi.mock("@/lib/email", () => ({ sendProgramReadyEmail: vi.fn() }))

import { resolveWeekResync } from "@/lib/services/assign-program"

describe("resolveWeekResync", () => {
  it("current paid/paid + premium → preserve (already purchased)", () => {
    expect(
      resolveWeekResync(
        { access_type: "paid", payment_status: "paid", price_cents: 4000 },
        4000,
      ),
    ).toBe("preserve")
  })

  it("current paid/not_required (granted) + premium → preserve (grant wins)", () => {
    expect(
      resolveWeekResync(
        { access_type: "paid", payment_status: "not_required", price_cents: 4000 },
        4000,
      ),
    ).toBe("preserve")
  })

  it("current paid/not_required (granted) + NOT premium → preserve (grant survives template change)", () => {
    expect(
      resolveWeekResync(
        { access_type: "paid", payment_status: "not_required", price_cents: 4000 },
        null,
      ),
    ).toBe("preserve")
  })

  it("current included/not_required + premium → {paid, pending, price}", () => {
    expect(
      resolveWeekResync(
        { access_type: "included", payment_status: "not_required", price_cents: null },
        5000,
      ),
    ).toEqual({ access_type: "paid", payment_status: "pending", price_cents: 5000 })
  })

  it("current paid/pending + premium (same price) → {paid, pending, price}", () => {
    expect(
      resolveWeekResync(
        { access_type: "paid", payment_status: "pending", price_cents: 3000 },
        3000,
      ),
    ).toEqual({ access_type: "paid", payment_status: "pending", price_cents: 3000 })
  })

  it("current paid/pending + NOT premium → {included, not_required, null}", () => {
    expect(
      resolveWeekResync(
        { access_type: "paid", payment_status: "pending", price_cents: 3000 },
        null,
      ),
    ).toEqual({ access_type: "included", payment_status: "not_required", price_cents: null })
  })

  it("current null + premium → {paid, pending, price}", () => {
    expect(resolveWeekResync(null, 2500)).toEqual({
      access_type: "paid",
      payment_status: "pending",
      price_cents: 2500,
    })
  })

  it("current null + NOT premium → {included, not_required, null}", () => {
    expect(resolveWeekResync(null, null)).toEqual({
      access_type: "included",
      payment_status: "not_required",
      price_cents: null,
    })
  })
})
