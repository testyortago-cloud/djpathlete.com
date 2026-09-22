// @vitest-environment node
//
// __tests__/app/api/admin/pipeline/boards-route.test.ts
//
// G29 Task 4. POST /api/admin/pipeline/boards (create) and PATCH
// /api/admin/pipeline/boards/[id] (rename / archive) — the same
// permission/tenant shape as pipeline/move/route.ts and pipeline/grant/route.ts
// in this same directory: `/api/admin/pipeline` is mapped to the
// staff-grantable `contacts` permission, so a coach (not just the operator)
// can manage boards on their own business, and `resolveAdminTenantForRequest`
// is what stops that coach's write from landing on another tenant's board.

import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const canAccessMock = vi.fn()
const resolveTenantMock = vi.fn()
const createPipelineBoardMock = vi.fn()
const updatePipelineBoardMock = vi.fn()
const readBoardRowMock = vi.fn()
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
    createPipelineBoard: (...a: unknown[]) => createPipelineBoardMock(...a),
    updatePipelineBoard: (...a: unknown[]) => updatePipelineBoardMock(...a),
    // The PATCH route reads the board BEFORE the update, for the audit row
    // only — see that route's own comment on why it is not a gate.
    readBoardRow: (...a: unknown[]) => readBoardRowMock(...a),
    PipelineBoardNotFoundError,
  }
})

import { POST } from "@/app/api/admin/pipeline/boards/route"
import { PATCH } from "@/app/api/admin/pipeline/boards/[id]/route"
import { NoAccessibleBusinessError } from "@/lib/tenancy/resolve"
import { PipelineBoardNotFoundError } from "@/lib/db/pipeline"

const STAFF_SESSION = { user: { id: "staff-1", role: "staff", permissions: {} } }
const COACH_SESSION = { user: { id: "coach-1", role: "staff", permissions: { contacts: true } } }

const SINGLETON = "00000000-0000-0000-0000-000000000001"

/**
 * The board-name cap, RETYPED on purpose.
 *
 * It has three homes — `MAX_NAME_LENGTH` in app/api/admin/pipeline/boards/route.ts,
 * the same constant in boards/[id]/route.ts, and `MAX_BOARD_NAME_LENGTH` in
 * components/admin/pipeline-settings.tsx — and the whole-branch review
 * deliberately did NOT collapse them: three reviewed files would have to
 * change for a cap nobody has ever hit. What it DID find is that none of the
 * three was pinned at all (`grep "Board name must be" __tests__/` returned
 * nothing), so shrinking any one of them, or dropping a `.max()`, was silent.
 *
 * A retyped number agreeing with a hardcoded one is agreement by luck, which
 * is why the tests below pin the BOUNDARY IN BOTH DIRECTIONS on both routes:
 * a cap moved to 100 fails the "exactly on it" case, and a `.max()` deleted
 * entirely fails the "one over" case. A test that only refused would pass
 * against a route that refuses everything.
 */
const MAX_BOARD_NAME_LENGTH = 200
/** The coach's own tenant — deliberately NOT the singleton. */
const BUSINESS_ID = "22222222-2222-2222-2222-222222222222"
const BOARD_ID = "board-1"

function postReq(body: unknown) {
  return new Request("https://www.darrenjpaul.com/api/admin/pipeline/boards", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function patchReq(body: unknown) {
  return new Request(`https://www.darrenjpaul.com/api/admin/pipeline/boards/${BOARD_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const NO_PARAMS = { params: Promise.resolve({}) }
const boardParams = { params: Promise.resolve({ id: BOARD_ID }) }

/**
 * What the database currently holds for BOARD_ID, and who owns it —
 * `readBoardRowMock` compares its ACTUAL arguments against this rather than
 * answering the same thing whatever it is handed. Same discipline as
 * stages-route.test.ts's `knownBoard`: an argument-blind mock would pass
 * every test here even if the route read a stale id or a hardcoded tenant.
 */
let knownBoard: { id: string; businessId: string; key: string; name: string; status: string } | null

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: a queued `*Once` implementation left
  // over from a previous test leaks across the boundary and misattributes
  // failures (this repo's own lesson).
  vi.resetAllMocks()
  authMock.mockResolvedValue(COACH_SESSION)
  canAccessMock.mockResolvedValue(true)
  resolveTenantMock.mockResolvedValue({ businessId: BUSINESS_ID, choices: [], isOperator: false })
  createPipelineBoardMock.mockResolvedValue({ id: BOARD_ID, key: "camps_clinics" })
  updatePipelineBoardMock.mockResolvedValue(undefined)
  knownBoard = { id: BOARD_ID, businessId: BUSINESS_ID, key: "camps_clinics", name: "Camps & Clinics", status: "active" }
  readBoardRowMock.mockImplementation((id: string, businessId: string) => {
    if (knownBoard && id === knownBoard.id && businessId === knownBoard.businessId) {
      return Promise.resolve({ id: knownBoard.id, key: knownBoard.key, name: knownBoard.name, status: knownBoard.status })
    }
    return Promise.resolve(null)
  })
  recordAuditMock.mockResolvedValue(undefined)
})

describe("POST /api/admin/pipeline/boards", () => {
  it("401s with no session", async () => {
    authMock.mockResolvedValue(null)
    const res = await POST(postReq({ name: "Camps & Clinics" }) as never, NO_PARAMS)
    expect(res.status).toBe(401)
    expect(createPipelineBoardMock).not.toHaveBeenCalled()
  })

  it("403s a staff member without `contacts`", async () => {
    authMock.mockResolvedValue(STAFF_SESSION)
    canAccessMock.mockResolvedValue(false)
    const res = await POST(postReq({ name: "Camps & Clinics" }) as never, NO_PARAMS)
    expect(res.status).toBe(403)
    expect(createPipelineBoardMock).not.toHaveBeenCalled()
  })

  it("403s when the caller resolves to no business at all", async () => {
    resolveTenantMock.mockRejectedValue(new NoAccessibleBusinessError())
    const res = await POST(postReq({ name: "Camps & Clinics" }) as never, NO_PARAMS)
    expect(res.status).toBe(403)
    expect(createPipelineBoardMock).not.toHaveBeenCalled()
  })

  it("400s a blank / whitespace-only name, naming the field", async () => {
    const res = await POST(postReq({ name: "   " }) as never, NO_PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.field).toBe("name")
    expect(createPipelineBoardMock).not.toHaveBeenCalled()
  })

  it("400s a name that duplicates an existing board, readably — the DAL's refusal surfaces, not a 500", async () => {
    createPipelineBoardMock.mockRejectedValue(
      new Error(`A board with the key "camps_clinics" already exists for this business. Choose a different name.`),
    )
    const res = await POST(postReq({ name: "Camps & Clinics" }) as never, NO_PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("already exists")
  })

  describe("the board-name cap, pinned from the refusing side", () => {
    it(`accepts a name of exactly ${MAX_BOARD_NAME_LENGTH} characters`, async () => {
      // `.trim()` runs BEFORE `.max()` in the schema chain, so the
      // "exactly on it" case pads with no surrounding whitespace.
      const res = await POST(postReq({ name: "x".repeat(MAX_BOARD_NAME_LENGTH) }) as never, NO_PARAMS)
      expect(res.status).toBe(200)
      expect(createPipelineBoardMock).toHaveBeenCalled()
    })

    it(`400s a name one character over, naming the field and saying the number`, async () => {
      const res = await POST(postReq({ name: "x".repeat(MAX_BOARD_NAME_LENGTH + 1) }) as never, NO_PARAMS)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe(`Board name must be ${MAX_BOARD_NAME_LENGTH} characters or fewer.`)
      expect(body.field).toBe("name")
      expect(createPipelineBoardMock).not.toHaveBeenCalled()
    })

    it(`the rename route accepts exactly ${MAX_BOARD_NAME_LENGTH} and refuses one more, in the same words`, async () => {
      const onTheCap = await PATCH(patchReq({ name: "x".repeat(MAX_BOARD_NAME_LENGTH) }) as never, boardParams)
      expect(onTheCap.status).toBe(200)

      const over = await PATCH(patchReq({ name: "x".repeat(MAX_BOARD_NAME_LENGTH + 1) }) as never, boardParams)
      expect(over.status).toBe(400)
      const body = await over.json()
      // The two routes carry SEPARATE copies of this cap and this sentence.
      // Asserting the identical string on both is what would catch one of
      // them drifting.
      expect(body.error).toBe(`Board name must be ${MAX_BOARD_NAME_LENGTH} characters or fewer.`)
      expect(body.field).toBe("name")
    })
  })

  it("200s a valid create, and calls createPipelineBoard with the RESOLVED tenant's businessId", async () => {
    const res = await POST(postReq({ name: "Camps & Clinics" }) as never, NO_PARAMS)
    expect(res.status).toBe(200)
    expect(createPipelineBoardMock).toHaveBeenCalledWith({ name: "Camps & Clinics", businessId: BUSINESS_ID })
    const [{ businessId }] = createPipelineBoardMock.mock.calls[0]
    expect(businessId).not.toBe(SINGLETON)
    expect(businessId).not.toBeUndefined()
  })

  it("the audit target resolves the created board's id and name on success", async () => {
    await POST(postReq({ name: "Camps & Clinics" }) as never, NO_PARAMS)
    const call = recordAuditMock.mock.calls.find((c) => c[0].action === "pipeline.board_created")
    expect(call?.[0].target).toEqual({ type: "pipeline_board", id: BOARD_ID, label: "Camps & Clinics" })
  })

  // Whole-branch review, Important 5. The KEY is the one fact about a new
  // board that nothing else on the row carries and nothing can later change —
  // a renamed board is unfindable from a row holding only its old name.
  it("records the created board's key in the audit metadata", async () => {
    await POST(postReq({ name: "Camps & Clinics" }) as never, NO_PARAMS)
    const call = recordAuditMock.mock.calls.find((c) => c[0].action === "pipeline.board_created")
    expect(call?.[0].metadata).toEqual({ key: "camps_clinics" })
  })

  // The presence control for the assertion above: a metadata callback that
  // returned {} unconditionally would pass nothing here, and a callback that
  // invented a key would pass the success case. A REFUSED create has no
  // board in its body, so the key must be absent rather than guessed.
  it("records no key when the create was refused", async () => {
    createPipelineBoardMock.mockRejectedValue(new Error("A board with the key \"camps_clinics\" already exists."))
    await POST(postReq({ name: "Camps & Clinics" }) as never, NO_PARAMS)
    const call = recordAuditMock.mock.calls.find((c) => c[0].action === "pipeline.board_created")
    expect(call?.[0].metadata).toEqual({})
  })
})

describe("PATCH /api/admin/pipeline/boards/[id]", () => {
  it("401s with no session", async () => {
    authMock.mockResolvedValue(null)
    const res = await PATCH(patchReq({ name: "Renamed" }) as never, boardParams)
    expect(res.status).toBe(401)
    expect(updatePipelineBoardMock).not.toHaveBeenCalled()
  })

  it("403s a staff member without `contacts`", async () => {
    authMock.mockResolvedValue(STAFF_SESSION)
    canAccessMock.mockResolvedValue(false)
    const res = await PATCH(patchReq({ name: "Renamed" }) as never, boardParams)
    expect(res.status).toBe(403)
    expect(updatePipelineBoardMock).not.toHaveBeenCalled()
  })

  it("403s when the caller resolves to no business at all", async () => {
    resolveTenantMock.mockRejectedValue(new NoAccessibleBusinessError())
    const res = await PATCH(patchReq({ name: "Renamed" }) as never, boardParams)
    expect(res.status).toBe(403)
    expect(updatePipelineBoardMock).not.toHaveBeenCalled()
  })

  it("400s an unrecognised status value, naming the field", async () => {
    const res = await PATCH(patchReq({ status: "deleted" }) as never, boardParams)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.field).toBe("status")
    expect(updatePipelineBoardMock).not.toHaveBeenCalled()
  })

  it("400s archiving the default board, carrying the DAL's 'every unrouted event falls back to' refusal", async () => {
    updatePipelineBoardMock.mockRejectedValue(
      new Error(
        `"Coaching" is the board every unrouted event falls back to, so it cannot be archived. Point the default at another board first.`,
      ),
    )
    const res = await PATCH(patchReq({ status: "archived" }) as never, boardParams)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("every unrouted event falls back to")
  })

  it("200s a rename — the presence control for the two 404 tests below", async () => {
    const res = await PATCH(patchReq({ name: "Renamed board" }) as never, boardParams)
    expect(res.status).toBe(200)
    expect(updatePipelineBoardMock).toHaveBeenCalledWith({
      pipelineId: BOARD_ID,
      businessId: BUSINESS_ID,
      name: "Renamed board",
      status: undefined,
    })
    // Without this, a route that 404'd EVERY rename would pass both tests
    // below just as well as a correct one.
    const call = recordAuditMock.mock.calls.find((c) => c[0].action === "pipeline.board_updated")
    expect(call?.[0].outcome).toBe("success")
  })

  // Fix round 1, Finding 1 (controller ruling R10). `updatePipelineBoard`
  // now throws `PipelineBoardNotFoundError` — same class, same message
  // template — whether `pipelineId` does not exist at all or belongs to a
  // DIFFERENT tenant (the DAL's own tests in __tests__/db/pipeline-boards.test.ts
  // pin that equivalence for real; here we pin what the ROUTE does with it).
  describe("a board id that does not resolve for this tenant", () => {
    it("404s a board id that does not exist, and records no successful audit row", async () => {
      updatePipelineBoardMock.mockRejectedValue(new PipelineBoardNotFoundError(BOARD_ID))

      const res = await PATCH(patchReq({ name: "Renamed board" }) as never, boardParams)

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.error).toBe(`Board ${BOARD_ID} was not found for this business.`)

      const call = recordAuditMock.mock.calls.find((c) => c[0].action === "pipeline.board_updated")
      expect(call?.[0].outcome).not.toBe("success")
    })

    it("404s a board id belonging to a different tenant, with the SAME status and message as the nonexistent case", async () => {
      // The route cannot see WHY updatePipelineBoard rejected — a
      // nonexistent id and a foreign tenant's id both surface as the exact
      // same PipelineBoardNotFoundError, so the route's response for each
      // is identical BY CONSTRUCTION. Asserting both, not just one, means a
      // future change that special-cases either side (e.g. answering 403
      // for "foreign tenant") breaks this test rather than shipping a leak.
      updatePipelineBoardMock.mockRejectedValueOnce(new PipelineBoardNotFoundError(BOARD_ID))
      const nonexistentRes = await PATCH(patchReq({ name: "Renamed board" }) as never, boardParams)
      const nonexistentBody = await nonexistentRes.json()

      updatePipelineBoardMock.mockRejectedValueOnce(new PipelineBoardNotFoundError(BOARD_ID))
      const foreignTenantRes = await PATCH(patchReq({ name: "Renamed board" }) as never, boardParams)
      const foreignTenantBody = await foreignTenantRes.json()

      expect(foreignTenantRes.status).toBe(404)
      expect(foreignTenantRes.status).toBe(nonexistentRes.status)
      expect(foreignTenantBody.error).toBe(nonexistentBody.error)
    })
  })

  it("the audit target resolves the board's id from the URL and its label from the response", async () => {
    await PATCH(patchReq({ name: "Renamed board" }) as never, boardParams)
    const call = recordAuditMock.mock.calls.find((c) => c[0].action === "pipeline.board_updated")
    expect(call?.[0].target).toEqual({ type: "pipeline_board", id: BOARD_ID, label: "Renamed board" })
  })

  it("still resolves an id-only target when the write is refused (no label to read off the response)", async () => {
    canAccessMock.mockResolvedValue(false)
    await PATCH(patchReq({ name: "Renamed board" }) as never, boardParams)
    const call = recordAuditMock.mock.calls.find((c) => c[0].action === "pipeline.board_updated")
    expect(call?.[0].target).toEqual({ type: "pipeline_board", id: BOARD_ID })
  })

  // -------------------------------------------------------------------------
  // WHAT CHANGED (whole-branch review, Important 5). Spec §2.3 collapsed the
  // old design's per-stage audit slugs into single rows on the argument that
  // "the metadata carries the before/after"; no metadata callback was ever
  // written, so an ARCHIVE recorded a bare uuid — no label, no status,
  // nothing distinguishing it from a rename.
  // -------------------------------------------------------------------------

  describe("the audit row says what changed", () => {
    it("names the board on an ARCHIVE, which carries no name of its own", async () => {
      const res = await PATCH(patchReq({ status: "archived" }) as never, boardParams)
      expect(res.status).toBe(200)

      const call = recordAuditMock.mock.calls.find((c) => c[0].action === "pipeline.board_updated")
      // The label is what makes the row findable by a human. It cannot come
      // from the request — an archive sends only `{status}` — so it comes
      // from the board as it was read before the write.
      expect(call?.[0].target).toEqual({ type: "pipeline_board", id: BOARD_ID, label: "Camps & Clinics" })
      expect(call?.[0].metadata).toMatchObject({
        status: "archived",
        previous_status: "active",
        previous_name: "Camps & Clinics",
        fields: ["status"],
      })
    })

    it("records the name a rename replaced, not only the new one", async () => {
      await PATCH(patchReq({ name: "One-to-one coaching" }) as never, boardParams)
      const call = recordAuditMock.mock.calls.find((c) => c[0].action === "pipeline.board_updated")
      expect(call?.[0].target).toEqual({ type: "pipeline_board", id: BOARD_ID, label: "One-to-one coaching" })
      expect(call?.[0].metadata).toMatchObject({ previous_name: "Camps & Clinics", fields: ["name"] })
      // A rename sends no status, so none is claimed.
      expect(call?.[0].metadata.status).toBeUndefined()
    })

    it("reads the board with the id from the URL and the RESOLVED tenant, never a body-supplied one", async () => {
      await PATCH(patchReq({ name: "One-to-one coaching" }) as never, boardParams)
      expect(readBoardRowMock.mock.calls[0]).toEqual([BOARD_ID, BUSINESS_ID])
    })

    it("does not leak a board it could not read for this tenant — no previous name at all", async () => {
      // A board that exists for somebody ELSE: `readBoardRowMock` compares
      // the arguments it was actually given against what exists, so the read
      // misses and the route must not invent a label.
      knownBoard = { id: BOARD_ID, businessId: "99999999-9999-9999-9999-999999999999", key: "k", name: "Someone Else's Board", status: "active" }
      updatePipelineBoardMock.mockRejectedValue(new PipelineBoardNotFoundError(BOARD_ID))

      const res = await PATCH(patchReq({ status: "archived" }) as never, boardParams)
      expect(res.status).toBe(404)

      const call = recordAuditMock.mock.calls.find((c) => c[0].action === "pipeline.board_updated")
      expect(call?.[0].metadata.previous_name).toBeUndefined()
      expect(JSON.stringify(call?.[0])).not.toContain("Someone Else's Board")
    })

    it("does not send the internal x-audit-* headers to the caller", async () => {
      const res = await PATCH(patchReq({ name: "One-to-one coaching" }) as never, boardParams)
      // `stripAuditHeaders` runs after the callbacks. If this ever fails, the
      // previous board name is being handed to the browser.
      expect([...res.headers.keys()].filter((k) => k.startsWith("x-audit-"))).toEqual([])
    })
  })
})
