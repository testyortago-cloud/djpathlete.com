// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest"
import { useState } from "react"
import { render, screen, waitFor, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

/**
 * The dialog closes the moment Generate is clicked — progress moves to the jobs
 * dock. Its "things to check" panel only renders INSIDE the dialog, so before
 * 2026-09-30 nothing ever brought it back: a day saved with 1 of its 12
 * exercises, or with an equipment violation, finished with a green toast and the
 * explanation sat unread in the job doc.
 */

type JobState = { status: string | null; result: unknown; error: string | null }
const job = vi.hoisted(() => ({ current: { status: null, result: null, error: null } as JobState }))

vi.mock("@/hooks/use-ai-job", () => ({
  useAiJob: () => ({ ...job.current, reset: () => {} }),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))
// Children that fetch on mount — not what this suite is about.
vi.mock("@/components/admin/TemplateSelector", () => ({ TemplateSelector: () => null }))
vi.mock("@/components/admin/EquipmentOverrideField", () => ({ EquipmentOverrideField: () => null }))
vi.mock("@/components/admin/NotifyWhenDoneToggle", () => ({ NotifyWhenDoneToggle: () => null }))

import { GenerationDialog } from "@/components/admin/GenerationDialog"

const openCalls: boolean[] = []

function Harness() {
  const [open, setOpen] = useState(true)
  return (
    <GenerationDialog
      mode="day"
      open={open}
      onOpenChange={(o) => {
        openCalls.push(o)
        setOpen(o)
      }}
      programId="prog-1"
      weekNumber={2}
      dayOfWeek={1}
      onGenerated={() => {}}
    />
  )
}

async function submitAndLetDialogClose(rerender: () => void) {
  await userEvent.click(screen.getByRole("button", { name: /^generate$/i }))
  await waitFor(() => expect(openCalls).toContain(false))
  // The job is now running in the function; the dialog is closed.
  job.current = { status: "processing", result: null, error: null }
  rerender()
  expect(screen.queryByText(/AI Generate Monday/)).toBeNull()
}

describe("GenerationDialog comes back when a finished run needs attention", () => {
  beforeEach(() => {
    openCalls.length = 0
    job.current = { status: null, result: null, error: null }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ jobId: "job-1" }), { status: 202 })),
    )
  })

  it("reopens on a completed run WITH warnings, showing them", async () => {
    const { rerender } = render(<Harness />)
    const again = () => rerender(<Harness />)
    await submitAndLetDialogClose(again)

    job.current = {
      status: "completed",
      result: {
        exercises_added: 1,
        warnings: ["Monday has 1 of the 12 exercises it was planned with — 11 were left empty"],
      },
      error: null,
    }
    act(() => again())

    await waitFor(() => expect(openCalls.at(-1)).toBe(true))
    expect(await screen.findByText(/Monday has 1 of the 12 exercises/)).toBeTruthy()
  })

  it("stays closed on a clean completed run (presence control)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { rerender } = render(<Harness />)
      const again = () => rerender(<Harness />)
      await submitAndLetDialogClose(again)

      job.current = { status: "completed", result: { exercises_added: 12, warnings: [] }, error: null }
      act(() => again())
      await act(async () => {
        vi.advanceTimersByTime(2500)
      })

      expect(openCalls.filter((o) => o === true)).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it("reopens on a failed run, so Try Again is reachable", async () => {
    const { rerender } = render(<Harness />)
    const again = () => rerender(<Harness />)
    await submitAndLetDialogClose(again)

    job.current = { status: "failed", result: null, error: "Exercise selection failed after 3 attempts" }
    act(() => again())

    await waitFor(() => expect(openCalls.at(-1)).toBe(true))
    expect(await screen.findByRole("button", { name: /try again/i })).toBeTruthy()
  })
})
