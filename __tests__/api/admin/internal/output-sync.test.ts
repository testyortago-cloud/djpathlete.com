// @vitest-environment node
//
// POST /api/admin/internal/output-sync is the auth, gate and logging shell around
// syncAllLinkedClients, which has its own tests (__tests__/lib/output-sports/sync.test.ts)
// and is mocked here.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  isCronSkipped: vi.fn(async (..._a: unknown[]) => ({ skipped: false }) as { skipped: boolean; reason?: string }),
  logCronStart: vi.fn(async (..._a: unknown[]) => "run-1"),
  logCronEnd: vi.fn(async (..._a: unknown[]) => undefined),
  syncAllLinkedClients: vi.fn(),
}))

vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped: mocks.isCronSkipped }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
vi.mock("@/lib/db/cron-runs", () => ({ logCronStart: mocks.logCronStart, logCronEnd: mocks.logCronEnd }))
vi.mock("@/lib/output-sports/sync", () => ({ syncAllLinkedClients: mocks.syncAllLinkedClients }))

import { POST } from "@/app/api/admin/internal/output-sync/route"

const req = (token?: string) =>
  new NextRequest("http://localhost/api/admin/internal/output-sync", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
const clean = { businesses: 1, clients: 2, added: 3, updated: 0, failures: [] }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INTERNAL_CRON_TOKEN = "cron-secret"
  mocks.isCronSkipped.mockResolvedValue({ skipped: false })
  mocks.syncAllLinkedClients.mockResolvedValue(clean)
})

describe("POST /api/admin/internal/output-sync", () => {
  it("401s without the cron token and syncs nothing", async () => {
    expect((await POST(req())).status).toBe(401)
    expect((await POST(req("wrong"))).status).toBe(401)
    expect(mocks.syncAllLinkedClients).not.toHaveBeenCalled()
  })

  it("is ON by default and honours its own switch", async () => {
    await POST(req("cron-secret"))
    expect(mocks.isCronSkipped).toHaveBeenCalledWith({ enabledKey: "cron_output_sync_enabled", defaultEnabled: true })
    mocks.isCronSkipped.mockResolvedValue({ skipped: true, reason: "disabled" })
    mocks.syncAllLinkedClients.mockClear()
    const res = await POST(req("cron-secret"))
    expect(await res.json()).toEqual({ skipped: "disabled" })
    expect(mocks.syncAllLinkedClients).not.toHaveBeenCalled()
  })

  it("logs the run under the name the automation-health watchdog expects", async () => {
    await POST(req("cron-secret"))
    expect(mocks.logCronStart).toHaveBeenCalledWith(expect.anything(), "outputSyncCron")
    expect(mocks.logCronEnd).toHaveBeenCalledWith(expect.anything(), "run-1", "success", clean)
  })

  it("records the run as failed when any business or client failed, so the watchdog sees it", async () => {
    const withFailure = { ...clean, failures: [{ businessId: "b", message: "OAuth error. Invalid refresh token!" }] }
    mocks.syncAllLinkedClients.mockResolvedValue(withFailure)
    const res = await POST(req("cron-secret"))
    expect(res.status).toBe(200)
    expect(mocks.logCronEnd).toHaveBeenCalledWith(expect.anything(), "run-1", "failed", withFailure)
  })

  it("answers 500 and closes the run when the sync throws", async () => {
    mocks.syncAllLinkedClients.mockRejectedValue(new Error("output_connections: boom"))
    const res = await POST(req("cron-secret"))
    expect(res.status).toBe(500)
    expect(mocks.logCronEnd).toHaveBeenCalledWith(expect.anything(), "run-1", "failed", {
      message: "output_connections: boom",
    })
  })
})
