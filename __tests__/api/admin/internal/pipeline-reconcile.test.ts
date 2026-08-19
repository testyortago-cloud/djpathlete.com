// Route-level tests for POST /api/admin/internal/pipeline-reconcile. This
// route is a thin wrapper (bearer check, cron-flag gate,
// logCronStart/logCronEnd) around `runPipelineReconcile`
// (lib/automation/pipeline-reconcile.ts), which IS mocked here — its real
// behavior is covered by __tests__/lib/automation/pipeline-reconcile.test.ts.
// Shape copied from __tests__/api/admin/internal/seo-agent.test.ts.
import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const isCronSkipped = vi.fn()
const runPipelineReconcile = vi.fn()
const logCronStart = vi.fn()
const logCronEnd = vi.fn()

vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped }))
vi.mock("@/lib/automation/pipeline-reconcile", () => ({ runPipelineReconcile }))
vi.mock("@/lib/db/cron-runs", () => ({ logCronStart, logCronEnd }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => ({}) }))

beforeEach(() => {
  isCronSkipped.mockReset()
  runPipelineReconcile.mockReset()
  logCronStart.mockReset()
  logCronEnd.mockReset()
  logCronStart.mockResolvedValue("run-1")
  logCronEnd.mockResolvedValue(undefined)
  process.env.INTERNAL_CRON_TOKEN = "shared-secret"
})

async function call({ bearer = "shared-secret" }: { bearer?: string } = {}) {
  const { POST } = await import("@/app/api/admin/internal/pipeline-reconcile/route")
  const req = new NextRequest("https://example.test/api/admin/internal/pipeline-reconcile", {
    method: "POST",
    headers: { authorization: bearer ? `Bearer ${bearer}` : "" },
    body: "{}",
  })
  return POST(req)
}

describe("POST /api/admin/internal/pipeline-reconcile", () => {
  it("returns 401 without bearer", async () => {
    const res = await call({ bearer: "" })
    expect(res.status).toBe(401)
    expect(isCronSkipped).not.toHaveBeenCalled()
  })

  it("returns 401 with the wrong bearer", async () => {
    const res = await call({ bearer: "wrong" })
    expect(res.status).toBe(401)
  })

  it("returns 401 when INTERNAL_CRON_TOKEN is not configured", async () => {
    delete process.env.INTERNAL_CRON_TOKEN
    const res = await call({ bearer: "shared-secret" })
    expect(res.status).toBe(401)
  })

  it("returns { skipped } when the cron flag is disabled — gated correctly, per the brief's default-off requirement", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: true, reason: "disabled" })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: "disabled" })
    expect(runPipelineReconcile).not.toHaveBeenCalled()
  })

  it("returns { skipped } when the global automation pause is on", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: true, reason: "paused" })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: "paused" })
  })

  it("checks isCronSkipped with the right key and default", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: true, reason: "disabled" })
    await call()
    expect(isCronSkipped).toHaveBeenCalledWith({
      enabledKey: "cron_pipeline_reconcile_enabled",
      defaultEnabled: false,
    })
  })

  it("happy path: runs the reconciler, logs success, returns its summary", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: false })
    runPipelineReconcile.mockResolvedValueOnce({ createdFromBookings: 2, wonFromPayments: 1, scanned: 5 })

    const res = await call()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, createdFromBookings: 2, wonFromPayments: 1, scanned: 5 })
    expect(logCronStart).toHaveBeenCalledWith(expect.anything(), "pipelineReconcileCron")
    expect(logCronEnd).toHaveBeenCalledWith(expect.anything(), "run-1", "success", {
      createdFromBookings: 2,
      wonFromPayments: 1,
      scanned: 5,
    })
  })

  it("logs a failed cron run and returns 500 when the reconciler throws", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: false })
    runPipelineReconcile.mockRejectedValueOnce(new Error("board not seeded"))

    const res = await call()

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "board not seeded" })
    expect(logCronEnd).toHaveBeenCalledWith(expect.anything(), "run-1", "failed", { message: "board not seeded" })
  })
})
