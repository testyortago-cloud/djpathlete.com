// POST /api/admin/automation/toggle-cron — the one endpoint that flips a cron or
// a feature flag.
//
// It had no tests, and it is the write path for every DB-backed toggle in the app,
// including the flag that lets a funnel charge a card. What is asserted here is
// what an auditor needs to be able to trust: that only admins can flip anything,
// that the endpoint cannot be repurposed as a generic system_settings writer, and
// that a flag flip is FILED AS A FLAG FLIP — which it was not, for any key whose
// name did not happen to start with "cron_" or "feature_".

import { describe, expect, it, vi, beforeEach } from "vitest"

const auth = vi.fn()
const setSetting = vi.fn()
const recordAudit = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => auth() }))
vi.mock("@/lib/db/system-settings", () => ({ setSetting: (...a: unknown[]) => setSetting(...a) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...a) }))

import { NextRequest } from "next/server"
import { POST } from "@/app/api/admin/automation/toggle-cron/route"
import { FUNNEL_CHECKOUT_FLAG } from "@/lib/funnels/checkout/flag"
import { CRON_CATALOG } from "@/lib/cron-catalog"

function request(body: unknown) {
  return new NextRequest("http://t.test/api/admin/automation/toggle-cron", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  auth.mockReset().mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  setSetting.mockReset().mockResolvedValue(undefined)
  recordAudit.mockReset()
})

describe("POST /api/admin/automation/toggle-cron", () => {
  it("flips the funnel checkout flag and files it as a FLAG toggle", async () => {
    // MUTANT: classifying by `enabledKey.startsWith("feature_")`. This key starts
    // with neither prefix, so the money flag would be filed as a generic
    // system_setting.changed and would not appear when an admin filters the audit
    // log for flag flips.
    const res = await POST(request({ enabledKey: FUNNEL_CHECKOUT_FLAG, enabled: true }))
    expect(res.status).toBe(200)
    expect(setSetting).toHaveBeenCalledWith(FUNNEL_CHECKOUT_FLAG, true, "admin-1")
    expect(recordAudit.mock.calls[0][0]).toMatchObject({
      action: "feature_flag.toggled",
      category: "system",
      metadata: { key: FUNNEL_CHECKOUT_FLAG, new_value: true },
    })
  })

  it("files a cron toggle the same way", async () => {
    await POST(request({ enabledKey: CRON_CATALOG[0].enabledKey, enabled: false }))
    expect(recordAudit.mock.calls[0][0]).toMatchObject({ action: "feature_flag.toggled" })
  })

  it("refuses a key in neither catalogue, so it cannot become a generic settings writer", async () => {
    const res = await POST(request({ enabledKey: "audit_log_retention_days", enabled: true }))
    expect(res.status).toBe(400)
    expect(setSetting).not.toHaveBeenCalled()
  })

  it("refuses a non-admin — staff included", async () => {
    // The money switch lives behind this endpoint, and `role !== "admin"` is
    // stricter than canAccessAdminPath, which admits staff.
    auth.mockResolvedValue({ user: { id: "staff-1", role: "staff" } })
    const res = await POST(request({ enabledKey: FUNNEL_CHECKOUT_FLAG, enabled: true }))
    expect(res.status).toBe(403)
    expect(setSetting).not.toHaveBeenCalled()
  })

  it("refuses an anonymous caller", async () => {
    auth.mockResolvedValue(null)
    const res = await POST(request({ enabledKey: FUNNEL_CHECKOUT_FLAG, enabled: true }))
    expect(res.status).toBe(403)
  })

  it("refuses a body with no boolean", async () => {
    const res = await POST(request({ enabledKey: FUNNEL_CHECKOUT_FLAG }))
    expect(res.status).toBe(400)
    expect(setSetting).not.toHaveBeenCalled()
  })
})
