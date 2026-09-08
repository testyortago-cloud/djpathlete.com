// @vitest-environment node
// __tests__/api/admin/sequences/status-route.test.ts
//
// PATCH /api/admin/sequences/[key]/status — the on/off switch. Mocks
// lib/db/sequence-admin and lib/tenancy/resolve, the same shape as
// __tests__/api/admin/sequences-enrol.test.ts, so these assert the CALLS and
// the RESPONSE rather than a real database.
//
// Admin-only, not permission-tiered — same precedent
// app/api/admin/sequences/enrol/route.ts states: switching a sequence on
// starts sending real email to real people, for everyone who enters from now
// on, which is not a "leads"-shaped permission.

import { beforeEach, describe, expect, it, vi } from "vitest"

const authMock = vi.fn()
const setSequenceStatusMock = vi.fn()
const recordAuditMock = vi.fn()
const resolveTenantMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/sequence-admin", () => ({
  setSequenceStatus: (...a: unknown[]) => setSequenceStatusMock(...a),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAuditMock(...a) }))
vi.mock("@/lib/tenancy/resolve", () => {
  class NoAccessibleBusinessError extends Error {}
  return {
    resolveAdminTenantForRequest: (...a: unknown[]) => resolveTenantMock(...a),
    NoAccessibleBusinessError,
  }
})

import { PATCH } from "@/app/api/admin/sequences/[key]/status/route"
import { NoAccessibleBusinessError } from "@/lib/tenancy/resolve"

// NOT the platform id: a fixture equal to it would pass for a route that
// dropped the argument and let the DAL default apply.
const BUSINESS_ID = "22222222-2222-4222-8222-222222222222"

const ADMIN_SESSION = { user: { id: "admin-1", email: "coach@example.com", role: "admin" } }
const CLIENT_SESSION = { user: { id: "client-1", role: "client" } }
const STAFF_SESSION = { user: { id: "staff-1", role: "staff", permissions: { contacts: true } } }

function req(body: unknown) {
  return new Request("http://localhost/api/admin/sequences/cold_lead/status", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function ctx(key = "cold_lead") {
  return { params: Promise.resolve({ key }) }
}

beforeEach(() => {
  // resetAllMocks, not clearAllMocks — clearAllMocks leaves queued
  // `mockResolvedValueOnce`/`mockRejectedValueOnce` implementations armed,
  // which would leak a rejection from one test into whichever test runs next.
  vi.resetAllMocks()
  resolveTenantMock.mockResolvedValue({ businessId: BUSINESS_ID, choices: [], isOperator: true })
  setSequenceStatusMock.mockResolvedValue({ id: "seq-1", from: "draft" })
})

describe("PATCH /api/admin/sequences/[key]/status — the gate", () => {
  it("401s when there is no session", async () => {
    authMock.mockResolvedValue(null)
    const res = await PATCH(req({ on: true }) as never, ctx())
    expect(res.status).toBe(401)
    expect(setSequenceStatusMock).not.toHaveBeenCalled()
  })

  it("403s for a client session", async () => {
    authMock.mockResolvedValue(CLIENT_SESSION)
    const res = await PATCH(req({ on: true }) as never, ctx())
    expect(res.status).toBe(403)
    expect(setSequenceStatusMock).not.toHaveBeenCalled()
  })

  it("403s for staff too — this route starts sending real email, so it is admin-only, not permission-tiered", async () => {
    // MUTANT: removing `session.user.role !== "admin"`. Staff carrying the
    // `contacts` permission (enough to VIEW /admin/sequences) must still be
    // refused here.
    authMock.mockResolvedValue(STAFF_SESSION)
    const res = await PATCH(req({ on: true }) as never, ctx())
    expect(res.status).toBe(403)
    expect(setSequenceStatusMock).not.toHaveBeenCalled()
  })

  it("403s, changing nothing, when the caller has no accessible business", async () => {
    authMock.mockResolvedValue(ADMIN_SESSION)
    resolveTenantMock.mockRejectedValue(new NoAccessibleBusinessError())
    const res = await PATCH(req({ on: true }) as never, ctx())
    expect(res.status).toBe(403)
    expect(setSequenceStatusMock).not.toHaveBeenCalled()
  })
})

describe("PATCH /api/admin/sequences/[key]/status — the body", () => {
  beforeEach(() => authMock.mockResolvedValue(ADMIN_SESSION))

  it("400s when `on` is missing or not a boolean", async () => {
    for (const body of [{}, { on: "true" }, { on: 1 }, { on: null }]) {
      const res = await PATCH(req(body) as never, ctx())
      expect(res.status).toBe(400)
    }
    expect(setSequenceStatusMock).not.toHaveBeenCalled()
  })

  it("the 400 reads in plain English, not raw type jargon — whole-branch review, Minor", async () => {
    const res = await PATCH(req({}) as never, ctx())
    const json = await res.json()
    expect(json.error).toBe("Could not understand that request.")
    expect(json.error).not.toMatch(/\bboolean\b/i)
    expect(json.error).not.toContain("{")
  })

  it("400s on a body that is not JSON at all", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/admin/sequences/cold_lead/status", {
        method: "PATCH",
        body: "not json",
      }) as never,
      ctx(),
    )
    expect(res.status).toBe(400)
    expect(setSequenceStatusMock).not.toHaveBeenCalled()
  })
})

describe("PATCH /api/admin/sequences/[key]/status — the write", () => {
  beforeEach(() => authMock.mockResolvedValue(ADMIN_SESSION))

  it("writes 'active' for on: true, under the resolved tenant and the URL's key", async () => {
    const res = await PATCH(req({ on: true }) as never, ctx("cold_lead"))
    expect(res.status).toBe(200)
    expect(setSequenceStatusMock).toHaveBeenCalledWith(BUSINESS_ID, "cold_lead", "active")
  })

  it("writes 'paused' for on: false — NEVER 'draft', which sequences_status_check also allows", async () => {
    // MUTANT: `parsed.data.on ? "paused" : "active"` (inverted), or
    // `"draft"` in either branch.
    const res = await PATCH(req({ on: false }) as never, ctx("cold_lead"))
    expect(res.status).toBe(200)
    expect(setSequenceStatusMock).toHaveBeenCalledWith(BUSINESS_ID, "cold_lead", "paused")
    expect(setSequenceStatusMock).not.toHaveBeenCalledWith(BUSINESS_ID, "cold_lead", "draft")
    expect(setSequenceStatusMock).not.toHaveBeenCalledWith(BUSINESS_ID, "cold_lead", "archived")
  })

  it("uses the key from the URL, not from the body", async () => {
    await PATCH(req({ on: true, key: "someone-elses-key" }) as never, ctx("cold_lead"))
    expect(setSequenceStatusMock).toHaveBeenCalledWith(BUSINESS_ID, "cold_lead", "active")
  })

  it("404s for another tenant's key, when the DAL returns null", async () => {
    setSequenceStatusMock.mockResolvedValue(null)
    const res = await PATCH(req({ on: true }) as never, ctx("someone-elses-key"))
    expect(res.status).toBe(404)
  })

  it("500s, not throws uncaught, when the DAL write fails", async () => {
    setSequenceStatusMock.mockRejectedValue(new Error("db down"))
    const res = await PATCH(req({ on: true }) as never, ctx())
    expect(res.status).toBe(500)
  })

  it("reports what changed: the prior status and the new one", async () => {
    setSequenceStatusMock.mockResolvedValue({ id: "seq-1", from: "paused" })
    const res = await PATCH(req({ on: true }) as never, ctx())
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, sequenceKey: "cold_lead", from: "paused", to: "active" })
  })
})

describe("PATCH /api/admin/sequences/[key]/status — the audit row", () => {
  beforeEach(() => authMock.mockResolvedValue(ADMIN_SESSION))

  it("records the key and the before/after statuses, and NOTHING else", async () => {
    setSequenceStatusMock.mockResolvedValue({ id: "seq-1", from: "draft" })
    await PATCH(req({ on: true }) as never, ctx("cold_lead"))

    expect(recordAuditMock).toHaveBeenCalled()
    const call = recordAuditMock.mock.calls.at(-1)?.[0] as {
      action: string
      category: string
      outcome: string
      target?: { type: string; id: string }
      metadata?: Record<string, unknown>
    }
    expect(call.action).toBe("sequence.status_changed")
    expect(call.category).toBe("admin_write")
    expect(call.outcome).toBe("success")
    expect(call.target).toEqual({ type: "sequence", id: "cold_lead" })
    // Exact equality, not toMatchObject — an extra key here (a contact id, an
    // email, the raw response body via `...body`) must fail this test.
    expect(call.metadata).toEqual({ sequence_key: "cold_lead", from: "draft", to: "active" })
  })

  it("records a denied outcome for a non-admin, naming nobody", async () => {
    authMock.mockResolvedValue(CLIENT_SESSION)
    await PATCH(req({ on: true }) as never, ctx("cold_lead"))
    const call = recordAuditMock.mock.calls.at(-1)?.[0] as { outcome: string; target?: unknown }
    expect(call.outcome).toBe("denied")
    expect(call.target).toEqual({ type: "sequence", id: "cold_lead" })
  })
})
