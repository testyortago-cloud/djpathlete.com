// POST /api/admin/internal/social-agent-cron — the Tue/Thu cron's enqueue
// (functions/src/index.ts socialAgentCron fetches it with the cron bearer).
// This route had no suite; G35 gives it one for the claim it now makes: the
// job carries the business whose owners the agent's alert goes to, read from
// the platform seam.
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  createAiJob: vi.fn(),
  settings: {} as Record<string, unknown>,
  bearer: "",
}))

vi.mock("next/headers", () => ({
  headers: async () => new Headers(h.bearer ? { authorization: `Bearer ${h.bearer}` } : {}),
}))
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table !== "system_settings") throw new Error(`unexpected table ${table}`)
      return {
        select: () => ({
          eq: (_column: string, key: string) => ({
            maybeSingle: async () => ({
              data: key in h.settings ? { value: h.settings[key] } : null,
              error: null,
            }),
          }),
        }),
      }
    },
  }),
}))
vi.mock("@/lib/ai-jobs", () => ({ createAiJob: h.createAiJob }))
// A distinct id: nothing else in this job ("system", "linkedin") could produce it.
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz-g35" }))

import { NextRequest } from "next/server"
import { POST } from "@/app/api/admin/internal/social-agent-cron/route"

function call() {
  return POST(new NextRequest("https://example.test/api/admin/internal/social-agent-cron", { method: "POST" }))
}

beforeEach(() => {
  h.createAiJob.mockReset()
  h.createAiJob.mockResolvedValue({ jobId: "job-1", status: "pending" })
  h.settings = { automation_paused: false, cron_social_agent_enabled: true }
  h.bearer = "cron-secret"
  process.env.INTERNAL_CRON_TOKEN = "cron-secret"
})

describe("POST /api/admin/internal/social-agent-cron", () => {
  // MUTANTS: no businessId (the route before G35); `businessId: "system"`
  // (the job's userId). The exact-object assertion catches both.
  it("stamps the platform business into the job input, read from the seam (G35)", async () => {
    const res = await call()
    expect(await res.json()).toEqual({ jobId: "job-1", status: "pending" })
    expect(h.createAiJob).toHaveBeenCalledWith({
      type: "social_agent_run",
      userId: "system",
      input: { platform: "linkedin", businessId: "platform-biz-g35" },
    })
  })

  // Absence; the test above is its presence control (same mocks, gate open).
  it("enqueues nothing when the cron is switched off", async () => {
    h.settings.cron_social_agent_enabled = false
    const res = await call()
    expect(await res.json()).toEqual({ skipped: "cron_social_agent_enabled=false" })
    expect(h.createAiJob).not.toHaveBeenCalled()
  })

  it("401s a wrong bearer and enqueues nothing", async () => {
    h.bearer = "wrong"
    const res = await call()
    expect(res.status).toBe(401)
    expect(h.createAiJob).not.toHaveBeenCalled()
  })
})
