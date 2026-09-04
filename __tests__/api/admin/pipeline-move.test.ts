// @vitest-environment node
//
// __tests__/api/admin/pipeline-move.test.ts
//
// POST /api/admin/pipeline/move — the only way a human moves a card on the
// Lead Engine board. `moveOpportunityManually` (lib/db/pipeline.ts, Task 3/5)
// already owns every consequence of a move: setting closed_trigger='manual',
// dual-logging the audit slugs on a close, clearing closure fields on a
// reopen. This route is thin on purpose — auth, parse, call, respond — so
// these tests mock `moveOpportunityManually` rather than a Supabase client,
// and assert the CALL rather than DB state: what closed_trigger ends up as is
// already covered by __tests__/db/pipeline.test.ts.
//
// The 403 case is not boilerplate here: this endpoint can close a deal and
// therefore move a revenue number, so an unauthorised session must be refused
// before moveOpportunityManually is ever reached.
//
// AS OF 2026-09-04 THIS ROUTE IS NO LONGER ADMIN-ONLY. `/api/admin/pipeline` is
// mapped to the `contacts` permission, so a coach can move cards on their OWN
// board — that is the point of the change. Two things replace the old blanket
// `role === "admin"` check and both are asserted below: the permission gate,
// and the tenant. The tenant half is the one that matters, because
// `opportunityId` arrives in the REQUEST BODY: without a businessId,
// moveOpportunityManually falls back to its SINGLETON_BUSINESS_ID default and a
// coach moves the operator's cards.

import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const moveOpportunityManuallyMock = vi.fn()
const recordAuditMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/pipeline", () => ({
  moveOpportunityManually: (...a: unknown[]) => moveOpportunityManuallyMock(...a),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAuditMock(...a) }))
// Mocked, or the route's resolveAdminTenantForRequest reaches a real Supabase
// client and this stops being a unit test.
//
// The error class is DECLARED INSIDE the factory and imported back below, not
// declared above it: vi.mock is hoisted to the top of the file, so a top-level
// `class` referenced from the factory is still in its temporal dead zone when
// the factory runs. That failure reports as "no tests", which is
// indistinguishable from a passing run at a glance.
const resolveTenantMock = vi.fn()
vi.mock("@/lib/tenancy/resolve", () => {
  class NoAccessibleBusinessError extends Error {}
  return {
    resolveAdminTenantForRequest: (...a: unknown[]) => resolveTenantMock(...a),
    NoAccessibleBusinessError,
  }
})

import { POST } from "@/app/api/admin/pipeline/move/route"
// The same class the route will `instanceof` against — taken from the mocked
// module so the two cannot be different constructors.
import { NoAccessibleBusinessError } from "@/lib/tenancy/resolve"

const ADMIN_SESSION = { user: { id: "admin-1", role: "admin" } }
const CLIENT_SESSION = { user: { id: "client-1", role: "client" } }
const STAFF_SESSION = { user: { id: "staff-1", role: "staff", permissions: {} } }
/** A coach who holds the permission this route is now mapped to. */
const COACH_SESSION = { user: { id: "coach-1", role: "staff", permissions: { contacts: true } } }
/**
 * The coach's own tenant. Deliberately NOT SINGLETON_BUSINESS_ID
 * (00000000-0000-0000-0000-000000000001): a fixture equal to the singleton
 * makes every "the right tenant reached the DAL" assertion vacuous, because
 * code that quietly kept scoping to the constant would satisfy it.
 */
const BUSINESS_ID = "22222222-2222-2222-2222-222222222222"

function req(body: unknown) {
  return new Request("http://localhost/api/admin/pipeline/move", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

// This route has no dynamic segment, but withAudit's Handler type still
// requires a context arg (it's shared with [id] routes) — an empty params
// promise satisfies it without meaning anything for this route.
const NO_PARAMS = { params: Promise.resolve({}) }

beforeEach(() => {
  authMock.mockReset()
  moveOpportunityManuallyMock.mockReset()
  recordAuditMock.mockReset()
  moveOpportunityManuallyMock.mockResolvedValue(undefined)
  resolveTenantMock.mockReset()
  resolveTenantMock.mockResolvedValue({ businessId: BUSINESS_ID, choices: [], isOperator: false })
})

describe("POST /api/admin/pipeline/move", () => {
  it("401s when there is no session", async () => {
    authMock.mockResolvedValue(null)
    const res = await POST(req({ opportunityId: "opp-1", toStageKey: "won" }) as never, NO_PARAMS)
    expect(res.status).toBe(401)
    expect(moveOpportunityManuallyMock).not.toHaveBeenCalled()
  })

  it("403s for a non-admin session — this endpoint can close deals and move revenue numbers", async () => {
    authMock.mockResolvedValue(CLIENT_SESSION)
    const res = await POST(req({ opportunityId: "opp-1", toStageKey: "won" }) as never, NO_PARAMS)
    expect(res.status).toBe(403)
    expect(moveOpportunityManuallyMock).not.toHaveBeenCalled()
  })

  it("403s for a staff member who does NOT hold `contacts`", async () => {
    // This assertion used to read "admin-only, not permission-gated". That
    // stopped being true on 2026-09-04; what survives of it is the part that
    // still matters — holding no permission is still a refusal, and the refusal
    // still happens before moveOpportunityManually is reached.
    authMock.mockResolvedValue(STAFF_SESSION)
    const res = await POST(req({ opportunityId: "opp-1", toStageKey: "consulted" }) as never, NO_PARAMS)
    expect(res.status).toBe(403)
    expect(moveOpportunityManuallyMock).not.toHaveBeenCalled()
  })

  it("lets a coach holding `contacts` move a card — the point of the change", async () => {
    // The presence control for the refusal above: without this, a route that
    // 403'd everyone would pass every negative assertion in this file.
    authMock.mockResolvedValue(COACH_SESSION)
    const res = await POST(req({ opportunityId: "opp-9", toStageKey: "consulted" }) as never, NO_PARAMS)
    expect(res.status).toBe(200)
    expect(moveOpportunityManuallyMock).toHaveBeenCalledWith({
      opportunityId: "opp-9",
      toStageKey: "consulted",
      actorUserId: "coach-1",
      businessId: BUSINESS_ID,
      actorRole: "staff",
    })
  })

  it("moves the card in the CALLER'S tenant, never the singleton", async () => {
    // MUTANT: dropping `businessId` from the call. moveOpportunityManually
    // defaults it to SINGLETON_BUSINESS_ID, so the move silently lands on the
    // operator's own pipeline and the coach's board looks broken while the
    // operator's changes underneath them.
    authMock.mockResolvedValue(COACH_SESSION)
    await POST(req({ opportunityId: "opp-9", toStageKey: "won" }) as never, NO_PARAMS)
    const arg = moveOpportunityManuallyMock.mock.calls[0][0] as { businessId?: string }
    expect(arg.businessId).toBe(BUSINESS_ID)
    expect(arg.businessId).not.toBe("00000000-0000-0000-0000-000000000001")
  })

  it("audits the move under the mover's REAL role, not a hardcoded admin", async () => {
    // MUTANT: dropping actorRole. moveOpportunityManually defaulted the audit
    // rows to `role: "admin"`, which was true by construction only while this
    // route gated on `role === "admin"`. A coach can close a deal now, so
    // leaving it hardcoded files every coach close against the operator — the
    // actor id stays right, so the row is traceable, but "did a coach close
    // this deal?" gets the wrong answer from the one trail meant to answer it.
    authMock.mockResolvedValue(COACH_SESSION)
    await POST(req({ opportunityId: "opp-9", toStageKey: "won" }) as never, NO_PARAMS)
    const arg = moveOpportunityManuallyMock.mock.calls[0][0] as { actorRole?: string }
    expect(arg.actorRole).toBe("staff")
    expect(arg.actorRole).not.toBe("admin")
  })

  it("403s when the caller resolves to no business at all", async () => {
    // A revoked membership, or a coach whose only business was paused. Failing
    // closed here is what stops the route falling through to the singleton.
    authMock.mockResolvedValue(COACH_SESSION)
    resolveTenantMock.mockRejectedValue(new NoAccessibleBusinessError())
    const res = await POST(req({ opportunityId: "opp-1", toStageKey: "won" }) as never, NO_PARAMS)
    expect(res.status).toBe(403)
    expect(moveOpportunityManuallyMock).not.toHaveBeenCalled()
  })

  it("400s when opportunityId or toStageKey is missing", async () => {
    authMock.mockResolvedValue(ADMIN_SESSION)
    const res = await POST(req({ opportunityId: "opp-1" }) as never, NO_PARAMS)
    expect(res.status).toBe(400)
    expect(moveOpportunityManuallyMock).not.toHaveBeenCalled()
  })

  it("200s for an admin and calls moveOpportunityManually with the session user's id", async () => {
    authMock.mockResolvedValue(ADMIN_SESSION)
    const res = await POST(req({ opportunityId: "opp-1", toStageKey: "consulted" }) as never, NO_PARAMS)
    expect(res.status).toBe(200)
    expect(moveOpportunityManuallyMock).toHaveBeenCalledWith({
      opportunityId: "opp-1",
      toStageKey: "consulted",
      actorUserId: "admin-1",
      businessId: BUSINESS_ID,
      actorRole: "admin",
    })
  })

  it("moving a card to the won stage passes toStageKey through unchanged — closed_trigger='manual' is the DAL's job, asserted in __tests__/db/pipeline.test.ts", async () => {
    authMock.mockResolvedValue(ADMIN_SESSION)
    const res = await POST(req({ opportunityId: "opp-2", toStageKey: "won" }) as never, NO_PARAMS)
    expect(res.status).toBe(200)
    expect(moveOpportunityManuallyMock).toHaveBeenCalledWith({
      opportunityId: "opp-2",
      toStageKey: "won",
      actorUserId: "admin-1",
      businessId: BUSINESS_ID,
      actorRole: "admin",
    })
  })

  it("500s (as a 400) when moveOpportunityManually throws, without leaking the raw error shape", async () => {
    authMock.mockResolvedValue(ADMIN_SESSION)
    moveOpportunityManuallyMock.mockRejectedValue(new Error("stage \"bogus\" not found on pipeline pipe-1"))
    const res = await POST(req({ opportunityId: "opp-1", toStageKey: "bogus" }) as never, NO_PARAMS)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain("bogus")
  })
})
