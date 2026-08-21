// @vitest-environment node
//
// POST /api/inquiry joining the contact spine, and its SMS consent write.
// recordContactEvent and recordConsent are mocked directly (the lighter
// approach shop-leads-spine.test.ts and contact-spine.test.ts use — no
// enrolment proof is required for this route). The `users`/`lead_inquiries`-
// adjacent Supabase stub mirrors __tests__/api/inquiry/attribution-capture.test.ts,
// which this route's pre-existing attribution suite already exercises.

import { describe, it, expect, vi, beforeEach } from "vitest"

type Row = Record<string, any>

const state: { users: Row[] } = { users: [] }

const mocks = vi.hoisted(() => ({
  createLeadInquiry: vi.fn(),
  updateLeadInquiryAiFields: vi.fn(),
  getAttributionBySession: vi.fn(),
  claimAttribution: vi.fn(),
  ghlCreateContact: vi.fn(),
  ghlTriggerWorkflow: vi.fn(),
  sendInquiryEmail: vi.fn(),
  sendInquiryAutoReply: vi.fn(),
  generateLeadAnalysis: vi.fn(),
  createGenerationLog: vi.fn(),
  updateGenerationLog: vi.fn(),
  recordAudit: vi.fn(),
  recordContactEvent: vi.fn(),
  recordConsent: vi.fn(),
  getBusinessSettings: vi.fn(),
}))

vi.mock("@/lib/db/lead-inquiries", () => ({
  createLeadInquiry: mocks.createLeadInquiry,
  updateLeadInquiryAiFields: mocks.updateLeadInquiryAiFields,
}))
vi.mock("@/lib/db/marketing-attribution", () => ({
  getAttributionBySession: mocks.getAttributionBySession,
  claimAttribution: mocks.claimAttribution,
}))
vi.mock("@/lib/ghl", () => ({
  ghlCreateContact: mocks.ghlCreateContact,
  ghlTriggerWorkflow: mocks.ghlTriggerWorkflow,
}))
vi.mock("@/lib/email", () => ({
  sendInquiryEmail: mocks.sendInquiryEmail,
  sendInquiryAutoReply: mocks.sendInquiryAutoReply,
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: mocks.recordAudit }))
vi.mock("@/lib/audit/with-audit", () => ({
  withAudit: (_cfg: unknown, handler: unknown) => handler,
}))
// AI enrichment is opt-in downstream of the inquiry row; keep it inert.
vi.mock("@/lib/ai/lead-analysis", () => ({ generateLeadAnalysis: mocks.generateLeadAnalysis }))
vi.mock("@/lib/db/ai-generation-log", () => ({
  createGenerationLog: mocks.createGenerationLog,
  updateGenerationLog: mocks.updateGenerationLog,
}))
vi.mock("@/lib/db/contacts", () => ({
  recordContactEvent: mocks.recordContactEvent,
}))
vi.mock("@/lib/db/contact-consents", () => ({
  recordConsent: mocks.recordConsent,
}))
vi.mock("@/lib/db/businesses", () => ({
  getBusinessSettings: mocks.getBusinessSettings,
}))

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "users") {
        return {
          select: () => ({
            eq: (field: string, value: unknown) => ({
              maybeSingle: async () => ({
                data: state.users.find((u) => u[field] === value) ?? null,
              }),
              // admins lookup: `await supabase.from("users").select("id").eq("role","admin")`
              then: (resolve: any) => resolve({ data: state.users.filter((u) => u[field] === value), error: null }),
            }),
          }),
          insert: (payload: Row) => ({
            select: () => ({
              single: async () => {
                const row = { id: `user-${state.users.length + 1}`, ...payload }
                state.users.push(row)
                return { data: row, error: null }
              },
            }),
          }),
          update: () => ({ eq: async () => ({}) }),
        }
      }
      return {
        insert: async () => ({ error: null }),
        select: () => ({ eq: async () => ({ data: [] }) }),
      }
    },
  }),
}))

import { POST } from "@/app/api/inquiry/route"

const VALID_BODY = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "5551234567",
  service: "in_person",
  goals: "Return to sprinting after a hamstring strain this season.",
  how_heard: "Google",
}

function req(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request("http://test/api/inquiry", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

async function post(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return POST(req(body, headers) as never, { params: Promise.resolve({}) } as never)
}

/** The SMS consent write runs fire-and-forget; give its microtask chain a turn. */
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  state.users = []
  vi.clearAllMocks()
  mocks.createLeadInquiry.mockResolvedValue({ id: "inquiry-1" })
  mocks.claimAttribution.mockResolvedValue(undefined)
  mocks.getAttributionBySession.mockResolvedValue(null)
  mocks.ghlCreateContact.mockResolvedValue({ id: "ghl-1" })
  mocks.ghlTriggerWorkflow.mockResolvedValue(undefined)
  mocks.sendInquiryEmail.mockResolvedValue(undefined)
  mocks.sendInquiryAutoReply.mockResolvedValue(undefined)
  mocks.recordContactEvent.mockResolvedValue({ contactId: "contact-1", created: true, merged: false })
  mocks.recordConsent.mockResolvedValue(undefined)
  mocks.getBusinessSettings.mockResolvedValue({ business_id: "biz-1", display_name: "Acme Fitness" })
})

describe("POST /api/inquiry — joins the contact spine", () => {
  it("calls recordContactEvent with source inquiry, email, phone, name", async () => {
    const res = await post(VALID_BODY)
    expect(res.status).toBe(200)

    expect(mocks.recordContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "ada@example.com",
        phone: "5551234567",
        name: "Ada Lovelace",
        source: "inquiry",
      }),
    )
  })

  it("passes through exactly the four attribution fields the route already resolves — none re-derived", async () => {
    mocks.getAttributionBySession.mockResolvedValue({
      id: "attr-1",
      gclid: "server-gclid",
      gbraid: "server-gbraid",
      wbraid: "server-wbraid",
      fbclid: "server-fbclid",
      claimed_at: null,
    })

    await post(VALID_BODY, { cookie: "djp_attr=sess-abc" })

    expect(mocks.recordContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          gclid: "server-gclid",
          gbraid: "server-gbraid",
          wbraid: "server-wbraid",
          fbclid: "server-fbclid",
        }),
      }),
    )
  })

  it("passes null for every attribution field when there is nothing to resolve — never invents a value", async () => {
    mocks.getAttributionBySession.mockResolvedValue(null)

    await post(VALID_BODY)

    expect(mocks.recordContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ gclid: null, gbraid: null, wbraid: null, fbclid: null }),
      }),
    )
  })

  it("never changes the route's response or existing writes when recordContactEvent throws", async () => {
    mocks.recordContactEvent.mockRejectedValueOnce(new Error("PGRST204 column missing"))

    const res = await post(VALID_BODY)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(mocks.createLeadInquiry).toHaveBeenCalledTimes(1)
    expect(mocks.sendInquiryEmail).toHaveBeenCalledTimes(1)
    expect(mocks.sendInquiryAutoReply).toHaveBeenCalledTimes(1)
    expect(mocks.ghlCreateContact).toHaveBeenCalledTimes(1)
  })
})

describe("POST /api/inquiry — SMS consent", () => {
  it("writes a consent row quoting the exact rendered wording when sms_consent is true and phone is present", async () => {
    const res = await post(
      { ...VALID_BODY, sms_consent: true },
      { "x-forwarded-for": "203.0.113.9", "user-agent": "test-agent/1.0" },
    )
    await flush()

    expect(res.status).toBe(200)
    expect(mocks.recordConsent).toHaveBeenCalledWith({
      contactId: "contact-1",
      channel: "sms",
      granted: true,
      source: "inquiry",
      wordingShown:
        "I agree to receive text messages from Acme Fitness about my inquiry. Message and data rates may apply. Reply STOP to opt out, HELP for help.",
      ip: "203.0.113.9",
      userAgent: "test-agent/1.0",
    })
  })

  it("writes no consent row when sms_consent is false", async () => {
    const res = await post({ ...VALID_BODY, sms_consent: false })
    await flush()

    expect(res.status).toBe(200)
    expect(mocks.recordConsent).not.toHaveBeenCalled()
  })

  it("writes no consent row when sms_consent is absent from the payload", async () => {
    const res = await post(VALID_BODY)
    await flush()

    expect(res.status).toBe(200)
    expect(mocks.recordConsent).not.toHaveBeenCalled()
  })

  it("writes no consent row when sms_consent is true but no phone was submitted", async () => {
    const res = await post({ ...VALID_BODY, phone: undefined, sms_consent: true })
    await flush()

    expect(res.status).toBe(200)
    expect(mocks.recordConsent).not.toHaveBeenCalled()
  })

  it("writes no consent row when sms_consent is true but no contact was captured", async () => {
    mocks.recordContactEvent.mockRejectedValueOnce(new Error("db down"))
    const res = await post({ ...VALID_BODY, sms_consent: true })
    await flush()

    expect(res.status).toBe(200)
    expect(mocks.recordConsent).not.toHaveBeenCalled()
  })

  it("writes no consent row when business_settings.display_name is blank, even though sms_consent is true and phone is present — the lead is still captured", async () => {
    mocks.getBusinessSettings.mockResolvedValue({ business_id: "biz-1", display_name: "" })
    const res = await post({ ...VALID_BODY, sms_consent: true })
    await flush()

    expect(res.status).toBe(200)
    expect(mocks.recordContactEvent).toHaveBeenCalledTimes(1)
    expect(mocks.recordConsent).not.toHaveBeenCalled()
  })

  it("writes no consent row when business_settings.display_name is whitespace-only", async () => {
    mocks.getBusinessSettings.mockResolvedValue({ business_id: "biz-1", display_name: "   " })
    const res = await post({ ...VALID_BODY, sms_consent: true })
    await flush()

    expect(res.status).toBe(200)
    expect(mocks.recordConsent).not.toHaveBeenCalled()
  })

  it("still returns success, and the lead is still captured, when the consent write itself throws", async () => {
    mocks.recordConsent.mockRejectedValue(new Error("db is down"))
    const res = await post({ ...VALID_BODY, sms_consent: true })
    await flush()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(mocks.recordContactEvent).toHaveBeenCalled()
    expect(mocks.recordConsent).toHaveBeenCalled()
  })
})
