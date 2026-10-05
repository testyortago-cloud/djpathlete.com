import { describe, it, expect, vi, beforeEach } from "vitest"

const getProgramById = vi.fn()
const createAssignment = vi.fn()
vi.mock("@/lib/db/programs", () => ({ getProgramById: (...a: unknown[]) => getProgramById(...a) }))
vi.mock("@/lib/db/program-week-pricing", () => ({ getPremiumWeeks: vi.fn().mockResolvedValue([]) }))
vi.mock("@/lib/db/assignments", () => ({
  getAssignmentByUserAndProgram: vi.fn().mockResolvedValue(null),
  createAssignment: (...a: unknown[]) => createAssignment(...a),
  getActiveAssignmentsForProgram: vi.fn(),
}))
vi.mock("@/lib/db/week-access", () => ({
  createWeekAccessBulk: vi.fn().mockResolvedValue([]),
  getWeekAccessByAssignment: vi.fn(),
  createWeekAccess: vi.fn(),
  updateWeekAccessByAssignmentAndWeek: vi.fn(),
}))
vi.mock("@/lib/db/users", () => ({ getUserById: vi.fn().mockResolvedValue({ email: "a@b.c", first_name: "Jo" }) }))
vi.mock("@/lib/email", () => ({ sendProgramReadyEmail: vi.fn() }))

import { assignProgram } from "@/lib/services/assign-program"

const base = { programId: "p1", userId: "u1", startDate: "2026-10-05" }

beforeEach(() => {
  getProgramById.mockReset().mockResolvedValue({ id: "p1", name: "P", payment_type: "free", duration_weeks: 12 })
  createAssignment.mockReset().mockResolvedValue({ id: "a1" })
})

describe("assignProgram and the library", () => {
  it("refuses a library program — clients only ever get a copy", async () => {
    getProgramById.mockResolvedValue({ id: "p1", name: "P", payment_type: "free", duration_weeks: 12, is_template: true })
    await expect(assignProgram(base)).rejects.toThrow(/library/i)
    expect(createAssignment).not.toHaveBeenCalled()
  })

  it("passes the release schedule through", async () => {
    await assignProgram({ ...base, releaseBaseWeek: 2, releaseAnchorAt: "2026-10-12T00:00:00.000Z" })
    expect(createAssignment.mock.calls[0][0]).toMatchObject({
      release_base_week: 2,
      release_anchor_at: "2026-10-12T00:00:00.000Z",
    })
  })

  it("every other caller's payload is unchanged: no release keys at all", async () => {
    await assignProgram(base)
    expect(Object.keys(createAssignment.mock.calls[0][0])).not.toContain("release_base_week")
    expect(Object.keys(createAssignment.mock.calls[0][0])).not.toContain("release_anchor_at")
  })
})
