// @vitest-environment node
//
// __tests__/app/api/admin/pipeline/stages-route.test.ts
//
// G29 Task 5. PUT /api/admin/pipeline/boards/[id]/stages — the whole-list
// save of a board's stage list. Same permission/tenant shape as
// boards-route.test.ts in this same directory.

import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const canAccessMock = vi.fn()
const resolveTenantMock = vi.fn()
const readStagesForEditMock = vi.fn()
const savePipelineStagesMock = vi.fn()
const recordAuditMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/permissions/guard", () => ({
  canAccessAdminPath: (...a: unknown[]) => canAccessMock(...a),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAuditMock(...a) }))

// Declared INSIDE the factory and imported back below — vi.mock is hoisted,
// so a top-level class referenced from the factory would still be in its
// temporal dead zone when the factory runs (that failure reports as "no
// tests", indistinguishable from a passing run).
vi.mock("@/lib/tenancy/resolve", () => {
  class NoAccessibleBusinessError extends Error {}
  return {
    resolveAdminTenantForRequest: (...a: unknown[]) => resolveTenantMock(...a),
    NoAccessibleBusinessError,
  }
})

// `PipelineBoardNotFoundError` declared INSIDE the factory, same reason as
// `NoAccessibleBusinessError` above — and imported back below so tests
// construct the SAME class the route's `instanceof` check compares against.
vi.mock("@/lib/db/pipeline", () => {
  class PipelineBoardNotFoundError extends Error {
    constructor(pipelineId: string) {
      super(`Board ${pipelineId} was not found for this business.`)
      this.name = "PipelineBoardNotFoundError"
    }
  }
  return {
    readStagesForEdit: (...a: unknown[]) => readStagesForEditMock(...a),
    savePipelineStages: (...a: unknown[]) => savePipelineStagesMock(...a),
    PipelineBoardNotFoundError,
  }
})

import { PUT } from "@/app/api/admin/pipeline/boards/[id]/stages/route"
import { NoAccessibleBusinessError } from "@/lib/tenancy/resolve"
import { PipelineBoardNotFoundError } from "@/lib/db/pipeline"

const STAFF_SESSION = { user: { id: "staff-1", role: "staff", permissions: {} } }
const COACH_SESSION = { user: { id: "coach-1", role: "staff", permissions: { contacts: true } } }

const SINGLETON = "00000000-0000-0000-0000-000000000001"
/** The coach's own tenant — deliberately NOT the singleton. */
const BUSINESS_ID = "22222222-2222-2222-2222-222222222222"
/** A DIFFERENT tenant — used to model "this board belongs to someone else". */
const OTHER_BUSINESS_ID = "33333333-3333-3333-3333-333333333333"
const BOARD_ID = "board-1"

type StageDraft = {
  id: string | null
  key: string
  name: string
  kind: "open" | "won" | "lost"
  amberAfterDays: number | null
  redAfterDays: number | null
}

const OPEN_STAGE: StageDraft = {
  id: "stage-open",
  key: "open",
  name: "Open",
  kind: "open",
  amberAfterDays: 3,
  redAfterDays: 7,
}
const WON_STAGE: StageDraft = {
  id: "stage-won",
  key: "won",
  name: "Won",
  kind: "won",
  amberAfterDays: null,
  redAfterDays: null,
}
const LOST_STAGE: StageDraft = {
  id: "stage-lost",
  key: "lost",
  name: "Lost",
  kind: "lost",
  amberAfterDays: null,
  redAfterDays: null,
}

/** A valid, submittable stage list — one of each mandatory kind. */
const VALID_STAGES: StageDraft[] = [OPEN_STAGE, WON_STAGE, LOST_STAGE]

/** What `readStagesForEdit` returns for an EXISTING, this-tenant's board. */
const EXISTING_BOARD_STAGES = {
  stages: [
    { id: "stage-open", key: "open", position: 1, name: "Open", kind: "open" as const, amberAfterDays: 3, redAfterDays: 7 },
    { id: "stage-won", key: "won", position: 2, name: "Won", kind: "won" as const, amberAfterDays: null, redAfterDays: null },
    { id: "stage-lost", key: "lost", position: 3, name: "Lost", kind: "lost" as const, amberAfterDays: null, redAfterDays: null },
  ],
  cardCountByStageId: new Map<string, number>(),
}

function putReq(body: unknown) {
  return new Request(`https://www.darrenjpaul.com/api/admin/pipeline/boards/${BOARD_ID}/stages`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const boardParams = { params: Promise.resolve({ id: BOARD_ID }) }

/**
 * Which (id, businessId) pair `readStagesForEditMock` treats as "this board
 * exists and has stages" — everything else comes back empty. Reviewer
 * finding (Task 5, fix round 1): a mock that returns the SAME thing
 * regardless of arguments cannot tell the route's pre-check apart from a
 * stale or hardcoded id/businessId — it would pass every test here even if
 * the route stopped forwarding the real values. Modelling "what the
 * database currently contains" and checking the mock's ACTUAL call
 * arguments against it (rather than a per-test `mockResolvedValueOnce`
 * override) is what makes the pre-check's arguments load-bearing for these
 * tests, not decorative.
 */
let knownBoard: { id: string; businessId: string } | null

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: a queued `*Once` implementation left
  // over from a previous test leaks across the boundary and misattributes
  // failures (this repo's own lesson).
  vi.resetAllMocks()
  authMock.mockResolvedValue(COACH_SESSION)
  canAccessMock.mockResolvedValue(true)
  resolveTenantMock.mockResolvedValue({ businessId: BUSINESS_ID, choices: [], isOperator: false })
  knownBoard = { id: BOARD_ID, businessId: BUSINESS_ID }
  readStagesForEditMock.mockImplementation((id: string, businessId: string) => {
    if (knownBoard && id === knownBoard.id && businessId === knownBoard.businessId) {
      return Promise.resolve(EXISTING_BOARD_STAGES)
    }
    return Promise.resolve({ stages: [], cardCountByStageId: new Map<string, number>() })
  })
  savePipelineStagesMock.mockResolvedValue({ ok: true })
  recordAuditMock.mockResolvedValue(undefined)
})

describe("PUT /api/admin/pipeline/boards/[id]/stages", () => {
  it("401s with no session", async () => {
    authMock.mockResolvedValue(null)
    const res = await PUT(putReq({ stages: VALID_STAGES }) as never, boardParams)
    expect(res.status).toBe(401)
    expect(savePipelineStagesMock).not.toHaveBeenCalled()
  })

  it("403s a staff member without `contacts`", async () => {
    authMock.mockResolvedValue(STAFF_SESSION)
    canAccessMock.mockResolvedValue(false)
    const res = await PUT(putReq({ stages: VALID_STAGES }) as never, boardParams)
    expect(res.status).toBe(403)
    expect(savePipelineStagesMock).not.toHaveBeenCalled()
  })

  it("403s when the caller resolves to no business at all", async () => {
    resolveTenantMock.mockRejectedValue(new NoAccessibleBusinessError())
    const res = await PUT(putReq({ stages: VALID_STAGES }) as never, boardParams)
    expect(res.status).toBe(403)
    expect(savePipelineStagesMock).not.toHaveBeenCalled()
  })

  it("400s a body where `stages` is not an array, naming the field", async () => {
    const res = await PUT(putReq({ stages: "not-an-array" }) as never, boardParams)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.field).toBe("stages")
    expect(readStagesForEditMock).not.toHaveBeenCalled()
    expect(savePipelineStagesMock).not.toHaveBeenCalled()
  })

  it("400s a stage name over the length cap, naming the field rather than a bare 'Invalid request body'", async () => {
    const res = await PUT(
      putReq({ stages: [{ ...OPEN_STAGE, name: "x".repeat(500) }, WON_STAGE, LOST_STAGE] }) as never,
      boardParams,
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).not.toBe("Invalid request body.")
    expect(body.field).toContain("name")
  })

  it("400s a `position` field on a stage instead of silently accepting it", async () => {
    const res = await PUT(
      putReq({ stages: [{ ...OPEN_STAGE, position: 1 }, WON_STAGE, LOST_STAGE] }) as never,
      boardParams,
    )
    expect(res.status).toBe(400)
    expect(savePipelineStagesMock).not.toHaveBeenCalled()
  })

  describe("a board id that does not resolve for this tenant", () => {
    it("404s a board id that does not exist, and never reaches savePipelineStages", async () => {
      // Argument-aware, not a canned override: nothing matches `knownBoard`,
      // so the mock's OWN comparison of (id, businessId) against "what
      // exists" is what produces the empty read — the SAME logic every
      // other test's happy path relies on to return stages at all.
      knownBoard = null
      const res = await PUT(putReq({ stages: VALID_STAGES }) as never, boardParams)
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.error).toBe(`Board ${BOARD_ID} was not found for this business.`)
      expect(readStagesForEditMock).toHaveBeenCalledWith(BOARD_ID, BUSINESS_ID)
      expect(savePipelineStagesMock).not.toHaveBeenCalled()
    })

    it("404s a board id belonging to a different tenant, with the SAME status and message as the nonexistent case, driven by the mock's argument-awareness", async () => {
      // `knownBoard` is left at its default (BOARD_ID belongs to
      // BUSINESS_ID) — the board genuinely exists. What changes is the
      // CALLER's resolved tenant, to a different, equally real business.
      // `readStagesForEditMock` still runs its own (id, businessId)
      // comparison — this is not a `mockResolvedValueOnce` standing in for
      // "the answer is empty this time"; the mock does not know in advance
      // that this call should miss, it just compares the ACTUAL arguments
      // the route passed it against what actually exists, same as every
      // other test.
      resolveTenantMock.mockResolvedValueOnce({ businessId: OTHER_BUSINESS_ID, choices: [], isOperator: false })
      const foreignTenantRes = await PUT(putReq({ stages: VALID_STAGES }) as never, boardParams)
      const foreignTenantBody = await foreignTenantRes.json()

      expect(foreignTenantRes.status).toBe(404)
      expect(foreignTenantBody.error).toBe(`Board ${BOARD_ID} was not found for this business.`)
      // Same id in the URL both times (BOARD_ID) is what makes this message
      // comparable to the "does not exist at all" test above — the message
      // is templated only on the id, so an identical id produces an
      // identical message regardless of WHY the lookup missed. Pinned
      // explicitly rather than re-deriving it from a second call, so this
      // test's failure points at the real cause instead of a second PUT.
      expect(readStagesForEditMock).toHaveBeenCalledWith(BOARD_ID, OTHER_BUSINESS_ID)
      expect(savePipelineStagesMock).not.toHaveBeenCalled()
    })
  })

  it("400s a list with no Won stage, carrying validateStageList's exact English", async () => {
    savePipelineStagesMock.mockResolvedValue({
      ok: false,
      problems: [{ index: null, message: "A board needs exactly one Won stage. This one has 0." }],
    })
    const res = await PUT(putReq({ stages: [OPEN_STAGE, LOST_STAGE] }) as never, boardParams)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.problems).toEqual([{ index: null, message: "A board needs exactly one Won stage. This one has 0." }])
  })

  it("400s a removal that would strand cards, naming the stage, and carries the problems array intact (not flattened)", async () => {
    savePipelineStagesMock.mockResolvedValue({
      ok: false,
      problems: [
        {
          index: null,
          message: `Stage "open" still has 2 card(s) on it. Say which stage they should move to before removing it.`,
        },
      ],
    })
    const res = await PUT(putReq({ stages: [WON_STAGE, LOST_STAGE], destinations: {} }) as never, boardParams)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(Array.isArray(body.problems)).toBe(true)
    expect(body.problems[0].message).toContain('Stage "open" still has 2 card(s)')
  })

  it("200s a valid save, and calls savePipelineStages with the stages in SUBMITTED ORDER and the RESOLVED businessId", async () => {
    const reordered = [LOST_STAGE, OPEN_STAGE, WON_STAGE]
    const res = await PUT(putReq({ stages: reordered, destinations: { "old-stage": "stage-open" } }) as never, boardParams)

    expect(res.status).toBe(200)
    expect(savePipelineStagesMock).toHaveBeenCalledWith({
      pipelineId: BOARD_ID,
      businessId: BUSINESS_ID,
      stages: reordered,
      destinations: { "old-stage": "stage-open" },
    })
    const [{ businessId, stages }] = savePipelineStagesMock.mock.calls[0]
    expect(businessId).not.toBe(SINGLETON)
    expect(businessId).toBe(BUSINESS_ID)
    // Order, not just membership — a mutant that reversed or sorted the
    // array would still call with "the same stages" by set-equality.
    expect(stages.map((s: StageDraft) => s.key)).toEqual(["lost", "open", "won"])
  })

  // Reviewer finding (Task 5, fix round 1): the 404 pre-check's own
  // arguments had zero direct regression protection — `readStagesForEditMock`
  // used to return the same thing no matter what it was called with, so a
  // future refactor that changed `readStagesForEdit(id, businessId)` to a
  // stale or hardcoded pair would have passed every test in this file
  // silently. Asserted on `mock.calls[0]` specifically (not just
  // `toHaveBeenCalledWith`, which is satisfied by ANY matching call) because
  // this is the ONE call this route makes to `readStagesForEdit` — the
  // pre-check — and nothing else in this test file's mocking exercises the
  // (unrelated, separately-mocked) call `savePipelineStages` makes
  // internally in production.
  it("the pre-check calls readStagesForEdit with the board id from the URL and the RESOLVED businessId, not a body-supplied or hardcoded one", async () => {
    await PUT(
      putReq({ stages: VALID_STAGES, destinations: { "some-stage-id": SINGLETON } }) as never,
      boardParams,
    )
    expect(readStagesForEditMock.mock.calls[0]).toEqual([BOARD_ID, BUSINESS_ID])
  })

  it("defaults `destinations` to {} when the caller omits it", async () => {
    await PUT(putReq({ stages: VALID_STAGES }) as never, boardParams)
    expect(savePipelineStagesMock).toHaveBeenCalledWith(
      expect.objectContaining({ destinations: {} }),
    )
  })

  // Presence control (per the task brief): without this, a route that 400'd
  // or 404'd EVERY save would pass every test above just as well as a
  // correct one — this is what proves the valid-save path is genuinely 200
  // and genuinely records success, not merely "didn't throw".
  it("the valid save's audit outcome is success", async () => {
    await PUT(putReq({ stages: VALID_STAGES }) as never, boardParams)
    const call = recordAuditMock.mock.calls.find((c) => c[0].action === "pipeline.stages_saved")
    expect(call?.[0].outcome).toBe("success")
  })

  it("the audit target names the board and labels the submitted stage count", async () => {
    await PUT(putReq({ stages: VALID_STAGES }) as never, boardParams)
    const call = recordAuditMock.mock.calls.find((c) => c[0].action === "pipeline.stages_saved")
    expect(call?.[0].target).toEqual({ type: "pipeline_board", id: BOARD_ID, label: "3 stage(s) submitted" })
  })
})
