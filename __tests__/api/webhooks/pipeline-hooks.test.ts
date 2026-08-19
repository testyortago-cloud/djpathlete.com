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
