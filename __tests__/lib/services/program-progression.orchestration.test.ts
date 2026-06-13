import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("@/lib/db/program-exercises")
vi.mock("@/lib/db/workout-sessions")
vi.mock("@/lib/db/assignments")
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => ({}) }))

import * as pe from "@/lib/db/program-exercises"
import * as ws from "@/lib/db/workout-sessions"
import * as asg from "@/lib/db/assignments"
import { advanceProgramForCheckin, revertProgramForCheckin } from "@/lib/services/program-progression"

const assignment = { id: "a1", user_id: "u1", program_id: "p1", current_week: 1 }

beforeEach(() => vi.resetAllMocks())

describe("advanceProgramForCheckin", () => {
  it("completes the first incomplete day and sets the week (not complete)", async () => {
    vi.mocked(pe.getProgramDaySlots).mockResolvedValue([
      { week_number: 1, day_of_week: 1 },
      { week_number: 1, day_of_week: 3 },
      { week_number: 2, day_of_week: 1 },
    ])
    vi.mocked(ws.listCompletedDayKeys).mockResolvedValue([])
    vi.mocked(ws.ensureSession).mockResolvedValue({ id: "ws1" } as never)
    vi.mocked(ws.completeForCheckin).mockResolvedValue()
    vi.mocked(asg.updateAssignment).mockResolvedValue({} as never)

    const r = await advanceProgramForCheckin({ assignment, sessionDate: "2026-06-13" })

    expect(r).toEqual({ workoutSessionId: "ws1", programCompleted: false })
    expect(ws.ensureSession).toHaveBeenCalledWith(expect.objectContaining({ week_number: 1, day_of_week: 1 }))
    expect(ws.completeForCheckin).toHaveBeenCalledWith("ws1", expect.any(String))
    expect(asg.updateAssignment).toHaveBeenCalledWith("a1", { current_week: 1 })
  })

  it("marks the program completed when the last day is checked in", async () => {
    vi.mocked(pe.getProgramDaySlots).mockResolvedValue([{ week_number: 1, day_of_week: 1 }])
    vi.mocked(ws.listCompletedDayKeys).mockResolvedValue([])
    vi.mocked(ws.ensureSession).mockResolvedValue({ id: "ws1" } as never)
    vi.mocked(ws.completeForCheckin).mockResolvedValue()
    vi.mocked(asg.updateAssignment).mockResolvedValue({} as never)

    const r = await advanceProgramForCheckin({ assignment, sessionDate: "2026-06-13" })

    expect(r).toEqual({ workoutSessionId: "ws1", programCompleted: true })
    expect(asg.updateAssignment).toHaveBeenCalledWith("a1", { status: "completed", current_week: 1 })
  })

  it("no-ops when the program is already complete", async () => {
    vi.mocked(pe.getProgramDaySlots).mockResolvedValue([{ week_number: 1, day_of_week: 1 }])
    vi.mocked(ws.listCompletedDayKeys).mockResolvedValue(["1-1"])

    const r = await advanceProgramForCheckin({ assignment, sessionDate: "2026-06-13" })

    expect(r).toEqual({ workoutSessionId: null, programCompleted: false })
    expect(ws.ensureSession).not.toHaveBeenCalled()
  })

  it("no-ops for an empty program (no slots)", async () => {
    vi.mocked(pe.getProgramDaySlots).mockResolvedValue([])
    const r = await advanceProgramForCheckin({ assignment, sessionDate: "2026-06-13" })
    expect(r).toEqual({ workoutSessionId: null, programCompleted: false })
    expect(ws.listCompletedDayKeys).not.toHaveBeenCalled()
  })
})

describe("revertProgramForCheckin", () => {
  it("reopens the day and reactivates the assignment at the recomputed week", async () => {
    vi.mocked(ws.reopenForVoid).mockResolvedValue()
    vi.mocked(pe.getProgramDaySlots).mockResolvedValue([
      { week_number: 1, day_of_week: 1 },
      { week_number: 1, day_of_week: 3 },
    ])
    vi.mocked(ws.listCompletedDayKeys).mockResolvedValue(["1-3"]) // 1-1 just reopened
    vi.mocked(asg.updateAssignment).mockResolvedValue({} as never)

    await revertProgramForCheckin({ workoutSessionId: "ws1", assignment })

    expect(ws.reopenForVoid).toHaveBeenCalledWith("ws1")
    expect(asg.updateAssignment).toHaveBeenCalledWith("a1", { status: "active", current_week: 1 })
  })
})
