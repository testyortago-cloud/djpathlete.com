// @vitest-environment node
//
// __tests__/app/api/admin/pipeline/grant-route.test.ts
//
// POST /api/admin/pipeline/grant had NO test at all before 2026-09-04, while
// being the highest-consequence write on the Lead Engine board: it assigns a
// program, can create a real account, and sends a real person a real email.
//
// It was `role === "admin"` and nothing else. That single line was doing two
// jobs at once — deciding WHO may grant, and (by admitting only the operator)
// making it not matter WHICH tenant's opportunity was being granted, because
// `readOpportunityForGrant` had no business predicate and `opportunityId`
// arrives in the REQUEST BODY.
//
// Mapping `/api/admin/pipeline` to the staff-grantable `contacts` permission
// splits those jobs apart, so both halves need asserting:
//
//   1. the permission gate  — a staff member without `contacts` is refused
//   2. the tenant           — the read is fenced to the CALLER'S business
//
// Assertion 2 is the one that would have been a real cross-tenant write. A test
// that only covered assertion 1 would be just as green for the dangerous
// version of this route.

import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const canAccessMock = vi.fn()
const readOpportunityForGrantMock = vi.fn()
const grantWonOpportunityMock = vi.fn()
const resolveTenantMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/permissions/guard", () => ({
  canAccessAdminPath: (...a: unknown[]) => canAccessMock(...a),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

// Declared INSIDE the factory and imported back below. vi.mock is hoisted, so a
// top-level class referenced from the factory is still in its temporal dead
// zone when the factory runs — and that failure reports as "no tests", which is
// indistinguishable from a passing run.
vi.mock("@/lib/tenancy/resolve", () => {
  class NoAccessibleBusinessError extends Error {}
  return {
    resolveAdminTenantForRequest: (...a: unknown[]) => resolveTenantMock(...a),
    NoAccessibleBusinessError,
  }
})

// The route imports these three lazily, inside the handler. Mocking the modules
// still works because the dynamic import resolves through the same registry.
vi.mock("@/lib/db/pipeline", () => ({
  readOpportunityForGrant: (...a: unknown[]) => readOpportunityForGrantMock(...a),
  readContactIdentity: vi.fn(),
}))
vi.mock("@/lib/funnels/checkout/deps", () => ({ buildManualGrantDeps: vi.fn() }))
vi.mock("@/lib/funnels/checkout/grant", () => ({ grantFunnelPurchase: vi.fn() }))
vi.mock("@/lib/funnels/checkout/grant-manual", () => ({
  grantWonOpportunity: (...a: unknown[]) => grantWonOpportunityMock(...a),
}))

import { POST } from "@/app/api/admin/pipeline/grant/route"
import { NoAccessibleBusinessError } from "@/lib/tenancy/resolve"

const ADMIN_SESSION = { user: { id: "admin-1", role: "admin" } }
const CLIENT_SESSION = { user: { id: "client-1", role: "client" } }
const STAFF_SESSION = { user: { id: "staff-1", role: "staff", permissions: {} } }
const COACH_SESSION = { user: { id: "coach-1", role: "staff", permissions: { contacts: true } } }

const SINGLETON = "00000000-0000-0000-0000-000000000001"
/** The coach's own tenant — deliberately NOT the singleton. See the header. */
const BUSINESS_ID = "22222222-2222-2222-2222-222222222222"
const OPPORTUNITY_ID = "opp-1"

function req(body: unknown) {
  return new Request("https://www.darrenjpaul.com/api/admin/pipeline/grant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const NO_PARAMS = { params: Promise.resolve({}) }
const validBody = { opportunityId: OPPORTUNITY_ID, programId: "prog-1" }

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: a queued `*Once` implementation left over
  // from a previous test leaks across the boundary and misattributes failures.
  vi.resetAllMocks()
  authMock.mockResolvedValue(ADMIN_SESSION)
  canAccessMock.mockResolvedValue(true)
  resolveTenantMock.mockResolvedValue({ businessId: BUSINESS_ID, choices: [], isOperator: false })
  readOpportunityForGrantMock.mockResolvedValue({
    id: OPPORTUNITY_ID,
    outcome: "won",
    contact_id: "contact-1",
    source_session_id: null,
  })
  grantWonOpportunityMock.mockResolvedValue({ outcome: "granted", userId: "u-1", accountCreated: true })
})

describe("who may grant", () => {
  it("401s with no session", async () => {
    authMock.mockResolvedValue(null)
    const res = await POST(req(validBody) as never, NO_PARAMS)
    expect(res.status).toBe(401)
    expect(grantWonOpportunityMock).not.toHaveBeenCalled()
  })

  it("403s a client outright", async () => {
    authMock.mockResolvedValue(CLIENT_SESSION)
    canAccessMock.mockResolvedValue(false)
    const res = await POST(req(validBody) as never, NO_PARAMS)
    expect(res.status).toBe(403)
    expect(grantWonOpportunityMock).not.toHaveBeenCalled()
  })

  it("403s a staff member who does not hold `contacts`", async () => {
    authMock.mockResolvedValue(STAFF_SESSION)
    canAccessMock.mockResolvedValue(false)
    const res = await POST(req(validBody) as never, NO_PARAMS)
    expect(res.status).toBe(403)
    expect(grantWonOpportunityMock).not.toHaveBeenCalled()
  })

  it("refuses BEFORE resolving a tenant or touching the grant path", async () => {
    // Order matters: a refusal that still resolved a tenant would be doing work
    // on behalf of a caller already known to be unauthorised.
    canAccessMock.mockResolvedValue(false)
    await POST(req(validBody) as never, NO_PARAMS)
    expect(resolveTenantMock).not.toHaveBeenCalled()
  })

  it("lets a coach holding `contacts` grant — the presence control", async () => {
    // Without this, a route that 403'd everybody would satisfy every negative
    // assertion above.
    authMock.mockResolvedValue(COACH_SESSION)
    const res = await POST(req(validBody) as never, NO_PARAMS)
    expect(res.status).toBe(200)
    expect(grantWonOpportunityMock).toHaveBeenCalled()
  })
})

describe("which tenant's card gets granted", () => {
  it("reads the opportunity in the CALLER'S business", async () => {
    // MUTANT: `readOpportunityForGrant(opportunityId)` with one argument, the
    // shape this route shipped with. `opportunityId` comes from the body, so
    // unscoped it grants against ANY tenant's won card — assigning a program
    // and emailing a stranger's athlete.
    authMock.mockResolvedValue(COACH_SESSION)
    await POST(req(validBody) as never, NO_PARAMS)

    // The route hands grantWonOpportunity a closure; invoke it the way the real
    // grant path does, then assert what reached the DAL underneath.
    const deps = grantWonOpportunityMock.mock.calls[0][1] as {
      getOpportunity: (id: string) => Promise<unknown>
    }
    await deps.getOpportunity(OPPORTUNITY_ID)

    expect(readOpportunityForGrantMock).toHaveBeenCalledWith(OPPORTUNITY_ID, BUSINESS_ID)
    const [, passed] = readOpportunityForGrantMock.mock.calls[0]
    expect(passed).not.toBe(SINGLETON)
    expect(passed).not.toBeUndefined()
  })

  it("403s when the caller resolves to no business at all", async () => {
    // A revoked membership, or a coach whose only business was paused. Failing
    // closed is what stops an unresolvable caller reaching the grant path.
    authMock.mockResolvedValue(COACH_SESSION)
    resolveTenantMock.mockRejectedValue(new NoAccessibleBusinessError())
    const res = await POST(req(validBody) as never, NO_PARAMS)
    expect(res.status).toBe(403)
    expect(grantWonOpportunityMock).not.toHaveBeenCalled()
  })
})

describe("the body still has to make sense", () => {
  it("400s without opportunityId or programId", async () => {
    for (const body of [{ programId: "prog-1" }, { opportunityId: OPPORTUNITY_ID }, {}]) {
      const res = await POST(req(body) as never, NO_PARAMS)
      expect(res.status).toBe(400)
    }
    expect(grantWonOpportunityMock).not.toHaveBeenCalled()
  })

  it("404s a card that is not in the caller's tenant", async () => {
    // The scoped read answers null for "no such card" and "another coach's
    // card" alike, and 404 is the right answer to fail closed to for both.
    grantWonOpportunityMock.mockResolvedValue({ outcome: "unknown_opportunity" })
    const res = await POST(req(validBody) as never, NO_PARAMS)
    expect(res.status).toBe(404)
  })

  it("409s a card that is not won", async () => {
    grantWonOpportunityMock.mockResolvedValue({ outcome: "not_won" })
    const res = await POST(req(validBody) as never, NO_PARAMS)
    expect(res.status).toBe(409)
  })

  it("reports a granted account whose invite email did not send", async () => {
    // The account exists and is granted; only the invite failed. Reporting a
    // clean success would leave the coach thinking the athlete was emailed.
    grantWonOpportunityMock.mockResolvedValue({
      outcome: "granted",
      userId: "u-1",
      accountCreated: true,
      emailFailed: true,
    })
    const res = await POST(req(validBody) as never, NO_PARAMS)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true, emailFailed: true })
  })
})
