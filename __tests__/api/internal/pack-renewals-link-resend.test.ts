import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ClientPackage } from "@/types/database"

// Its own file, like pack-renewals-sweep.test.ts: the older suites' mock
// factories deliberately stay minimal so they keep testing exactly what they
// tested before. This one exercises the expired-payment-link re-send pass.
const isCronSkippedMock = vi.fn()
const listActivePackagesMock = vi.fn()
const updateClientPackageMock = vi.fn()
const listDepletedAutoRenewPackagesMock = vi.fn()
const getUserByIdMock = vi.fn()
const getUsersMock = vi.fn()
const createNotificationMock = vi.fn()
const sendPackRenewalEmailMock = vi.fn()
const sendPackPaymentLinkEmailMock = vi.fn()
const attemptPackRenewalMock = vi.fn()
const packAutoRenewEnabledMock = vi.fn()
const packAutoRenewMaxAgeDaysMock = vi.fn()
const countStalePendingRenewalAttemptsMock = vi.fn()
const countRenewalsAwaitingPaymentMock = vi.fn()
const listRenewalsAwaitingPaymentMock = vi.fn()
const resolvePackPaymentLinkMock = vi.fn()
const resolveBillingUserIdMock = vi.fn()
const packLinkResendEnabledMock = vi.fn()
const packLinkResendMaxMock = vi.fn()

vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped: (...a: unknown[]) => isCronSkippedMock(...a) }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => ({}) }))
vi.mock("@/lib/db/client-packages", () => ({
  listActivePackages: (...a: unknown[]) => listActivePackagesMock(...a),
  updateClientPackage: (...a: unknown[]) => updateClientPackageMock(...a),
  listDepletedAutoRenewPackages: (...a: unknown[]) => listDepletedAutoRenewPackagesMock(...a),
}))
vi.mock("@/lib/db/pack-renewal-attempts", () => ({
  countStalePendingRenewalAttempts: (...a: unknown[]) => countStalePendingRenewalAttemptsMock(...a),
  countRenewalsAwaitingPayment: (...a: unknown[]) => countRenewalsAwaitingPaymentMock(...a),
  listRenewalsAwaitingPayment: (...a: unknown[]) => listRenewalsAwaitingPaymentMock(...a),
}))
vi.mock("@/lib/db/users", () => ({
  getUserById: (...a: unknown[]) => getUserByIdMock(...a),
  getUsers: (...a: unknown[]) => getUsersMock(...a),
}))
vi.mock("@/lib/db/notifications", () => ({ createNotification: (...a: unknown[]) => createNotificationMock(...a) }))
vi.mock("@/lib/email", () => ({
  sendPackRenewalEmail: (...a: unknown[]) => sendPackRenewalEmailMock(...a),
  sendPackAutoRenewWarningEmail: vi.fn(),
  sendPackPaymentLinkEmail: (...a: unknown[]) => sendPackPaymentLinkEmailMock(...a),
}))
vi.mock("@/lib/services/pack-renewal", () => ({
  attemptPackRenewal: (...a: unknown[]) => attemptPackRenewalMock(...a),
}))
vi.mock("@/lib/services/pack-payment-link", () => ({
  resolvePackPaymentLink: (...a: unknown[]) => resolvePackPaymentLinkMock(...a),
}))
vi.mock("@/lib/services/billing-payer", () => ({
  resolveBillingUserId: (...a: unknown[]) => resolveBillingUserIdMock(...a),
}))
vi.mock("@/lib/db/payment-methods", () => ({ getDefaultPaymentMethod: vi.fn() }))
vi.mock("@/lib/packs/flags", () => ({
  PACK_RENEWALS_CRON_KEY: "cron_pack_renewals_enabled",
  packReminderLowAt: async () => 2,
  packReminderExpiryDays: async () => 7,
  packAutoRenewEnabled: (...a: unknown[]) => packAutoRenewEnabledMock(...a),
  packAutoRenewMaxAgeDays: (...a: unknown[]) => packAutoRenewMaxAgeDaysMock(...a),
  packLinkResendEnabled: (...a: unknown[]) => packLinkResendEnabledMock(...a),
  packLinkResendMax: (...a: unknown[]) => packLinkResendMaxMock(...a),
}))

import { POST } from "@/app/api/admin/internal/pack-renewals/route"

/** Sirisha's real shape: a pending, active replacement pack billed to a parent. */
function pendingPack(p: Partial<ClientPackage> = {}): ClientPackage {
  return {
    id: "pack-1",
    client_user_id: "trainee-1",
    product_id: null,
    session_type: "training",
    credits_total: 10,
    credits_used: 1,
    price_cents: 150000,
    payment_method: "stripe",
    payment_status: "pending",
    stripe_session_id: "cs_live_dead",
    stripe_payment_id: null,
    purchased_at: "2026-09-15T10:05:00Z",
    expires_at: null,
    status: "active",
    last_reminded_threshold: null,
    notes: null,
    bill_to_email: "payer@example.com",
    bill_to_emailed_at: null,
    auto_renew: true,
    renewed_from_package_id: "pack-0",
    renewal_attempted_at: null,
    payment_link_resent_count: 0,
    payment_link_resent_at: null,
    created_by: null,
    created_at: "",
    updated_at: "",
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
  isCronSkippedMock.mockResolvedValue({ skipped: true, reason: "off" })
  listActivePackagesMock.mockResolvedValue([])
  getUsersMock.mockResolvedValue([])
  packAutoRenewEnabledMock.mockResolvedValue(false)
  packAutoRenewMaxAgeDaysMock.mockResolvedValue(7)
  listDepletedAutoRenewPackagesMock.mockResolvedValue([])
  countStalePendingRenewalAttemptsMock.mockResolvedValue(0)
  countRenewalsAwaitingPaymentMock.mockResolvedValue(0)
  listRenewalsAwaitingPaymentMock.mockResolvedValue([])
  packLinkResendEnabledMock.mockResolvedValue(true)
  packLinkResendMaxMock.mockResolvedValue(3)
  resolveBillingUserIdMock.mockResolvedValue("payer-1")
  getUserByIdMock.mockImplementation(async (id: string) =>
    id === "payer-1"
      ? { id: "payer-1", email: "payer@example.com", first_name: "Sandeep", last_name: "P" }
      : { id: "trainee-1", email: "athlete@example.com", first_name: "Sirisha", last_name: "C" },
  )
  updateClientPackageMock.mockResolvedValue({})
  sendPackPaymentLinkEmailMock.mockResolvedValue(undefined)
})

describe("POST /api/admin/internal/pack-renewals — expired payment-link re-send", () => {
  it("re-mints and re-emails when the link came back refreshed", async () => {
    listRenewalsAwaitingPaymentMock.mockResolvedValue([pendingPack()])
    resolvePackPaymentLinkMock.mockResolvedValue({ ok: true, url: "https://pay/new", refreshed: true })

    const res = await POST(req())
    const json = await res.json()

    expect(json.linksResent).toBe(1)
    expect(json.linkResendsFailed).toBe(0)
    expect(sendPackPaymentLinkEmailMock).toHaveBeenCalledTimes(1)
    const sent = sendPackPaymentLinkEmailMock.mock.calls[0][0]
    expect(sent.url).toBe("https://pay/new")
    expect(sent.to).toBe("payer@example.com")
    expect(sent.ccClientEmail).toBe("athlete@example.com")
    expect(sent.amountCents).toBe(150000)
  })

  it("sends nothing when the existing link is still open", async () => {
    listRenewalsAwaitingPaymentMock.mockResolvedValue([pendingPack()])
    resolvePackPaymentLinkMock.mockResolvedValue({ ok: true, url: "https://pay/old", refreshed: false })

    const res = await POST(req())
    const json = await res.json()

    expect(json.linksResent).toBe(0)
    expect(sendPackPaymentLinkEmailMock).not.toHaveBeenCalled()
    // Control: the pass DID run and reach Stripe — an untouched mailer would
    // look identical if the whole block had been skipped.
    expect(resolvePackPaymentLinkMock).toHaveBeenCalledTimes(1)
    expect(updateClientPackageMock).not.toHaveBeenCalled()
  })

  it("sends nothing and stamps nothing when Stripe could not be read", async () => {
    listRenewalsAwaitingPaymentMock.mockResolvedValue([pendingPack()])
    // `refreshed: true` is deliberately impossible for a not-ok result — the
    // union has no such field. It is here to ISOLATE the ok-guard: with a bare
    // { ok: false } the refreshed-guard below it also stops execution, so
    // deleting either one leaves this test green and neither is pinned. A
    // mutation sweep proved exactly that before this line was added.
    resolvePackPaymentLinkMock.mockResolvedValue({
      ok: false,
      status: 502,
      error: "stripe down",
      refreshed: true,
    })

    const res = await POST(req())
    const json = await res.json()

    expect(json.linksResent).toBe(0)
    expect(json.linkResendsFailed).toBe(0)
    expect(sendPackPaymentLinkEmailMock).not.toHaveBeenCalled()
    expect(updateClientPackageMock).not.toHaveBeenCalled()
    expect(resolvePackPaymentLinkMock).toHaveBeenCalledTimes(1)
  })

  it("stamps the count and the timestamp BEFORE emailing", async () => {
    listRenewalsAwaitingPaymentMock.mockResolvedValue([pendingPack({ payment_link_resent_count: 1 })])
    resolvePackPaymentLinkMock.mockResolvedValue({ ok: true, url: "https://pay/new", refreshed: true })
    const order: string[] = []
    updateClientPackageMock.mockImplementation(async () => {
      order.push("stamp")
    })
    sendPackPaymentLinkEmailMock.mockImplementation(async () => {
      order.push("email")
    })

    await POST(req())

    expect(order).toEqual(["stamp", "email"])
    expect(updateClientPackageMock).toHaveBeenCalledWith("pack-1", {
      payment_link_resent_count: 2,
      payment_link_resent_at: expect.any(String),
    })
  })

  it("does not email when the stamp fails, so an old schema costs one inert deploy not daily spam", async () => {
    listRenewalsAwaitingPaymentMock.mockResolvedValue([pendingPack()])
    resolvePackPaymentLinkMock.mockResolvedValue({ ok: true, url: "https://pay/new", refreshed: true })
    updateClientPackageMock.mockRejectedValue(new Error("column payment_link_resent_count does not exist"))

    const res = await POST(req())
    const json = await res.json()

    expect(sendPackPaymentLinkEmailMock).not.toHaveBeenCalled()
    expect(json.linksResent).toBe(0)
    expect(json.linkResendsFailed).toBe(1)
  })

  it("stops once the pack has spent its re-send budget", async () => {
    listRenewalsAwaitingPaymentMock.mockResolvedValue([pendingPack({ payment_link_resent_count: 3 })])
    resolvePackPaymentLinkMock.mockResolvedValue({ ok: true, url: "https://pay/new", refreshed: true })

    const res = await POST(req())
    const json = await res.json()

    expect(json.linksResent).toBe(0)
    // Never even asks Stripe — a spent pack costs no API call.
    expect(resolvePackPaymentLinkMock).not.toHaveBeenCalled()
    expect(sendPackPaymentLinkEmailMock).not.toHaveBeenCalled()
  })

  it("honours a re-send budget raised in settings", async () => {
    packLinkResendMaxMock.mockResolvedValue(5)
    listRenewalsAwaitingPaymentMock.mockResolvedValue([pendingPack({ payment_link_resent_count: 3 })])
    resolvePackPaymentLinkMock.mockResolvedValue({ ok: true, url: "https://pay/new", refreshed: true })

    const res = await POST(req())

    expect((await res.json()).linksResent).toBe(1)
  })

  it("holds a pack re-sent within the throttle", async () => {
    listRenewalsAwaitingPaymentMock.mockResolvedValue([
      pendingPack({ payment_link_resent_count: 1, payment_link_resent_at: new Date().toISOString() }),
    ])
    resolvePackPaymentLinkMock.mockResolvedValue({ ok: true, url: "https://pay/new", refreshed: true })

    const res = await POST(req())

    expect((await res.json()).linksResent).toBe(0)
    expect(resolvePackPaymentLinkMock).not.toHaveBeenCalled()
  })

  it("does nothing at all when the flag is off", async () => {
    packLinkResendEnabledMock.mockResolvedValue(false)
    listRenewalsAwaitingPaymentMock.mockResolvedValue([pendingPack()])
    resolvePackPaymentLinkMock.mockResolvedValue({ ok: true, url: "https://pay/new", refreshed: true })

    const res = await POST(req())

    expect((await res.json()).linksResent).toBe(0)
    expect(listRenewalsAwaitingPaymentMock).not.toHaveBeenCalled()
    expect(sendPackPaymentLinkEmailMock).not.toHaveBeenCalled()
  })

  it("emails the trainee when no parent is billed", async () => {
    listRenewalsAwaitingPaymentMock.mockResolvedValue([pendingPack({ bill_to_email: null })])
    resolvePackPaymentLinkMock.mockResolvedValue({ ok: true, url: "https://pay/new", refreshed: true })
    resolveBillingUserIdMock.mockResolvedValue("trainee-1")

    await POST(req())

    const sent = sendPackPaymentLinkEmailMock.mock.calls[0][0]
    expect(sent.to).toBe("athlete@example.com")
    // Nobody is cc'd on their own email.
    expect(sent.ccClientEmail).toBeNull()
  })

  it("keeps going after one pack throws", async () => {
    listRenewalsAwaitingPaymentMock.mockResolvedValue([pendingPack({ id: "bad" }), pendingPack({ id: "good" })])
    resolvePackPaymentLinkMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ ok: true, url: "https://pay/new", refreshed: true })

    const res = await POST(req())
    const json = await res.json()

    expect(json.linkResendsFailed).toBe(1)
    expect(json.linksResent).toBe(1)
  })

  it("does not take the rest of the cron down when the whole pass throws", async () => {
    listRenewalsAwaitingPaymentMock.mockRejectedValue(new Error("db gone"))
    countRenewalsAwaitingPaymentMock.mockResolvedValue(2)

    const res = await POST(req())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.linksResent).toBe(0)
    // Control: the OLDER watch still ran and still reported.
    expect(json.renewalsAwaitingPayment).toBe(2)
  })
})
