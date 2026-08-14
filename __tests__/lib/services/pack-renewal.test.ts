import { describe, it, expect, vi, beforeEach } from "vitest"

const chargeSavedCard = vi.fn()
const createRenewalAttemptIfAbsent = vi.fn()
const updateRenewalAttempt = vi.fn()
const createClientPackage = vi.fn()
const updateClientPackage = vi.fn()
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
vi.mock("@/lib/db/client-packages", () => ({ createClientPackage, updateClientPackage }))
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
    // Explicit default (not just vi.clearAllMocks(), same reasoning as
    // sendPackRenewedEmail below): a later test replaces this with
    // mockImplementation to make ONE specific call fail, and without
    // resetting it here that replacement implementation survives into every
    // test that runs after it.
    updateRenewalAttempt.mockResolvedValue({ id: "att-1" })
    updateClientPackage.mockResolvedValue({ id: "pack-1" })
    createPayment.mockResolvedValue({ id: "pay-1" })
    getUsers.mockResolvedValue([])
    resolvePackPaymentLink.mockResolvedValue({ ok: true, url: "https://pay", refreshed: false })
    // Explicit default (not just vi.clearAllMocks(), which clears call history
    // but NOT a configured mockRejectedValue) — otherwise the rejection set by
    // the "receipt email rejects" test below leaks into every test after it.
    sendPackRenewedEmail.mockResolvedValue(undefined)
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
      expect.objectContaining({
        payment_status: "paid",
        credits_used: 0,
        renewed_from_package_id: "pack-1",
        // I1: the renewal pack's OWN PaymentIntent id, not the source pack's
        // (buildRenewalPack correctly leaves that null) — without this,
        // getPackageByStripePaymentId can never find this pack, so a Stripe
        // refund of this exact charge has nothing to match against and the
        // credits are never clawed back.
        stripe_payment_id: "pi_1",
      }),
    )
    expect(updateRenewalAttempt).toHaveBeenCalledWith(
      "att-1",
      expect.objectContaining({ status: "succeeded", stripe_payment_intent_id: "pi_1", new_package_id: "pack-2" }),
    )
    expect(createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        // C1: matches the manual pack-checkout mirror's convention — the
        // TRAINEE's ledger, even though the payer's card was charged (that's
        // recorded separately via stripe_customer_id below).
        user_id: "u1",
        stripe_payment_id: "pi_1",
        stripe_customer_id: "cus_1",
        amount_cents: 75000,
        status: "succeeded",
        // C1: the double-revenue bug. income-adapter only treats
        // metadata.type "session_pack" as a mirror row of an existing
        // client_packages sale — anything else (the old "pack_auto_renewal")
        // falls through and gets counted a SECOND time as its own income
        // draft. client_package_id must be the NEW pack (pack-2), which is
        // what income-adapter's id-pairing branch looks up to consume.
        metadata: {
          type: "session_pack",
          client_package_id: "pack-2",
          auto_renewal: true,
          source_package_id: "pack-1",
        },
      }),
    )
  })

  it("stamps renewal_attempted_at on the SOURCE pack once an attempt is reserved", async () => {
    chargeSavedCard.mockResolvedValue({ ok: true, paymentIntentId: "pi_1" })
    const { attemptPackRenewal } = await import("@/lib/services/pack-renewal")
    await attemptPackRenewal(pack() as never)

    expect(updateClientPackage).toHaveBeenCalledWith("pack-1", expect.objectContaining({ renewal_attempted_at: expect.any(String) }))
  })

  it("stops without charging when an attempt row already exists", async () => {
    createRenewalAttemptIfAbsent.mockResolvedValue(null)
    const { attemptPackRenewal } = await import("@/lib/services/pack-renewal")
    const out = await attemptPackRenewal(pack() as never)

    expect(out).toEqual({ renewed: false, reason: "already_attempted" })
    expect(chargeSavedCard).not.toHaveBeenCalled()
  })

  it("only charges once under concurrent renewal attempts (the double-charge guard)", async () => {
    chargeSavedCard.mockResolvedValue({ ok: true, paymentIntentId: "pi_1" })
    createRenewalAttemptIfAbsent.mockResolvedValueOnce({ id: "att-1" }).mockResolvedValue(null)
    const { attemptPackRenewal } = await import("@/lib/services/pack-renewal")
    const p = pack()
    const [a, b] = await Promise.all([attemptPackRenewal(p as never), attemptPackRenewal(p as never)])

    expect(chargeSavedCard).toHaveBeenCalledTimes(1)
    // Exactly one of the two calls actually renewed; the other saw the lock.
    const outcomes = [a, b]
    expect(outcomes.filter((o) => o.renewed)).toHaveLength(1)
    expect(outcomes.filter((o) => o.reason === "already_attempted")).toHaveLength(1)
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

  // M8: updateRenewalAttempt uses .single(), which throws on ANY write
  // failure. Before this fix that status-update call sat BEFORE the payment
  // link and the admin alert, so a transient DB hiccup there would strand
  // the client with no card, no link, and no attempt row update — the exact
  // "another way to strand a pending attempt" the finding described.
  it("still sends the payment link when updateRenewalAttempt fails on the no-card status update (M8)", async () => {
    getDefaultPaymentMethod.mockResolvedValue(null)
    getUsers.mockResolvedValue([{ id: "admin-1", role: "admin" }])
    updateRenewalAttempt.mockImplementation(async (id: string, patch: Record<string, unknown>) => {
      if (patch.status === "skipped") throw new Error("db down")
      return { id, ...patch }
    })
    const { attemptPackRenewal } = await import("@/lib/services/pack-renewal")
    const out = await attemptPackRenewal(pack() as never)

    expect(out).toEqual({ renewed: false, reason: "no_card", newPackageId: "pack-2" })
    expect(sendPackPaymentLinkEmail).toHaveBeenCalled()
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ user_id: "admin-1" }))
  })

  it("still sends the payment link and notifies admins when updateRenewalAttempt fails on the decline status update (M8)", async () => {
    chargeSavedCard.mockResolvedValue({ ok: false, reason: "declined", message: "card_declined" })
    getUsers.mockResolvedValue([{ id: "admin-1", role: "admin" }])
    updateRenewalAttempt.mockImplementation(async (id: string, patch: Record<string, unknown>) => {
      if (patch.status === "failed" || patch.new_package_id != null) throw new Error("db down")
      return { id, ...patch }
    })
    const { attemptPackRenewal } = await import("@/lib/services/pack-renewal")
    const out = await attemptPackRenewal(pack() as never)

    expect(out.renewed).toBe(false)
    expect(out.reason).toBe("declined")
    expect(sendPackPaymentLinkEmail).toHaveBeenCalled()
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ user_id: "admin-1" }))
  })

  it("does NOT mint a second payment channel when the charge outcome is unknown (network/5xx error)", async () => {
    chargeSavedCard.mockResolvedValue({ ok: false, reason: "error", message: "stripe timeout" })
    getUsers.mockResolvedValue([{ id: "admin-1", role: "admin" }])
    const { attemptPackRenewal } = await import("@/lib/services/pack-renewal")
    const out = await attemptPackRenewal(pack() as never)

    expect(out).toEqual({ renewed: false, reason: "error" })
    expect(updateRenewalAttempt).toHaveBeenCalledWith(
      "att-1",
      expect.objectContaining({ status: "failed", failure_reason: "stripe timeout" }),
    )
    // The whole point: no fallback pack, no payment link — either would be a
    // second, unprotected payment channel on top of a charge that may have
    // already gone through.
    expect(createClientPackage).not.toHaveBeenCalled()
    expect(sendPackPaymentLinkEmail).not.toHaveBeenCalled()
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "admin-1", message: expect.stringContaining("unknown") }),
    )
  })

  it("addresses the fallback payment-link email to bill_to_email over the payer, and CCs the trainee", async () => {
    getDefaultPaymentMethod.mockResolvedValue(null) // no card -> fallback path
    // id-aware, so the CC assertion below proves the TRAINEE's email is used,
    // not a value that only looks right because payer and trainee share a mock.
    getUserById.mockImplementation(async (id: string) =>
      id === "payer-1"
        ? { id: "payer-1", email: "payer@x.com", first_name: "Pat", stripe_customer_id: "cus_payer" }
        : { id: "u1", email: "trainee@x.com", first_name: "Sam", last_name: "R", stripe_customer_id: "cus_trainee" },
    )
    const { attemptPackRenewal } = await import("@/lib/services/pack-renewal")
    await attemptPackRenewal(pack({ bill_to_email: "mom@example.com" }) as never)

    expect(sendPackPaymentLinkEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "mom@example.com", ccClientEmail: "trainee@x.com" }),
    )
  })

  it("flags the attempt without claiming a pack exists when createClientPackage itself fails", async () => {
    chargeSavedCard.mockResolvedValue({ ok: true, paymentIntentId: "pi_1" })
    createClientPackage.mockRejectedValueOnce(new Error("db down"))
    getUsers.mockResolvedValue([{ id: "admin-1", role: "admin" }])
    const { attemptPackRenewal } = await import("@/lib/services/pack-renewal")
    const out = await attemptPackRenewal(pack() as never)

    expect(out).toEqual({ renewed: false, reason: "post_charge_write_failed" })
    expect(updateRenewalAttempt).toHaveBeenCalledWith(
      "att-1",
      expect.objectContaining({ status: "failed", stripe_payment_intent_id: "pi_1", new_package_id: null }),
    )
    const message = createNotification.mock.calls.find((c) => c[0].user_id === "admin-1")?.[0].message
    expect(message).toContain("Create and credit the pack manually")
    // No pack was created — the message must NOT claim one exists (that would
    // send an admin looking for a pack-2 that was never made).
    expect(message).not.toContain("WAS created")
    expect(sendPackRenewedEmail).not.toHaveBeenCalled()
  })

  it("names the pack id and warns against a duplicate when the pack WAS created but the attempt record update fails", async () => {
    chargeSavedCard.mockResolvedValue({ ok: true, paymentIntentId: "pi_1" })
    getUsers.mockResolvedValue([{ id: "admin-1", role: "admin" }])
    // createClientPackage succeeds (default mock: { id: "pack-2" }); only the
    // SUCCEEDED-status attempt update fails — the "failed"-status recovery
    // update in the catch block must still go through so we can assert on it.
    updateRenewalAttempt.mockImplementation(async (id: string, patch: Record<string, unknown>) => {
      if (patch.status === "succeeded") throw new Error("attempt update db down")
      return { id, ...patch }
    })
    const { attemptPackRenewal } = await import("@/lib/services/pack-renewal")
    const out = await attemptPackRenewal(pack() as never)

    expect(out).toEqual({ renewed: false, reason: "post_charge_write_failed" })
    expect(updateRenewalAttempt).toHaveBeenCalledWith(
      "att-1",
      expect.objectContaining({ status: "failed", stripe_payment_intent_id: "pi_1", new_package_id: "pack-2" }),
    )
    const message = createNotification.mock.calls.find((c) => c[0].user_id === "admin-1")?.[0].message
    expect(message).toContain("pack-2")
    expect(message).toContain("WAS created")
    expect(message).toContain("Do NOT create another pack")
    expect(sendPackRenewedEmail).not.toHaveBeenCalled()
  })

  it("does not fail the money path when the receipt email rejects", async () => {
    chargeSavedCard.mockResolvedValue({ ok: true, paymentIntentId: "pi_1" })
    sendPackRenewedEmail.mockRejectedValue(new Error("resend down"))
    const { attemptPackRenewal } = await import("@/lib/services/pack-renewal")
    const out = await attemptPackRenewal(pack() as never)

    expect(out).toEqual({ renewed: true, newPackageId: "pack-2" })
  })

  it("charges the household payer's card but records the trainee as the user", async () => {
    chargeSavedCard.mockResolvedValue({ ok: true, paymentIntentId: "pi_1" })
    // id-aware: a stub that returns the SAME object regardless of id can't
    // detect the implementation reading stripe_customer_id off the wrong user.
    getUserById.mockImplementation(async (id: string) =>
      id === "payer-1"
        ? { id: "payer-1", email: "payer@x.com", first_name: "Pat", stripe_customer_id: "cus_payer" }
        : { id: "u1", email: "trainee@x.com", first_name: "Sam", last_name: "R", stripe_customer_id: "cus_trainee" },
    )
    const { attemptPackRenewal } = await import("@/lib/services/pack-renewal")
    await attemptPackRenewal(pack() as never)

    expect(getDefaultPaymentMethod).toHaveBeenCalledWith("payer-1")
    expect(createRenewalAttemptIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "u1", billing_user_id: "payer-1" }),
    )
    // The card charged must be the PAYER's, never the trainee's.
    expect(chargeSavedCard).toHaveBeenCalledWith(expect.objectContaining({ customerId: "cus_payer" }))
    // cc-dedup: trainee's email differs from the payer's, so it shows up as CC.
    expect(sendPackRenewedEmail).toHaveBeenCalledWith(expect.objectContaining({ ccClientEmail: "trainee@x.com" }))
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
