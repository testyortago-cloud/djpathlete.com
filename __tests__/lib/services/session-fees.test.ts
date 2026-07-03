import { describe, it, expect, vi, beforeEach } from "vitest"

const feesEnabledMock = vi.fn()
const noShowCentsMock = vi.fn()
const lateCentsMock = vi.fn()
const windowHoursMock = vi.fn()
const getUserMock = vi.fn()
const getCardMock = vi.fn()
const chargeMock = vi.fn()
const createChargeMock = vi.fn()
const updateChargeMock = vi.fn()

vi.mock("@/lib/packs/flags", () => ({
  sessionFeesEnabled: () => feesEnabledMock(),
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
}))
vi.mock("@/lib/db/payments", () => ({ createPayment: vi.fn(async () => ({ id: "pay-1" })) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { chargeNoShowFee, chargeLateCancelFee } from "@/lib/services/session-fees"

const session = {
  id: "occ-1",
  client_user_id: "c1",
  session_date: "2026-07-06",
  start_time: "05:45:00",
} as never

beforeEach(() => {
  vi.clearAllMocks()
  feesEnabledMock.mockResolvedValue(true)
  noShowCentsMock.mockResolvedValue(2000)
  lateCentsMock.mockResolvedValue(1500)
  windowHoursMock.mockResolvedValue(12)
  getUserMock.mockResolvedValue({ id: "c1", stripe_customer_id: "cus_1" })
  getCardMock.mockResolvedValue({ stripe_payment_method_id: "pm_1" })
  createChargeMock.mockResolvedValue({ id: "fee-1" })
  chargeMock.mockResolvedValue({ ok: true, paymentIntentId: "pi_1" })
})

describe("chargeNoShowFee", () => {
  it("no-ops when fees are disabled (no charge attempt)", async () => {
    feesEnabledMock.mockResolvedValue(false)
    await chargeNoShowFee(session)
    expect(createChargeMock).not.toHaveBeenCalled()
    expect(chargeMock).not.toHaveBeenCalled()
  })

  it("no-ops when the configured fee is 0", async () => {
    noShowCentsMock.mockResolvedValue(0)
    await chargeNoShowFee(session)
    expect(createChargeMock).not.toHaveBeenCalled()
  })

  it("waives (no charge) when the client has no saved card", async () => {
    getCardMock.mockResolvedValue(null)
    const r = await chargeNoShowFee(session)
    expect(chargeMock).not.toHaveBeenCalled()
    expect(updateChargeMock).toHaveBeenCalledWith("fee-1", expect.objectContaining({ status: "waived" }))
    expect(r.reason).toBe("no_card")
  })

  it("charges the saved card and marks the fee succeeded", async () => {
    const r = await chargeNoShowFee(session)
    expect(chargeMock).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "cus_1", paymentMethodId: "pm_1", amountCents: 2000, idempotencyKey: "fee_occ-1_no_show" }),
    )
    expect(updateChargeMock).toHaveBeenCalledWith("fee-1", expect.objectContaining({ status: "succeeded", stripe_payment_intent_id: "pi_1" }))
    expect(r.charged).toBe(true)
  })

  it("marks failed on a decline (no throw)", async () => {
    chargeMock.mockResolvedValue({ ok: false, reason: "declined", message: "card_declined" })
    const r = await chargeNoShowFee(session)
    expect(updateChargeMock).toHaveBeenCalledWith("fee-1", expect.objectContaining({ status: "failed" }))
    expect(r.charged).toBe(false)
  })

  it("never double-charges (dup reservation returns null)", async () => {
    createChargeMock.mockResolvedValue(null)
    await chargeNoShowFee(session)
    expect(chargeMock).not.toHaveBeenCalled()
  })
})

describe("chargeLateCancelFee", () => {
  it("does not charge when cancelled well before the window", async () => {
    // session start 2026-07-06 05:45Z; now 5 days earlier → far outside a 12h window
    await chargeLateCancelFee(session, new Date("2026-07-01T00:00:00Z"))
    expect(createChargeMock).not.toHaveBeenCalled()
  })

  it("charges the late-cancel fee inside the window", async () => {
    // now 2 hours before start → inside 12h window
    await chargeLateCancelFee(session, new Date("2026-07-06T03:45:00Z"))
    expect(chargeMock).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 1500, idempotencyKey: "fee_occ-1_late_cancel" }))
  })
})
