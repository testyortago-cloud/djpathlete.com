// @vitest-environment node
//
// POST /api/inquiry's pipeline hook (gap #8 phase 1.5, Task B). Same mocking
// shape as __tests__/api/spine/inquiry-spine.test.ts, which already covers
// this route's contact-spine and SMS-consent writes — this file is scoped to
// the NEW pipeline call only, mocking @/lib/db/pipeline's applyPipelineEvent
// directly rather than the Supabase client three layers under it.
// routeToPipeline (lib/lead-engine/pipeline-route.ts) is pure and left real.

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
  applyPipelineEvent: vi.fn(),
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
// THE ONE NEW MOCK for this file — everything else mirrors inquiry-spine.test.ts.
vi.mock("@/lib/db/pipeline", () => ({
  applyPipelineEvent: mocks.applyPipelineEvent,
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

function req(body: Record<string, unknown>) {
  return new Request("http://test/api/inquiry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

async function post(body: Record<string, unknown>) {
  return POST(req(body) as never, { params: Promise.resolve({}) } as never)
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
  mocks.applyPipelineEvent.mockResolvedValue({ decision: { kind: "create", toStageKey: "x", trigger: "inquiry" }, opportunityId: "opp-1" })
})

describe("POST /api/inquiry — pipeline hook (Task B)", () => {
  it("calls applyPipelineEvent with an inquiry event carrying the submitted service and the resolved tenant", async () => {
    const res = await post({ ...VALID_BODY, service: "assessment" })
    expect(res.status).toBe(200)

    expect(mocks.applyPipelineEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: "contact-1",
        businessId: "host-biz",
        event: expect.objectContaining({ kind: "inquiry", serviceType: "assessment" }),
        // routeToPipeline({ event: "inquiry", serviceType: "assessment" })
        // resolves to the Assessment board — real routing table, not mocked.
        pipelineKey: "assessment",
      }),
    )
  })

  it("routes a non-assessment service to Coaching explicitly (routeToPipeline never refuses an inquiry)", async () => {
    await post({ ...VALID_BODY, service: "in_person" })

    expect(mocks.applyPipelineEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ serviceType: "in_person" }),
        pipelineKey: "coaching",
      }),
    )
  })

  it("never calls applyPipelineEvent when no contact was captured", async () => {
    mocks.recordContactEvent.mockRejectedValueOnce(new Error("db down"))

    const res = await post(VALID_BODY)

    expect(res.status).toBe(200)
    expect(mocks.applyPipelineEvent).not.toHaveBeenCalled()
  })

  it("never changes the route's response or existing writes when applyPipelineEvent throws — a misconfigured board must not fail the enquiry", async () => {
    mocks.applyPipelineEvent.mockRejectedValueOnce(new Error("no pipeline configured"))

    const res = await post({ ...VALID_BODY, service: "assessment" })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true })
    // The rest of the route's writes still ran.
    expect(mocks.createLeadInquiry).toHaveBeenCalledTimes(1)
    expect(mocks.sendInquiryEmail).toHaveBeenCalledTimes(1)
    expect(mocks.sendInquiryAutoReply).toHaveBeenCalledTimes(1)
    expect(mocks.ghlCreateContact).toHaveBeenCalledTimes(1)
  })

  it("never changes the route's response when applyPipelineEvent rejects with a PipelineNotConfiguredError-shaped error", async () => {
    class FakeNotConfigured extends Error {}
    mocks.applyPipelineEvent.mockRejectedValueOnce(new FakeNotConfigured("board missing"))

    const res = await post({ ...VALID_BODY, service: "assessment" })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
  })
})
