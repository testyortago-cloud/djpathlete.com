// @vitest-environment node
// __tests__/api/admin/week-release-controls.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const getAssignmentById = vi.fn()
const updateAssignment = vi.fn()
const getWeekAccess = vi.fn()
const updateWeekAccess = vi.fn()
const createWeekAccess = vi.fn()
const recordAudit = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: vi.fn().mockResolvedValue({ user: { id: "coach-1", role: "admin" } }) }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: vi.fn().mockResolvedValue(true) }))
vi.mock("@/lib/audit/with-audit", () => ({ withAudit: (_o: unknown, h: unknown) => h }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...a) }))
vi.mock("@/lib/db/assignments", () => ({
  getAssignmentById: (...a: unknown[]) => getAssignmentById(...a),
  updateAssignment: (...a: unknown[]) => updateAssignment(...a),
  deleteAssignment: vi.fn(),
  getActiveAssignmentsForProgram: vi.fn(),
}))
vi.mock("@/lib/db/week-access", () => ({
  getWeekAccess: (...a: unknown[]) => getWeekAccess(...a),
  updateWeekAccess: (...a: unknown[]) => updateWeekAccess(...a),
  createWeekAccess: (...a: unknown[]) => createWeekAccess(...a),
  getWeekAccessByAssignment: vi.fn(),
}))

import { PATCH as patchAssignment } from "@/app/api/admin/assignments/[id]/route"
import { POST as weekAccessPOST } from "@/app/api/admin/programs/[id]/week-access/route"

const NOW = new Date("2026-10-05T10:00:00Z")
const patch = (body: unknown) =>
  patchAssignment(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "a1" }),
  })
const post = (body: unknown) =>
  weekAccessPOST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "prog-1" }),
  })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  getAssignmentById.mockReset()
  updateAssignment.mockReset().mockResolvedValue({ id: "a1" })
  getWeekAccess.mockReset()
  updateWeekAccess.mockReset().mockResolvedValue({ id: "wa-1" })
  createWeekAccess.mockReset().mockResolvedValue({ id: "wa-new" })
  recordAudit.mockReset()
})
afterEach(() => vi.useRealTimers())

describe("PATCH release_schedule", () => {
  it("starts the schedule from the client's current week, so nothing they already see disappears", async () => {
    getAssignmentById.mockResolvedValue({ id: "a1", status: "active", payment_status: "paid", current_week: 5 })
    expect((await patch({ release_schedule: true })).status).toBe(200)
    expect(updateAssignment).toHaveBeenCalledWith("a1", {
      release_base_week: 5,
      release_anchor_at: NOW.toISOString(),
    })
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "assignment.release_schedule_changed" }))
  })

  it("leaves the clock stopped while payment is pending", async () => {
    getAssignmentById.mockResolvedValue({ id: "a1", status: "active", payment_status: "pending", current_week: 1 })
    await patch({ release_schedule: true })
    expect(updateAssignment).toHaveBeenCalledWith("a1", { release_base_week: 1, release_anchor_at: null })
  })

  it("off makes every week visible again", async () => {
    getAssignmentById.mockResolvedValue({ id: "a1", status: "active", payment_status: "paid", current_week: 3 })
    await patch({ release_schedule: false })
    expect(updateAssignment).toHaveBeenCalledWith("a1", { release_base_week: null, release_anchor_at: null })
  })

  it("rejects a non-boolean", async () => {
    getAssignmentById.mockResolvedValue({ id: "a1", status: "active", payment_status: "paid", current_week: 3 })
    expect((await patch({ release_schedule: "yes" })).status).toBe(400)
    expect(updateAssignment).not.toHaveBeenCalled()
  })
})

describe("POST set_visibility", () => {
  const body = (visibility: string) => ({ assignmentId: "a1", weekNumber: 3, action: "set_visibility", visibility })

  it("404s an assignment that belongs to another program", async () => {
    getAssignmentById.mockResolvedValue({ id: "a1", program_id: "other" })
    expect((await post(body("hidden"))).status).toBe(404)
    expect(updateWeekAccess).not.toHaveBeenCalled()
  })

  it("updates the existing week row", async () => {
    getAssignmentById.mockResolvedValue({ id: "a1", program_id: "prog-1" })
    getWeekAccess.mockResolvedValue({ id: "wa-1" })
    expect((await post(body("hidden"))).status).toBe(200)
    expect(updateWeekAccess).toHaveBeenCalledWith("wa-1", { visibility: "hidden" })
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "assignment.week_visibility_changed" }))
  })

  it("creates an included row when the week has none", async () => {
    getAssignmentById.mockResolvedValue({ id: "a1", program_id: "prog-1" })
    getWeekAccess.mockResolvedValue(null)
    await post(body("shown"))
    expect(createWeekAccess).toHaveBeenCalledWith(
      expect.objectContaining({ assignment_id: "a1", week_number: 3, access_type: "included", visibility: "shown" }),
    )
  })

  it("rejects an unknown visibility", async () => {
    expect((await post(body("maybe"))).status).toBe(400)
  })
})
