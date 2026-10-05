// __tests__/lib/services/access-guard-weeks.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const getAssignmentById = vi.fn()
const getWeekAccess = vi.fn()
vi.mock("@/lib/db/assignments", () => ({ getAssignmentById: (...a: unknown[]) => getAssignmentById(...a) }))
vi.mock("@/lib/db/week-access", () => ({ getWeekAccess: (...a: unknown[]) => getWeekAccess(...a) }))

import { assertAssignmentPayable } from "@/lib/services/access-guard"

const NOW = new Date("2026-10-05T10:00:00Z")
const scheduled = { payment_status: "paid", release_base_week: 1, release_anchor_at: NOW.toISOString() }
const included = { access_type: "included", payment_status: "not_required", visibility: "auto" }

beforeEach(() => {
  getAssignmentById.mockReset()
  getWeekAccess.mockReset()
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
  })
})
