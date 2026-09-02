// @vitest-environment node
//
// Pinned to node (Full Engine phase 2): these suites drive route handlers with
// Request/Response and never touch a DOM, and every jsdom suite in this repo
// currently fails to start (ERR_REQUIRE_ESM in html-encoding-sniffer). Without
// this line the file reports "no tests" rather than red.
import { describe, it, expect, vi, beforeEach } from "vitest"

// ─── Shared mocks: lib/db/contacts + lib/db/sequences + lib/db/pipeline ─────
//
// Both webhooks (Stripe checkout completion, GHL booking) resolve a contact
// once and hand it to two consumers: exitRunsForContact (Stage 1b) and
// applyPipelineEvent (Stage 1c, Task 4). This file only tests the wiring —
// that each webhook translates its own payload into the right contactId +
// PipelineEvent and calls applyPipelineEvent inside the same never-rethrow
// catch as exitRunsForContact. What applyPipelineEvent itself decides to do
// with that event (create/advance/close/refuse) is decideMove's job and is
// covered by __tests__/lib/lead-engine/pipeline-move.test.ts.

const findContactByIdentifiersMock = vi.fn(async (..._a: any[]) => null as string | null)
const exitRunsForContactMock = vi.fn(async (..._a: any[]) => 0)
const applyPipelineEventMock = vi.fn(async (..._a: any[]) => ({
  decision: { kind: "noop", reason: "test" } as const,
  opportunityId: null as string | null,
}))

vi.mock("@/lib/db/contacts", () => ({
  findContactByIdentifiers: (...a: unknown[]) => findContactByIdentifiersMock(...a),
}))
vi.mock("@/lib/db/sequences", () => ({
  exitRunsForContact: (...a: unknown[]) => exitRunsForContactMock(...a),
}))
vi.mock("@/lib/db/pipeline", () => ({
  applyPipelineEvent: (...a: unknown[]) => applyPipelineEventMock(...a),
}))

// ─── Stripe webhook — checkout.session.completed ─────────────────────────────

const verifyMock = vi.fn()
const createPaymentMock = vi.fn(async (..._a: any[]) => ({ id: "pay-1" }))
const getPaymentByStripeIdMock = vi.fn(async (..._a: any[]) => null as any)
const getUserByEmailMock = vi.fn(async (..._a: any[]) => null as any)

vi.mock("@/lib/stripe", () => ({
  verifyWebhookSignature: (...a: unknown[]) => verifyMock(...a),
  resolveSessionPaymentIntent: vi.fn(
    async (session: { payment_intent?: string | null }) => session.payment_intent ?? null,
  ),
}))
vi.mock("@/lib/db/payments", () => ({
  createPayment: (...a: unknown[]) => createPaymentMock(...a),
  getPaymentByStripeId: (...a: unknown[]) => getPaymentByStripeIdMock(...a),
  updatePayment: vi.fn(),
}))
vi.mock("@/lib/db/subscriptions", () => ({
  createSubscription: vi.fn(async () => ({ id: "sub-1" })),
  getSubscriptionByStripeId: vi.fn(async () => null),
  updateSubscriptionByStripeId: vi.fn(),
}))
vi.mock("@/lib/db/users", () => ({
  getUserByEmail: (...a: unknown[]) => getUserByEmailMock(...a),
  getUserById: vi.fn(),
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
vi.mock("@/lib/db/client-profiles", () => ({ getProfileByUserId: vi.fn() }))
vi.mock("@/lib/db/programs", () => ({ getProgramById: vi.fn() }))
vi.mock("@/lib/db/event-signups", () => ({
  confirmSignup: vi.fn(),
  cancelSignup: vi.fn(),
  getSignupById: vi.fn(),
  getEventSignupByPaymentIntent: vi.fn(),
}))
vi.mock("@/lib/db/events", () => ({ getEventById: vi.fn() }))
vi.mock("@/lib/email", () => ({
  sendCoachPurchaseNotification: vi.fn(),
  sendEventSignupConfirmedEmail: vi.fn(),
  sendEventSignupOverbookRefundEmail: vi.fn(),
}))
vi.mock("@/lib/ghl", () => ({ ghlCreateContact: vi.fn(), ghlTriggerWorkflow: vi.fn() }))

// Isolates the fix-round-1 tests below (a shop_order / save_card checkout
// must not win a card) from the real handleShopOrderCheckout's DB chain —
// which is untouched by this file's other mocks and would 500 the route.
// handleSaveCardCheckout needs no equivalent mock: it returns immediately
// when session.metadata.userId is absent, which the fixture below omits.
const handleShopOrderCheckoutMock = vi.fn(async (..._a: any[]) => undefined)
vi.mock("@/lib/shop/webhooks", () => ({
  handleShopOrderCheckout: (...a: unknown[]) => handleShopOrderCheckoutMock(...a),
}))

// One shared "@/lib/supabase" mock services both route files under test in
// this one file: the Stripe route only ever hits the generic update().eq()
// shape below (event_signups status updates etc., all bypassed by the
// external/no-metadata session shape used here); the booking route needs the
// richer bookings/users/notifications shapes, set up per-test below.
let bookingsSelectMaybeSingle: ReturnType<typeof vi.fn>
let bookingsInsert: ReturnType<typeof vi.fn>
let bookingsUpdateEq: ReturnType<typeof vi.fn>

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "bookings") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: bookingsSelectMaybeSingle }) }),
          update: () => ({ eq: bookingsUpdateEq }),
          insert: bookingsInsert,
        }
      }
      if (table === "users") {
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }
      }
      if (table === "notifications") {
        return { insert: vi.fn(async () => ({ data: null, error: null })) }
      }
      // Stripe webhook path (event_signups status updates etc.)
      return {
        update: () => ({ eq: vi.fn(async () => undefined) }),
      }
    },
  }),
}))

vi.mock("@/lib/db/marketing-attribution", () => ({
  findAttributionByEmail: vi.fn(async () => null),
  upsertAttributionBySession: vi.fn(),
  getUnclaimedAttribution: vi.fn(),
  claimAttribution: vi.fn(),
}))
vi.mock("@/lib/ads/conversions", () => ({
  enqueueBookingConversion: vi.fn(async () => null),
  enqueuePaymentValueAdjustmentByEmail: vi.fn(async () => null),
}))

function makeStripeReq(body = "{}") {
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "test_sig" },
    body,
  })
}

function stripeEvent(overrides: Record<string, any> = {}) {
  return {
    type: "checkout.session.completed",
    data: {
      object: {
        mode: "payment",
        metadata: {},
        payment_intent: "pi_test_1",
        customer: "cus_test_1",
        customer_details: { email: "lead@example.com" },
        amount_total: 5000,
        currency: "usd",
        id: "cs_test_1",
        ...overrides,
      },
    },
  }
}

describe("Stripe webhook — pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyMock.mockReset()
    createPaymentMock.mockClear()
    getPaymentByStripeIdMock.mockReset().mockResolvedValue(null)
    getUserByEmailMock.mockReset().mockResolvedValue(null)
    findContactByIdentifiersMock.mockReset().mockResolvedValue(null)
    exitRunsForContactMock.mockReset().mockResolvedValue(0)
    applyPipelineEventMock
      .mockReset()
      .mockResolvedValue({ decision: { kind: "noop", reason: "test" }, opportunityId: null })
  })

  it("wins the card on checkout.session.completed, with the session amount", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce("contact-pay-1")
    verifyMock.mockReturnValueOnce(stripeEvent({ amount_total: 12500 }))

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeStripeReq())

    expect(res.status).toBe(200)
    expect(applyPipelineEventMock).toHaveBeenCalledWith({
      contactId: "contact-pay-1",
      event: { kind: "payment", amountCents: 12500, currency: "usd", occurredAt: expect.any(Date) },
      metadata: { stripe_session_id: "cs_test_1" },
    })
  })

  it("passes the session currency through", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce("contact-pay-2")
    verifyMock.mockReturnValueOnce(stripeEvent({ currency: "eur" }))

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeStripeReq())

    expect(res.status).toBe(200)
    expect(applyPipelineEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: "contact-pay-2",
        event: expect.objectContaining({ kind: "payment", currency: "eur" }),
        metadata: { stripe_session_id: "cs_test_1" },
      }),
    )
  })

  it("does not fail the webhook when applyPipelineEvent throws", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce("contact-pay-3")
    applyPipelineEventMock.mockRejectedValueOnce(new Error("board exploded"))
    verifyMock.mockReturnValueOnce(stripeEvent())
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeStripeReq())

    expect(res.status).toBe(200)
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  // Fix round 1, Finding 1: checkout.session.completed fires for every kind
  // of money this business takes, not only a coaching sale — applyPipelineEvent
  // must not win a card for the ones that aren't.
  it("exits sequences but does NOT win a card for a shop_order checkout", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce("contact-shop-1")
    verifyMock.mockReturnValueOnce(stripeEvent({ metadata: { type: "shop_order" } }))

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeStripeReq())

    expect(res.status).toBe(200)
    expect(exitRunsForContactMock).toHaveBeenCalledWith("contact-shop-1", "payment")
    expect(applyPipelineEventMock).not.toHaveBeenCalled()
    expect(handleShopOrderCheckoutMock).toHaveBeenCalled() // dispatch still runs — only the card is gated
  })

  it("exits sequences but does NOT win a card for a save_card checkout", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce("contact-savecard-1")
    // No session.metadata.userId — handleSaveCardCheckout returns immediately,
    // so this test needs no mock for it (see the module-level comment above).
    verifyMock.mockReturnValueOnce(stripeEvent({ metadata: { type: "save_card" }, amount_total: 0 }))

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeStripeReq())

    expect(res.status).toBe(200)
    expect(exitRunsForContactMock).toHaveBeenCalledWith("contact-savecard-1", "payment")
    expect(applyPipelineEventMock).not.toHaveBeenCalled()
  })

  it("still wins the card for an ordinary coaching checkout (no exclusion type set)", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce("contact-coaching-1")
    verifyMock.mockReturnValueOnce(stripeEvent({ metadata: {}, amount_total: 30000 }))

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeStripeReq())

    expect(res.status).toBe(200)
    expect(exitRunsForContactMock).toHaveBeenCalledWith("contact-coaching-1", "payment")
    expect(applyPipelineEventMock).toHaveBeenCalledWith({
      contactId: "contact-coaching-1",
      event: { kind: "payment", amountCents: 30000, currency: "usd", occurredAt: expect.any(Date) },
      metadata: { stripe_session_id: "cs_test_1" },
    })
  })

  // ─── charge.refunded — pipeline (spec §14) ───────────────────────────────
  //
  // A refund reopens nothing — the Won card stays Won — but its value_cents
  // is corrected so §7's campaign-to-revenue report self-heals. What
  // decideMove actually computes (clamp, full vs partial reason,
  // idempotency) is covered by __tests__/lib/lead-engine/pipeline-move.test.ts
  // and __tests__/db/pipeline.test.ts; this file only owns the wiring: that
  // the webhook resolves a contact off the refunded payment and hands
  // applyPipelineEvent the right event/metadata shape.
  describe("charge.refunded — pipeline (spec §14)", () => {
    function chargeRefundedEvent(overrides: Record<string, any> = {}) {
      return {
        type: "charge.refunded",
        data: {
          object: {
            id: "ch_test_1",
            object: "charge",
            payment_intent: "pi_test_refund_1",
            amount_refunded: 10000,
            ...overrides,
          },
        },
      }
    }

    it("amends the Won card, resolving the contact from the payment's user_id", async () => {
      getPaymentByStripeIdMock.mockResolvedValueOnce({ id: "pay-1", user_id: "user-1" })
      findContactByIdentifiersMock.mockResolvedValueOnce("contact-refund-1")
      verifyMock.mockReturnValueOnce(chargeRefundedEvent({ amount_refunded: 15000 }))
      vi.spyOn(console, "error").mockImplementation(() => {})

      const { POST } = await import("@/app/api/stripe/webhook/route")
      const res = await POST(makeStripeReq())

      expect(res.status).toBe(200)
      expect(findContactByIdentifiersMock).toHaveBeenCalledWith({ userId: "user-1", email: null })
      expect(applyPipelineEventMock).toHaveBeenCalledWith({
        contactId: "contact-refund-1",
        event: { kind: "refund", amountRefundedCents: 15000, occurredAt: expect.any(Date) },
        metadata: { stripe_charge_id: "ch_test_1", amount_refunded: 15000 },
      })
    })

    // Fix round 1 (Critical): getPaymentByStripeId select("*")s with no type
    // check — the SAME `payments` table also carries event-ticket and
    // no-show-fee rows for a contact who may separately have a real Won
    // coaching deal. Without this gate, cancelling an unrelated event ticket
    // would subtract its refund from that contact's coaching value_cents.
    // Mirrors NON_COACHING_PAYMENT_TYPES, the reconciler's identical gate on
    // the identical `payments` join (lib/lead-engine/constants.ts) — one
    // shared denylist, not a third copy.
    it("does NOT amend a coaching card when the refunded payment is an event_signup ticket", async () => {
      getPaymentByStripeIdMock.mockResolvedValueOnce({
        id: "pay-ticket-1",
        user_id: "user-1",
        metadata: { type: "event_signup" },
      })
      findContactByIdentifiersMock.mockResolvedValueOnce("contact-refund-ticket")
      verifyMock.mockReturnValueOnce(chargeRefundedEvent())
      vi.spyOn(console, "error").mockImplementation(() => {})

      const { POST } = await import("@/app/api/stripe/webhook/route")
      const res = await POST(makeStripeReq())

      expect(res.status).toBe(200)
      expect(applyPipelineEventMock).not.toHaveBeenCalled()
    })

    it("does NOT amend a coaching card when the refunded payment is a session_fee penalty", async () => {
      getPaymentByStripeIdMock.mockResolvedValueOnce({
        id: "pay-fee-1",
        user_id: "user-1",
        metadata: { type: "session_fee" },
      })
      findContactByIdentifiersMock.mockResolvedValueOnce("contact-refund-fee")
      verifyMock.mockReturnValueOnce(chargeRefundedEvent())
      vi.spyOn(console, "error").mockImplementation(() => {})

      const { POST } = await import("@/app/api/stripe/webhook/route")
      const res = await POST(makeStripeReq())

      expect(res.status).toBe(200)
      expect(applyPipelineEventMock).not.toHaveBeenCalled()
    })

    // The denylist is a denylist, not an allowlist: a payment with no
    // `metadata.type` at all (or any type outside the non-coaching set) must
    // still amend — an unlabelled coaching payment must not go silently
    // unhandled.
    it("still amends an ordinary coaching refund whose payment carries no metadata.type", async () => {
      getPaymentByStripeIdMock.mockResolvedValueOnce({ id: "pay-coaching-1", user_id: "user-1", metadata: {} })
      findContactByIdentifiersMock.mockResolvedValueOnce("contact-refund-coaching")
      verifyMock.mockReturnValueOnce(chargeRefundedEvent({ amount_refunded: 5000 }))
      vi.spyOn(console, "error").mockImplementation(() => {})

      const { POST } = await import("@/app/api/stripe/webhook/route")
      const res = await POST(makeStripeReq())

      expect(res.status).toBe(200)
      expect(applyPipelineEventMock).toHaveBeenCalledWith({
        contactId: "contact-refund-coaching",
        event: { kind: "refund", amountRefundedCents: 5000, occurredAt: expect.any(Date) },
        metadata: { stripe_charge_id: "ch_test_1", amount_refunded: 5000 },
      })
    })

    it("does not call applyPipelineEvent when no payment resolves for the charge", async () => {
      getPaymentByStripeIdMock.mockResolvedValueOnce(null)
      verifyMock.mockReturnValueOnce(chargeRefundedEvent())
      vi.spyOn(console, "error").mockImplementation(() => {})

      const { POST } = await import("@/app/api/stripe/webhook/route")
      const res = await POST(makeStripeReq())

      expect(res.status).toBe(200)
      expect(applyPipelineEventMock).not.toHaveBeenCalled()
    })

    it("does not call applyPipelineEvent when no contact resolves from the payment", async () => {
      getPaymentByStripeIdMock.mockResolvedValueOnce({ id: "pay-1", user_id: null })
      findContactByIdentifiersMock.mockResolvedValueOnce(null)
      verifyMock.mockReturnValueOnce(chargeRefundedEvent())
      vi.spyOn(console, "error").mockImplementation(() => {})

      const { POST } = await import("@/app/api/stripe/webhook/route")
      const res = await POST(makeStripeReq())

      expect(res.status).toBe(200)
      expect(applyPipelineEventMock).not.toHaveBeenCalled()
    })

    it("does not fail the webhook when applyPipelineEvent throws for a refund", async () => {
      getPaymentByStripeIdMock.mockResolvedValueOnce({ id: "pay-1", user_id: "user-1" })
      findContactByIdentifiersMock.mockResolvedValueOnce("contact-refund-2")
      applyPipelineEventMock.mockRejectedValueOnce(new Error("board exploded"))
      verifyMock.mockReturnValueOnce(chargeRefundedEvent())
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

      const { POST } = await import("@/app/api/stripe/webhook/route")
      const res = await POST(makeStripeReq())

      expect(res.status).toBe(200)
      expect(consoleErrorSpy).toHaveBeenCalled()
      consoleErrorSpy.mockRestore()
    })
  })
})

// ─── GHL booking webhook ──────────────────────────────────────────────────────

function makeBookingReq(payload: unknown): Request {
  return new Request("http://localhost/api/webhooks/ghl-booking", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
}

describe("GHL booking webhook — pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.GHL_WEBHOOK_SECRET

    bookingsSelectMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    bookingsInsert = vi.fn().mockReturnValue({
      select: () => ({ single: vi.fn().mockResolvedValue({ data: { id: "bk-1" }, error: null }) }),
    })
    bookingsUpdateEq = vi.fn().mockResolvedValue({ error: null })

    findContactByIdentifiersMock.mockReset().mockResolvedValue(null)
    exitRunsForContactMock.mockReset().mockResolvedValue(0)
    applyPipelineEventMock
      .mockReset()
      .mockResolvedValue({ decision: { kind: "noop", reason: "test" }, opportunityId: null })
  })

  it("creates a card when a booking is scheduled", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce("contact-sched")

    const { POST } = await import("@/app/api/webhooks/ghl-booking/route")
    const res = await POST(
      makeBookingReq({
        contact_email: "lead@example.com",
        contact_name: "Jane",
        booking_date: "2026-05-10T15:00:00Z",
        ghl_appointment_id: "appt-pipe-1",
        status: "scheduled",
      }),
    )

    expect(res.status).toBe(201)
    expect(applyPipelineEventMock).toHaveBeenCalledWith({
      contactId: "contact-sched",
      event: { kind: "booking", status: "scheduled", occurredAt: expect.any(Date) },
    })
  })

  it("advances the card when the booking completes", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce("contact-comp")

    const { POST } = await import("@/app/api/webhooks/ghl-booking/route")
    const res = await POST(
      makeBookingReq({
        contact_email: "lead@example.com",
        contact_name: "Jane",
        booking_date: "2026-05-10T15:00:00Z",
        ghl_appointment_id: "appt-pipe-2",
        status: "completed",
      }),
    )

    expect(res.status).toBe(201)
    expect(applyPipelineEventMock).toHaveBeenCalledWith({
      contactId: "contact-comp",
      event: { kind: "booking", status: "completed", occurredAt: expect.any(Date) },
    })
  })

  it("closes the card lost on cancelled, with reason booking_cancelled", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce("contact-cancel")

    const { POST } = await import("@/app/api/webhooks/ghl-booking/route")
    const res = await POST(
      makeBookingReq({
        contact_email: "lead@example.com",
        contact_name: "Jane",
        booking_date: "2026-05-10T15:00:00Z",
        ghl_appointment_id: "appt-pipe-3",
        status: "cancelled",
      }),
    )

    expect(res.status).toBe(201)
    // decideMove (unit-tested directly in pipeline-move.test.ts) is what
    // actually turns a cancelled-status event into a close/lost/
    // booking_cancelled decision. This webhook test only owns the wiring:
    // that a cancelled status is handed through as-is.
    expect(applyPipelineEventMock).toHaveBeenCalledWith({
      contactId: "contact-cancel",
      event: { kind: "booking", status: "cancelled", occurredAt: expect.any(Date) },
    })
    // Deliberate asymmetry (commit 63ff31db): exitRunsForContact must NOT
    // fire on a cancellation, even though applyPipelineEvent does.
    expect(exitRunsForContactMock).not.toHaveBeenCalled()
  })

  it("closes the card lost on no_show, with reason booking_no_show", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce("contact-noshow")

    const { POST } = await import("@/app/api/webhooks/ghl-booking/route")
    const res = await POST(
      makeBookingReq({
        contact_email: "lead@example.com",
        contact_name: "Jane",
        booking_date: "2026-05-10T15:00:00Z",
        ghl_appointment_id: "appt-pipe-4",
        status: "no_show",
      }),
    )

    expect(res.status).toBe(201)
    expect(applyPipelineEventMock).toHaveBeenCalledWith({
      contactId: "contact-noshow",
      event: { kind: "booking", status: "no_show", occurredAt: expect.any(Date) },
    })
    expect(exitRunsForContactMock).not.toHaveBeenCalled()
  })

  it("does not fail the webhook when applyPipelineEvent throws", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce("contact-throws")
    applyPipelineEventMock.mockRejectedValueOnce(new Error("board exploded"))
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const { POST } = await import("@/app/api/webhooks/ghl-booking/route")
    const res = await POST(
      makeBookingReq({
        contact_email: "lead@example.com",
        contact_name: "Jane",
        booking_date: "2026-05-10T15:00:00Z",
        ghl_appointment_id: "appt-pipe-5",
        status: "scheduled",
      }),
    )

    expect(res.status).toBe(201)
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it("does not call applyPipelineEvent when no contact resolves", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce(null)

    const { POST } = await import("@/app/api/webhooks/ghl-booking/route")
    const res = await POST(
      makeBookingReq({
        contact_email: "unknown@example.com",
        contact_name: "Jane",
        booking_date: "2026-05-10T15:00:00Z",
        ghl_appointment_id: "appt-pipe-6",
        status: "scheduled",
      }),
    )

    expect(res.status).toBe(201)
    expect(applyPipelineEventMock).not.toHaveBeenCalled()
  })
})

// ─── Calendly booking webhook — the SECOND caller of lib/bookings/ingest.ts ──
//
// Full Engine phase 2 extracted the GHL route's body into `ingestBooking` and
// added a Calendly route that calls the same function. These are the GHL
// assertions above, retargeted: the same mocks, the same expectations about
// which contactId + PipelineEvent reach applyPipelineEvent, driven through the
// Calendly envelope instead. If the two routes ever disagree about what a
// booking means, one of the two blocks goes red.

import { buildSignatureHeader } from "@/lib/calendly/signature"
import { readFileSync } from "fs"

const CALENDLY_KEY = "pipeline-hooks-signing-key"
const CALENDLY_FIXTURE = JSON.parse(readFileSync("__tests__/fixtures/calendly/invitee-created.json", "utf8"))

function makeCalendlyReq(event: "invitee.created" | "invitee.canceled", payloadOverrides: Record<string, unknown> = {}): Request {
  const raw = JSON.stringify({ ...CALENDLY_FIXTURE, event, payload: { ...CALENDLY_FIXTURE.payload, ...payloadOverrides } })
  return new Request("http://localhost/api/webhooks/calendly", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "calendly-webhook-signature": buildSignatureHeader({
        rawBody: raw,
        signingKey: CALENDLY_KEY,
        timestampSeconds: Math.floor(Date.now() / 1000),
      }),
    },
    body: raw,
  })
}

describe("Calendly booking webhook — pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CALENDLY_WEBHOOK_SIGNING_KEY = CALENDLY_KEY
    delete process.env.CALENDLY_EVENT_TYPE_URI

    bookingsSelectMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    bookingsInsert = vi.fn().mockReturnValue({
      select: () => ({ single: vi.fn().mockResolvedValue({ data: { id: "bk-cal-1" }, error: null }) }),
    })
    bookingsUpdateEq = vi.fn().mockResolvedValue({ error: null })

    findContactByIdentifiersMock.mockReset().mockResolvedValue(null)
    exitRunsForContactMock.mockReset().mockResolvedValue(0)
    applyPipelineEventMock
      .mockReset()
      .mockResolvedValue({ decision: { kind: "noop", reason: "test" }, opportunityId: null })
  })

  it("creates a card when an invitee is created", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce("contact-cal-sched")

    const { POST } = await import("@/app/api/webhooks/calendly/route")
    const res = await POST(makeCalendlyReq("invitee.created"))

    expect(res.status).toBe(201)
    expect(findContactByIdentifiersMock).toHaveBeenCalledWith({
      email: "priya.raman+seed@example.test",
      phone: "+16176504548",
    })
    expect(applyPipelineEventMock).toHaveBeenCalledWith({
      contactId: "contact-cal-sched",
      event: { kind: "booking", status: "scheduled", occurredAt: expect.any(Date) },
    })
  })

  it("closes the card lost when an invitee cancels", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce("contact-cal-cancel")

    const { POST } = await import("@/app/api/webhooks/calendly/route")
    const res = await POST(makeCalendlyReq("invitee.canceled", { status: "canceled" }))

    expect(res.status).toBe(201)
    expect(applyPipelineEventMock).toHaveBeenCalledWith({
      contactId: "contact-cal-cancel",
      event: { kind: "booking", status: "cancelled", occurredAt: expect.any(Date) },
    })
    expect(exitRunsForContactMock).not.toHaveBeenCalled()
  })

  // Spec §8.2: a reschedule is a cancel PLUS a create, in no guaranteed order.
  // The cancel half must not reach the pipeline or the person who moved their
  // call by a day gets a Lost card.
  it("does NOT touch the pipeline on the cancel half of a reschedule", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce("contact-cal-resched")

    const { POST } = await import("@/app/api/webhooks/calendly/route")
    const res = await POST(
      makeCalendlyReq("invitee.canceled", {
        status: "canceled",
        rescheduled: true,
        new_invitee: "https://api.calendly.com/scheduled_events/SCHEDEVENT0002/invitees/INVITEE00000002",
      }),
    )

    expect(res.status).toBe(201)
    expect(applyPipelineEventMock).not.toHaveBeenCalled()
    expect(exitRunsForContactMock).not.toHaveBeenCalled()
    // ...but the row IS written, as cancelled.
    expect(bookingsInsert).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled", source: "calendly" }))
  })

  it("updates rather than inserts when the scheduled_event URI is already known (redelivery)", async () => {
    bookingsSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "bk-cal-existing", status: "scheduled", booking_date: "2026-09-08T14:00:00.000000Z" },
      error: null,
    })

    const { POST } = await import("@/app/api/webhooks/calendly/route")
    const res = await POST(makeCalendlyReq("invitee.created"))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, action: "updated" })
    expect(bookingsInsert).not.toHaveBeenCalled()
    expect(bookingsUpdateEq).toHaveBeenCalledWith("id", "bk-cal-existing")
  })

  it("does not fail the webhook when applyPipelineEvent throws", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce("contact-cal-throws")
    applyPipelineEventMock.mockRejectedValueOnce(new Error("board exploded"))
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const { POST } = await import("@/app/api/webhooks/calendly/route")
    const res = await POST(makeCalendlyReq("invitee.created"))

    expect(res.status).toBe(201)
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it("does not call applyPipelineEvent when no contact resolves", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce(null)

    const { POST } = await import("@/app/api/webhooks/calendly/route")
    const res = await POST(makeCalendlyReq("invitee.created"))

    expect(res.status).toBe(201)
    expect(applyPipelineEventMock).not.toHaveBeenCalled()
  })

  it("writes the Calendly key and the two invitee links onto the new row", async () => {
    const { POST } = await import("@/app/api/webhooks/calendly/route")
    await POST(makeCalendlyReq("invitee.created"))

    expect(bookingsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "calendly",
        calendly_event_uri: "https://api.calendly.com/scheduled_events/SCHEDEVENT0001",
        reschedule_url: "https://calendly.com/reschedulings/INVITEE00000001",
        cancel_url: "https://calendly.com/cancellations/INVITEE00000001",
        gclid: "TeSt_gclid-123",
        ghl_appointment_id: null,
      }),
    )
  })
})
