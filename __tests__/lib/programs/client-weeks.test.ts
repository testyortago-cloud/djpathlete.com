import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  getDaySlotsByProgram: vi.fn(),
  listTrainedSlots: vi.fn(),
  getWeekAccessByAssignments: vi.fn(),
}))
vi.mock("@/lib/db/program-exercises", () => ({ getDaySlotsByProgram: mocks.getDaySlotsByProgram }))
vi.mock("@/lib/db/workout-sessions", () => ({ listTrainedSlots: mocks.listTrainedSlots }))
vi.mock("@/lib/db/week-access", () => ({ getWeekAccessByAssignments: mocks.getWeekAccessByAssignments }))

import { getClientWeeks } from "@/lib/programs/client-weeks"
import { slotKey } from "@/lib/program-weeks"

const now = new Date("2026-10-30T12:00:00Z")
// One 4-week program, only week 1 built (days 1 and 3), week 2 hidden on the program.
const program = { duration_weeks: 4, hidden_weeks: [2] }
const assignment = (id: string) => ({
  id,
  program_id: "p-1",
  current_week: 1,
  total_weeks: 4,
  release_base_week: null,
  release_anchor_at: null,
  programs: program,
})

describe("getClientWeeks", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getDaySlotsByProgram.mockResolvedValue(
      new Map([
        [
          "p-1",
          [
            { week_number: 1, day_of_week: 1 },
            { week_number: 1, day_of_week: 3 },
          ],
        ],
      ]),
    )
    // Both clients trained both days of week 1.
    mocks.listTrainedSlots.mockResolvedValue(
      new Set(["a-1", "a-2"].flatMap((a) => [slotKey(a, 1, 1), slotKey(a, 1, 3)])),
    )
  })

  it("applies each client's own week access, not another client's", async () => {
    // a-2 had week 2 shown to them; a-1 did not, so the program's hide applies to a-1 only.
    mocks.getWeekAccessByAssignments.mockResolvedValue([
      {
        assignment_id: "a-2",
        week_number: 2,
        access_type: "included",
        payment_status: "not_required",
        price_cents: null,
        visibility: "shown",
      },
    ])
    const weeks = await getClientWeeks([assignment("a-1"), assignment("a-2")], now)
    expect(weeks.get("a-1")).toEqual({ week: 3, totalWeeks: 4 })
    expect(weeks.get("a-2")).toEqual({ week: 2, totalWeeks: 4 })
    // One read per kind for the whole list, each program asked for once.
    expect(mocks.getDaySlotsByProgram).toHaveBeenCalledTimes(1)
    expect(mocks.getDaySlotsByProgram).toHaveBeenCalledWith(["p-1"])
    expect(mocks.listTrainedSlots).toHaveBeenCalledWith(["a-1", "a-2"])
  })

  it("reads nothing for an empty list", async () => {
    expect((await getClientWeeks([], now)).size).toBe(0)
    expect(mocks.getDaySlotsByProgram).not.toHaveBeenCalled()
  })
})
