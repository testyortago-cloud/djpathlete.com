import { describe, it, expect } from "vitest"
import { selectPacksNeedingReminder } from "@/lib/automation/pack-renewal-scanner"
import type { ClientPackage } from "@/types/database"

const now = new Date("2026-06-13T00:00:00Z")

function pkg(p: Partial<ClientPackage>): ClientPackage {
  return {
    id: "p",
    client_user_id: "c",
    product_id: null,
    session_type: "1-on-1",
    credits_total: 10,
    credits_used: 0,
    price_cents: 0,
    payment_method: "stripe",
    payment_status: "paid",
    stripe_session_id: null,
    stripe_payment_id: null,
    purchased_at: "2026-06-01T00:00:00Z",
    expires_at: null,
    status: "active",
    last_reminded_threshold: null,
    notes: null,
    created_by: null,
    created_at: "",
    updated_at: "",
    ...p,
  }
}

describe("selectPacksNeedingReminder", () => {
  it("selects empty, low, and expiring packs", () => {
    const res = selectPacksNeedingReminder(
      [
        pkg({ id: "empty", credits_used: 10 }),
        pkg({ id: "low", credits_used: 8 }),
        pkg({ id: "expiring", credits_used: 1, expires_at: "2026-06-17T00:00:00Z" }),
        pkg({ id: "healthy", credits_used: 1 }),
      ],
      now,
      2,
      7,
    )
    const map = Object.fromEntries(res.map((r) => [r.pkg.id, r.threshold]))
    expect(map).toEqual({ empty: "empty", low: "low", expiring: "expiring" })
  })

  it("skips packs already nudged at the same or higher severity", () => {
    const res = selectPacksNeedingReminder([pkg({ id: "x", credits_used: 8, last_reminded_threshold: "low" })], now, 2, 7)
    expect(res).toHaveLength(0)
  })

  it("re-selects when severity escalates from low to empty", () => {
    const res = selectPacksNeedingReminder([pkg({ id: "x", credits_used: 10, last_reminded_threshold: "low" })], now, 2, 7)
    expect(res).toHaveLength(1)
    expect(res[0].threshold).toBe("empty")
  })

  it("ignores healthy packs", () => {
    expect(selectPacksNeedingReminder([pkg({ credits_used: 1 })], now, 2, 7)).toHaveLength(0)
  })
})
