import { describe, it, expect, vi, beforeEach } from "vitest"

type SendArgs = { from: string; to: string | string[]; cc?: string | string[]; subject: string; html: string }
const sendMock = vi.fn<(args: SendArgs) => Promise<{ data: { id: string } | null; error: unknown }>>()
sendMock.mockResolvedValue({ data: { id: "msg-1" }, error: null })

vi.mock("resend", () => ({
  Resend: vi.fn(function () {
    return { emails: { send: sendMock } }
  }),
}))

// sendAdminNewSignupEmail is keyed on the EVENT's business (migration 00282's
// alertAddressing, same as every other coach alert) — see
// lib/email.ts:sendAdminNewSignupEmail's own doc comment. Distinct fixtures
// per business id below let a test tell "read event.business_id" apart from
// "read signup.business_id" or "ignore businessId and read a fixed one".
const getBusinessSettingsMock = vi.fn()
vi.mock("@/lib/db/businesses", () => ({
  getBusinessSettings: (...args: unknown[]) => getBusinessSettingsMock(...args),
}))

const mockEvent = {
  id: "evt-1",
  business_id: "biz-event-1",
  type: "clinic" as const,
  slug: "spring-clinic",
  title: "Spring Agility Clinic",
  summary: "",
  description: "",
  focus_areas: [],
  audience: [],
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
  // Deliberately a DIFFERENT business than mockEvent.business_id — the
  // fixture pins "keyed on the event's business, not the signup's own" (a
  // signup denormalizes business_id too; sendAdminNewSignupEmail must not
  // reach for it).
  business_id: "biz-signup-1",
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
  waiver_accepted_at: "2026-04-14T10:00:00.000Z",
  waiver_document_id: "doc-waiver-1",
  waiver_ip_address: null,
  waiver_user_agent: null,
  created_at: "2026-04-14T10:00:00.000Z",
  updated_at: "2026-04-14T10:00:00.000Z",
  gclid: null,
  gbraid: null,
  wbraid: null,
  fbclid: null,
}

describe("event email templates", () => {
  beforeEach(() => {
    sendMock.mockClear()
    getBusinessSettingsMock.mockReset()
  })

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

  // Retargeted: sendAdminNewSignupEmail used to hard-code `to: ADMIN_CC`
  // (darren@) for every business's camp/clinic signups. It now goes through
  // alertAddressing(settings) (migration 00282), the same addressing every
  // other coach alert uses.
  describe("sendAdminNewSignupEmail — routed through alertAddressing (migration 00282)", () => {
    it("sends to alert_email, cc reply_to, when the business has set alert_email (was: hard-coded to darren@)", async () => {
      getBusinessSettingsMock.mockResolvedValueOnce({
        business_id: "biz-event-1",
        alert_email: "sales@example.com",
        reply_to: "coach@example.com",
      })

      const { sendAdminNewSignupEmail } = await import("@/lib/email")
      await sendAdminNewSignupEmail(mockSignup, mockEvent)

      expect(getBusinessSettingsMock).toHaveBeenCalledWith("biz-event-1")
      expect(sendMock).toHaveBeenCalledTimes(1)
      const call = sendMock.mock.calls[0][0]
      expect(call.to).toBe("sales@example.com")
      expect(call.cc).toBe("coach@example.com")
      expect(call.subject).toContain("Sam Doe")
      expect(call.subject).toContain("Spring Agility Clinic")
      expect(call.html).toContain("alex@example.com")
      expect(call.html).toContain("555-0100")
      expect(call.html).toContain("Pulled hamstring")
      expect(call.html).toContain("/admin/events/evt-1")
    })

    it("sends to reply_to alone, no cc, when alert_email is not set", async () => {
      getBusinessSettingsMock.mockResolvedValueOnce({
        business_id: "biz-event-1",
        alert_email: null,
        reply_to: "coach@example.com",
      })

      const { sendAdminNewSignupEmail } = await import("@/lib/email")
      await sendAdminNewSignupEmail(mockSignup, mockEvent)

      expect(sendMock).toHaveBeenCalledTimes(1)
      const call = sendMock.mock.calls[0][0]
      expect(call.to).toBe("coach@example.com")
      expect(call.cc).toBeUndefined()
    })

    it("sends nothing and warns, without throwing, when neither alert_email nor reply_to is set", async () => {
      getBusinessSettingsMock.mockResolvedValueOnce({
        business_id: "biz-event-1",
        alert_email: null,
        reply_to: "",
      })
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

      const { sendAdminNewSignupEmail } = await import("@/lib/email")
      await expect(sendAdminNewSignupEmail(mockSignup, mockEvent)).resolves.toBeUndefined()

      expect(sendMock).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("biz-event-1"))
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("alert_email"))
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("reply_to"))
      warnSpy.mockRestore()
    })

    it("reads settings for the EVENT's business, not the signup's own business_id", async () => {
      // MUTANT: reading signup.business_id ("biz-signup-1") instead of
      // event.business_id ("biz-event-1") would still call
      // getBusinessSettings, just with the wrong id — this assertion is what
      // catches that, not merely "was it called".
      getBusinessSettingsMock.mockResolvedValueOnce({
        business_id: "biz-event-1",
        alert_email: "sales@example.com",
        reply_to: "coach@example.com",
      })

      const { sendAdminNewSignupEmail } = await import("@/lib/email")
      await sendAdminNewSignupEmail(mockSignup, mockEvent)

      expect(getBusinessSettingsMock).toHaveBeenCalledTimes(1)
      expect(getBusinessSettingsMock).toHaveBeenCalledWith("biz-event-1")
      expect(getBusinessSettingsMock).not.toHaveBeenCalledWith("biz-signup-1")
    })
  })
})
