import { describe, it, expect, vi, beforeEach } from "vitest"

type SendArgs = { from: string; to: string | string[]; subject: string; html: string }
const sendMock = vi.fn<(args: SendArgs) => Promise<{ data: { id: string } | null; error: unknown }>>()
sendMock.mockResolvedValue({ data: { id: "msg-1" }, error: null })

vi.mock("resend", () => ({
  Resend: vi.fn(function () {
    return { emails: { send: sendMock } }
  }),
}))

const mockEvent = {
  id: "evt-1",
  type: "clinic" as const,
  slug: "spring-clinic",
  title: "Spring Agility Clinic",
  summary: "",
  description: "",
  focus_areas: [],
  start_date: "2026-05-15T15:00:00.000Z",
  end_date: "2026-05-15T17:00:00.000Z",
  session_schedule: null,
  location_name: "Richmond Sports Complex",
  location_address: "123 Main St",
  location_map_url: "https://maps.example/r",
  age_min: 12,
  age_max: 18,
  capacity: 12,
  signup_count: 3,
  price_cents: null,
  stripe_product_id: null,
  stripe_price_id: null,
  status: "published" as const,
  hero_image_url: null,
  created_at: "",
  updated_at: "",
}

const mockSignup = {
  id: "sig-1",
  event_id: "evt-1",
  signup_type: "interest" as const,
  parent_name: "Alex Doe",
  parent_email: "alex@example.com",
  parent_phone: "555-0100",
  athlete_name: "Sam Doe",
  athlete_age: 14,
  sport: "soccer",
  notes: "Pulled hamstring last year",
  status: "pending" as const,
  stripe_session_id: null,
  stripe_payment_intent_id: null,
  amount_paid_cents: null,
  user_id: null,
  created_at: "2026-04-14T10:00:00.000Z",
  updated_at: "2026-04-14T10:00:00.000Z",
}

describe("event email templates", () => {
  beforeEach(() => sendMock.mockClear())

  it("sendEventSignupReceivedEmail sends to parent with event title in subject", async () => {
    const { sendEventSignupReceivedEmail } = await import("@/lib/email")
    await sendEventSignupReceivedEmail(mockSignup, mockEvent)
    expect(sendMock).toHaveBeenCalledTimes(1)
    const call = sendMock.mock.calls[0][0]
    expect(call.to).toBe("alex@example.com")
    expect(call.subject).toContain("Spring Agility Clinic")
    expect(call.html).toContain("Spring Agility Clinic")
    expect(call.html).toContain("Richmond Sports Complex")
  })

  it("sendEventSignupConfirmedEmail has confirmation subject and athlete name", async () => {
    const { sendEventSignupConfirmedEmail } = await import("@/lib/email")
    await sendEventSignupConfirmedEmail(mockSignup, mockEvent)
    expect(sendMock).toHaveBeenCalledTimes(1)
    const call = sendMock.mock.calls[0][0]
    expect(call.to).toBe("alex@example.com")
    expect(call.subject).toContain("confirmed")
    expect(call.html).toContain("Sam Doe")
    expect(call.html).toContain("Spring Agility Clinic")
  })

  it("sendAdminNewSignupEmail goes to admin cc and includes all signup fields", async () => {
    const { sendAdminNewSignupEmail } = await import("@/lib/email")
    await sendAdminNewSignupEmail(mockSignup, mockEvent)
    expect(sendMock).toHaveBeenCalledTimes(1)
    const call = sendMock.mock.calls[0][0]
    const to = Array.isArray(call.to) ? call.to[0] : call.to
    expect(to).toContain("darren")
    expect(call.subject).toContain("Sam Doe")
    expect(call.subject).toContain("Spring Agility Clinic")
    expect(call.html).toContain("alex@example.com")
    expect(call.html).toContain("555-0100")
    expect(call.html).toContain("Pulled hamstring")
    expect(call.html).toContain("/admin/events/evt-1")
  })
})
