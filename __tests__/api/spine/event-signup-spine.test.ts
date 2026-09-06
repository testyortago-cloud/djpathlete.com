// @vitest-environment node
//
// POST /api/events/[id]/signup and POST /api/events/[id]/checkout joining
// the contact spine, and each one's own SMS consent write.
//
// components/public/EventSignupModal.tsx posts to ONE OF THESE TWO routes
// depending on the flow the visitor picked (see its `url` branch: paid →
// checkout, interest/waitlist → signup) — "an event signup is a contact
// too" has to be true regardless of which one actually ran, so both get
// their own describe blocks below rather than treating the checkout path as
// a variant of the signup path's coverage.
//
// recordContactEvent / recordConsent / getBusinessSettings mocked directly,
// mirroring inquiry-spine.test.ts's lighter approach — no enrolment proof
// is required for either route.

import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  getEventById: vi.fn(),
  createSignup: vi.fn(),
  getActiveDocument: vi.fn(),
  sendEventSignupReceivedEmail: vi.fn(),
  sendAdminNewSignupEmail: vi.fn(),
  createEventCheckoutSession: vi.fn(),
  recordContactEvent: vi.fn(),
  recordConsent: vi.fn(),
  getBusinessSettings: vi.fn(),
  recordAudit: vi.fn(),
  updateEq: vi.fn((..._args: unknown[]) => Promise.resolve({})),
}))

vi.mock("@/lib/db/events", () => ({ getEventById: (...a: unknown[]) => mocks.getEventById(...a) }))
vi.mock("@/lib/db/event-signups", () => ({ createSignup: (...a: unknown[]) => mocks.createSignup(...a) }))
vi.mock("@/lib/db/legal-documents", () => ({
  getActiveDocument: (...a: unknown[]) => mocks.getActiveDocument(...a),
}))
vi.mock("@/lib/email", () => ({
  sendEventSignupReceivedEmail: (...a: unknown[]) => mocks.sendEventSignupReceivedEmail(...a),
  sendAdminNewSignupEmail: (...a: unknown[]) => mocks.sendAdminNewSignupEmail(...a),
}))
vi.mock("@/lib/stripe", () => ({
  createEventCheckoutSession: (...a: unknown[]) => mocks.createEventCheckoutSession(...a),
}))
vi.mock("@/lib/db/contacts", () => ({ recordContactEvent: (...a: unknown[]) => mocks.recordContactEvent(...a) }))
vi.mock("@/lib/db/contact-consents", () => ({ recordConsent: (...a: unknown[]) => mocks.recordConsent(...a) }))
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: (...a: unknown[]) => mocks.getBusinessSettings(...a) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => mocks.recordAudit(...a) }))
vi.mock("@/lib/audit/with-audit", () => ({
  withAudit: (_cfg: unknown, handler: unknown) => handler,
}))
// A chainable `.eq()` stand-in — the checkout route's update now writes
// `.eq("id", ...).eq("business_id", ...)` rather than a single `.eq()`. Each
// call is recorded on `mocks.updateEq` so it stays the one place to inspect.
function chainableUpdateEq(): { eq: typeof chainableUpdateEq } & PromiseLike<Record<string, never>> {
  const chain = Promise.resolve({}) as unknown as { eq: typeof chainableUpdateEq } & PromiseLike<Record<string, never>>
  chain.eq = ((...args: unknown[]) => {
    mocks.updateEq(...args)
    return chainableUpdateEq()
  }) as typeof chainableUpdateEq
  return chain
}
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      update: () => ({
        eq: (...args: unknown[]) => {
          mocks.updateEq(...args)
          return chainableUpdateEq()
        },
      }),
    }),
  }),
}))
// The route resolves its tenant from the request's Host through the ONE Host
// boundary (lib/tenancy/public.ts). Mocked to a sentinel that is not the
// platform's, so a route that hard-codes platformBusinessId() cannot pass.
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: async () => "host-biz" }))

const publishedEvent = {
  id: "evt-1",
  slug: "summer-camp",
  type: "camp",
  status: "published",
  capacity: 10,
  signup_count: 3,
  title: "Summer Camp",
  summary: "",
  description: "",
  focus_areas: [],
  start_date: new Date(Date.now() + 86400000).toISOString(),
  end_date: null,
  session_schedule: null,
  location_name: "L",
  location_address: null,
  location_map_url: null,
  age_min: null,
  age_max: null,
  price_cents: 29900,
  stripe_price_id: "price_test_1",
  hero_image_url: null,
  created_at: "",
  updated_at: "",
}

const validBody = {
  parent_name: "Alex Parent",
  parent_email: "alex@example.com",
  parent_phone: "5551234567",
  athlete_name: "Sam Athlete",
  athlete_age: 14,
  waiver_accepted: true,
}

const ctx = { params: Promise.resolve({ id: "evt-1" }) }

/**
 * The signup route's SMS consent write runs fire-and-forget; give its
 * microtask chain a turn. The checkout route's own write is AWAITED inline
 * (app/api/events/[id]/checkout/route.ts's own comment explains why — no
 * runway after it, unlike signup's own Promise.allSettled email sends), so
 * calling this after `POST` resolves in the checkout describe blocks below
 * is a harmless no-op, kept only so both blocks share one flush helper.
 */
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  // resetAllMocks, NOT clearAllMocks: clearAllMocks wipes call history but
  // leaves any UNCONSUMED `mockRejectedValueOnce`/`mockResolvedValueOnce`
  // queued on a mock sitting there — if a test queues one and its own route
  // call never actually reaches the mock (e.g. under a mutation that drops
  // the call entirely), that leftover once-value survives into whichever
  // LATER test is first to call the same mock, silently corrupting an
  // unrelated test's result. recordContactEvent is shared across the
  // signup-route and checkout-route describe blocks below, so a leak here
  // can misattribute a regression from one route to the other. resetAllMocks
  // clears the once-queue too; every default below is re-armed immediately
  // after, same as before.
  vi.resetAllMocks()
  mocks.getActiveDocument.mockResolvedValue({ id: "doc-waiver-1" })
  mocks.sendEventSignupReceivedEmail.mockResolvedValue(undefined)
  mocks.sendAdminNewSignupEmail.mockResolvedValue(undefined)
  mocks.recordContactEvent.mockResolvedValue({ contactId: "contact-1", created: true, merged: false })
  mocks.recordConsent.mockResolvedValue(undefined)
  mocks.getBusinessSettings.mockResolvedValue({ business_id: "biz-1", display_name: "Acme Fitness" })
})

function signupReq(body: Record<string, unknown>, urlSuffix = "") {
  return new Request(`http://localhost/api/events/evt-1/signup${urlSuffix}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function checkoutReq(body: Record<string, unknown>) {
  return new Request("http://localhost/api/events/evt-1/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/events/[id]/signup — joins the contact spine", () => {
  it("calls recordContactEvent with source event_signup, parent email/phone/name", async () => {
    mocks.getEventById.mockResolvedValueOnce(publishedEvent)
    mocks.createSignup.mockResolvedValueOnce({
      id: "sig-1",
      event_id: "evt-1",
      parent_name: "Alex Parent",
      parent_email: "alex@example.com",
      parent_phone: "5551234567",
    })

    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(signupReq(validBody), ctx)
    expect(res.status).toBe(200)

    expect(mocks.recordContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "alex@example.com",
        phone: "5551234567",
        name: "Alex Parent",
        source: "event_signup",
      }),
    )
  })

  it("never changes the route's response or existing writes when recordContactEvent throws", async () => {
    mocks.getEventById.mockResolvedValueOnce(publishedEvent)
    mocks.createSignup.mockResolvedValueOnce({
      id: "sig-1",
      event_id: "evt-1",
      parent_name: "Alex Parent",
      parent_email: "alex@example.com",
      parent_phone: "5551234567",
    })
    mocks.recordContactEvent.mockRejectedValueOnce(new Error("PGRST204 column missing"))

    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(signupReq(validBody), ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mocks.sendEventSignupReceivedEmail).toHaveBeenCalledTimes(1)
    expect(mocks.sendAdminNewSignupEmail).toHaveBeenCalledTimes(1)
  })
})

describe("POST /api/events/[id]/signup — SMS consent", () => {
  it("writes a consent row quoting the exact rendered wording when sms_consent is true and phone is present", async () => {
    mocks.getEventById.mockResolvedValueOnce(publishedEvent)
    mocks.createSignup.mockResolvedValueOnce({
      id: "sig-1",
      event_id: "evt-1",
      parent_name: "Alex Parent",
      parent_email: "alex@example.com",
      parent_phone: "5551234567",
    })

    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(signupReq({ ...validBody, sms_consent: true }), ctx)
    await flush()

    expect(res.status).toBe(200)
    expect(mocks.recordConsent).toHaveBeenCalledWith({
      contactId: "contact-1",
      channel: "sms",
      granted: true,
      source: "event_signup",
      wordingShown:
        "I agree to receive text messages from Acme Fitness about my inquiry. Message and data rates may apply. Reply STOP to opt out, HELP for help.",
      ip: null,
      userAgent: null,
      businessId: "host-biz",
    })
  })

  it("writes no consent row when sms_consent is false", async () => {
    mocks.getEventById.mockResolvedValueOnce(publishedEvent)
    mocks.createSignup.mockResolvedValueOnce({
      id: "sig-1",
      event_id: "evt-1",
      parent_email: "alex@example.com",
      parent_phone: "5551234567",
      parent_name: "Alex Parent",
    })
    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(signupReq({ ...validBody, sms_consent: false }), ctx)
    await flush()

    expect(res.status).toBe(200)
    expect(mocks.recordConsent).not.toHaveBeenCalled()
  })

  it("writes no consent row when sms_consent is absent from the payload", async () => {
    mocks.getEventById.mockResolvedValueOnce(publishedEvent)
    mocks.createSignup.mockResolvedValueOnce({
      id: "sig-1",
      event_id: "evt-1",
      parent_email: "alex@example.com",
      parent_phone: "5551234567",
      parent_name: "Alex Parent",
    })
    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(signupReq(validBody), ctx)
    await flush()

    expect(res.status).toBe(200)
    expect(mocks.recordConsent).not.toHaveBeenCalled()
  })

  it("writes no consent row when sms_consent is true but no phone was submitted", async () => {
    mocks.getEventById.mockResolvedValueOnce(publishedEvent)
    mocks.createSignup.mockResolvedValueOnce({
      id: "sig-1",
      event_id: "evt-1",
      parent_email: "alex@example.com",
      parent_phone: null,
      parent_name: "Alex Parent",
    })
    const { parent_phone: _p, ...withoutPhone } = validBody
    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(signupReq({ ...withoutPhone, sms_consent: true }), ctx)
    await flush()

    expect(res.status).toBe(200)
    expect(mocks.recordConsent).not.toHaveBeenCalled()
  })

  it("writes no consent row when sms_consent is true but no contact was captured", async () => {
    mocks.getEventById.mockResolvedValueOnce(publishedEvent)
    mocks.createSignup.mockResolvedValueOnce({
      id: "sig-1",
      event_id: "evt-1",
      parent_email: "alex@example.com",
      parent_phone: "5551234567",
      parent_name: "Alex Parent",
    })
    mocks.recordContactEvent.mockRejectedValueOnce(new Error("db down"))
    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(signupReq({ ...validBody, sms_consent: true }), ctx)
    await flush()

    expect(res.status).toBe(200)
    expect(mocks.recordConsent).not.toHaveBeenCalled()
  })

  it("writes no consent row when business_settings.display_name is blank, even though sms_consent is true and phone is present — the lead is still captured", async () => {
    mocks.getEventById.mockResolvedValueOnce(publishedEvent)
    mocks.createSignup.mockResolvedValueOnce({
      id: "sig-1",
      event_id: "evt-1",
      parent_email: "alex@example.com",
      parent_phone: "5551234567",
      parent_name: "Alex Parent",
    })
    mocks.getBusinessSettings.mockResolvedValue({ business_id: "biz-1", display_name: "" })
    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(signupReq({ ...validBody, sms_consent: true }), ctx)
    await flush()

    expect(res.status).toBe(200)
    expect(mocks.recordContactEvent).toHaveBeenCalledTimes(1)
    expect(mocks.recordConsent).not.toHaveBeenCalled()
  })

  it("writes no consent row when business_settings.display_name is whitespace-only", async () => {
    mocks.getEventById.mockResolvedValueOnce(publishedEvent)
    mocks.createSignup.mockResolvedValueOnce({
      id: "sig-1",
      event_id: "evt-1",
      parent_email: "alex@example.com",
      parent_phone: "5551234567",
      parent_name: "Alex Parent",
    })
    mocks.getBusinessSettings.mockResolvedValue({ business_id: "biz-1", display_name: "   " })
    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(signupReq({ ...validBody, sms_consent: true }), ctx)
    await flush()

    expect(res.status).toBe(200)
    expect(mocks.recordConsent).not.toHaveBeenCalled()
  })

  it("still returns success, and the lead is still captured, when the consent write itself throws", async () => {
    mocks.getEventById.mockResolvedValueOnce(publishedEvent)
    mocks.createSignup.mockResolvedValueOnce({
      id: "sig-1",
      event_id: "evt-1",
      parent_email: "alex@example.com",
      parent_phone: "5551234567",
      parent_name: "Alex Parent",
    })
    mocks.recordConsent.mockRejectedValue(new Error("db is down"))
    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(signupReq({ ...validBody, sms_consent: true }), ctx)
    await flush()

    expect(res.status).toBe(200)
    expect(mocks.recordContactEvent).toHaveBeenCalled()
    expect(mocks.recordConsent).toHaveBeenCalled()
  })
})

describe("POST /api/events/[id]/checkout — joins the contact spine", () => {
  it("calls recordContactEvent with source event_signup, parent email/phone/name, once the Stripe session is created", async () => {
    mocks.getEventById.mockResolvedValueOnce(publishedEvent)
    mocks.createSignup.mockResolvedValueOnce({ id: "sig-1", event_id: "evt-1" })
    mocks.createEventCheckoutSession.mockResolvedValueOnce({
      id: "cs_test_xyz",
      url: "https://checkout.stripe.com/cs_test_xyz",
    })

    const { POST } = await import("@/app/api/events/[id]/checkout/route")
    const res = await POST(checkoutReq(validBody), ctx)
    expect(res.status).toBe(200)

    expect(mocks.recordContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "alex@example.com",
        phone: "5551234567",
        name: "Alex Parent",
        source: "event_signup",
      }),
    )
  })

  it("never changes the route's response when recordContactEvent throws", async () => {
    mocks.getEventById.mockResolvedValueOnce(publishedEvent)
    mocks.createSignup.mockResolvedValueOnce({ id: "sig-1", event_id: "evt-1" })
    mocks.createEventCheckoutSession.mockResolvedValueOnce({
      id: "cs_test_xyz",
      url: "https://checkout.stripe.com/cs_test_xyz",
    })
    mocks.recordContactEvent.mockRejectedValueOnce(new Error("PGRST204 column missing"))

    const { POST } = await import("@/app/api/events/[id]/checkout/route")
    const res = await POST(checkoutReq(validBody), ctx)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.sessionUrl).toBe("https://checkout.stripe.com/cs_test_xyz")
  })

  it("does not join the spine when the event is at capacity — no signup row was created", async () => {
    mocks.getEventById.mockResolvedValueOnce({ ...publishedEvent, signup_count: 10 })

    const { POST } = await import("@/app/api/events/[id]/checkout/route")
    const res = await POST(checkoutReq(validBody), ctx)
    expect(res.status).toBe(409)
    expect(mocks.recordContactEvent).not.toHaveBeenCalled()
  })
})

describe("POST /api/events/[id]/checkout — SMS consent", () => {
  function mockHappyCheckout() {
    mocks.getEventById.mockResolvedValueOnce(publishedEvent)
    mocks.createSignup.mockResolvedValueOnce({ id: "sig-1", event_id: "evt-1" })
    mocks.createEventCheckoutSession.mockResolvedValueOnce({
      id: "cs_test_xyz",
      url: "https://checkout.stripe.com/cs_test_xyz",
    })
  }

  it("writes a consent row quoting the exact rendered wording when sms_consent is true and phone is present", async () => {
    mockHappyCheckout()
    const { POST } = await import("@/app/api/events/[id]/checkout/route")
    const res = await POST(checkoutReq({ ...validBody, sms_consent: true }), ctx)
    await flush()

    expect(res.status).toBe(200)
    expect(mocks.recordConsent).toHaveBeenCalledWith({
      contactId: "contact-1",
      channel: "sms",
      granted: true,
      source: "event_signup",
      wordingShown:
        "I agree to receive text messages from Acme Fitness about my inquiry. Message and data rates may apply. Reply STOP to opt out, HELP for help.",
      ip: null,
      userAgent: null,
      businessId: "host-biz",
    })
  })

  it("writes no consent row when sms_consent is absent", async () => {
    mockHappyCheckout()
    const { POST } = await import("@/app/api/events/[id]/checkout/route")
    const res = await POST(checkoutReq(validBody), ctx)
    await flush()

    expect(res.status).toBe(200)
    expect(mocks.recordConsent).not.toHaveBeenCalled()
  })

  it("writes no consent row when business_settings.display_name is blank — the lead is still captured", async () => {
    mockHappyCheckout()
    mocks.getBusinessSettings.mockResolvedValue({ business_id: "biz-1", display_name: "" })
    const { POST } = await import("@/app/api/events/[id]/checkout/route")
    const res = await POST(checkoutReq({ ...validBody, sms_consent: true }), ctx)
    await flush()

    expect(res.status).toBe(200)
    expect(mocks.recordContactEvent).toHaveBeenCalledTimes(1)
    expect(mocks.recordConsent).not.toHaveBeenCalled()
  })

  it("still returns success, and the lead is still captured, when the consent write itself throws", async () => {
    mockHappyCheckout()
    mocks.recordConsent.mockRejectedValue(new Error("db is down"))
    const { POST } = await import("@/app/api/events/[id]/checkout/route")
    const res = await POST(checkoutReq({ ...validBody, sms_consent: true }), ctx)
    await flush()

    expect(res.status).toBe(200)
    expect(mocks.recordContactEvent).toHaveBeenCalled()
    expect(mocks.recordConsent).toHaveBeenCalled()
  })

  // Unlike the signup route's identical-looking block, this route's consent
  // write is AWAITED (see app/api/events/[id]/checkout/route.ts's own
  // comment on why: no runway after it, unlike signup's Promise.allSettled
  // email sends before ITS response). Awaiting a rejecting promise inside
  // the route's own try/catch would turn a rejection into this route's
  // generic 500 IF the `.catch` guard on the call site were ever removed —
  // this test is the proof that guard is doing its job: even with the
  // underlying DB call thrown all the way from `recordConsent`, the route
  // still returns its real 200 payload (sessionUrl/signupId), not the
  // catch-all "Internal server error" body from the route's outer try/catch.
  it("returns the real sessionUrl/signupId payload, not a 500, when the awaited consent write rejects", async () => {
    mockHappyCheckout()
    mocks.recordConsent.mockRejectedValue(new Error("db is down"))
    const { POST } = await import("@/app/api/events/[id]/checkout/route")
    const res = await POST(checkoutReq({ ...validBody, sms_consent: true }), ctx)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data).toEqual({ sessionUrl: "https://checkout.stripe.com/cs_test_xyz", signupId: "sig-1" })
    expect(mocks.recordConsent).toHaveBeenCalled()
  })
})

describe("event routes — tenant", () => {
  const signupRow = {
    id: "sig-1",
    event_id: "evt-1",
    parent_name: "Alex Parent",
    parent_email: "alex@example.com",
    parent_phone: "5551234567",
    athlete_name: "Sam Athlete",
    athlete_age: 14,
    status: "pending",
  }

  it("signup: resolves the tenant once through the seam and threads it into contact, settings and consent", async () => {
    mocks.getEventById.mockResolvedValueOnce(publishedEvent)
    mocks.createSignup.mockResolvedValueOnce(signupRow)
    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(signupReq({ ...validBody, sms_consent: true }), ctx)
    await flush()
    expect(res.status).toBe(200)
    expect(mocks.recordContactEvent.mock.calls[0][0]).toMatchObject({ businessId: "host-biz" })
    expect(mocks.getBusinessSettings).toHaveBeenCalledWith("host-biz")
    expect(mocks.recordConsent.mock.calls[0][0]).toMatchObject({ businessId: "host-biz" })
  })

  it("signup: threads the resolved tenant into getEventById and createSignup, not the platform id", async () => {
    // The sentinel "host-biz" is deliberately NOT platformBusinessId() — a
    // route that hard-codes the platform id in place of the resolved tenant
    // would still pass a test written against that id.
    mocks.getEventById.mockResolvedValueOnce(publishedEvent)
    mocks.createSignup.mockResolvedValueOnce(signupRow)
    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(signupReq(validBody), ctx)
    await flush()
    expect(res.status).toBe(200)
    expect(mocks.getEventById).toHaveBeenCalledWith("host-biz", "evt-1")
    expect(mocks.createSignup.mock.calls[0][0]).toBe("host-biz")
  })

  it("checkout: resolves the tenant once through the seam and threads it into contact, settings and consent", async () => {
    mocks.getEventById.mockResolvedValueOnce(publishedEvent)
    mocks.createSignup.mockResolvedValueOnce(signupRow)
    mocks.createEventCheckoutSession.mockResolvedValueOnce({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" })
    const { POST } = await import("@/app/api/events/[id]/checkout/route")
    const res = await POST(checkoutReq({ ...validBody, sms_consent: true }), ctx)
    await flush()
    expect(res.ok).toBe(true)
    expect(mocks.recordContactEvent.mock.calls[0][0]).toMatchObject({ businessId: "host-biz" })
    expect(mocks.getBusinessSettings).toHaveBeenCalledWith("host-biz")
    expect(mocks.recordConsent.mock.calls[0][0]).toMatchObject({ businessId: "host-biz" })
  })

  it("checkout: threads the resolved tenant into getEventById and createSignup, not the platform id", async () => {
    // The sentinel "host-biz" is deliberately NOT platformBusinessId() — a
    // route that hard-codes the platform id in place of the resolved tenant
    // would still pass a test written against that id.
    mocks.getEventById.mockResolvedValueOnce(publishedEvent)
    mocks.createSignup.mockResolvedValueOnce(signupRow)
    mocks.createEventCheckoutSession.mockResolvedValueOnce({ id: "cs_2", url: "https://checkout.stripe.test/cs_2" })
    const { POST } = await import("@/app/api/events/[id]/checkout/route")
    const res = await POST(checkoutReq(validBody), ctx)
    await flush()
    expect(res.ok).toBe(true)
    expect(mocks.getEventById).toHaveBeenCalledWith("host-biz", "evt-1")
    expect(mocks.createSignup.mock.calls[0][0]).toBe("host-biz")
  })
})
