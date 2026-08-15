import { describe, it, expect, vi } from "vitest"

// Prevent module-level side effects (Supabase client creation, Resend instantiation)
// when importing the service. Only the pure exported functions are under test here.
vi.mock("@/lib/db/programs", () => ({ getProgramById: vi.fn() }))
vi.mock("@/lib/db/program-week-pricing", () => ({ getPremiumWeeks: vi.fn() }))
vi.mock("@/lib/db/assignments", () => ({
  getAssignmentByUserAndProgram: vi.fn(),
  createAssignment: vi.fn(),
}))
vi.mock("@/lib/db/week-access", () => ({ createWeekAccessBulk: vi.fn() }))
vi.mock("@/lib/db/users", () => ({ getUserById: vi.fn() }))
vi.mock("@/lib/email", () => ({ sendProgramReadyEmail: vi.fn() }))

import { computeAssignmentPaymentStatus, buildWeekAccessRows } from "@/lib/services/assign-program"

describe("computeAssignmentPaymentStatus", () => {
  it("free entry is not_required", () => {
    expect(computeAssignmentPaymentStatus("free", false)).toBe("not_required")
  })
  it("complimentary is not_required even when paid", () => {
    expect(computeAssignmentPaymentStatus("one_time", true)).toBe("not_required")
    expect(computeAssignmentPaymentStatus("subscription", true)).toBe("not_required")
  })
  it("one_time entry is pending", () => {
    expect(computeAssignmentPaymentStatus("one_time", false)).toBe("pending")
  })
  it("subscription entry is pending", () => {
    expect(computeAssignmentPaymentStatus("subscription", false)).toBe("pending")
  })

  it("prepaid is paid, so a buyer is not locked out of what they just bought", () => {
    // MUTANT KILLED: ignoring `prepaid`. A paid program seeds "pending", and
    // `isAccessAllowed` refuses every workout route while it is pending — so an
    // anonymous funnel purchase would charge the card and then deny access to
    // the thing bought. Set ONLY by a caller holding a settled payment.
    expect(computeAssignmentPaymentStatus("one_time", false, true)).toBe("paid")
    expect(computeAssignmentPaymentStatus("subscription", false, true)).toBe("paid")
  })

  it("keeps a complimentary or free assignment not_required even when prepaid", () => {
    // A gift stays a gift. Promoting it to "paid" would rewrite the coach's
    // decision to give it away in the record.
    expect(computeAssignmentPaymentStatus("free", false, true)).toBe("not_required")
    expect(computeAssignmentPaymentStatus("one_time", true, true)).toBe("not_required")
  })

  it("still defaults to pending when prepaid is not passed at all", () => {
    // Every pre-existing caller omits the argument and every one of them means
    // "awaiting payment". A default of true would silently mark every
    // admin-assigned paid program as already settled.
    expect(computeAssignmentPaymentStatus("one_time", false)).toBe("pending")
  })
})

describe("buildWeekAccessRows", () => {
  it("marks premium weeks paid/pending and the rest included/not_required", () => {
    const rows = buildWeekAccessRows("asg-1", 6, [{ week_number: 5, price_cents: 4000 }, { week_number: 6, price_cents: 4000 }])
    expect(rows).toHaveLength(6)
    expect(rows[0]).toEqual({
      assignment_id: "asg-1",
      week_number: 1,
      access_type: "included",
      price_cents: null,
      payment_status: "not_required",
      stripe_session_id: null,
      stripe_payment_id: null,
    })
    expect(rows[4]).toEqual({
      assignment_id: "asg-1",
      week_number: 5,
      access_type: "paid",
      price_cents: 4000,
      payment_status: "pending",
      stripe_session_id: null,
      stripe_payment_id: null,
    })
  })
  it("free entry plus premium weeks still locks the premium weeks", () => {
    const rows = buildWeekAccessRows("asg-2", 3, [{ week_number: 3, price_cents: 1500 }])
    expect(rows[2].access_type).toBe("paid")
    expect(rows[2].payment_status).toBe("pending")
  })
})
