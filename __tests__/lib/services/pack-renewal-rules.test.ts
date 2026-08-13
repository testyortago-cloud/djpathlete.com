import { describe, it, expect } from "vitest"
import { shouldAttemptRenewal, buildRenewalPack } from "@/lib/services/pack-renewal-rules"
import type { ClientPackage } from "@/types/database"

const pack = (over: Partial<ClientPackage> = {}): ClientPackage =>
  ({
    id: "pack-1", client_user_id: "u1", product_id: "prod-1", assignment_id: null,
    session_type: "training", credits_total: 10, credits_used: 10, price_cents: 75000,
    payment_method: "stripe", payment_status: "paid", stripe_session_id: null,
    stripe_payment_id: null, purchased_at: "2026-07-01T00:00:00Z", expires_at: null,
    status: "depleted", last_reminded_threshold: null, notes: null, bill_to_email: null,
    bill_to_emailed_at: null, created_by: null, created_at: "", updated_at: "",
    auto_renew: true, renewed_from_package_id: null, renewal_attempted_at: null,
    ...over,
  }) as ClientPackage

describe("shouldAttemptRenewal", () => {
  it("attempts when armed, depleted, priced and the flag is on", () => {
    expect(shouldAttemptRenewal(pack(), true)).toEqual({ attempt: true })
  })

  it("refuses when the flag is off, even for a perfectly eligible pack", () => {
    expect(shouldAttemptRenewal(pack(), false)).toEqual({ attempt: false, reason: "disabled" })
  })

  it("refuses an unarmed pack", () => {
    expect(shouldAttemptRenewal(pack({ auto_renew: false }), true)).toEqual({
      attempt: false, reason: "not_armed",
    })
  })

  it("refuses while credits remain", () => {
    expect(shouldAttemptRenewal(pack({ credits_used: 9 }), true)).toEqual({
      attempt: false, reason: "not_depleted",
    })
  })

  it("refuses a zero-price pack so a comp pack never bills anyone", () => {
    expect(shouldAttemptRenewal(pack({ price_cents: 0 }), true)).toEqual({
      attempt: false, reason: "zero_price",
    })
  })

  it("refuses an expired pack — expiry is a reason to stop, not to rebuy", () => {
    // credits_used: 0 is load-bearing. With the base fixture's 10/10 the pack is
    // also depleted, so this assertion would pass under either guard order and
    // prove nothing. A pack that is expired WITH credits left is the only case
    // where "expired" and "not_depleted" disagree.
    expect(shouldAttemptRenewal(pack({ status: "expired", credits_used: 0 }), true)).toEqual({
      attempt: false, reason: "expired",
    })
  })
})

describe("buildRenewalPack", () => {
  it("clones the commercial terms and carries auto_renew forward", () => {
    const next = buildRenewalPack(pack(), { paid: true, now: new Date("2026-08-14T00:00:00Z") })
    expect(next.credits_total).toBe(10)
    expect(next.credits_used).toBe(0)
    expect(next.price_cents).toBe(75000)
    expect(next.session_type).toBe("training")
    expect(next.status).toBe("active")
    expect(next.payment_status).toBe("paid")
    expect(next.auto_renew).toBe(true)
    expect(next.renewed_from_package_id).toBe("pack-1")
  })

  it("marks the clone pending when the charge did not succeed", () => {
    const next = buildRenewalPack(pack(), { paid: false, now: new Date("2026-08-14T00:00:00Z") })
    expect(next.payment_status).toBe("pending")
    expect(next.status).toBe("active")
  })

  it("does not copy the source's stripe ids onto the clone", () => {
    const next = buildRenewalPack(
      pack({ stripe_session_id: "cs_old", stripe_payment_id: "pi_old" }),
      { paid: true, now: new Date("2026-08-14T00:00:00Z") },
    )
    expect(next.stripe_session_id).toBeNull()
    expect(next.stripe_payment_id).toBeNull()
  })
})
