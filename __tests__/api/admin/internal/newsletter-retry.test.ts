// @vitest-environment node
//
// POST /api/admin/internal/newsletter-retry is the auth, gate and logging
// shell around runNewsletterRetryTick, which has its own suite
// (__tests__/lib/automation/newsletter-retry.test.ts) and is mocked here.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  isCronSkipped: vi.fn(async (..._a: unknown[]) => ({ skipped: false }) as { skipped: boolean; reason?: string }),
  logCronStart: vi.fn(async (..._a: unknown[]) => "run-1"),
  logCronEnd: vi.fn(async (..._a: unknown[]) => undefined),
  runNewsletterRetryTick: vi.fn(async () => ({ businesses: [] as { businessId: string; outcome: string }[] })),
}))

vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped: mocks.isCronSkipped }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
vi.mock("@/lib/db/cron-runs", () => ({ logCronStart: mocks.logCronStart, logCronEnd: mocks.logCronEnd }))
vi.mock("@/lib/automation/newsletter-retry", () => ({ runNewsletterRetryTick: mocks.runNewsletterRetryTick }))

import { POST } from "@/app/api/admin/internal/newsletter-retry/route"

const req = (token?: string) =>
  new NextRequest("http://localhost/api/admin/internal/newsletter-retry", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INTERNAL_CRON_TOKEN = "cron-secret"
  mocks.isCronSkipped.mockResolvedValue({ skipped: false })
  mocks.runNewsletterRetryTick.mockResolvedValue({ businesses: [] })
})

describe("POST /api/admin/internal/newsletter-retry", () => {
  it("401s without the cron token and sends nothing", async () => {
    expect((await POST(req())).status).toBe(401)
    expect((await POST(req("wrong"))).status).toBe(401)
    expect(mocks.runNewsletterRetryTick).not.toHaveBeenCalled()
  })

  it("is ON by default and honours its own switch", async () => {
    await POST(req("cron-secret"))
    expect(mocks.isCronSkipped).toHaveBeenCalledWith({
      enabledKey: "cron_newsletter_retry_enabled",
      defaultEnabled: true,
    })

    mocks.isCronSkipped.mockResolvedValue({ skipped: true, reason: "disabled" })
    mocks.runNewsletterRetryTick.mockClear()
    const res = await POST(req("cron-secret"))
    expect(await res.json()).toEqual({ skipped: "disabled" })
    expect(mocks.runNewsletterRetryTick).not.toHaveBeenCalled()
  })

  it("logs a clean tick as success", async () => {
    mocks.runNewsletterRetryTick.mockResolvedValue({
      businesses: [{ businessId: "b", outcome: "outside_working_hours" }],
    })
    expect((await POST(req("cron-secret"))).status).toBe(200)
    expect(mocks.logCronEnd).toHaveBeenCalledWith({}, "run-1", "success", expect.anything())
  })

  it.each(["failed", "refused", "send_error"])("logs a tick with a %s business as failed", async (outcome) => {
    mocks.runNewsletterRetryTick.mockResolvedValue({ businesses: [{ businessId: "b", outcome }] })
    await POST(req("cron-secret"))
    expect(mocks.logCronEnd).toHaveBeenCalledWith({}, "run-1", "failed", expect.anything())
  })

  it("500s and logs failed when the tick throws", async () => {
    mocks.runNewsletterRetryTick.mockRejectedValue(new Error("RESEND_FROM_EMAIL is not set"))
    const res = await POST(req("cron-secret"))
    expect(res.status).toBe(500)
    expect(mocks.logCronEnd).toHaveBeenCalledWith({}, "run-1", "failed", { message: "RESEND_FROM_EMAIL is not set" })
  })
})
