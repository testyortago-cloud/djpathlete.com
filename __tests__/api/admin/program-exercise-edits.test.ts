// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const canAccess = vi.fn()
const tenant = vi.fn()
const logExerciseEdit = vi.fn()
const pe = vi.hoisted(() => ({
  addExerciseToProgram: vi.fn(),
  removeExerciseFromProgram: vi.fn(),
  updateProgramExercise: vi.fn(),
}))
const getLatestAssignmentProgram = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: (...a: unknown[]) => canAccess(...a) }))
vi.mock("@/lib/tenancy/resolve", () => ({ resolveAdminTenantForRequest: (...a: unknown[]) => tenant(...a) }))
vi.mock("@/lib/db/program-exercises", () => pe)
vi.mock("@/lib/db/program-exercise-edits", () => ({ logExerciseEdit: (...a: unknown[]) => logExerciseEdit(...a) }))
vi.mock("@/lib/db/assignments", () => ({
  getLatestAssignmentProgram: (...a: unknown[]) => getLatestAssignmentProgram(...a),
}))

import { POST as add } from "@/app/api/admin/programs/[id]/exercises/route"
import { DELETE as remove } from "@/app/api/admin/programs/[id]/exercises/[exerciseId]/route"
import { GET as previousProgram } from "@/app/api/admin/clients/[id]/previous-program/route"

const EX = "11111111-2222-4333-8444-555555555555"
const programCtx = { params: Promise.resolve({ id: "prog-1" }) }
const rowCtx = { params: Promise.resolve({ id: "prog-1", exerciseId: "pe-1" }) }

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "coach-1", role: "admin" } })
  canAccess.mockResolvedValue(true)
  tenant.mockResolvedValue({ businessId: "biz-1" })
  logExerciseEdit.mockResolvedValue(true)
})

describe("POST /api/admin/programs/[id]/exercises", () => {
  it("logs the exercise as put in, for this coach and business", async () => {
    pe.addExerciseToProgram.mockResolvedValue({ id: "pe-9", exercise_id: EX, week_number: 2, day_of_week: 3 })
    const res = await add(
      new Request("http://x/api", {
        method: "POST",
        body: JSON.stringify({ exercise_id: EX, day_of_week: 3, week_number: 2, order_index: 0 }),
      }),
      programCtx,
    )
    expect(res.status).toBe(201)
    expect(logExerciseEdit).toHaveBeenCalledWith({
      programId: "prog-1",
      exerciseId: EX,
      action: "added",
      aiPick: false,
      weekNumber: 2,
      dayOfWeek: 3,
      businessId: "biz-1",
      coachId: "coach-1",
    })
  })
})

describe("DELETE /api/admin/programs/[id]/exercises/[exerciseId]", () => {
  it("logs an AI pick as taken out when the row had a slot role", async () => {
    pe.removeExerciseFromProgram.mockResolvedValue({
      program_id: "prog-1",
      exercise_id: EX,
      slot_role: "primary_compound",
      week_number: 1,
      day_of_week: 1,
    })
    const res = await remove(new Request("http://x/api", { method: "DELETE" }), rowCtx)
    expect(res.status).toBe(200)
    expect(logExerciseEdit).toHaveBeenCalledWith(expect.objectContaining({ action: "removed", aiPick: true }))
  })

  it("marks a hand-added row as not an AI pick", async () => {
    pe.removeExerciseFromProgram.mockResolvedValue({
      program_id: "prog-1",
      exercise_id: EX,
      slot_role: null,
      week_number: 1,
      day_of_week: 1,
    })
    await remove(new Request("http://x/api", { method: "DELETE" }), rowCtx)
    expect(logExerciseEdit).toHaveBeenCalledWith(expect.objectContaining({ action: "removed", aiPick: false }))
  })

  it("still answers success when the log cannot be written: the edit itself was saved", async () => {
    pe.removeExerciseFromProgram.mockResolvedValue({
      program_id: "prog-1",
      exercise_id: EX,
      slot_role: "accessory",
      week_number: 1,
      day_of_week: 1,
    })
    logExerciseEdit.mockRejectedValue(new Error("db down"))
    const res = await remove(new Request("http://x/api", { method: "DELETE" }), rowCtx)
    expect(res.status).toBe(200)
  })

  it("logs nothing when the row was already gone", async () => {
    pe.removeExerciseFromProgram.mockResolvedValue(null)
    const res = await remove(new Request("http://x/api", { method: "DELETE" }), rowCtx)
    expect(res.status).toBe(200)
    expect(logExerciseEdit).not.toHaveBeenCalled()
  })
})

describe("GET /api/admin/clients/[id]/previous-program", () => {
  const ctx = { params: Promise.resolve({ id: "client-1" }) }

  it("names the program the generator will follow on from", async () => {
    getLatestAssignmentProgram.mockResolvedValue({
      name: "Shoulder Rebuild",
      start_date: "2026-08-01",
      status: "completed",
    })
    const res = await previousProgram(new Request("http://x/api"), ctx)
    expect(await res.json()).toEqual({
      program: { name: "Shoulder Rebuild", start_date: "2026-08-01", status: "completed" },
    })
    expect(getLatestAssignmentProgram).toHaveBeenCalledWith("client-1")
  })

  it("refuses a caller without admin access", async () => {
    canAccess.mockResolvedValue(false)
    const res = await previousProgram(new Request("http://x/api"), ctx)
    expect(res.status).toBe(403)
    expect(getLatestAssignmentProgram).not.toHaveBeenCalled()
  })
})
