import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ClientPackage } from "@/types/database"

// Separate test file from pack-renewals.test.ts on purpose: that file's
// vi.mock("@/lib/db/client-packages", ...) factory intentionally does not
// export listDepletedAutoRenewPackages (it must stay unchanged so the
// pre-existing reminder-email suite keeps testing exactly what it tested
// before). This file exercises the auto-renew sweep loop, which that mock
// silently no-ops for via the route's own try/catch.
const isCronSkippedMock = vi.fn()
const listActivePackagesMock = vi.fn()
const updateClientPackageMock = vi.fn()
const listDepletedAutoRenewPackagesMock = vi.fn()
const getUserByIdMock = vi.fn()
const getUsersMock = vi.fn()
const createNotificationMock = vi.fn()
const sendPackRenewalEmailMock = vi.fn()
const attemptPackRenewalMock = vi.fn()
const packAutoRenewEnabledMock = vi.fn()
const packAutoRenewMaxAgeDaysMock = vi.fn()
const countStalePendingRenewalAttemptsMock = vi.fn()
const countRenewalsAwaitingPaymentMock = vi.fn()

vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped: (...a: unknown[]) => isCronSkippedMock(...a) }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => ({}) }))
vi.mock("@/lib/db/client-packages", () => ({
  listActivePackages: (...a: unknown[]) => listActivePackagesMock(...a),
  updateClientPackage: (...a: unknown[]) => updateClientPackageMock(...a),
  listDepletedAutoRenewPackages: (...a: unknown[]) => listDepletedAutoRenewPackagesMock(...a),
}))
vi.mock("@/lib/db/pack-renewal-attempts", () => ({
  listRenewalsAwaitingPayment: async () => [],
  countStalePendingRenewalAttempts: (...a: unknown[]) => countStalePendingRenewalAttemptsMock(...a),
  countRenewalsAwaitingPayment: (...a: unknown[]) => countRenewalsAwaitingPaymentMock(...a),
}))
vi.mock("@/lib/db/users", () => ({
  getUserById: (...a: unknown[]) => getUserByIdMock(...a),
  getUsers: (...a: unknown[]) => getUsersMock(...a),
}))
vi.mock("@/lib/db/notifications", () => ({ createNotification: (...a: unknown[]) => createNotificationMock(...a) }))
vi.mock("@/lib/email", () => ({
  sendPackRenewalEmail: (...a: unknown[]) => sendPackRenewalEmailMock(...a),
  sendPackAutoRenewWarningEmail: vi.fn(),
  sendPackPaymentLinkEmail: vi.fn(),
}))
vi.mock("@/lib/services/pack-renewal", () => ({
  attemptPackRenewal: (...a: unknown[]) => attemptPackRenewalMock(...a),
}))
vi.mock("@/lib/packs/flags", () => ({
  // Present but OFF, on purpose. The route calls the re-send pass inside its own
  // try/catch, so an ABSENT export degrades to a silent no-op and this suite
  // would go on passing while the pass was broken. Naming it here makes the
  // no-op deliberate instead of accidental.
  packLinkResendEnabled: async () => false,
  packLinkResendMax: async () => 3,
  PACK_RENEWALS_CRON_KEY: "cron_pack_renewals_enabled",
  packReminderLowAt: async () => 2,
  packReminderExpiryDays: async () => 7,
  packAutoRenewEnabled: (...a: unknown[]) => packAutoRenewEnabledMock(...a),
  packAutoRenewMaxAgeDays: (...a: unknown[]) => packAutoRenewMaxAgeDaysMock(...a),
}))

import { POST } from "@/app/api/admin/internal/pack-renewals/route"

function pkg(p: Partial<ClientPackage>): ClientPackage {
  return {
    id: "p",
    client_user_id: "c",
    product_id: null,
    session_type: "1-on-1",
    credits_total: 10,
    credits_used: 10,
    price_cents: 50000,
    payment_method: "stripe",
    payment_status: "paid",
    stripe_session_id: null,
    stripe_payment_id: null,
    purchased_at: "2026-06-01T00:00:00Z",
    expires_at: null,
    status: "depleted",
    last_reminded_threshold: null,
    notes: null,
    created_by: null,
    created_at: "",
    updated_at: "",
    auto_renew: true,
    renewed_from_package_id: null,
    renewal_attempted_at: null,
    ...p,
  } as ClientPackage
}

function req() {
  return new Request("http://localhost/api/admin/internal/pack-renewals", {
    method: "POST",
    headers: { authorization: "Bearer test-token" },
  }) as never
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INTERNAL_CRON_TOKEN = "test-token"
  isCronSkippedMock.mockResolvedValue({ skipped: false })
  listActivePackagesMock.mockResolvedValue([])
  getUsersMock.mockResolvedValue([])
  packAutoRenewEnabledMock.mockResolvedValue(true)
  packAutoRenewMaxAgeDaysMock.mockResolvedValue(7)
  listDepletedAutoRenewPackagesMock.mockResolvedValue([])
  countStalePendingRenewalAttemptsMock.mockResolvedValue(0)
  countRenewalsAwaitingPaymentMock.mockResolvedValue(0)
})

describe("POST /api/admin/internal/pack-renewals — auto-renew sweep", () => {
  it("calls attemptPackRenewal for each depleted, armed pack", async () => {
    const p1 = pkg({ id: "p1" })
    listDepletedAutoRenewPackagesMock.mockResolvedValue([p1])
    attemptPackRenewalMock.mockResolvedValue({ renewed: true })

    await POST(req())

    expect(attemptPackRenewalMock).toHaveBeenCalledWith(p1, expect.any(Date))
  })

  it("increments renewed on a successful renewal", async () => {
    listDepletedAutoRenewPackagesMock.mockResolvedValue([pkg({ id: "p1" }), pkg({ id: "p2" })])
    attemptPackRenewalMock.mockResolvedValue({ renewed: true })

    const res = await POST(req())
    const json = await res.json()

    expect(json.renewed).toBe(2)
    expect(json.renewalsFailed).toBe(0)
  })

  it("increments renewalsFailed on a declined charge but not on disabled or already_attempted", async () => {
    listDepletedAutoRenewPackagesMock.mockResolvedValue([
      pkg({ id: "declined" }),
      pkg({ id: "flag-disabled" }),
      pkg({ id: "already-attempted" }),
    ])
    attemptPackRenewalMock
      .mockResolvedValueOnce({ renewed: false, reason: "declined" })
      .mockResolvedValueOnce({ renewed: false, reason: "disabled" })
      .mockResolvedValueOnce({ renewed: false, reason: "already_attempted" })

    const res = await POST(req())
    const json = await res.json()

    expect(attemptPackRenewalMock).toHaveBeenCalledTimes(3)
    expect(json.renewed).toBe(0)
    expect(json.renewalsFailed).toBe(1)
  })

  it("is a clean no-op when there are no depleted, armed packs", async () => {
    listDepletedAutoRenewPackagesMock.mockResolvedValue([])

    const res = await POST(req())
    const json = await res.json()

    expect(attemptPackRenewalMock).not.toHaveBeenCalled()
    expect(json.renewed).toBe(0)
    expect(json.renewalsFailed).toBe(0)
  })

  it("runs even when the reminder cron is disabled — the two gates are independent", async () => {
    isCronSkippedMock.mockResolvedValue({ skipped: true, reason: "disabled" })
    listDepletedAutoRenewPackagesMock.mockResolvedValue([pkg({ id: "p1" })])
    attemptPackRenewalMock.mockResolvedValue({ renewed: true })

    const res = await POST(req())
    const json = await res.json()

    expect(json.skipped).toBe("disabled")
    // The warning pass legitimately calls this once (packAutoRenewEnabledMock
    // defaults to true in this file's beforeEach, so it runs here too, finding
    // nothing since listActivePackagesMock defaults to []). TWO calls would
    // mean the reminder loop ignored gate.skipped and ran anyway — that's what
    // this asserts against, not "the reminder loop never touched it."
    expect(listActivePackagesMock).toHaveBeenCalledTimes(1)
    expect(attemptPackRenewalMock).toHaveBeenCalledTimes(1)
    expect(json.renewed).toBe(1)
  })

  it("does not run the sweep when pack_auto_renew_enabled is off", async () => {
    packAutoRenewEnabledMock.mockResolvedValue(false)
    listDepletedAutoRenewPackagesMock.mockResolvedValue([pkg({ id: "p1" })])

    const res = await POST(req())
    const json = await res.json()

    expect(listDepletedAutoRenewPackagesMock).not.toHaveBeenCalled()
    expect(attemptPackRenewalMock).not.toHaveBeenCalled()
    expect(json.renewed).toBe(0)
    expect(json.renewalsFailed).toBe(0)
  })

  it("continues to the next pack when one throws (per-pack catch)", async () => {
    listDepletedAutoRenewPackagesMock.mockResolvedValue([pkg({ id: "boom" }), pkg({ id: "ok" })])
    attemptPackRenewalMock
      .mockRejectedValueOnce(new Error("resolveBillingUserId exploded"))
      .mockResolvedValueOnce({ renewed: true })

    const res = await POST(req())
    const json = await res.json()

    expect(attemptPackRenewalMock).toHaveBeenCalledTimes(2)
    expect(json.renewed).toBe(1)
    expect(json.renewalsFailed).toBe(1)
  })

  // I3: packs get ARMED at checkout the moment auto-renew ships, independent
  // of pack_auto_renew_enabled. Anything that depleted while the flag was
  // off has no attempt row and sits invisible until the first sweep after
  // the flag flips on — which, without a recency bound, would charge every
  // such pack in one batch regardless of how long ago it ran out.
  it("bounds listDepletedAutoRenewPackages by pack_auto_renew_max_age_days, not an unbounded scan", async () => {
    packAutoRenewMaxAgeDaysMock.mockResolvedValue(7)
    await POST(req())

    expect(listDepletedAutoRenewPackagesMock).toHaveBeenCalledTimes(1)
    const sinceIso = listDepletedAutoRenewPackagesMock.mock.calls[0][0]
    const sinceMs = Date.parse(sinceIso)
    const nowMs = Date.now()
    // Within a couple seconds of "7 days ago" — proves the days value from
    // the setting actually reached the query, not a hardcoded default.
    const expectedMs = nowMs - 7 * 24 * 60 * 60 * 1000
    expect(Math.abs(sinceMs - expectedMs)).toBeLessThan(5000)
  })

  it("uses a different max-age-days value when the admin setting overrides the default", async () => {
    packAutoRenewMaxAgeDaysMock.mockResolvedValue(1)
    await POST(req())

    const sinceIso = listDepletedAutoRenewPackagesMock.mock.calls[0][0]
    const sinceMs = Date.parse(sinceIso)
    const expectedMs = Date.now() - 1 * 24 * 60 * 60 * 1000
    expect(Math.abs(sinceMs - expectedMs)).toBeLessThan(5000)
  })

  // I2: the sweep exists to recover a crash mid-charge, but a crash in the
  // exact gap between reserving the attempt row and calling chargeSavedCard
  // strands that row at `pending` forever — listDepletedAutoRenewPackages
  // permanently excludes any pack that already has an attempt row, so it can
  // never be picked up again. Auto-retry is unsafe (Stripe idempotency keys
  // expire at 24h), so this only surfaces the count for a human.
  describe("stale pending renewal attempts (I2)", () => {
    it("includes the stale-pending count in the JSON response", async () => {
      countStalePendingRenewalAttemptsMock.mockResolvedValue(3)
      const res = await POST(req())
      const json = await res.json()
      expect(json.stalePendingRenewals).toBe(3)
    })

    it("is zero and does not notify admins when nothing is stuck", async () => {
      countStalePendingRenewalAttemptsMock.mockResolvedValue(0)
      countRenewalsAwaitingPaymentMock.mockResolvedValue(0)
      const res = await POST(req())
      const json = await res.json()
      expect(json.stalePendingRenewals).toBe(0)
      expect(createNotificationMock).not.toHaveBeenCalled()
    })

    it("notifies every admin when there are stale pending attempts", async () => {
      countStalePendingRenewalAttemptsMock.mockResolvedValue(2)
      getUsersMock.mockResolvedValue([
        { id: "admin-1", role: "admin" },
        { id: "admin-2", role: "admin" },
        { id: "coach-client", role: "client" },
      ])
      await POST(req())

      expect(createNotificationMock).toHaveBeenCalledTimes(2)
      expect(createNotificationMock).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: "admin-1", title: expect.stringContaining("stuck") }),
      )
      expect(createNotificationMock).toHaveBeenCalledWith(expect.objectContaining({ user_id: "admin-2" }))
    })

    it("runs even when pack_auto_renew_enabled is off — a stuck row can predate the flag flipping", async () => {
      packAutoRenewEnabledMock.mockResolvedValue(false)
      countStalePendingRenewalAttemptsMock.mockResolvedValue(1)
      getUsersMock.mockResolvedValue([{ id: "admin-1", role: "admin" }])
      const res = await POST(req())
      const json = await res.json()

      expect(json.stalePendingRenewals).toBe(1)
      expect(createNotificationMock).toHaveBeenCalledWith(expect.objectContaining({ user_id: "admin-1" }))
    })

    it("does not fail the whole sweep response when the stale-attempt check itself throws", async () => {
      countStalePendingRenewalAttemptsMock.mockRejectedValue(new Error("db down"))
      const res = await POST(req())
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.stalePendingRenewals).toBe(0)
    })
  })
})

// A renewal that resolves to `skipped`/`failed` mints an unpaid replacement
// pack and is supposed to tell a human, from the inline path in
// attemptPackRenewal. That path runs fire-and-forget AFTER the check-in
// response, so anything it still had to do can simply not happen: a real
// $1,500 renewal skipped with `no_card`, the payment link went out, and the
// admin notification never landed — the coach found it by eye days later. The
// stale-pending check above cannot see it, because that attempt is not stuck,
// it is finished. This is the watch for "finished, and still nobody paid".
describe("renewals awaiting payment", () => {
  it("includes the awaiting-payment count in the JSON response", async () => {
    countRenewalsAwaitingPaymentMock.mockResolvedValue(1)
    const res = await POST(req())
    const json = await res.json()
    expect(json.renewalsAwaitingPayment).toBe(1)
  })

  it("notifies every admin when a resolved renewal is still unpaid", async () => {
    countRenewalsAwaitingPaymentMock.mockResolvedValue(2)
    getUsersMock.mockResolvedValue([
      { id: "admin-1", role: "admin" },
      { id: "admin-2", role: "admin" },
      { id: "client-1", role: "client" },
    ])
    await POST(req())
    const targets = createNotificationMock.mock.calls.map((c) => c[0].user_id)
    expect(targets).toEqual(["admin-1", "admin-2"])
    // The count is the whole point — an alert that does not say how many, or
    // that says "1" when two families are waiting, is not worth the interrupt.
    expect(createNotificationMock.mock.calls[0][0].message).toContain("2")
  })

  it("says nothing when every resolved renewal has been paid", async () => {
    countRenewalsAwaitingPaymentMock.mockResolvedValue(0)
    const res = await POST(req())
    const json = await res.json()
    expect(json.renewalsAwaitingPayment).toBe(0)
    // Self-clearing: paying the link flips the pack to `paid`, which drops it
    // out of the count. Without this the daily alert would nag forever.
    expect(createNotificationMock).not.toHaveBeenCalled()
  })

  it("still reports the count when the stale-pending check throws", async () => {
    countStalePendingRenewalAttemptsMock.mockRejectedValue(new Error("db down"))
    countRenewalsAwaitingPaymentMock.mockResolvedValue(1)
    const res = await POST(req())
    const json = await res.json()
    // Two independent watches. Sharing one try/catch would mean the older one
    // failing silently takes the newer one down with it.
    expect(json.renewalsAwaitingPayment).toBe(1)
  })
})
