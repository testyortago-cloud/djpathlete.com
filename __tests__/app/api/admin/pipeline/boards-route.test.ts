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

vi.mock("@/lib/db/pipeline", () => ({
  createPipelineBoard: (...a: unknown[]) => createPipelineBoardMock(...a),
  updatePipelineBoard: (...a: unknown[]) => updatePipelineBoardMock(...a),
}))

import { POST } from "@/app/api/admin/pipeline/boards/route"
import { PATCH } from "@/app/api/admin/pipeline/boards/[id]/route"
import { NoAccessibleBusinessError } from "@/lib/tenancy/resolve"

const STAFF_SESSION = { user: { id: "staff-1", role: "staff", permissions: {} } }
const COACH_SESSION = { user: { id: "coach-1", role: "staff", permissions: { contacts: true } } }

const SINGLETON = "00000000-0000-0000-0000-000000000001"
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

  it("200s a rename", async () => {
    const res = await PATCH(patchReq({ name: "Renamed board" }) as never, boardParams)
    expect(res.status).toBe(200)
    expect(updatePipelineBoardMock).toHaveBeenCalledWith({
      pipelineId: BOARD_ID,
      businessId: BUSINESS_ID,
      name: "Renamed board",
      status: undefined,
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
})
