import { describe, it, expect, vi, beforeEach } from "vitest"

const feesEnabledMock = vi.fn()
const payerNotifyEnabledMock = vi.fn()
const noShowCentsMock = vi.fn()
const lateCentsMock = vi.fn()
const windowHoursMock = vi.fn()
const getUserMock = vi.fn()
const getCardMock = vi.fn()
const chargeMock = vi.fn()
const createChargeMock = vi.fn()
const updateChargeMock = vi.fn()
const getChargeByIdMock = vi.fn()
const resolveBillingMock = vi.fn()
const sendPayerEmailMock = vi.fn()

vi.mock("@/lib/services/billing-payer", () => ({ resolveBillingUserId: (...a: unknown[]) => resolveBillingMock(...a) }))
vi.mock("@/lib/packs/flags", () => ({
  sessionFeesEnabled: () => feesEnabledMock(),
  sessionFeePayerNotifyEnabled: () => payerNotifyEnabledMock(),
  noShowFeeCents: () => noShowCentsMock(),
  lateCancelFeeCents: () => lateCentsMock(),
  cancelWindowHours: () => windowHoursMock(),
}))
vi.mock("@/lib/db/users", () => ({ getUserById: (...a: unknown[]) => getUserMock(...a) }))
vi.mock("@/lib/db/payment-methods", () => ({ getDefaultPaymentMethod: (...a: unknown[]) => getCardMock(...a) }))
vi.mock("@/lib/stripe", () => ({ chargeSavedCard: (...a: unknown[]) => chargeMock(...a) }))
vi.mock("@/lib/db/session-fee-charges", () => ({
  createFeeChargeIfAbsent: (...a: unknown[]) => createChargeMock(...a),
  updateFeeCharge: (...a: unknown[]) => updateChargeMock(...a),
  getFeeChargeById: (...a: unknown[]) => getChargeByIdMock(...a),
}))
vi.mock("@/lib/db/payments", () => ({ createPayment: vi.fn(async () => ({ id: "pay-1" })) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/email", () => ({ sendFeeChargedToPayerEmail: (...a: unknown[]) => sendPayerEmailMock(...a) }))

import { chargeNoShowFee, retryFeeCharge } from "@/lib/services/session-fees"

const session = {
  id: "occ-1",
  client_user_id: "c1",
  session_date: "2026-07-06",
  start_time: "05:45:00",
} as never

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  vi.clearAllMocks()
  feesEnabledMock.mockResolvedValue(true)
  payerNotifyEnabledMock.mockResolvedValue(true)
  noShowCentsMock.mockResolvedValue(2000)
  lateCentsMock.mockResolvedValue(1500)
  windowHoursMock.mockResolvedValue(12)
  getUserMock.mockImplementation(async (id: string) =>
    id === "dad"
      ? { id: "dad", email: "dad@fam.com", first_name: "Dad", last_name: "Durante", stripe_customer_id: "cus_dad" }
      : { id: "c1", email: "kid@fam.com", first_name: "Kid", last_name: "Durante", stripe_customer_id: "cus_kid" },
  )
  getCardMock.mockResolvedValue({ stripe_payment_method_id: "pm_1" })
  createChargeMock.mockResolvedValue({ id: "fee-1" })
  chargeMock.mockResolvedValue({ ok: true, paymentIntentId: "pi_1" })
  resolveBillingMock.mockImplementation(async (id: string) => id) // default: self-pays
  sendPayerEmailMock.mockResolvedValue(undefined)
})

describe("payer notification on fee charge", () => {
  it("emails the payer when someone else's fee hits their card", async () => {
    resolveBillingMock.mockResolvedValue("dad")
    const r = await chargeNoShowFee(session)
    expect(r.charged).toBe(true)
    await flush()
    expect(sendPayerEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "dad@fam.com",
        firstName: "Dad",
        traineeName: "Kid Durante",
        kind: "no_show",
        amountCents: 2000,
        sessionDate: "2026-07-06",
      }),
    )
  })

  it("does NOT email when the trainee pays for themselves", async () => {
    await chargeNoShowFee(session)
    await flush()
    expect(sendPayerEmailMock).not.toHaveBeenCalled()
  })

  it("does NOT email when the notify flag is off", async () => {
    payerNotifyEnabledMock.mockResolvedValue(false)
    resolveBillingMock.mockResolvedValue("dad")
    await chargeNoShowFee(session)
    await flush()
    expect(sendPayerEmailMock).not.toHaveBeenCalled()
  })

  it("does NOT email on a failed charge", async () => {
    resolveBillingMock.mockResolvedValue("dad")
    chargeMock.mockResolvedValue({ ok: false, reason: "declined", message: "card_declined" })
    await chargeNoShowFee(session)
    await flush()
    expect(sendPayerEmailMock).not.toHaveBeenCalled()
  })

  it("a notification failure never affects the charge outcome", async () => {
    resolveBillingMock.mockResolvedValue("dad")
    sendPayerEmailMock.mockRejectedValue(new Error("resend down"))
    const r = await chargeNoShowFee(session)
    expect(r.charged).toBe(true)
    await flush()
  })

  it("emails the payer when a retried fee finally succeeds", async () => {
    resolveBillingMock.mockResolvedValue("dad")
    getChargeByIdMock.mockResolvedValue({
      id: "fee-1",
      user_id: "c1",
      scheduled_session_id: "occ-1",
      kind: "no_show",
      amount_cents: 2000,
      status: "failed",
    })
    const r = await retryFeeCharge("fee-1")
    expect(r.charged).toBe(true)
    await flush()
    expect(sendPayerEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "dad@fam.com", traineeName: "Kid Durante", kind: "no_show", amountCents: 2000 }),
    )
  })
})
