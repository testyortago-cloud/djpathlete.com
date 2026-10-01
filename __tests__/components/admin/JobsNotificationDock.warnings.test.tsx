// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, act } from "@testing-library/react"

/**
 * The dock is where a generation lands once its dialog closes at submit — and
 * after a navigation it is the ONLY surface. Before 2026-09-30 it read
 * `status` and nothing else, and dismissed itself 30s later, so a run's
 * coach-facing warnings were never shown anywhere.
 */

const jobDoc = vi.hoisted(() => ({ current: {} as Record<string, unknown>, readFails: false }))
const dock = vi.hoisted(() => ({
  jobs: [] as Array<Record<string, unknown>>,
  markResolved: vi.fn(),
  removeJob: vi.fn(),
  clearResolved: vi.fn(),
}))

vi.mock("@/lib/firebase", () => ({ db: {} }))
vi.mock("firebase/firestore", () => {
  const snap = () => ({ exists: () => true, data: () => jobDoc.current })
  return {
    doc: () => ({}),
    onSnapshot: (_ref: unknown, next: (s: ReturnType<typeof snap>) => void) => {
      next(snap())
      return () => {}
    },
    getDoc: async () => {
      if (jobDoc.readFails) throw new Error("offline")
      return snap()
    },
  }
})
vi.mock("@/hooks/use-ai-jobs-dock", () => ({ useAiJobsDock: () => dock }))

import { JobsNotificationDock } from "@/components/admin/JobsNotificationDock"

const WARNING = "Monday has 1 of the 12 exercises it was planned with — 11 were left empty"

describe("JobsNotificationDock shows a finished run's warnings", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    dock.removeJob.mockReset()
    dock.jobs = [
      {
        jobId: "job-1",
        kind: "day",
        label: "Week 2 / Monday",
        programId: "prog-1",
        startedAt: new Date().toISOString(),
        resolvedState: "completed",
      },
    ]
  })
  afterEach(() => vi.useRealTimers())

  it("lists the warnings and does not auto-dismiss the card", async () => {
    jobDoc.current = { status: "completed", result: { exercises_added: 1, warnings: [WARNING] } }
    render(<JobsNotificationDock />)

    expect(await screen.findByText(WARNING)).toBeTruthy()
    expect(screen.getByText(/1 thing to check/)).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(dock.removeJob).not.toHaveBeenCalled()
  })

  it("still auto-dismisses a clean run (presence control)", async () => {
    jobDoc.current = { status: "completed", result: { exercises_added: 12, warnings: [] } }
    render(<JobsNotificationDock />)
    expect(await screen.findByText(/Ready/)).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(31_000)
    })
    expect(dock.removeJob).toHaveBeenCalledWith("job-1")
  })
})

describe("JobsNotificationDock never strands a finished card", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    dock.removeJob.mockReset()
    jobDoc.readFails = true
    dock.jobs = [
      {
        jobId: "job-3",
        kind: "day",
        label: "Week 2 / Monday",
        programId: "prog-1",
        startedAt: new Date().toISOString(),
        resolvedState: "completed",
      },
    ]
  })
  afterEach(() => {
    jobDoc.readFails = false
    vi.useRealTimers()
  })

  it("still auto-dismisses a restored card whose job doc cannot be read", async () => {
    // Review finding: the dismiss timer waits for the doc to load, and a failed
    // read left the card up forever — sessionStorage brought it back on reload.
    render(<JobsNotificationDock />)
    // Let the failed read settle (it lands a tick after render) before the clock moves.
    await act(async () => {})
    await act(async () => {
      vi.advanceTimersByTime(31_000)
    })
    expect(dock.removeJob).toHaveBeenCalledWith("job-3")
  })
})

describe("JobsNotificationDock shows how the instructions were read", () => {
  beforeEach(() => {
    dock.removeJob.mockReset()
    dock.jobs = [
      {
        jobId: "job-2",
        kind: "day",
        label: "Week 2 / Monday",
        programId: "prog-1",
        startedAt: new Date().toISOString(),
        resolvedState: "completed",
      },
    ]
  })

  it("offers the rewrite on a finished run's card", async () => {
    jobDoc.current = {
      status: "completed",
      result: {
        exercises_added: 12,
        warnings: [],
        instructions_used: {
          original: "12 exercises, mainly shoulder",
          enriched: "Exactly 12 exercises: 7 shoulder, 3 upper back, 2 chest.",
          model: "claude-opus-5-5",
          note: null,
        },
      },
    }
    render(<JobsNotificationDock />)
    expect(await screen.findByText("How the AI read your instructions")).toBeTruthy()
    expect(screen.getByText(/Exactly 12 exercises/)).toBeTruthy()
  })

  // M5: the panel renders nothing for this check, so its spacing wrapper must not
  // render either — an empty mt-2 div left a gap in the card.
  it("renders no empty wrapper for an unchecked result with no lines and no note", async () => {
    jobDoc.current = {
      status: "completed",
      result: {
        exercises_added: 12,
        warnings: [],
        instruction_check: { status: "unchecked", items: [], rebuilt: false, rebuild_reason: null, note: null },
      },
    }
    const { container } = render(<JobsNotificationDock />)
    expect(await screen.findByText(/Ready/)).toBeTruthy()
    expect(screen.queryByText("Your instructions, checked")).toBeNull()
    const empty = [...container.querySelectorAll("div.mt-2")].filter((el) => el.childElementCount === 0)
    expect(empty).toEqual([])
  })

  it("still shows an unchecked result that carries a note (presence control)", async () => {
    jobDoc.current = {
      status: "completed",
      result: {
        exercises_added: 12,
        warnings: [],
        instruction_check: {
          status: "unchecked",
          items: [],
          rebuilt: false,
          rebuild_reason: null,
          note: "Couldn't check your instructions this time.",
        },
      },
    }
    render(<JobsNotificationDock />)
    expect(await screen.findByText("Your instructions, checked")).toBeTruthy()
    expect(screen.getByText("Couldn't check your instructions this time.")).toBeTruthy()
  })

  it("shows the instructions checklist even when there is no instructions_used", async () => {
    jobDoc.current = {
      status: "completed",
      result: {
        exercises_added: 6,
        warnings: [],
        instruction_check: {
          status: "passed",
          items: [{ instruction: "Pool only", met: true, detail: "all from the pool", source: "code" }],
          rebuilt: false,
          rebuild_reason: null,
          note: null,
        },
      },
    }
    render(<JobsNotificationDock />)
    expect(await screen.findByText("Your instructions, checked")).toBeTruthy()
  })
})
