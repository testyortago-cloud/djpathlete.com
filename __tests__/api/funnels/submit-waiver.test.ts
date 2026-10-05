// @vitest-environment node
//
// POST /api/funnels/submit — the liability waiver on a plain (non-checkout)
// form, such as the pre-visit onboarding form.
//
// A waiver tick is a legal gate, so two things must hold on ANY form, not
// only a checkout one:
//   1. A tick the visitor did not give is refused. `required` alone only
//      rejects "", and a client can post "false".
//   2. The submission files WHICH waiver document was in force when they
//      ticked it (00288). The row already carries their IP and user agent.
// A form with no waiver tick must not pay for a legal_documents read, and its
// row must carry no waiver columns at all (that is what keeps every ordinary
// lead safe from the 00288 deploy race).

import { describe, expect, it, vi, beforeEach } from "vitest"

const getPublishedFormConfig = vi.fn()
const createSubmission = vi.fn()
const getActiveDocument = vi.fn()

vi.mock("@/lib/db/funnels", () => ({
  getPublishedFormConfig: (...a: unknown[]) => getPublishedFormConfig(...a),
  createSubmission: (...a: unknown[]) => createSubmission(...a),
  getFunnelById: vi.fn(async () => ({ id: "f1", name: "Onboarding", status: "published", notify_emails: null })),
  getStep: vi.fn(async () => ({
    id: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
    funnel_id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
    slug: "index",
    name: "Landing page",
  })),
  listSteps: vi.fn(async () => []),
}))
vi.mock("@/lib/db/legal-documents", () => ({
  getActiveDocument: (...a: unknown[]) => getActiveDocument(...a),
}))
vi.mock("@/lib/funnels/capture-contact", () => ({ captureContactFromSubmission: vi.fn(async () => null) }))
vi.mock("@/lib/db/contact-consents", () => ({ recordConsent: vi.fn() }))
vi.mock("@/lib/db/businesses", () => ({
  getBusinessSettings: vi.fn(async () => ({ business_id: "biz-1", display_name: "Acme Fitness" })),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/email", () => ({ sendNewFunnelLeadEmail: vi.fn(async () => undefined) }))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: vi.fn(async () => false) }))
vi.mock("@/lib/db/marketing-attribution", () => ({ getAttributionBySession: vi.fn(async () => null) }))
vi.mock("@/lib/marketing/cookies", () => ({ parseAttrCookie: () => null }))
vi.mock("@/lib/db/events", () => ({ getEventById: vi.fn(async () => null) }))
vi.mock("@/lib/events/checkout", () => ({ createEventSignupCheckout: vi.fn() }))
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: async () => "host-biz" }))

import { POST } from "@/app/api/funnels/submit/route"

const WAIVER_FORM = [
  { name: "first_name", label: "First name", type: "text" },
  { name: "waiver", label: "I agree to the liability waiver above.", type: "checkbox", required: true, role: "waiver_accepted" },
]
const PLAIN_FORM = [{ name: "first_name", label: "First name", type: "text", required: true }]

let ipCounter = 0
/** No email value, so the route never reaches `upsertLead` (real Supabase client). */
function request(values: Record<string, string>) {
  ipCounter += 1
  return new Request("http://t.test/api/funnels/submit", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "test-agent", "x-forwarded-for": `198.51.100.${ipCounter}` },
    body: JSON.stringify({
      funnelId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
      stepId: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
      formKey: "pre-visit",
      values,
      elapsedMs: 9000,
    }),
  })
}

beforeEach(() => {
  getPublishedFormConfig.mockReset().mockResolvedValue({ formKey: "pre-visit", successMode: "message", fields: WAIVER_FORM })
  createSubmission.mockReset().mockResolvedValue({ id: "sub1" })
  getActiveDocument.mockReset().mockResolvedValue({ id: "doc-7", content: "Assumption of risk" })
})

describe("POST /api/funnels/submit — waiver on a plain form", () => {
  it("files the waiver document in force and when it was accepted", async () => {
    const before = Date.now()
    const res = await POST(request({ first_name: "Sam", waiver: "on" }))
    expect(res.status).toBe(200)
    expect(getActiveDocument).toHaveBeenCalledWith("liability_waiver")
    const row = createSubmission.mock.calls[0][1]
    expect(row.waiver_document_id).toBe("doc-7")
    expect(Date.parse(row.waiver_accepted_at)).toBeGreaterThanOrEqual(before - 1000)
    // The evidence the row already carried, still carried.
    expect(row.user_agent).toBe("test-agent")
    expect(row.ip_address).toMatch(/^198\.51\.100\./)
  })

  it.each(["false", "0", "off", "FALSE"])("refuses a waiver posted as %j, and files nothing", async (value) => {
    // MUTANT KILLED: relying on `required`, which only rejects "".
    const res = await POST(request({ first_name: "Sam", waiver: value }))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toContain("I agree to the liability waiver above.")
    expect(createSubmission).not.toHaveBeenCalled()
  })

  it("still files the acceptance when no waiver document is active, with no document id", async () => {
    // Same choice the event signup makes (lib/events/checkout.ts): the visitor
    // DID tick it, and dropping that would lose the half of the evidence we have.
    getActiveDocument.mockResolvedValue(null)
    const res = await POST(request({ first_name: "Sam", waiver: "on" }))
    expect(res.status).toBe(200)
    const row = createSubmission.mock.calls[0][1]
    expect(row.waiver_document_id).toBeNull()
    expect(typeof row.waiver_accepted_at).toBe("string")
  })

  it("keeps the lead when the waiver document cannot be read", async () => {
    // MUTANT KILLED: awaiting getActiveDocument without a catch, which 500s and
    // loses the lead over a read that only labels the evidence.
    getActiveDocument.mockRejectedValue(new Error("db unreachable"))
    const res = await POST(request({ first_name: "Sam", waiver: "on" }))
    expect(res.status).toBe(200)
    const row = createSubmission.mock.calls[0][1]
    expect(row.waiver_document_id).toBeNull()
    expect(typeof row.waiver_accepted_at).toBe("string")
  })

  it("reads no legal document, and writes no waiver columns, for a form without a waiver", async () => {
    getPublishedFormConfig.mockResolvedValue({ formKey: "pre-visit", successMode: "message", fields: PLAIN_FORM })
    const res = await POST(request({ first_name: "Sam" }))
    expect(res.status).toBe(200)
    expect(getActiveDocument).not.toHaveBeenCalled()
    const row = createSubmission.mock.calls[0][1]
    expect(row).not.toHaveProperty("waiver_document_id")
    expect(row).not.toHaveProperty("waiver_accepted_at")
  })
})
