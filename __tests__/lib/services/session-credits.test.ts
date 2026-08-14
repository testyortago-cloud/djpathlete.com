import { describe, it, expect } from "vitest"
import {
  remainingCredits,
  isExpired,
  packStatusAfter,
  reminderThreshold,
  expiresAtFrom,
  buildPackageInsert,
} from "@/lib/services/session-credits"

describe("remainingCredits", () => {
  it("subtracts used from total", () => {
    expect(remainingCredits({ credits_total: 10, credits_used: 3 })).toBe(7)
  })
  it("never goes negative", () => {
    expect(remainingCredits({ credits_total: 5, credits_used: 9 })).toBe(0)
  })
})

describe("isExpired", () => {
  const now = new Date("2026-06-13T12:00:00Z")
  it("false when expires_at null", () => {
    expect(isExpired({ expires_at: null }, now)).toBe(false)
  })
  it("true when past", () => {
    expect(isExpired({ expires_at: "2026-06-01T00:00:00Z" }, now)).toBe(true)
  })
  it("false when future", () => {
    expect(isExpired({ expires_at: "2026-12-01T00:00:00Z" }, now)).toBe(false)
  })
})

describe("packStatusAfter", () => {
  const now = new Date("2026-06-13T12:00:00Z")
  it("depleted at zero remaining", () => {
    expect(packStatusAfter({ credits_total: 3, credits_used: 3, expires_at: null }, now)).toBe("depleted")
  })
  it("active with credits left", () => {
    expect(packStatusAfter({ credits_total: 3, credits_used: 1, expires_at: null }, now)).toBe("active")
  })
  it("expired beats depleted", () => {
    expect(packStatusAfter({ credits_total: 3, credits_used: 0, expires_at: "2000-01-01T00:00:00Z" }, now)).toBe("expired")
  })
})

describe("reminderThreshold", () => {
  const now = new Date("2026-06-13T00:00:00Z")
  it("empty at 0 remaining", () => {
    expect(reminderThreshold({ credits_total: 10, credits_used: 10, expires_at: null }, now, 2, 7)).toBe("empty")
  })
  it("low at <= lowAt remaining", () => {
    expect(reminderThreshold({ credits_total: 10, credits_used: 8, expires_at: null }, now, 2, 7)).toBe("low")
  })
  it("expiring within window", () => {
    expect(reminderThreshold({ credits_total: 10, credits_used: 1, expires_at: "2026-06-17T00:00:00Z" }, now, 2, 7)).toBe("expiring")
  })
  it("null when healthy", () => {
    expect(reminderThreshold({ credits_total: 10, credits_used: 1, expires_at: null }, now, 2, 7)).toBeNull()
  })
  it("null when already expired", () => {
    expect(reminderThreshold({ credits_total: 10, credits_used: 1, expires_at: "2026-06-01T00:00:00Z" }, now, 2, 7)).toBeNull()
  })
})

describe("expiresAtFrom", () => {
  it("returns null when no validity window", () => {
    expect(expiresAtFrom("2026-06-13T00:00:00Z", null)).toBeNull()
  })
  it("adds the validity window in days", () => {
    expect(expiresAtFrom("2026-06-13T00:00:00.000Z", 90)).toBe("2026-09-11T00:00:00.000Z")
  })
})

describe("buildPackageInsert payment_status", () => {
  const base = {
    clientUserId: "c1",
    productId: null,
    sessionType: "1-on-1",
    credits: 10,
    priceCents: 50000,
    validityDays: null,
    createdBy: "coach-1",
    now: new Date("2026-07-17T00:00:00Z"),
  }
  it("cash defaults to paid", () => {
    expect(buildPackageInsert({ ...base, paymentMethod: "cash" }).payment_status).toBe("paid")
  })
  it("cash with owed stays pending (usable but debt tracked)", () => {
    const row = buildPackageInsert({ ...base, paymentMethod: "cash", owed: true })
    expect(row.payment_status).toBe("pending")
    expect(row.status).toBe("active") // credits usable immediately
  })
  it("comp is not_required even if owed is passed", () => {
    expect(buildPackageInsert({ ...base, paymentMethod: "comp", owed: true }).payment_status).toBe("not_required")
  })
  it("stripe is pending until the webhook promotes it", () => {
    expect(buildPackageInsert({ ...base, paymentMethod: "stripe" }).payment_status).toBe("pending")
  })
})

describe("buildPackageInsert auto_renew (I3)", () => {
  const base = {
    clientUserId: "c1",
    productId: null,
    sessionType: "1-on-1",
    credits: 10,
    priceCents: 50000,
    validityDays: null,
    createdBy: "coach-1",
    now: new Date("2026-07-17T00:00:00Z"),
    paymentMethod: "stripe" as const,
  }
  it("defaults to false when omitted", () => {
    expect(buildPackageInsert(base).auto_renew).toBe(false)
  })
  it("records true from the checkout request — not deferred to the webhook", () => {
    expect(buildPackageInsert({ ...base, autoRenew: true }).auto_renew).toBe(true)
  })
})
