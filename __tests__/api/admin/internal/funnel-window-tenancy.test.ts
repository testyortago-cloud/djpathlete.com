// @vitest-environment node
//
// G31 (funnel tenancy): the funnel-window cron has no session and no Host —
// it is guarded by INTERNAL_CRON_TOKEN alone — so it cannot resolve a single
// tenant the way an admin route or a public page does. Its job is every
// tenant's expired funnels, and the fix is the same shape
// lib/automation/pipeline-reconcile.ts already uses: iterate `listBusinesses()`
// and scope every DAL call to the business being walked.
//
// This file is narrowly about THAT iteration — general route behavior
// (bearer check, cron-flag gate, per-funnel failure isolation, the happy
// path against one business) is already covered by
// __tests__/api/admin/internal/funnel-window.test.ts and is not repeated here.
import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import type { Funnel } from "@/types/database"

const isCronSkipped = vi.fn()
const listFunnels = vi.fn()
const updateFunnel = vi.fn()
const listBusinesses = vi.fn()
const recordAudit = vi.fn()
const logCronStart = vi.fn()
const logCronEnd = vi.fn()

vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped }))
vi.mock("@/lib/db/funnels", () => ({ listFunnels, updateFunnel }))
vi.mock("@/lib/db/businesses", () => ({ listBusinesses }))
vi.mock("@/lib/audit/record", () => ({ recordAudit }))
vi.mock("@/lib/db/cron-runs", () => ({ logCronStart, logCronEnd }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => ({}) }))

const A = "biz-a"
const B = "biz-b"

// Same fixture helper as funnel-window.test.ts and
// __tests__/lib/automation/funnel-window-closer.test.ts — a funnel one field
// away from qualifying still has to look like a real row to
// `selectFunnelsToClose`, which is not mocked here.
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
  listBusinesses.mockReset()
  recordAudit.mockReset()
  logCronStart.mockReset()
  logCronEnd.mockReset()
  logCronStart.mockResolvedValue("run-1")
  logCronEnd.mockResolvedValue(undefined)
  recordAudit.mockResolvedValue(undefined)
  isCronSkipped.mockResolvedValue({ skipped: false })
  listFunnels.mockResolvedValue([])
  updateFunnel.mockImplementation(async (_businessId: string, id: string) => ({ id, status: "draft" }))
  process.env.INTERNAL_CRON_TOKEN = "shared-secret"
})

async function call() {
  const { POST } = await import("@/app/api/admin/internal/funnel-window/route")
  const req = new NextRequest("https://example.test/api/admin/internal/funnel-window", {
    method: "POST",
    headers: { authorization: "Bearer shared-secret" },
    body: "{}",
  })
  return POST(req)
}

describe("POST /api/admin/internal/funnel-window — iterates every business", () => {
  it("closes expired funnels for EVERY business, not just one", async () => {
    // MUTANT: resolve a single tenant here. A second tenant's expired camp page
    // then stays published forever, and the cron reports success every night.
    listBusinesses.mockResolvedValue([
      { id: A, name: "A", slug: "a" },
      { id: B, name: "B", slug: "b" },
    ])
    const pastA = funnel({ id: "camp-a", ends_at: "2020-01-01T00:00:00.000Z" })
    const pastB = funnel({ id: "camp-b", ends_at: "2020-01-01T00:00:00.000Z" })
    listFunnels.mockImplementation(async (businessId: string) => (businessId === A ? [pastA] : [pastB]))

    const res = await call()

    expect(listBusinesses).toHaveBeenCalledWith({ activeOnly: true })
    expect(listFunnels).toHaveBeenCalledWith(A)
    expect(listFunnels).toHaveBeenCalledWith(B)
    expect(updateFunnel).toHaveBeenCalledWith(A, "camp-a", { status: "draft" })
    expect(updateFunnel).toHaveBeenCalledWith(B, "camp-b", { status: "draft" })

    const body = (await res.json()) as { ok: boolean; considered: number; closed: string[] }
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.considered).toBe(2)
    // BOTH businesses' expired funnels closed — neither list is a subset the
    // other silently swallowed.
    expect(body.closed.sort()).toEqual(["camp-a", "camp-b"])
  })

  it("keeps closing the second business's expired funnels when the first business's read fails", async () => {
    // The same "one bad tenant must not strand the rest" property the plain
    // per-funnel guard has, one level up: a business whose OWN read failed is
    // reported in `failed`, but every other business is still walked.
    listBusinesses.mockResolvedValue([
      { id: A, name: "A", slug: "a" },
      { id: B, name: "B", slug: "b" },
    ])
    const pastB = funnel({ id: "camp-b", ends_at: "2020-01-01T00:00:00.000Z" })
    listFunnels.mockImplementation(async (businessId: string) => {
      if (businessId === A) throw new Error("db down for A")
      return [pastB]
    })

    const res = await call()

    expect(listFunnels).toHaveBeenCalledWith(A)
    expect(listFunnels).toHaveBeenCalledWith(B)
    expect(updateFunnel).toHaveBeenCalledWith(B, "camp-b", { status: "draft" })
    expect(updateFunnel).not.toHaveBeenCalledWith(A, expect.anything(), expect.anything())

    expect(res.status).toBe(500)
    const body = (await res.json()) as { ok: boolean; closed: string[]; failed: { id: string; error: string }[] }
    expect(body.ok).toBe(false)
    expect(body.closed).toEqual(["camp-b"])
    expect(body.failed).toContainEqual({ id: A, error: "db down for A" })
  })

  it("passes activeOnly:true — a paused business is not operating, so nothing on it needs closing", async () => {
    listBusinesses.mockResolvedValue([])
    await call()
    expect(listBusinesses).toHaveBeenCalledWith({ activeOnly: true })
  })

  it("does not call listFunnels or listBusinesses when the cron flag is off", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: true, reason: "disabled" })
    listBusinesses.mockResolvedValue([
      { id: A, name: "A", slug: "a" },
      { id: B, name: "B", slug: "b" },
    ])
    await call()
    expect(listBusinesses).not.toHaveBeenCalled()
    expect(listFunnels).not.toHaveBeenCalled()
  })
})
