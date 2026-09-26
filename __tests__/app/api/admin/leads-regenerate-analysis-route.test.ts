// @vitest-environment node
//
// POST /api/admin/leads/[id]/regenerate-analysis — G45. The route reads the
// inquiry under the ADMIN'S RESOLVED TENANT and writes the AI fields back
// under it. An id belonging to another business reads as not found, before
// any model call, generation log or audit row.

import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const canAccessAdminPathMock = vi.fn()
const resolveTenantMock = vi.fn()
const getLeadInquiryByIdMock = vi.fn()
const updateAiFieldsMock = vi.fn()
const generateMock = vi.fn()
const createLogMock = vi.fn()
const updateLogMock = vi.fn()
const recordAuditMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: (...a: unknown[]) => canAccessAdminPathMock(...a) }))
vi.mock("@/lib/tenancy/resolve", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tenancy/resolve")>()),
  resolveAdminTenantForRequest: (...a: unknown[]) => resolveTenantMock(...a),
}))
vi.mock("@/lib/db/lead-inquiries", () => ({
  getLeadInquiryById: (...a: unknown[]) => getLeadInquiryByIdMock(...a),
  updateLeadInquiryAiFields: (...a: unknown[]) => updateAiFieldsMock(...a),
}))
vi.mock("@/lib/ai/lead-analysis", () => ({ generateLeadAnalysis: (...a: unknown[]) => generateMock(...a) }))
vi.mock("@/lib/db/ai-generation-log", () => ({
  createGenerationLog: (...a: unknown[]) => createLogMock(...a),
  updateGenerationLog: (...a: unknown[]) => updateLogMock(...a),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAuditMock(...a) }))
vi.mock("@/lib/ai/anthropic", () => ({ MODEL_SONNET: "sonnet" }))

import { NextRequest } from "next/server"
import { POST } from "@/app/api/admin/leads/[id]/regenerate-analysis/route"

// A sentinel that is NOT the platform id, so a route that reads under
// platformBusinessId() (or no tenant) cannot pass.
const TENANT = "dddddddd-0000-4000-8000-00000000000d"
const ID = "eeeeeeee-0000-4000-8000-00000000000e"

function call() {
  const req = new NextRequest(`http://localhost/api/admin/leads/${ID}/regenerate-analysis`, { method: "POST" })
  return POST(req, { params: Promise.resolve({ id: ID }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  canAccessAdminPathMock.mockResolvedValue(true)
  resolveTenantMock.mockResolvedValue({ businessId: TENANT, choices: [], isOperator: false })
  getLeadInquiryByIdMock.mockResolvedValue({
    id: ID,
    business_id: TENANT,
    lead_user_id: null,
    name: "Jordan Blake",
    service: "in_person",
    sport: "Soccer",
    experience: null,
    goals: "Speed",
    injuries: null,
    how_heard: null,
  })
  createLogMock.mockResolvedValue({ id: "log-1" })
  updateLogMock.mockResolvedValue(undefined)
  generateMock.mockResolvedValue({
    content: { priority: "high", priority_reason: "r", summary: "s", draft_reply: "d" },
    tokens_used: 1,
  })
  updateAiFieldsMock.mockResolvedValue({ id: ID })
  recordAuditMock.mockResolvedValue(undefined)
})

describe("regenerate-analysis is tenant-scoped", () => {
  it("reads the inquiry under the admin's resolved tenant", async () => {
    await call()
    expect(getLeadInquiryByIdMock).toHaveBeenCalledWith(TENANT, ID)
  })

  it("writes the AI fields back under the same tenant", async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(updateAiFieldsMock.mock.calls[0][0]).toBe(TENANT)
    expect(updateAiFieldsMock.mock.calls[0][1]).toBe(ID)
  })

  it("answers 404, and spends nothing, for an id this business does not have", async () => {
    getLeadInquiryByIdMock.mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(404)
    expect(generateMock).not.toHaveBeenCalled()
    expect(createLogMock).not.toHaveBeenCalled()
    expect(recordAuditMock).not.toHaveBeenCalled()
  })

  it("answers 403, not 500, for a signed-in user who can reach no business", async () => {
    const { NoAccessibleBusinessError } = await import("@/lib/tenancy/resolve")
    resolveTenantMock.mockRejectedValue(new NoAccessibleBusinessError())
    const res = await call()
    expect(res.status).toBe(403)
    expect(getLeadInquiryByIdMock).not.toHaveBeenCalled()
  })

  it("answers 500, not 'not found', when the read itself fails", async () => {
    getLeadInquiryByIdMock.mockRejectedValue(new Error("getLeadInquiryById: timeout"))
    const res = await call()
    expect(res.status).toBe(500)
    expect(generateMock).not.toHaveBeenCalled()
  })
})
