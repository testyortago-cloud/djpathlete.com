import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ClientPackage } from "@/types/database"

// Separate test file on purpose — same reasoning as pack-renewals-sweep.test.ts:
// this exercises the NEW auto-renew warning pass, which must fire independent of
// cron_pack_renewals_enabled. pack-renewals.test.ts's mock factories intentionally
// stay untouched so that pre-existing suite keeps testing exactly what it tested
// before this feature landed.
const isCronSkippedMock = vi.fn()
const listActivePackagesMock = vi.fn()
const updateClientPackageMock = vi.fn()
const listDepletedAutoRenewPackagesMock = vi.fn()
const getUserByIdMock = vi.fn()
const getUsersMock = vi.fn()
const createNotificationMock = vi.fn()
const sendPackRenewalEmailMock = vi.fn()
const sendPackAutoRenewWarningEmailMock = vi.fn()
const attemptPackRenewalMock = vi.fn()
const packAutoRenewEnabledMock = vi.fn()
const packAutoRenewMaxAgeDaysMock = vi.fn()
const countStalePendingRenewalAttemptsMock = vi.fn()
const resolveBillingUserIdMock = vi.fn()
const getDefaultPaymentMethodMock = vi.fn()

vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped: (...a: unknown[]) => isCronSkippedMock(...a) }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => ({}) }))
vi.mock("@/lib/db/client-packages", () => ({
  listActivePackages: (...a: unknown[]) => listActivePackagesMock(...a),
  updateClientPackage: (...a: unknown[]) => updateClientPackageMock(...a),
  listDepletedAutoRenewPackages: (...a: unknown[]) => listDepletedAutoRenewPackagesMock(...a),
}))
vi.mock("@/lib/db/pack-renewal-attempts", () => ({
  countStalePendingRenewalAttempts: (...a: unknown[]) => countStalePendingRenewalAttemptsMock(...a),
}))
vi.mock("@/lib/db/users", () => ({
  getUserById: (...a: unknown[]) => getUserByIdMock(...a),
  getUsers: (...a: unknown[]) => getUsersMock(...a),
}))
vi.mock("@/lib/db/notifications", () => ({ createNotification: (...a: unknown[]) => createNotificationMock(...a) }))
vi.mock("@/lib/db/payment-methods", () => ({
  getDefaultPaymentMethod: (...a: unknown[]) => getDefaultPaymentMethodMock(...a),
}))
vi.mock("@/lib/services/billing-payer", () => ({
  resolveBillingUserId: (...a: unknown[]) => resolveBillingUserIdMock(...a),
}))
vi.mock("@/lib/email", () => ({
  sendPackRenewalEmail: (...a: unknown[]) => sendPackRenewalEmailMock(...a),
  sendPackAutoRenewWarningEmail: (...a: unknown[]) => sendPackAutoRenewWarningEmailMock(...a),
}))
vi.mock("@/lib/services/pack-renewal", () => ({ attemptPackRenewal: (...a: unknown[]) => attemptPackRenewalMock(...a) }))
vi.mock("@/lib/packs/flags", () => ({
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
    client_user_id: "c1",
    product_id: null,
    session_type: "1-on-1",
    credits_total: 10,
    credits_used: 8, // remaining = 2 -> "low" at the default lowAt=2
    price_cents: 75000,
    payment_method: "stripe",
    payment_status: "paid",
    stripe_session_id: null,
    stripe_payment_id: null,
    purchased_at: "2026-06-01T00:00:00Z",
    expires_at: null,
    status: "active",
    last_reminded_threshold: null,
    notes: null,
    bill_to_email: null,
    bill_to_emailed_at: null,
    auto_renew: false,
    renewed_from_package_id: null,
    renewal_attempted_at: null,
    created_by: null,
    created_at: "",
    updated_at: "",
    ...p,
  }
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
  listDepletedAutoRenewPackagesMock.mockResolvedValue([])
  getUsersMock.mockResolvedValue([])
  countStalePendingRenewalAttemptsMock.mockResolvedValue(0)
  packAutoRenewEnabledMock.mockResolvedValue(true)
  packAutoRenewMaxAgeDaysMock.mockResolvedValue(7)
  getUserByIdMock.mockResolvedValue({ id: "c1", email: "c1@x.com", first_name: "Sam", last_name: "Lee" })
  resolveBillingUserIdMock.mockResolvedValue("c1")
  getDefaultPaymentMethodMock.mockResolvedValue(null)
})

describe("POST /api/admin/internal/pack-renewals — auto-renew warning pass", () => {
  it("warns an armed pack with a card at the low threshold even with cron_pack_renewals_enabled OFF", async () => {
    isCronSkippedMock.mockResolvedValue({ skipped: true, reason: "disabled" })
    listActivePackagesMock.mockResolvedValue([pkg({ id: "armed-card", auto_renew: true })])
    getDefaultPaymentMethodMock.mockResolvedValue({ brand: "visa", last4: "4242" })

    const res = await POST(req())
    const json = await res.json()

    expect(json.skipped).toBe("disabled")
    expect(sendPackAutoRenewWarningEmailMock).toHaveBeenCalledTimes(1)
    expect(sendPackRenewalEmailMock).not.toHaveBeenCalled()
  })

  it("leaves unarmed-pack behaviour untouched when cron_pack_renewals_enabled is off", async () => {
    isCronSkippedMock.mockResolvedValue({ skipped: true, reason: "disabled" })
    listActivePackagesMock.mockResolvedValue([pkg({ id: "unarmed", auto_renew: false })])

    await POST(req())

    expect(sendPackAutoRenewWarningEmailMock).not.toHaveBeenCalled()
    expect(sendPackRenewalEmailMock).not.toHaveBeenCalled()
    expect(updateClientPackageMock).not.toHaveBeenCalled()
  })

  it("sends the manual reminder, not the warning, when the armed pack's payer has no card", async () => {
    listActivePackagesMock.mockResolvedValue([pkg({ id: "armed-no-card", auto_renew: true })])
    getDefaultPaymentMethodMock.mockResolvedValue(null)

    await POST(req())

    expect(sendPackAutoRenewWarningEmailMock).not.toHaveBeenCalled()
    expect(sendPackRenewalEmailMock).toHaveBeenCalledTimes(1)
    expect(sendPackRenewalEmailMock).toHaveBeenCalledWith(expect.objectContaining({ threshold: "low", to: "c1@x.com" }))
  })

  it("sends neither email for an armed pack at the empty threshold", async () => {
    listActivePackagesMock.mockResolvedValue([pkg({ id: "armed-empty", auto_renew: true, credits_used: 10 })])

    await POST(req())

    expect(sendPackAutoRenewWarningEmailMock).not.toHaveBeenCalled()
    expect(sendPackRenewalEmailMock).not.toHaveBeenCalled()
  })

  it("keeps the empty reminder for an unarmed pack (unchanged)", async () => {
    listActivePackagesMock.mockResolvedValue([pkg({ id: "unarmed-empty", auto_renew: false, credits_used: 10 })])

    await POST(req())

    expect(sendPackRenewalEmailMock).toHaveBeenCalledWith(expect.objectContaining({ threshold: "empty" }))
    expect(sendPackAutoRenewWarningEmailMock).not.toHaveBeenCalled()
  })

  it("stamps last_reminded_threshold after sending a warning, so it isn't re-sent tomorrow", async () => {
    listActivePackagesMock.mockResolvedValue([pkg({ id: "armed-card", auto_renew: true })])
    getDefaultPaymentMethodMock.mockResolvedValue({ brand: "visa", last4: "4242" })

    await POST(req())

    expect(updateClientPackageMock).toHaveBeenCalledWith("armed-card", { last_reminded_threshold: "low" })
  })

  it("falls back to the manual reminder for an armed+low pack when pack_auto_renew_enabled itself is off", async () => {
    packAutoRenewEnabledMock.mockResolvedValue(false)
    listActivePackagesMock.mockResolvedValue([pkg({ id: "armed-flag-off", auto_renew: true })])

    await POST(req())

    expect(sendPackAutoRenewWarningEmailMock).not.toHaveBeenCalled()
    expect(sendPackRenewalEmailMock).toHaveBeenCalledWith(expect.objectContaining({ threshold: "low" }))
  })

  it("does not suppress the empty reminder for an armed pack when pack_auto_renew_enabled is off", async () => {
    packAutoRenewEnabledMock.mockResolvedValue(false)
    listActivePackagesMock.mockResolvedValue([pkg({ id: "armed-empty-flag-off", auto_renew: true, credits_used: 10 })])

    await POST(req())

    expect(sendPackRenewalEmailMock).toHaveBeenCalledWith(expect.objectContaining({ threshold: "empty" }))
  })

  it("CCs the trainee when the payer differs from the client (household billing)", async () => {
    listActivePackagesMock.mockResolvedValue([pkg({ id: "armed-card", auto_renew: true, client_user_id: "trainee-1" })])
    resolveBillingUserIdMock.mockResolvedValue("payer-1")
    getUserByIdMock.mockImplementation(async (id: string) =>
      id === "payer-1"
        ? { id: "payer-1", email: "parent@x.com", first_name: "Pat", last_name: "Doe" }
        : { id: "trainee-1", email: "kid@x.com", first_name: "Kim", last_name: "Doe" },
    )
    getDefaultPaymentMethodMock.mockResolvedValue({ brand: "visa", last4: "4242" })

    await POST(req())

    expect(sendPackAutoRenewWarningEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "parent@x.com", ccClientEmail: "kid@x.com" }),
    )
  })

  it("does not re-warn a pack already reminded at low or higher", async () => {
    listActivePackagesMock.mockResolvedValue([
      pkg({ id: "already-low", auto_renew: true, last_reminded_threshold: "low" }),
    ])
    getDefaultPaymentMethodMock.mockResolvedValue({ brand: "visa", last4: "4242" })

    await POST(req())

    expect(sendPackAutoRenewWarningEmailMock).not.toHaveBeenCalled()
    expect(sendPackRenewalEmailMock).not.toHaveBeenCalled()
  })

  it("continues to the next pack when one warning attempt throws", async () => {
    listActivePackagesMock.mockResolvedValue([
      pkg({ id: "boom", auto_renew: true }),
      pkg({ id: "ok", auto_renew: true, client_user_id: "c2" }),
    ])
    getDefaultPaymentMethodMock.mockResolvedValue({ brand: "visa", last4: "4242" })
    resolveBillingUserIdMock.mockImplementation(async (clientUserId: string) => {
      if (clientUserId === "c1") throw new Error("billing payer lookup exploded")
      return clientUserId
    })

    const res = await POST(req())
    const json = await res.json()

    expect(sendPackAutoRenewWarningEmailMock).toHaveBeenCalledTimes(1)
    expect(json.warningsFailed).toBe(1)
    expect(json.warned).toBe(1)
  })
})
