// __tests__/lib/services/access-guard-weeks.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const getAssignmentById = vi.fn()
const getWeekAccess = vi.fn()
const getProgramById = vi.fn()
vi.mock("@/lib/db/assignments", () => ({ getAssignmentById: (...a: unknown[]) => getAssignmentById(...a) }))
vi.mock("@/lib/db/week-access", () => ({ getWeekAccess: (...a: unknown[]) => getWeekAccess(...a) }))
vi.mock("@/lib/db/programs", () => ({ getProgramById: (...a: unknown[]) => getProgramById(...a) }))

import { assertAssignmentPayable } from "@/lib/services/access-guard"

const NOW = new Date("2026-10-05T10:00:00Z")
const scheduled = {
  payment_status: "paid",
  program_id: "p1",
  release_base_week: 1,
  release_anchor_at: NOW.toISOString(),
}
const included = { access_type: "included", payment_status: "not_required", visibility: "auto" }

beforeEach(() => {
  getAssignmentById.mockReset()
  getWeekAccess.mockReset()
  getProgramById.mockReset().mockResolvedValue({ hidden_weeks: [] })
})

describe("assertAssignmentPayable with a week", () => {
  it("refuses a week the schedule has not reached, as not_released", async () => {
    getAssignmentById.mockResolvedValue(scheduled)
    getWeekAccess.mockResolvedValue(included)
    expect(await assertAssignmentPayable("a1", 2, NOW)).toEqual({ ok: false, reason: "not_released" })
  })

  it("allows a released week (presence control for the refusal above)", async () => {
    getAssignmentById.mockResolvedValue(scheduled)
    getWeekAccess.mockResolvedValue(included)
    expect(await assertAssignmentPayable("a1", 1, NOW)).toEqual({ ok: true })
  })

  it("refuses a week the coach hid, even with no schedule", async () => {
    getAssignmentById.mockResolvedValue({ payment_status: "paid", release_base_week: null, release_anchor_at: null })
    getWeekAccess.mockResolvedValue({ ...included, visibility: "hidden" })
    expect(await assertAssignmentPayable("a1", 1, NOW)).toEqual({ ok: false, reason: "not_released" })
  })

  it("refuses a visible paid week awaiting payment, as payment", async () => {
    getAssignmentById.mockResolvedValue({ payment_status: "paid", release_base_week: null, release_anchor_at: null })
    getWeekAccess.mockResolvedValue({ access_type: "paid", payment_status: "pending", visibility: "auto" })
    expect(await assertAssignmentPayable("a1", 1, NOW)).toEqual({ ok: false, reason: "payment" })
  })

  it("refuses a pending assignment as payment before looking at the week", async () => {
    getAssignmentById.mockResolvedValue({ ...scheduled, payment_status: "pending" })
    getWeekAccess.mockResolvedValue(included)
    expect(await assertAssignmentPayable("a1", 5, NOW)).toEqual({ ok: false, reason: "payment" })
  })

  it("without a week, checks only the assignment", async () => {
    getAssignmentById.mockResolvedValue(scheduled)
    expect(await assertAssignmentPayable("a1")).toEqual({ ok: true })
    expect(getWeekAccess).not.toHaveBeenCalled()
    expect(getProgramById).not.toHaveBeenCalled()
  })

  it("refuses a week hidden on the program, for a client with no setting of their own", async () => {
    getAssignmentById.mockResolvedValue({
      payment_status: "paid",
      program_id: "p1",
      release_base_week: null,
      release_anchor_at: null,
    })
    getWeekAccess.mockResolvedValue(null)
    getProgramById.mockResolvedValue({ hidden_weeks: [3] })
    expect(await assertAssignmentPayable("a1", 3, NOW)).toEqual({ ok: false, reason: "not_released" })
    expect(getProgramById).toHaveBeenCalledWith("p1")
  })

  it("allows the next week of that program (presence control)", async () => {
    getAssignmentById.mockResolvedValue({
      payment_status: "paid",
      program_id: "p1",
      release_base_week: null,
      release_anchor_at: null,
    })
    getWeekAccess.mockResolvedValue(null)
    getProgramById.mockResolvedValue({ hidden_weeks: [3] })
    expect(await assertAssignmentPayable("a1", 4, NOW)).toEqual({ ok: true })
  })

  it("allows a program-hidden week the coach opened for this client", async () => {
    getAssignmentById.mockResolvedValue({
      payment_status: "paid",
      program_id: "p1",
      release_base_week: null,
      release_anchor_at: null,
    })
    getWeekAccess.mockResolvedValue({ ...included, visibility: "shown" })
    getProgramById.mockResolvedValue({ hidden_weeks: [3] })
    expect(await assertAssignmentPayable("a1", 3, NOW)).toEqual({ ok: true })
  })
})
