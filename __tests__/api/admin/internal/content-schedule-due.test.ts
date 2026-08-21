import { describe, it, expect, vi, beforeEach } from "vitest"

const runContentScheduleMock = vi.fn()
vi.mock("@/lib/content-schedule/run-due", () => ({
  runContentSchedule: (o: unknown) => runContentScheduleMock(o),
}))
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))
vi.mock("@/lib/db/cron-runs", () => ({
  logCronStart: vi.fn(async () => "run-id"),
  logCronEnd: vi.fn(async () => undefined),
}))

import { POST } from "@/app/api/admin/internal/content-schedule-due/route"
import { CRON_CATALOG } from "@/lib/cron-catalog"
import { CONTENT_SCHEDULE_FLAG } from "@/lib/content-schedule/flag"

function req(auth?: string) {
  return new Request("http://localhost/api/admin/internal/content-schedule-due", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  }) as unknown as Parameters<typeof POST>[0]
}

describe("POST /api/admin/internal/content-schedule-due", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.INTERNAL_CRON_TOKEN = "secret"
    runContentScheduleMock.mockResolvedValue({ considered: 0, published: 0, sent: 0, missed: 0, failed: 0 })
  })

  it("rejects a request with no bearer token", async () => {
    const res = await POST(req())
    expect(res.status).toBe(401)
    expect(runContentScheduleMock).not.toHaveBeenCalled()
  })

  it("rejects a wrong bearer token", async () => {
    const res = await POST(req("Bearer wrong"))
    expect(res.status).toBe(401)
  })

  it("rejects everything when the server has no token configured", async () => {
    // Otherwise an unset env var makes `Bearer ` match and the endpoint opens.
    delete process.env.INTERNAL_CRON_TOKEN
    const res = await POST(req("Bearer "))
    expect(res.status).toBe(401)
    expect(runContentScheduleMock).not.toHaveBeenCalled()
  })

  it("runs the checker for a valid token and returns its counts", async () => {
    runContentScheduleMock.mockResolvedValue({ considered: 3, published: 1, sent: 1, missed: 1, failed: 0 })
    const res = await POST(req("Bearer secret"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, considered: 3, published: 1, sent: 1, missed: 1, failed: 0 })
  })

  it("returns 500 with the message when the checker throws", async () => {
    runContentScheduleMock.mockRejectedValue(new Error("db down"))
    const res = await POST(req("Bearer secret"))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/db down/)
  })

  it("catalogs the cron under the exact key the runner reads", () => {
    const entry = CRON_CATALOG.find((c) => c.name === "content-schedule")
    expect(entry).toBeDefined()
    expect(entry?.enabledKey).toBe(CONTENT_SCHEDULE_FLAG) // never a copied string
    expect(entry?.defaultEnabled).toBe(true)
    expect(entry?.firebaseFunction).toBe("contentScheduleCron")
  })
})
