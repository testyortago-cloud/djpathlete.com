import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/auth", () => ({ auth: authMock }))

const canAccessMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: canAccessMock }))

const recordAuditMock = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock("@/lib/audit/record", () => ({ recordAudit: recordAuditMock }))

const createBlockMock = vi.hoisted(() => vi.fn())
const deleteBlockMock = vi.hoisted(() => vi.fn())
const countUsableMock = vi.hoisted(() => vi.fn())
const listStudioMock = vi.hoisted(() => vi.fn(async () => []))
const listClientMock = vi.hoisted(() => vi.fn(async () => []))
vi.mock("@/lib/db/exercise-blocks", () => ({
  createExerciseBlock: createBlockMock,
  deleteExerciseBlock: deleteBlockMock,
  countUsableInPattern: countUsableMock,
  listStudioBlocks: listStudioMock,
  listClientBlocks: listClientMock,
}))

const getExerciseMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/db/exercises", () => ({ getExerciseById: getExerciseMock }))

import { POST, GET } from "@/app/api/admin/exercises/blocks/route"
import { DELETE } from "@/app/api/admin/exercises/blocks/[id]/route"

const ADMIN = { user: { id: "coach-1", role: "admin", email: "c@x.com" } }
const EX_ID = "11111111-1111-4111-8111-111111111111"
const CLIENT_ID = "22222222-2222-4222-8222-222222222222"

const noParams = { params: Promise.resolve({} as Record<string, string>) }

function post(body: unknown) {
  return new Request("http://localhost/api/admin/exercises/blocks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/admin/exercises/blocks", () => {
  beforeEach(() => {
    // resetAllMocks, not clearAllMocks: a leaked *Once implementation crosses
    // test boundaries and misattributes the failure to the wrong case.
    vi.resetAllMocks()
    authMock.mockResolvedValue(ADMIN)
    canAccessMock.mockResolvedValue(true)
    recordAuditMock.mockResolvedValue(undefined)
    countUsableMock.mockResolvedValue(3)
    getExerciseMock.mockResolvedValue({ id: EX_ID, name: "Suitcase carry-Core", movement_pattern: "carry" })
    createBlockMock.mockResolvedValue({ id: "b1", client_id: null, exercise_id: EX_ID })
  })

  it("rejects an unauthenticated caller", async () => {
    authMock.mockResolvedValue(null)
    const res = await POST(post({ exercise_id: EX_ID }), noParams)
    expect(res.status).toBe(401)
    expect(createBlockMock).not.toHaveBeenCalled()
  })

  it("rejects a caller without admin access", async () => {
    canAccessMock.mockResolvedValue(false)
    const res = await POST(post({ exercise_id: EX_ID }), noParams)
    expect(res.status).toBe(403)
    expect(createBlockMock).not.toHaveBeenCalled()
  })

  it("creates a studio-wide block when no client_id is given", async () => {
    const res = await POST(post({ exercise_id: EX_ID }), noParams)
    expect(res.status).toBe(200)
    expect(createBlockMock).toHaveBeenCalledWith(
      expect.objectContaining({ coachId: "coach-1", clientId: null, exerciseId: EX_ID }),
    )
  })

  it("scopes the block to a client when client_id is given", async () => {
    createBlockMock.mockResolvedValue({ id: "b2", client_id: CLIENT_ID, exercise_id: EX_ID })
    await POST(post({ exercise_id: EX_ID, client_id: CLIENT_ID }), noParams)
    expect(createBlockMock).toHaveBeenCalledWith(expect.objectContaining({ clientId: CLIENT_ID }))
  })

  it("reports remainingInPattern so the caller can warn about starvation", async () => {
    countUsableMock.mockResolvedValue(0)
    const res = await POST(post({ exercise_id: EX_ID }), noParams)
    const body = await res.json()
    expect(body.remainingInPattern).toBe(0)
    expect(body.movementPattern).toBe("carry")
  })

  it("reports a non-zero remainder when the pattern still has exercises", async () => {
    // Control for the test above: proves remainingInPattern actually tracks the
    // count rather than always reporting the starved case.
    countUsableMock.mockResolvedValue(7)
    const res = await POST(post({ exercise_id: EX_ID }), noParams)
    expect((await res.json()).remainingInPattern).toBe(7)
  })

  it("returns a null remainder for an exercise with no movement pattern", async () => {
    getExerciseMock.mockResolvedValue({ id: EX_ID, name: "Stretch", movement_pattern: null })
    const res = await POST(post({ exercise_id: EX_ID }), noParams)
    expect((await res.json()).remainingInPattern).toBeNull()
    expect(countUsableMock).not.toHaveBeenCalled()
  })

  it("is idempotent — a second block returns 200, not a conflict", async () => {
    const first = await POST(post({ exercise_id: EX_ID }), noParams)
    const second = await POST(post({ exercise_id: EX_ID }), noParams)
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
  })

  it("rejects a body with no exercise_id", async () => {
    const res = await POST(post({}), noParams)
    expect(res.status).toBe(400)
    expect(createBlockMock).not.toHaveBeenCalled()
  })

  it("rejects a non-uuid exercise_id", async () => {
    const res = await POST(post({ exercise_id: "not-a-uuid" }), noParams)
    expect(res.status).toBe(400)
  })
})

describe("GET /api/admin/exercises/blocks", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    authMock.mockResolvedValue(ADMIN)
    canAccessMock.mockResolvedValue(true)
    listStudioMock.mockResolvedValue([])
    listClientMock.mockResolvedValue([])
  })

  it("lists studio-wide blocks when no client_id is given", async () => {
    await GET(new Request("http://localhost/api/admin/exercises/blocks"))
    expect(listStudioMock).toHaveBeenCalledWith("coach-1")
    expect(listClientMock).not.toHaveBeenCalled()
  })

  it("lists that client's blocks when client_id is given", async () => {
    await GET(new Request(`http://localhost/api/admin/exercises/blocks?client_id=${CLIENT_ID}`))
    expect(listClientMock).toHaveBeenCalledWith("coach-1", CLIENT_ID)
    expect(listStudioMock).not.toHaveBeenCalled()
  })
})

describe("DELETE /api/admin/exercises/blocks/[id]", () => {
  const ctx = { params: Promise.resolve({ id: "b1" }) }

  beforeEach(() => {
    vi.resetAllMocks()
    authMock.mockResolvedValue(ADMIN)
    canAccessMock.mockResolvedValue(true)
    recordAuditMock.mockResolvedValue(undefined)
  })

  it("removes the block scoped to the calling coach", async () => {
    deleteBlockMock.mockResolvedValue(true)
    const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), ctx)
    expect(res.status).toBe(200)
    // The coach id is the whole authorization story here — without it any coach
    // could delete any block by guessing an id.
    expect(deleteBlockMock).toHaveBeenCalledWith("coach-1", "b1")
  })

  it("404s when the id matched no block for this coach", async () => {
    deleteBlockMock.mockResolvedValue(false)
    const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), {
      params: Promise.resolve({ id: "b1" }),
    })
    expect(res.status).toBe(404)
  })

  it("rejects a caller without admin access", async () => {
    canAccessMock.mockResolvedValue(false)
    const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), {
      params: Promise.resolve({ id: "b1" }),
    })
    expect(res.status).toBe(403)
    expect(deleteBlockMock).not.toHaveBeenCalled()
  })
})
