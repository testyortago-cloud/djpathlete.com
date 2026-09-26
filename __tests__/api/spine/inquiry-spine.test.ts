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

const state: { users: Row[]; notifications: Row[] } = { users: [], notifications: [] }

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
  listBusinessMemberUserIds: vi.fn(),
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
// The bell's recipients (G35). Only the reader is replaced: LEAD_ALERT_ROLES
// stays the real constant, so the call assertions below check what the route
// actually passes.
vi.mock("@/lib/db/business-members", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/business-members")>()),
  listBusinessMemberUserIds: mocks.listBusinessMemberUserIds,
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
              // The pre-G35 admin read (`.eq("role", "admin")`) resolved through
              // here. Kept so the bell tests below can seed a platform admin that
              // a route still making that read would find.
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
        // `notifications` rows are kept so the bell tests can say who was told;
        // every other table's insert is accepted and forgotten.
        insert: async (payload: Row | Row[]) => {
          if (table === "notifications") state.notifications.push(...(Array.isArray(payload) ? payload : [payload]))
          return { error: null }
        },
        select: () => ({ eq: async () => ({ data: [] }) }),
      }
    },
  }),
}))
// The route resolves its tenant from the request's Host through the ONE Host
// boundary (lib/tenancy/public.ts). Mocked to a sentinel that is not the
// platform's, so a route that hard-codes platformBusinessId() cannot pass.
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: async () => "host-biz" }))

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
  state.notifications = []
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
  // Nobody to bell unless a test says otherwise: the state every older test
  // here was written against (no admin in `state.users`), which also keeps the
  // lead analysis off, as it was.
  mocks.listBusinessMemberUserIds.mockResolvedValue([])
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

  it("records source step_up when form_context is step_up — StepUpInquiryForm's own identity", async () => {
    const res = await post({ ...VALID_BODY, form_context: "step_up" })
    expect(res.status).toBe(200)

    expect(mocks.recordContactEvent).toHaveBeenCalledWith(expect.objectContaining({ source: "step_up" }))
  })

  it("still records source inquiry when form_context is absent — the plain InquiryForm default", async () => {
    const res = await post(VALID_BODY)
    expect(res.status).toBe(200)

    expect(mocks.recordContactEvent).toHaveBeenCalledWith(expect.objectContaining({ source: "inquiry" }))
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

  // G10. Until this shipped the route passed NO event metadata at all, so
  // every applicant looked identical to the engine and
  // `service_application_received` could not say one thing to someone asking
  // about a camp and another to someone asking about coaching.
  it("carries the service the applicant chose, so a sequence can branch on camp versus coaching", async () => {
    await post({ ...VALID_BODY, service: "camp" })

    expect(mocks.recordContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ service: "camp" }) }),
    )
  })

  it("carries whichever service was chosen, not a fixed one", async () => {
    // The control: an implementation that hard-coded "camp" would satisfy
    // the test above.
    await post({ ...VALID_BODY, service: "assessment" })

    expect(mocks.recordContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ service: "assessment" }) }),
    )
  })

  // G16 {{sport}}. The form collected "Sport / Activity" and the route threw
  // it away, so `{{sport}}` rendered blank for every applicant.
  it("carries the sport the applicant typed, trimmed", async () => {
    await post({ ...VALID_BODY, sport: "  Soccer " })

    expect(mocks.recordContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ service: "in_person", sport: "Soccer" }) }),
    )
  })

  it("leaves sport out when the applicant left the box empty", async () => {
    await post(VALID_BODY)

    const metadata = mocks.recordContactEvent.mock.calls[0][0].metadata as Record<string, unknown>
    expect(metadata).not.toHaveProperty("sport")
    expect(metadata.service).toBe("in_person") // presence control: the bag itself was sent
  })

  it("does not pass a sport answer carrying a phone number anywhere into the engine", async () => {
    // The box is free text a stranger fills in. The event metadata is written
    // to the contact's timeline and matched against trigger filters before the
    // run's own allow-list ever sees it, so the route applies that allow-list
    // itself: what fails it never leaves the route.
    await post({ ...VALID_BODY, sport: "Soccer, text me on 0412 345 678" })

    const metadata = mocks.recordContactEvent.mock.calls[0][0].metadata as Record<string, unknown>
    expect(metadata).not.toHaveProperty("sport")
    expect(metadata.service).toBe("in_person")
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

    // "It was called" is not "it was called about the right tenant". Both
    // mailers resolve the sender identity and the coach's mailbox from this
    // id, so a route that dropped it would send a perfectly well-formed email
    // from the wrong business, and every count above would still be 1.
    expect(mocks.sendInquiryEmail.mock.calls[0][0]).toMatchObject({ businessId: "host-biz" })
    expect(mocks.sendInquiryAutoReply.mock.calls[0][0]).toMatchObject({ businessId: "host-biz" })
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
      businessId: "host-biz",
    })
  })

  it("consent row's source follows the same step_up mapping as the spine event", async () => {
    const res = await post(
      { ...VALID_BODY, sms_consent: true, form_context: "step_up" },
      { "x-forwarded-for": "203.0.113.9", "user-agent": "test-agent/1.0" },
    )
    await flush()

    expect(res.status).toBe(200)
    expect(mocks.recordConsent).toHaveBeenCalledWith(expect.objectContaining({ source: "step_up" }))
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

describe("POST /api/inquiry — tenant", () => {
  it("resolves the tenant once through the seam and threads it into the contact, the settings read and the consent row", async () => {
    await post({ ...VALID_BODY, sms_consent: true })
    await flush()
    expect(mocks.recordContactEvent.mock.calls[0][0]).toMatchObject({ businessId: "host-biz" })
    expect(mocks.getBusinessSettings).toHaveBeenCalledWith("host-biz")
    expect(mocks.recordConsent.mock.calls[0][0]).toMatchObject({ businessId: "host-biz" })
  })
})

// G45. `lead_inquiries` gained `business_id` (00280). The route stamps the
// Host's business on the row, and its AI-fields write names the same business,
// so the admin by-id read (which now carries the tenant) finds the row under
// the business that received it. "host-biz" is the Host mock above, NOT the
// platform id, so a route that stamped platformBusinessId() fails this.
describe("POST /api/inquiry — the inquiry row carries its business (G45)", () => {
  beforeEach(() => {
    mocks.createGenerationLog.mockResolvedValue({ id: "log-1" })
    mocks.updateGenerationLog.mockResolvedValue(undefined)
    mocks.updateLeadInquiryAiFields.mockResolvedValue(undefined)
    mocks.recordAudit.mockResolvedValue(undefined)
    mocks.generateLeadAnalysis.mockResolvedValue({
      content: { priority: "high", priority_reason: "Ready now", summary: "Sprinter", draft_reply: "Hi Ada" },
      tokens_used: 10,
    })
    mocks.listBusinessMemberUserIds.mockResolvedValue(["owner-1"])
  })

  it("stamps the Host's business on the inquiry it writes", async () => {
    await post(VALID_BODY)
    expect(mocks.createLeadInquiry).toHaveBeenCalledWith(expect.objectContaining({ business_id: "host-biz" }))
  })

  it("writes the AI fields back under the same business", async () => {
    await post(VALID_BODY)
    expect(mocks.updateLeadInquiryAiFields).toHaveBeenCalledTimes(1)
    expect(mocks.updateLeadInquiryAiFields.mock.calls[0][0]).toBe("host-biz")
    expect(mocks.updateLeadInquiryAiFields.mock.calls[0][1]).toBe("inquiry-1")
  })
})

// G35. Same change as POST /api/contact: the bell goes to the site business's
// owners and coaches, not to every `users.role = 'admin'` row. This route also
// named its FIRST admin as the requester of the lead analysis, so that moves
// with it. PLATFORM_ADMIN is what the old read would have found.
describe("POST /api/inquiry — who gets the bell (G35)", () => {
  const PLATFORM_ADMIN = { id: "platform-admin", email: "ops@example.com", role: "admin" }

  beforeEach(() => {
    // With a recipient present the lead analysis runs, so its collaborators
    // answer the way the real ones do. A bare vi.fn() returns undefined, and the
    // route's failure path calls `recordAudit(...).catch`, which would throw
    // into the outer catch and turn every test here into a 500.
    mocks.createGenerationLog.mockResolvedValue({ id: "log-1" })
    mocks.updateGenerationLog.mockResolvedValue(undefined)
    mocks.updateLeadInquiryAiFields.mockResolvedValue(undefined)
    mocks.recordAudit.mockResolvedValue(undefined)
    mocks.generateLeadAnalysis.mockResolvedValue({
      content: { priority: "high", priority_reason: "Ready now", summary: "Sprinter", draft_reply: "Hi Ada" },
      tokens_used: 10,
    })
  })

  it("bells the site business's owners and coaches, not every platform admin", async () => {
    // MUTANT: the old `users where role = 'admin'` read — it bells
    // platform-admin and neither owner-1 nor coach-1. MUTANT: the platform's
    // id, or `staff` among the roles — the call assertion fails.
    state.users = [PLATFORM_ADMIN]
    mocks.listBusinessMemberUserIds.mockResolvedValue(["owner-1", "coach-1"])

    const res = await post(VALID_BODY)

    expect(res.status).toBe(200)
    expect(mocks.listBusinessMemberUserIds).toHaveBeenCalledWith("host-biz", ["owner", "coach"])
    expect(state.notifications.map((n) => n.user_id)).toEqual(["owner-1", "coach-1"])
  })

  it("names the business's first owner or coach as the analysis requester, not a platform admin", async () => {
    // MUTANT: the requester still taken from the `users` admin read — the log
    // row and the audit actor would both name platform-admin.
    state.users = [PLATFORM_ADMIN]
    mocks.listBusinessMemberUserIds.mockResolvedValue(["owner-1", "coach-1"])

    await post(VALID_BODY)

    expect(mocks.createGenerationLog).toHaveBeenCalledWith(expect.objectContaining({ requested_by: "owner-1" }))
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "lead.ai_analysis_generated", actor: { id: "owner-1", role: "system" } }),
    )
  })

  it("files no bell and runs no analysis for a business with no owner or coach — never the platform's admins", async () => {
    // MUTANT: an empty recipient list falling back to the `users` admin read.
    state.users = [PLATFORM_ADMIN]
    mocks.listBusinessMemberUserIds.mockResolvedValue([])

    const res = await post(VALID_BODY)

    expect(res.status).toBe(200)
    expect(state.notifications).toEqual([])
    expect(mocks.createGenerationLog).not.toHaveBeenCalled()
    // Presence control: the rest of the route ran, so the absences above are
    // not the route having stopped early.
    expect(mocks.createLeadInquiry).toHaveBeenCalledTimes(1)
    expect(mocks.sendInquiryEmail).toHaveBeenCalledTimes(1)
  })

  it("logs a failed recipients read and still captures the inquiry and sends both emails", async () => {
    // MUTANT: a catch that swallows without logging, so the lost alert leaves
    // no trace. MUTANT: no catch at all — the throw reaches the route's outer
    // catch, and an applicant who already submitted is told it went wrong.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    state.users = [PLATFORM_ADMIN]
    mocks.listBusinessMemberUserIds.mockRejectedValue(
      new Error("listBusinessMemberUserIds failed (42P01): no such table"),
    )

    const res = await post(VALID_BODY)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(state.notifications).toEqual([])
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("no bell alert"),
      expect.objectContaining({ message: expect.stringContaining("42P01") }),
    )
    expect(mocks.createLeadInquiry).toHaveBeenCalledTimes(1)
    expect(mocks.sendInquiryEmail).toHaveBeenCalledTimes(1)
    expect(mocks.sendInquiryAutoReply).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })
})
