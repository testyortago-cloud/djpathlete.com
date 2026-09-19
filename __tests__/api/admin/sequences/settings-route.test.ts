// @vitest-environment node
// __tests__/api/admin/sequences/settings-route.test.ts
//
// PATCH /api/admin/sequences/[key]/settings — today one setting, the
// re-enrolment cooldown (migration 00263). Mocks lib/db/sequence-admin and
// lib/tenancy/resolve, the same shape as status-route.test.ts, so these
// assert the CALLS and the RESPONSE rather than a real database.
//
// Admin-only, not permission-tiered, for the same reason the status route
// gives: this changes how the engine treats EVERYONE who re-triggers a
// sequence from now on.

import { beforeEach, describe, expect, it, vi } from "vitest"

const authMock = vi.fn()
const setCooldownMock = vi.fn()
const recordAuditMock = vi.fn()
const resolveTenantMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/sequence-admin", () => ({
  setSequenceReenrolCooldown: (...a: unknown[]) => setCooldownMock(...a),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAuditMock(...a) }))
vi.mock("@/lib/tenancy/resolve", () => {
  class NoAccessibleBusinessError extends Error {}
  return {
    resolveAdminTenantForRequest: (...a: unknown[]) => resolveTenantMock(...a),
    NoAccessibleBusinessError,
  }
})

import { PATCH } from "@/app/api/admin/sequences/[key]/settings/route"
import { NoAccessibleBusinessError } from "@/lib/tenancy/resolve"

// NOT the platform id: a fixture equal to it would pass for a route that
// dropped the argument and let the DAL default apply.
const BUSINESS_ID = "22222222-2222-4222-8222-222222222222"

const ADMIN_SESSION = { user: { id: "admin-1", email: "coach@example.com", role: "admin" } }
const CLIENT_SESSION = { user: { id: "client-1", role: "client" } }
const STAFF_SESSION = { user: { id: "staff-1", role: "staff", permissions: { contacts: true } } }

function req(body: unknown, raw = false) {
  return new Request("http://localhost/api/admin/sequences/cold_lead/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  })
}

function ctx(key = "cold_lead") {
  return { params: Promise.resolve({ key }) }
}

beforeEach(() => {
  vi.resetAllMocks()
  resolveTenantMock.mockResolvedValue({ businessId: BUSINESS_ID, choices: [], isOperator: true })
  setCooldownMock.mockResolvedValue({ id: "seq-1", from: 30 })
})

describe("PATCH /api/admin/sequences/[key]/settings — the gate", () => {
  it("401s when there is no session", async () => {
    authMock.mockResolvedValue(null)
    const res = await PATCH(req({ reenrolCooldownDays: 14 }) as never, ctx())
    expect(res.status).toBe(401)
    expect(setCooldownMock).not.toHaveBeenCalled()
  })

  it("403s for a client session", async () => {
    authMock.mockResolvedValue(CLIENT_SESSION)
    const res = await PATCH(req({ reenrolCooldownDays: 14 }) as never, ctx())
    expect(res.status).toBe(403)
    expect(setCooldownMock).not.toHaveBeenCalled()
  })

  it("403s for staff too — admin-only, not permission-tiered", async () => {
    authMock.mockResolvedValue(STAFF_SESSION)
    const res = await PATCH(req({ reenrolCooldownDays: 14 }) as never, ctx())
    expect(res.status).toBe(403)
    expect(setCooldownMock).not.toHaveBeenCalled()
  })

  it("403s, changing nothing, when the caller has no accessible business", async () => {
    authMock.mockResolvedValue(ADMIN_SESSION)
    resolveTenantMock.mockRejectedValue(new NoAccessibleBusinessError())
    const res = await PATCH(req({ reenrolCooldownDays: 14 }) as never, ctx())
    expect(res.status).toBe(403)
    expect(setCooldownMock).not.toHaveBeenCalled()
  })
})

describe("PATCH /api/admin/sequences/[key]/settings — the body", () => {
  beforeEach(() => authMock.mockResolvedValue(ADMIN_SESSION))

  it("400s when reenrolCooldownDays is missing", async () => {
    const res = await PATCH(req({}) as never, ctx())
    expect(res.status).toBe(400)
    expect(setCooldownMock).not.toHaveBeenCalled()
  })

  it("400s on a fraction, a negative number, a string, and anything over a year", async () => {
    for (const bad of [1.5, -1, "14", 366, null]) {
      const res = await PATCH(req({ reenrolCooldownDays: bad }) as never, ctx())
      expect(res.status).toBe(400)
    }
    expect(setCooldownMock).not.toHaveBeenCalled()
  })

  it("accepts the two edges: 0 and 365", async () => {
    for (const ok of [0, 365]) {
      const res = await PATCH(req({ reenrolCooldownDays: ok }) as never, ctx())
      expect(res.status).toBe(200)
    }
    expect(setCooldownMock).toHaveBeenCalledWith(BUSINESS_ID, "cold_lead", 0)
    expect(setCooldownMock).toHaveBeenCalledWith(BUSINESS_ID, "cold_lead", 365)
  })

  it("the 400 reads in plain English, not raw type jargon", async () => {
    const res = await PATCH(req({ reenrolCooldownDays: -1 }) as never, ctx())
    const json = await res.json()
    expect(json.error).toMatch(/whole number of days|between 0 and 365/i)
    expect(json.error).not.toMatch(/ZodError|Expected number|invalid_type/i)
  })

  it("400s on a body that is not JSON at all", async () => {
    const res = await PATCH(req("not json", true) as never, ctx())
    expect(res.status).toBe(400)
  })
})

describe("PATCH /api/admin/sequences/[key]/settings — the write", () => {
  beforeEach(() => authMock.mockResolvedValue(ADMIN_SESSION))

  it("writes the days under the resolved tenant and the URL's key", async () => {
    const res = await PATCH(req({ reenrolCooldownDays: 14 }) as never, ctx("cold_lead"))
    expect(res.status).toBe(200)
    expect(setCooldownMock).toHaveBeenCalledWith(BUSINESS_ID, "cold_lead", 14)
  })

  it("uses the key from the URL, not from the body", async () => {
    await PATCH(req({ reenrolCooldownDays: 14, key: "someone-elses-key" }) as never, ctx("cold_lead"))
    expect(setCooldownMock).toHaveBeenCalledWith(BUSINESS_ID, "cold_lead", 14)
  })

  it("404s for another tenant's key, when the DAL returns null", async () => {
    setCooldownMock.mockResolvedValue(null)
    const res = await PATCH(req({ reenrolCooldownDays: 14 }) as never, ctx("someone-elses-key"))
    expect(res.status).toBe(404)
  })

  it("500s, not throws uncaught, when the DAL write fails", async () => {
    setCooldownMock.mockRejectedValue(new Error("db down"))
    const res = await PATCH(req({ reenrolCooldownDays: 14 }) as never, ctx())
    expect(res.status).toBe(500)
  })

  it("reports what changed: the prior value and the new one", async () => {
    setCooldownMock.mockResolvedValue({ id: "seq-1", from: 30 })
    const res = await PATCH(req({ reenrolCooldownDays: 14 }) as never, ctx())
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, sequenceKey: "cold_lead", from: 30, to: 14 })
  })
})

describe("PATCH /api/admin/sequences/[key]/settings — the audit row", () => {
  beforeEach(() => authMock.mockResolvedValue(ADMIN_SESSION))

  it("records the key, the setting and the before/after days, and NOTHING else", async () => {
    setCooldownMock.mockResolvedValue({ id: "seq-1", from: 30 })
    await PATCH(req({ reenrolCooldownDays: 14 }) as never, ctx("cold_lead"))

    expect(recordAuditMock).toHaveBeenCalled()
    const call = recordAuditMock.mock.calls.at(-1)?.[0] as {
      action: string
      category: string
      outcome: string
      target?: { type: string; id: string }
      metadata?: Record<string, unknown>
    }
    expect(call.action).toBe("sequence.settings_changed")
    expect(call.category).toBe("admin_write")
    expect(call.outcome).toBe("success")
    expect(call.target).toEqual({ type: "sequence", id: "cold_lead" })
    // Exact equality, not toMatchObject — an extra key here must fail this test.
    expect(call.metadata).toEqual({ sequence_key: "cold_lead", setting: "reenrol_cooldown_days", from: 30, to: 14 })
  })

  it("records a denied outcome for a non-admin, naming nobody", async () => {
    authMock.mockResolvedValue(CLIENT_SESSION)
    await PATCH(req({ reenrolCooldownDays: 14 }) as never, ctx("cold_lead"))
    const call = recordAuditMock.mock.calls.at(-1)?.[0] as { outcome: string; target?: unknown }
    expect(call.outcome).toBe("denied")
    expect(call.target).toEqual({ type: "sequence", id: "cold_lead" })
  })
})
