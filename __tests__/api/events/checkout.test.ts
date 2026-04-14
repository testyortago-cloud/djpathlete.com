import { describe, it, expect, vi, beforeEach } from "vitest"

const getEventByIdMock = vi.fn()
const createSignupMock = vi.fn()
const countPendingPaidSignupsMock = vi.fn()
const createEventCheckoutSessionMock = vi.fn()
const updateSignupSessionMock = vi.fn(async () => undefined)

vi.mock("@/lib/db/events", () => ({ getEventById: (...a: unknown[]) => getEventByIdMock(...a) }))
vi.mock("@/lib/db/event-signups", () => ({
  createSignup: (...a: unknown[]) => createSignupMock(...a),
  countPendingPaidSignups: (...a: unknown[]) => countPendingPaidSignupsMock(...a),
}))
vi.mock("@/lib/stripe", () => ({
  createEventCheckoutSession: (...a: unknown[]) => createEventCheckoutSessionMock(...a),
}))
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      update: () => ({ eq: updateSignupSessionMock }),
    }),
  }),
}))

const publishedCamp = {
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
  end_date: new Date(Date.now() + 7 * 86400000).toISOString(),
  session_schedule: null,
  location_name: "L",
  location_address: null,
  location_map_url: null,
  age_min: null,
  age_max: null,
  price_cents: 29900,
  stripe_product_id: "prod_test_1",
  stripe_price_id: "price_test_1",
  hero_image_url: null,
  created_at: "",
  updated_at: "",
}

function makeReq(body: Record<string, unknown>) {
  return new Request("http://localhost/api/events/evt-1/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const ctx = { params: Promise.resolve({ id: "evt-1" }) }
const validBody = {
  parent_name: "Alex",
  parent_email: "a@x.com",
  athlete_name: "Sam",
  athlete_age: 14,
}

describe("POST /api/events/[id]/checkout", () => {
  beforeEach(() => {
    getEventByIdMock.mockReset()
    createSignupMock.mockReset()
    countPendingPaidSignupsMock.mockReset()
    createEventCheckoutSessionMock.mockReset()
    updateSignupSessionMock.mockClear()
  })

  it("silent-drops on honeypot", async () => {
    const { POST } = await import("@/app/api/events/[id]/checkout/route")
    const res = await POST(makeReq({ ...validBody, website: "spam" }), ctx)
    expect(res.status).toBe(200)
    expect(createSignupMock).not.toHaveBeenCalled()
  })

  it("400 on invalid body", async () => {
    const { POST } = await import("@/app/api/events/[id]/checkout/route")
    const res = await POST(makeReq({ parent_email: "bad" }), ctx)
    expect(res.status).toBe(400)
  })

  it("404 on draft event", async () => {
    getEventByIdMock.mockResolvedValueOnce({ ...publishedCamp, status: "draft" })
    const { POST } = await import("@/app/api/events/[id]/checkout/route")
    const res = await POST(makeReq(validBody), ctx)
    expect(res.status).toBe(404)
  })

  it("400 if event is not a camp", async () => {
    getEventByIdMock.mockResolvedValueOnce({ ...publishedCamp, type: "clinic" })
    const { POST } = await import("@/app/api/events/[id]/checkout/route")
    const res = await POST(makeReq(validBody), ctx)
    expect(res.status).toBe(400)
  })

  it("400 if camp has no stripe_price_id", async () => {
    getEventByIdMock.mockResolvedValueOnce({ ...publishedCamp, stripe_price_id: null })
    const { POST } = await import("@/app/api/events/[id]/checkout/route")
    const res = await POST(makeReq(validBody), ctx)
    expect(res.status).toBe(400)
  })

  it("409 at_capacity when confirmed + pending paid >= capacity", async () => {
    getEventByIdMock.mockResolvedValueOnce({ ...publishedCamp, signup_count: 9 })
    countPendingPaidSignupsMock.mockResolvedValueOnce(1)
    const { POST } = await import("@/app/api/events/[id]/checkout/route")
    const res = await POST(makeReq(validBody), ctx)
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.error).toBe("at_capacity")
  })

  it("happy path creates pending paid signup, stores session id, returns sessionUrl", async () => {
    getEventByIdMock.mockResolvedValueOnce(publishedCamp)
    countPendingPaidSignupsMock.mockResolvedValueOnce(0)
    createSignupMock.mockResolvedValueOnce({ id: "sig-1", event_id: "evt-1" })
    createEventCheckoutSessionMock.mockResolvedValueOnce({
      id: "cs_test_xyz",
      url: "https://checkout.stripe.com/cs_test_xyz",
    })
    const { POST } = await import("@/app/api/events/[id]/checkout/route")
    const res = await POST(makeReq(validBody), ctx)
    expect(res.status).toBe(200)
    expect(createSignupMock).toHaveBeenCalledWith("evt-1", expect.objectContaining({ parent_email: "a@x.com" }), "paid")
    const data = await res.json()
    expect(data.sessionUrl).toBe("https://checkout.stripe.com/cs_test_xyz")
    expect(data.signupId).toBe("sig-1")
  })

  it("502 when Stripe throws", async () => {
    getEventByIdMock.mockResolvedValueOnce(publishedCamp)
    countPendingPaidSignupsMock.mockResolvedValueOnce(0)
    createSignupMock.mockResolvedValueOnce({ id: "sig-1", event_id: "evt-1" })
    createEventCheckoutSessionMock.mockRejectedValueOnce(new Error("stripe down"))
    const { POST } = await import("@/app/api/events/[id]/checkout/route")
    const res = await POST(makeReq(validBody), ctx)
    expect(res.status).toBe(502)
  })
})
