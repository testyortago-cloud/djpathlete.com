import { describe, it, expect, vi, beforeEach } from "vitest"

const verifyMock = vi.fn()
const getSignupByIdMock = vi.fn()
const confirmSignupMock = vi.fn()
const cancelSignupMock = vi.fn()
const getEventByIdMock = vi.fn()
const getSignupByPiMock = vi.fn()
const getSignupTenantByIdMock = vi.fn()
const updateSignupMock = vi.fn((..._args: unknown[]) => undefined)

const refundsCreateMock = vi.fn(async () => ({ id: "re_test_1" }))
vi.mock("@/lib/stripe", () => ({
  verifyWebhookSignature: (...a: unknown[]) => verifyMock(...a),
  stripe: { refunds: { create: (...a: unknown[]) => refundsCreateMock(...(a as [])) } },
  resolveSessionPaymentIntent: vi.fn(async () => null),
}))
vi.mock("@/lib/db/event-signups", () => ({
  getSignupById: (...a: unknown[]) => getSignupByIdMock(...a),
  confirmSignup: (...a: unknown[]) => confirmSignupMock(...a),
  cancelSignup: (...a: unknown[]) => cancelSignupMock(...a),
  getEventSignupByPaymentIntent: (...a: unknown[]) => getSignupByPiMock(...a),
  getSignupTenantById: (...a: unknown[]) => getSignupTenantByIdMock(...a),
}))
vi.mock("@/lib/db/events", () => ({ getEventById: (...a: unknown[]) => getEventByIdMock(...a) }))
vi.mock("@/lib/email", () => ({
  sendEventSignupConfirmedEmail: vi.fn(async () => undefined),
  sendEventSignupOverbookRefundEmail: vi.fn(async () => undefined),
  sendCoachPurchaseNotification: vi.fn(async () => undefined),
}))
// A chainable, awaitable `.eq()` stand-in — the real Supabase query builder
// stays chainable across any number of `.eq()` calls and only resolves when
// awaited, and the webhook now writes `.eq("id", ...).eq("business_id", ...)`
// rather than a single `.eq()`. Each `.eq()` call is recorded on
// `updateSignupMock` so existing `toHaveBeenCalled()` assertions still see it.
type EqChain = PromiseLike<undefined> & { eq: (...args: unknown[]) => EqChain }
function chainableEq(): EqChain {
  // A real Promise carries a `.then` that already matches `PromiseLike`
  // exactly; `.eq` is bolted on rather than reimplemented, so no method
  // signature has to be restated by hand.
  const chain = Promise.resolve(undefined) as unknown as EqChain
  chain.eq = (...args: unknown[]) => {
    updateSignupMock(...args)
    return chainableEq()
  }
  return chain
}
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      update: () => ({
        eq: (...args: unknown[]) => {
          updateSignupMock(...args)
          return chainableEq()
        },
      }),
    }),
  }),
}))
// Stub modules the existing webhook imports for program flow
vi.mock("@/lib/db/payments", () => ({
  createPayment: vi.fn(),
  getPaymentByStripeId: vi.fn(),
  updatePayment: vi.fn(),
}))
vi.mock("@/lib/db/assignments", () => ({
  createAssignment: vi.fn(),
  getAssignmentByUserAndProgram: vi.fn(),
  updateAssignment: vi.fn(),
}))
vi.mock("@/lib/db/week-access", () => ({
  updateWeekAccess: vi.fn(),
  createWeekAccessBulk: vi.fn(),
}))
vi.mock("@/lib/db/subscriptions", () => ({
  createSubscription: vi.fn(),
  getSubscriptionByStripeId: vi.fn(),
  updateSubscriptionByStripeId: vi.fn(),
}))
vi.mock("@/lib/db/users", () => ({ getUserById: vi.fn() }))
vi.mock("@/lib/db/client-profiles", () => ({ getProfileByUserId: vi.fn() }))
vi.mock("@/lib/db/programs", () => ({ getProgramById: vi.fn() }))
vi.mock("@/lib/ghl", () => ({ ghlCreateContact: vi.fn(), ghlTriggerWorkflow: vi.fn() }))

function makeReq(body: string = "{}") {
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "test_sig" },
    body,
  })
}

describe("Stripe webhook — event_signup branches", () => {
  beforeEach(async () => {
    verifyMock.mockReset()
    getSignupByIdMock.mockReset()
    confirmSignupMock.mockReset()
    cancelSignupMock.mockReset()
    getEventByIdMock.mockReset()
    getSignupByPiMock.mockReset()
    getSignupTenantByIdMock.mockReset()
    updateSignupMock.mockClear()
    refundsCreateMock.mockClear()
    // Sentinel, distinct from the public ("host-biz") and admin ("admin-biz")
    // boundary tenants used elsewhere in this phase's tests — the webhook's
    // tenant comes from the SIGNUP ROW, not either boundary, and this value
    // makes a test that reads the tenant from the wrong source fail rather
    // than pass by accident.
    getSignupTenantByIdMock.mockResolvedValue("row-biz")
    const { sendEventSignupConfirmedEmail, sendEventSignupOverbookRefundEmail } = await import("@/lib/email")
    vi.mocked(sendEventSignupConfirmedEmail).mockClear()
    vi.mocked(sendEventSignupOverbookRefundEmail).mockClear()
  })

  it("confirms the signup under the signup ROW's own business, not a boundary tenant", async () => {
    verifyMock.mockReturnValueOnce({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { type: "event_signup", event_signup_id: "sig-1", event_id: "evt-1" },
          payment_intent: "pi_test_1",
          amount_total: 29900,
        },
      },
    })
    confirmSignupMock.mockResolvedValueOnce({ ok: true })
    getSignupByIdMock.mockResolvedValueOnce({ id: "sig-1", parent_email: "a@x.com", status: "confirmed" })
    getEventByIdMock.mockResolvedValueOnce({ id: "evt-1", title: "Camp", type: "camp", slug: "c", start_date: "" })

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const { sendEventSignupConfirmedEmail } = await import("@/lib/email")
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    // MUTANT: reading the tenant from anywhere but the row (e.g. hard-coding
    // the platform id). getSignupTenantById is keyed on the metadata id
    // alone — see the doc comment on it in lib/db/event-signups.ts.
    expect(getSignupTenantByIdMock).toHaveBeenCalledWith("sig-1")
    expect(confirmSignupMock).toHaveBeenCalledWith("row-biz", "sig-1")
    expect(getSignupByIdMock).toHaveBeenCalledWith("row-biz", "sig-1")
    expect(getEventByIdMock).toHaveBeenCalledWith("row-biz", "evt-1")
    // The stripe_payment_intent_id write is scoped by business_id too, not
    // only by signup id — deleting this predicate would let the write reach
    // a same-id row belonging to a different tenant.
    expect(updateSignupMock).toHaveBeenCalledWith("business_id", "row-biz")
    expect(sendEventSignupConfirmedEmail).toHaveBeenCalled()
  })

  it("no signup row for the metadata id: does not confirm, and drops the event quietly", async () => {
    // The signup was never created (or the id is bogus) — `getSignupTenantById`
    // returns null, and the handler must not call `confirmSignup` with no
    // tenant to scope it by.
    verifyMock.mockReturnValueOnce({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { type: "event_signup", event_signup_id: "sig-ghost", event_id: "evt-1" },
          payment_intent: "pi_ghost",
          amount_total: 1000,
        },
      },
    })
    getSignupTenantByIdMock.mockResolvedValueOnce(null)

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(confirmSignupMock).not.toHaveBeenCalled()
  })

  it("checkout.session.completed without event_signup metadata does not invoke event handlers", async () => {
    verifyMock.mockReturnValueOnce({
      type: "checkout.session.completed",
      data: { object: { mode: "payment", metadata: {}, payment_intent: "pi_x" } },
    })
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const { sendEventSignupConfirmedEmail } = await import("@/lib/email")
    const res = await POST(makeReq())
    expect(confirmSignupMock).not.toHaveBeenCalled()
    expect(sendEventSignupConfirmedEmail).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
  })

  it("idempotent: confirmSignup returning not_pending does not throw and does not send email", async () => {
    verifyMock.mockReturnValueOnce({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { type: "event_signup", event_signup_id: "sig-1", event_id: "evt-1" },
          payment_intent: "pi_x",
          amount_total: 29900,
        },
      },
    })
    confirmSignupMock.mockResolvedValueOnce({ ok: false, reason: "not_pending" })
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const { sendEventSignupConfirmedEmail } = await import("@/lib/email")
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(sendEventSignupConfirmedEmail).not.toHaveBeenCalled()
  })

  it("at_capacity race after payment triggers refund + apology email + status=refunded", async () => {
    verifyMock.mockReturnValueOnce({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { type: "event_signup", event_signup_id: "sig-loser", event_id: "evt-1" },
          payment_intent: "pi_race_loser",
          amount_total: 500,
        },
      },
    })
    confirmSignupMock.mockResolvedValueOnce({ ok: false, reason: "at_capacity" })
    getSignupByIdMock.mockResolvedValueOnce({
      id: "sig-loser",
      parent_email: "a@x.com",
      parent_name: "A",
      athlete_name: "S",
      status: "refunded",
    })
    getEventByIdMock.mockResolvedValueOnce({
      id: "evt-1",
      title: "Camp",
      type: "camp",
      slug: "c",
      start_date: "",
    })

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const { sendEventSignupOverbookRefundEmail, sendEventSignupConfirmedEmail } = await import("@/lib/email")
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    // The race is DETECTED under the same row tenant confirmSignup was called
    // with — there is no second, independently-resolved businessId anywhere
    // in this flow.
    expect(confirmSignupMock).toHaveBeenCalledWith("row-biz", "sig-loser")
    expect(refundsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_race_loser" }),
    )
    expect(updateSignupMock).toHaveBeenCalled()
    // The refund-status write is scoped by business_id too — the same
    // predicate that closes the confirm-path leak above.
    expect(updateSignupMock).toHaveBeenCalledWith("business_id", "row-biz")
    expect(getSignupByIdMock).toHaveBeenCalledWith("row-biz", "sig-loser")
    expect(getEventByIdMock).toHaveBeenCalledWith("row-biz", "evt-1")
    expect(sendEventSignupOverbookRefundEmail).toHaveBeenCalled()
    expect(sendEventSignupConfirmedEmail).not.toHaveBeenCalled()
  })

  it("charge.refunded matching an event signup flips status to refunded, under the ROW's own tenant", async () => {
    verifyMock.mockReturnValueOnce({
      type: "charge.refunded",
      data: { object: { payment_intent: "pi_test_1" } },
    })
    // `getEventSignupByPaymentIntent` is the unscoped reader; the row it
    // returns carries `business_id`, and that value — not a boundary tenant —
    // is what every write and lookup after it must use.
    getSignupByPiMock.mockResolvedValueOnce({ id: "sig-1", status: "confirmed", business_id: "row-biz" })
    cancelSignupMock.mockResolvedValueOnce({ ok: true })

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    // MUTANT: hard-coding the platform id, or swapping (id, businessId).
    expect(cancelSignupMock).toHaveBeenCalledWith("row-biz", "sig-1")
    expect(updateSignupMock).toHaveBeenCalled()
    // The status=refunded write is scoped by business_id too.
    expect(updateSignupMock).toHaveBeenCalledWith("business_id", "row-biz")
  })
})
