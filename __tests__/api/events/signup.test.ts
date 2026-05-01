import { describe, it, expect, vi, beforeEach } from "vitest"

const getEventByIdMock = vi.fn()
const createSignupMock = vi.fn()
const getActiveDocumentMock = vi.fn()
const sendReceivedMock = vi.fn<(signup: unknown, event: unknown) => Promise<undefined>>(async () => undefined)
const sendAdminMock = vi.fn<(signup: unknown, event: unknown) => Promise<undefined>>(async () => undefined)

vi.mock("@/lib/db/events", () => ({ getEventById: (...args: unknown[]) => getEventByIdMock(...args) }))
vi.mock("@/lib/db/event-signups", () => ({ createSignup: (...args: unknown[]) => createSignupMock(...args) }))
vi.mock("@/lib/db/legal-documents", () => ({
  getActiveDocument: (...args: unknown[]) => getActiveDocumentMock(...args),
}))
vi.mock("@/lib/email", () => ({
  sendEventSignupReceivedEmail: (signup: unknown, event: unknown) => sendReceivedMock(signup, event),
  sendAdminNewSignupEmail: (signup: unknown, event: unknown) => sendAdminMock(signup, event),
}))

const publishedEvent = {
  id: "evt-1",
  type: "clinic",
  status: "published",
  capacity: 10,
  signup_count: 3,
  slug: "x",
  title: "x",
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
  price_cents: null,
  stripe_price_id: null,
  hero_image_url: null,
  created_at: "",
  updated_at: "",
}

function makeRequest(body: Record<string, unknown>, urlSuffix = "") {
  return new Request(`http://localhost/api/events/evt-1/signup${urlSuffix}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const validBody = {
  parent_name: "Alex",
  parent_email: "a@x.com",
  athlete_name: "Sam",
  athlete_age: 14,
  waiver_accepted: true,
}

const ctx = { params: Promise.resolve({ id: "evt-1" }) }

describe("POST /api/events/[id]/signup", () => {
  beforeEach(() => {
    getEventByIdMock.mockReset()
    createSignupMock.mockReset()
    getActiveDocumentMock.mockReset()
    getActiveDocumentMock.mockResolvedValue({ id: "doc-waiver-1" })
    sendReceivedMock.mockClear()
    sendAdminMock.mockClear()
  })

  it("silently succeeds on honeypot fill without writing DB", async () => {
    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(makeRequest({ ...validBody, website: "http://bot.example" }), ctx)
    expect(res.status).toBe(200)
    expect(createSignupMock).not.toHaveBeenCalled()
    expect(sendReceivedMock).not.toHaveBeenCalled()
  })

  it("returns 400 on invalid body", async () => {
    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(makeRequest({ parent_email: "bad" }), ctx)
    expect(res.status).toBe(400)
  })

  it("returns 400 when waiver_accepted is missing", async () => {
    const { waiver_accepted: _w, ...withoutWaiver } = validBody
    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(makeRequest(withoutWaiver), ctx)
    expect(res.status).toBe(400)
  })

  it("returns 400 when waiver_accepted is false", async () => {
    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(makeRequest({ ...validBody, waiver_accepted: false }), ctx)
    expect(res.status).toBe(400)
  })

  it("returns 404 on unpublished event", async () => {
    getEventByIdMock.mockResolvedValueOnce({ ...publishedEvent, status: "draft" })
    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(makeRequest(validBody), ctx)
    expect(res.status).toBe(404)
  })

  it("returns 409 at_capacity when event is full and waitlist query absent", async () => {
    getEventByIdMock.mockResolvedValueOnce({ ...publishedEvent, capacity: 3, signup_count: 3 })
    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(makeRequest(validBody), ctx)
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.error).toBe("at_capacity")
  })

  it("accepts waitlist override when event is full", async () => {
    getEventByIdMock.mockResolvedValueOnce({ ...publishedEvent, capacity: 3, signup_count: 3 })
    createSignupMock.mockResolvedValueOnce({ id: "sig-1", event_id: "evt-1", parent_email: "a@x.com" })
    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(makeRequest(validBody, "?waitlist=true"), ctx)
    expect(res.status).toBe(200)
    expect(createSignupMock).toHaveBeenCalled()
  })

  it("happy path records waiver acceptance and fires both emails", async () => {
    getEventByIdMock.mockResolvedValueOnce(publishedEvent)
    createSignupMock.mockResolvedValueOnce({ id: "sig-1", event_id: "evt-1", parent_email: "a@x.com" })
    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(makeRequest(validBody), ctx)
    expect(res.status).toBe(200)
    expect(createSignupMock).toHaveBeenCalledWith(
      "evt-1",
      expect.objectContaining({ parent_email: "a@x.com" }),
      "interest",
      expect.objectContaining({ document_id: "doc-waiver-1" }),
    )
    // The waiver_accepted boolean is stripped before reaching the DAL.
    expect(createSignupMock.mock.calls[0][1]).not.toHaveProperty("waiver_accepted")
    expect(sendReceivedMock).toHaveBeenCalled()
    expect(sendAdminMock).toHaveBeenCalled()
  })

  it("still returns 200 when email send rejects", async () => {
    getEventByIdMock.mockResolvedValueOnce(publishedEvent)
    createSignupMock.mockResolvedValueOnce({ id: "sig-1", event_id: "evt-1", parent_email: "a@x.com" })
    sendReceivedMock.mockRejectedValueOnce(new Error("resend down"))
    sendAdminMock.mockRejectedValueOnce(new Error("resend down"))
    const { POST } = await import("@/app/api/events/[id]/signup/route")
    const res = await POST(makeRequest(validBody), ctx)
    expect(res.status).toBe(200)
  })
})
