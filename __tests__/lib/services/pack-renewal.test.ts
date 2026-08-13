import { describe, it, expect, vi, beforeEach } from "vitest"

const chargeSavedCard = vi.fn()
const createRenewalAttemptIfAbsent = vi.fn()
const updateRenewalAttempt = vi.fn()
const createClientPackage = vi.fn()
const createPayment = vi.fn()
const recordAudit = vi.fn()
const getDefaultPaymentMethod = vi.fn()
const resolveBillingUserId = vi.fn()
const getUserById = vi.fn()
const resolvePackPaymentLink = vi.fn()
const sendPackPaymentLinkEmail = vi.fn()
const sendPackRenewedEmail = vi.fn()
const createNotification = vi.fn()
const getUsers = vi.fn()
const packAutoRenewEnabled = vi.fn()

vi.mock("@/lib/stripe", () => ({ chargeSavedCard }))
vi.mock("@/lib/db/pack-renewal-attempts", () => ({ createRenewalAttemptIfAbsent, updateRenewalAttempt }))
vi.mock("@/lib/db/client-packages", () => ({ createClientPackage, updateClientPackage: vi.fn() }))
vi.mock("@/lib/db/payments", () => ({ createPayment }))
vi.mock("@/lib/audit/record", () => ({ recordAudit }))
vi.mock("@/lib/db/payment-methods", () => ({ getDefaultPaymentMethod }))
vi.mock("@/lib/services/billing-payer", () => ({ resolveBillingUserId }))
vi.mock("@/lib/db/users", () => ({ getUserById, getUsers }))
vi.mock("@/lib/services/pack-payment-link", () => ({ resolvePackPaymentLink }))
vi.mock("@/lib/email", () => ({ sendPackPaymentLinkEmail, sendPackRenewedEmail }))
vi.mock("@/lib/db/notifications", () => ({ createNotification }))
vi.mock("@/lib/packs/flags", () => ({ packAutoRenewEnabled }))

const pack = (over = {}) => ({
  id: "pack-1", client_user_id: "u1", product_id: "prod-1", assignment_id: null,
  session_type: "training", credits_total: 10, credits_used: 10, price_cents: 75000,
  payment_method: "stripe", payment_status: "paid", stripe_session_id: null,
  stripe_payment_id: null, purchased_at: "", expires_at: null, status: "depleted",
  last_reminded_threshold: null, notes: null, bill_to_email: null, bill_to_emailed_at: null,
  created_by: null, created_at: "", updated_at: "",
  auto_renew: true, renewed_from_package_id: null, renewal_attempted_at: null,
  ...over,
})

describe("attemptPackRenewal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    packAutoRenewEnabled.mockResolvedValue(true)
    createRenewalAttemptIfAbsent.mockResolvedValue({ id: "att-1" })
    resolveBillingUserId.mockResolvedValue("payer-1")
    getUserById.mockResolvedValue({
      id: "payer-1", email: "payer@x.com", first_name: "Pat", stripe_customer_id: "cus_1",
    })
    getDefaultPaymentMethod.mockResolvedValue({ stripe_payment_method_id: "pm_1" })
    createClientPackage.mockResolvedValue({ id: "pack-2" })
    getUsers.mockResolvedValue([])
    resolvePackPaymentLink.mockResolvedValue({ ok: true, url: "https://pay", refreshed: false })
  })

  it("charges the saved card and creates a paid clone", async () => {
    chargeSavedCard.mockResolvedValue({ ok: true, paymentIntentId: "pi_1" })
    const { attemptPackRenewal } = await import("@/lib/services/pack-renewal")
    const out = await attemptPackRenewal(pack() as never)

    expect(out.renewed).toBe(true)
    expect(chargeSavedCard).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "cus_1",
        paymentMethodId: "pm_1",
        amountCents: 75000,
        idempotencyKey: "pack_renew_pack-1",
      }),
    )
    expect(createClientPackage).toHaveBeenCalledWith(
      expect.objectContaining({ payment_status: "paid", credits_used: 0, renewed_from_package_id: "pack-1" }),
    )
    expect(updateRenewalAttempt).toHaveBeenCalledWith(
      "att-1",
      expect.objectContaining({ status: "succeeded", stripe_payment_intent_id: "pi_1", new_package_id: "pack-2" }),
    )
    expect(createPayment).toHaveBeenCalled()
  })

  it("stops without charging when an attempt row already exists", async () => {
    createRenewalAttemptIfAbsent.mockResolvedValue(null)
    const { attemptPackRenewal } = await import("@/lib/services/pack-renewal")
    const out = await attemptPackRenewal(pack() as never)

    expect(out).toEqual({ renewed: false, reason: "already_attempted" })
    expect(chargeSavedCard).not.toHaveBeenCalled()
  })

  it("skips — not fails — when there is no saved card, and sends a link instead", async () => {
    getDefaultPaymentMethod.mockResolvedValue(null)
    const { attemptPackRenewal } = await import("@/lib/services/pack-renewal")
    const out = await attemptPackRenewal(pack() as never)

    expect(out).toEqual({ renewed: false, reason: "no_card", newPackageId: "pack-2" })
    expect(chargeSavedCard).not.toHaveBeenCalled()
    expect(updateRenewalAttempt).toHaveBeenCalledWith("att-1", expect.objectContaining({ status: "skipped" }))
    expect(createClientPackage).toHaveBeenCalledWith(expect.objectContaining({ payment_status: "pending" }))
    expect(sendPackPaymentLinkEmail).toHaveBeenCalled()
  })

  it("falls back to a pending pack and a payment link on decline", async () => {
    chargeSavedCard.mockResolvedValue({ ok: false, reason: "declined", message: "card_declined" })
    getUsers.mockResolvedValue([{ id: "admin-1", role: "admin" }])
    const { attemptPackRenewal } = await import("@/lib/services/pack-renewal")
    const out = await attemptPackRenewal(pack() as never)

    expect(out.renewed).toBe(false)
    expect(out.reason).toBe("declined")
    expect(updateRenewalAttempt).toHaveBeenCalledWith(
      "att-1",
      expect.objectContaining({ status: "failed", failure_reason: "card_declined" }),
    )
    expect(createClientPackage).toHaveBeenCalledWith(expect.objectContaining({ payment_status: "pending" }))
    expect(sendPackPaymentLinkEmail).toHaveBeenCalled()
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ user_id: "admin-1" }))
  })

  it("charges the household payer's card but records the trainee as the user", async () => {
    chargeSavedCard.mockResolvedValue({ ok: true, paymentIntentId: "pi_1" })
    const { attemptPackRenewal } = await import("@/lib/services/pack-renewal")
    await attemptPackRenewal(pack() as never)

    expect(getDefaultPaymentMethod).toHaveBeenCalledWith("payer-1")
    expect(createRenewalAttemptIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "u1", billing_user_id: "payer-1" }),
    )
  })

  it("does not charge when the flag is off", async () => {
    packAutoRenewEnabled.mockResolvedValue(false)
    const { attemptPackRenewal } = await import("@/lib/services/pack-renewal")
    const out = await attemptPackRenewal(pack() as never)

    expect(out).toEqual({ renewed: false, reason: "disabled" })
    expect(createRenewalAttemptIfAbsent).not.toHaveBeenCalled()
    expect(chargeSavedCard).not.toHaveBeenCalled()
  })
})
