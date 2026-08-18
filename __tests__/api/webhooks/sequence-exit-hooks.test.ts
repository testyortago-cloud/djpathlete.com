import { describe, it, expect, vi, beforeEach } from "vitest"

// ─── Shared mocks: lib/db/contacts + lib/db/sequences ───────────────────────
//
// Both webhooks (Stripe checkout completion, GHL booking) call the same pair
// of DB functions: findContactByIdentifiers to resolve who this is, then
// exitRunsForContact to stop their active sequence runs. Mocked once here and
// reused by both describe blocks below.

const findContactByIdentifiersMock = vi.fn(async (..._a: any[]) => null as string | null)
const exitRunsForContactMock = vi.fn(async (..._a: any[]) => 0)

vi.mock("@/lib/db/contacts", () => ({
  findContactByIdentifiers: (...a: unknown[]) => findContactByIdentifiersMock(...a),
}))
vi.mock("@/lib/db/sequences", () => ({
  exitRunsForContact: (...a: unknown[]) => exitRunsForContactMock(...a),
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

describe("Stripe webhook — sequence exit on payment", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyMock.mockReset()
    createPaymentMock.mockClear()
    getPaymentByStripeIdMock.mockReset().mockResolvedValue(null)
    getUserByEmailMock.mockReset().mockResolvedValue(null)
    findContactByIdentifiersMock.mockReset().mockResolvedValue(null)
    exitRunsForContactMock.mockReset().mockResolvedValue(0)
  })

  it("exits active runs when a checkout completes", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce("contact-1")
    verifyMock.mockReturnValueOnce(stripeEvent())

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeStripeReq())

    expect(res.status).toBe(200)
    expect(exitRunsForContactMock).toHaveBeenCalledWith("contact-1", "payment")
  })

  it("resolves by user_id in preference to email", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce("contact-by-uid")
    verifyMock.mockReturnValueOnce(
      stripeEvent({ metadata: { userId: "user-7" }, customer_details: { email: "lead@example.com" } }),
    )

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeStripeReq())

    expect(res.status).toBe(200)
    expect(findContactByIdentifiersMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-7", email: "lead@example.com" }),
    )
  })

  it("does not fail the webhook when the contact cannot be resolved", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce(null)
    verifyMock.mockReturnValueOnce(stripeEvent())

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const res = await POST(makeStripeReq())

    expect(res.status).toBe(200)
    expect(exitRunsForContactMock).not.toHaveBeenCalled()
  })

  it("does not fail the webhook when exitRunsForContact throws", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce("contact-2")
    exitRunsForContactMock.mockRejectedValueOnce(new Error("db exploded"))
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

describe("GHL booking webhook — sequence exit on booking", () => {
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
  })

  it("exits active runs when a booking completes", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce("contact-3")

    const { POST } = await import("@/app/api/webhooks/ghl-booking/route")
    const res = await POST(
      makeBookingReq({
        contact_email: "lead@example.com",
        contact_phone: "+16176504548",
        contact_name: "Jane",
        booking_date: "2026-05-10T15:00:00Z",
        ghl_appointment_id: "appt-exit-1",
      }),
    )

    expect(res.status).toBe(201)
    expect(findContactByIdentifiersMock).toHaveBeenCalledWith(
      expect.objectContaining({ email: "lead@example.com", phone: "+16176504548" }),
    )
    expect(exitRunsForContactMock).toHaveBeenCalledWith("contact-3", "booking")
  })

  it("does not fail the webhook when the contact cannot be resolved", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce(null)

    const { POST } = await import("@/app/api/webhooks/ghl-booking/route")
    const res = await POST(
      makeBookingReq({
        contact_email: "unknown@example.com",
        contact_name: "Jane",
        booking_date: "2026-05-10T15:00:00Z",
        ghl_appointment_id: "appt-exit-2",
      }),
    )

    expect(res.status).toBe(201)
    expect(exitRunsForContactMock).not.toHaveBeenCalled()
  })

  it("does not fail the webhook when exitRunsForContact throws", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce("contact-4")
    exitRunsForContactMock.mockRejectedValueOnce(new Error("db exploded"))
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const { POST } = await import("@/app/api/webhooks/ghl-booking/route")
    const res = await POST(
      makeBookingReq({
        contact_email: "lead@example.com",
        contact_name: "Jane",
        booking_date: "2026-05-10T15:00:00Z",
        ghl_appointment_id: "appt-exit-3",
      }),
    )

    expect(res.status).toBe(201)
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  // A cancelled or no-show booking means the lead did NOT convert — the
  // opposite of the "they booked, stop pitching" logic that justifies the
  // exit at all. There is no re-enrolment path anywhere in this branch
  // (enrollIfTriggered only fires from ContactEventSource values, and
  // "booking cancelled" isn't one), so exiting here on a bad-outcome status
  // would end the conversation permanently with nothing to ever restart it.

  it("does not exit sequences when the booking is cancelled", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce("contact-5")

    const { POST } = await import("@/app/api/webhooks/ghl-booking/route")
    const res = await POST(
      makeBookingReq({
        contact_email: "lead@example.com",
        contact_name: "Jane",
        booking_date: "2026-05-10T15:00:00Z",
        ghl_appointment_id: "appt-cancelled",
        status: "cancelled",
      }),
    )

    expect(res.status).toBe(201)
    expect(exitRunsForContactMock).not.toHaveBeenCalled()
  })

  it("does not exit sequences when the booking is a no-show", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce("contact-6")

    const { POST } = await import("@/app/api/webhooks/ghl-booking/route")
    const res = await POST(
      makeBookingReq({
        contact_email: "lead@example.com",
        contact_name: "Jane",
        booking_date: "2026-05-10T15:00:00Z",
        ghl_appointment_id: "appt-noshow",
        status: "no_show",
      }),
    )

    expect(res.status).toBe(201)
    expect(exitRunsForContactMock).not.toHaveBeenCalled()
  })

  it("still exits sequences when the booking is scheduled or completed", async () => {
    findContactByIdentifiersMock.mockResolvedValueOnce("contact-7").mockResolvedValueOnce("contact-8")

    const { POST } = await import("@/app/api/webhooks/ghl-booking/route")

    const scheduledRes = await POST(
      makeBookingReq({
        contact_email: "lead@example.com",
        contact_name: "Jane",
        booking_date: "2026-05-10T15:00:00Z",
        ghl_appointment_id: "appt-scheduled",
        status: "scheduled",
      }),
    )
    expect(scheduledRes.status).toBe(201)
    expect(exitRunsForContactMock).toHaveBeenCalledWith("contact-7", "booking")

    const completedRes = await POST(
      makeBookingReq({
        contact_email: "lead2@example.com",
        contact_name: "Jane",
        booking_date: "2026-05-10T15:00:00Z",
        ghl_appointment_id: "appt-completed",
        status: "completed",
      }),
    )
    expect(completedRes.status).toBe(201)
    expect(exitRunsForContactMock).toHaveBeenCalledWith("contact-8", "booking")
  })
})
