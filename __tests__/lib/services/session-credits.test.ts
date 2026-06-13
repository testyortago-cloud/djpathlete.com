import { describe, it, expect } from "vitest"
import {
  remainingCredits,
  isExpired,
  packStatusAfter,
  reminderThreshold,
  expiresAtFrom,
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
