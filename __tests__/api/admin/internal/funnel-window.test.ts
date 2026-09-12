// @vitest-environment node
//
// Route-level tests for POST /api/admin/internal/funnel-window. Thin wrapper
// (bearer check, cron-flag gate, logCronStart/logCronEnd) around
// `selectFunnelsToClose` (lib/automation/funnel-window-closer.ts — NOT mocked
// here, it's a pure function and its own behavior is already covered by
// __tests__/lib/automation/funnel-window-closer.test.ts) plus the two DB
// calls that actually take a funnel offline. Shape copied from
// __tests__/api/admin/internal/pipeline-reconcile.test.ts (audit §4 #9,
// task 5: this route never wrote a cron_runs row at all before this file).
import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import type { Funnel } from "@/types/database"

const isCronSkipped = vi.fn()
const listFunnels = vi.fn()
const updateFunnel = vi.fn()
const recordAudit = vi.fn()
const logCronStart = vi.fn()
const logCronEnd = vi.fn()

vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped }))
vi.mock("@/lib/db/funnels", () => ({ listFunnels, updateFunnel }))
vi.mock("@/lib/audit/record", () => ({ recordAudit }))
vi.mock("@/lib/db/cron-runs", () => ({ logCronStart, logCronEnd }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => ({}) }))

// Same fixture helper as __tests__/lib/automation/funnel-window-closer.test.ts
// — a funnel one field away from qualifying still has to look like a real row
// to selectFunnelsToClose, which is not mocked here.
function funnel(overrides: Partial<Funnel> & { id: string }): Funnel {
  return {
    slug: overrides.id,
    name: overrides.id,
    description: null,
    status: "published",
    kind: "funnel",
    goal: null,
    template: "event",
    audience: null,
    offer_kind: null,
    offer_ref: null,
    starts_at: null,
    ends_at: null,
    auto_offline_at_end: true,
    notify_emails: null,
    created_by: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  } as Funnel
}

beforeEach(() => {
  isCronSkipped.mockReset()
  listFunnels.mockReset()
  updateFunnel.mockReset()
  recordAudit.mockReset()
  logCronStart.mockReset()
  logCronEnd.mockReset()
  logCronStart.mockResolvedValue("run-1")
  logCronEnd.mockResolvedValue(undefined)
  recordAudit.mockResolvedValue(undefined)
  listFunnels.mockResolvedValue([])
  process.env.INTERNAL_CRON_TOKEN = "shared-secret"
})

async function call({ bearer = "shared-secret" }: { bearer?: string } = {}) {
  const { POST } = await import("@/app/api/admin/internal/funnel-window/route")
  const req = new NextRequest("https://example.test/api/admin/internal/funnel-window", {
    method: "POST",
    headers: { authorization: bearer ? `Bearer ${bearer}` : "" },
    body: "{}",
  })
  return POST(req)
}

describe("POST /api/admin/internal/funnel-window", () => {
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

  it("checks isCronSkipped with the right key and default", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: true, reason: "disabled" })
    await call()
    expect(isCronSkipped).toHaveBeenCalledWith({
      enabledKey: "cron_funnel_window_enabled",
      defaultEnabled: false,
    })
  })

  it("returns { skipped } when the cron flag is disabled, and logs the run as success before the gate", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: true, reason: "disabled" })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: "disabled" })
    expect(listFunnels).not.toHaveBeenCalled()
    // MUTANT: this route never called logCronStart/logCronEnd at all before
    // task 5. Shipped OFF by default, so a flag-off tick wrote NO cron_runs
    // row — indistinguishable from a dead scheduler (audit §4 #9).
    expect(logCronStart).toHaveBeenCalledWith(expect.anything(), "funnelWindowCron")
    expect(logCronEnd).toHaveBeenCalledWith(expect.anything(), "run-1", "success", { skipped: "disabled" })
  })

  it("returns { skipped } when the global automation pause is on", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: true, reason: "paused" })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: "paused" })
    // Same MUTANT as above, exercised through the other skip reason so both
    // values of `gate.reason` are pinned into `detail`.
    expect(logCronEnd).toHaveBeenCalledWith(expect.anything(), "run-1", "success", { skipped: "paused" })
  })

  it("happy path: closes the selected funnel, records an audit row, and logs success with the summary", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: false })
    const past = funnel({ id: "camp-1", ends_at: "2020-01-01T00:00:00.000Z" })
    const stillRunning = funnel({ id: "camp-2", ends_at: "2099-01-01T00:00:00.000Z" })
    listFunnels.mockResolvedValueOnce([past, stillRunning])
    updateFunnel.mockResolvedValueOnce({ ...past, status: "draft" })

    const res = await call()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, considered: 2, closed: ["camp-1"], failed: [] })
    expect(updateFunnel).toHaveBeenCalledWith("camp-1", { status: "draft" })
    expect(updateFunnel).not.toHaveBeenCalledWith("camp-2", expect.anything())
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "funnel.auto_offline",
        target: expect.objectContaining({ id: "camp-1" }),
      }),
    )
    // MUTANT: logging `{ ok, closed, failed }` (the HTTP response shape)
    // instead of `{ considered, closed, failed }` into cron_runs `detail` —
    // the two happen to overlap on `closed`/`failed` but not on `considered`
    // vs `ok`, so a swap here would still pass a looser assertion.
    expect(logCronStart).toHaveBeenCalledWith(expect.anything(), "funnelWindowCron")
    expect(logCronEnd).toHaveBeenCalledWith(expect.anything(), "run-1", "success", {
      considered: 2,
      closed: ["camp-1"],
      failed: [],
    })
  })

  it("logs a failed cron run and returns 500 when updateFunnel rejects for one funnel", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: false })
    const past = funnel({ id: "camp-1", ends_at: "2020-01-01T00:00:00.000Z" })
    listFunnels.mockResolvedValueOnce([past])
    updateFunnel.mockRejectedValueOnce(new Error("row locked"))

    const res = await call()

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      ok: false,
      considered: 1,
      closed: [],
      failed: [{ id: "camp-1", error: "row locked" }],
    })
    // MUTANT: logging "success" regardless of `failed.length` — a per-funnel
    // failure must flip the cron_runs row to "failed" too, or the health
    // scanner sees a green run for a tick that left a camp online past close.
    expect(logCronEnd).toHaveBeenCalledWith(expect.anything(), "run-1", "failed", {
      considered: 1,
      closed: [],
      failed: [{ id: "camp-1", error: "row locked" }],
    })
  })

  it("logs a failed cron run and returns 500 when listFunnels itself throws", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: false })
    listFunnels.mockRejectedValueOnce(new Error("db down"))

    const res = await call()

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "db down" })
    // MUTANT: no outer try/catch around the body — an unhandled rejection
    // here would 500 with no cron_runs row at all, same blind spot as the
    // flag-gate bug this task fixes, just moved one branch over.
    expect(logCronEnd).toHaveBeenCalledWith(expect.anything(), "run-1", "failed", { message: "db down" })
  })
})
