import { describe, it, expect, vi } from "vitest"

// Prevent module-level side effects (Supabase client creation, Resend instantiation)
// when importing the service. Only the pure exported functions are under test here.
vi.mock("@/lib/db/assignments", () => ({ getAssignmentById: vi.fn() }))
vi.mock("@/lib/db/week-access", () => ({ getWeekAccess: vi.fn() }))

import { isAccessAllowed } from "@/lib/services/access-guard"

describe("isAccessAllowed", () => {
  it("blocks when entry payment is pending", () => {
    expect(isAccessAllowed({ payment_status: "pending" }, null)).toBe(false)
  })
  it("allows when entry is not_required / paid / subscription_active", () => {
    expect(isAccessAllowed({ payment_status: "not_required" }, null)).toBe(true)
    expect(isAccessAllowed({ payment_status: "paid" }, null)).toBe(true)
    expect(isAccessAllowed({ payment_status: "subscription_active" }, null)).toBe(true)
  })
  it("blocks a paid week that is still pending", () => {
    expect(
      isAccessAllowed({ payment_status: "paid" }, { access_type: "paid", payment_status: "pending" }),
    ).toBe(false)
  })
  it("allows an included week and a paid-but-paid week", () => {
    expect(isAccessAllowed({ payment_status: "paid" }, { access_type: "included", payment_status: "not_required" })).toBe(true)
    expect(isAccessAllowed({ payment_status: "paid" }, { access_type: "paid", payment_status: "paid" })).toBe(true)
  })
})
