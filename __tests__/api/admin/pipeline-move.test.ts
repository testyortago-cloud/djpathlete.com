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
// therefore move a revenue number, so a non-admin session must be refused
// before moveOpportunityManually is ever reached.

import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const moveOpportunityManuallyMock = vi.fn()
const recordAuditMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/pipeline", () => ({
  moveOpportunityManually: (...a: unknown[]) => moveOpportunityManuallyMock(...a),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAuditMock(...a) }))

import { POST } from "@/app/api/admin/pipeline/move/route"

const ADMIN_SESSION = { user: { id: "admin-1", role: "admin" } }
const CLIENT_SESSION = { user: { id: "client-1", role: "client" } }
const STAFF_SESSION = { user: { id: "staff-1", role: "staff", permissions: {} } }

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

  it("403s for staff too — this route is admin-only, not permission-gated", async () => {
    authMock.mockResolvedValue(STAFF_SESSION)
    const res = await POST(req({ opportunityId: "opp-1", toStageKey: "consulted" }) as never, NO_PARAMS)
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
