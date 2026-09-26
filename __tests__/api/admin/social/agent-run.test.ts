// POST /api/admin/social/agent/run — a manual social-agent run. No suite
// before G35; this one pins which business the job carries.
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  canAccessAdminPath: vi.fn(),
  createAiJob: vi.fn(),
  resolveAdminTenantForRequest: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: h.auth }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: h.canAccessAdminPath }))
vi.mock("@/lib/ai-jobs", () => ({ createAiJob: h.createAiJob }))
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz-g35" }))
// This route HAS a session, so "use the admin's selected business" is the
// tempting fix. It is the wrong one: the agent's subject is the platform's own
// blog whichever business is selected. The resolver is mocked to a DIFFERENT
// business so that mutant stamps "coach-b-biz" and fails the assertions below.
vi.mock("@/lib/tenancy/resolve", () => ({
  resolveAdminTenantForRequest: h.resolveAdminTenantForRequest,
  resolveAdminTenant: h.resolveAdminTenantForRequest,
  NoAccessibleBusinessError: class NoAccessibleBusinessError extends Error {},
}))

import { NextRequest } from "next/server"
import { POST } from "@/app/api/admin/social/agent/run/route"

function call(body: unknown) {
  return POST(
    new NextRequest("https://example.test/api/admin/social/agent/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  h.auth.mockReset()
  h.auth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  h.canAccessAdminPath.mockReset()
  h.canAccessAdminPath.mockResolvedValue(true)
  h.createAiJob.mockReset()
  h.createAiJob.mockResolvedValue({ jobId: "job-1", status: "pending" })
  h.resolveAdminTenantForRequest.mockReset()
  h.resolveAdminTenantForRequest.mockResolvedValue({ businessId: "coach-b-biz", choices: [], isOperator: true })
})

describe("POST /api/admin/social/agent/run", () => {
  // MUTANTS: no businessId (the route before G35); the admin's selected
  // business (resolveAdminTenantForRequest, mocked to coach-b-biz above).
  it("stamps the PLATFORM business, not the admin's selected one (G35)", async () => {
    const res = await call({})
    expect(res.status).toBe(202)
    expect(h.createAiJob).toHaveBeenCalledWith({
      type: "social_agent_run",
      userId: "admin-1",
      input: { platform: "linkedin", businessId: "platform-biz-g35" },
    })
  })

  it("keeps a manual topic override beside the stamp", async () => {
    await call({ blogPostId: "post-1" })
    expect(h.createAiJob).toHaveBeenCalledWith({
      type: "social_agent_run",
      userId: "admin-1",
      input: { platform: "linkedin", businessId: "platform-biz-g35", blogPostId: "post-1" },
    })
  })

  // Absence; the first test is its presence control (same mocks, a session).
  it("enqueues nothing without an admin session", async () => {
    h.auth.mockResolvedValueOnce(null)
    const res = await call({})
    expect(res.status).toBe(401)
    expect(h.createAiJob).not.toHaveBeenCalled()
  })
})
