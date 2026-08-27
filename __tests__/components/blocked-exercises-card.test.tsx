import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { BlockedExercisesCard } from "@/components/admin/BlockedExercisesCard"
import type { ExerciseBlockRow } from "@/lib/db/exercise-blocks"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const row: ExerciseBlockRow = {
  id: "b1",
  coach_id: "coach-1",
  client_id: null,
  exercise_id: "ex-1",
  reason: "Shows up in every single day",
  created_by: "coach-1",
  created_at: "2026-08-28T00:00:00Z",
  exercises: { id: "ex-1", name: "Suitcase carry-Core", movement_pattern: "carry" },
}

describe("BlockedExercisesCard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
  })

  it("renders the exercise name, movement pattern and reason", () => {
    render(<BlockedExercisesCard blocks={[row]} scopeLabel="Blocked exercises" emptyHint="none yet" />)
    expect(screen.getByText("Suitcase carry-Core")).toBeInTheDocument()
    expect(screen.getByText("carry")).toBeInTheDocument()
    expect(screen.getByText(/every single day/)).toBeInTheDocument()
  })

  it("shows the empty hint when there are no blocks", () => {
    render(<BlockedExercisesCard blocks={[]} scopeLabel="Blocked exercises" emptyHint="none yet" />)
    expect(screen.getByText("none yet")).toBeInTheDocument()
  })

  it("survives a block whose exercise row was deleted", () => {
    // exercise_id cascades, so this should not occur — but a null join rendering
    // as a crash would take the whole settings page down with it.
    const orphan = { ...row, exercises: null }
    render(<BlockedExercisesCard blocks={[orphan]} scopeLabel="Blocked exercises" emptyHint="none yet" />)
    expect(screen.getByText("Removed exercise")).toBeInTheDocument()
  })

  it("unblocks through the DELETE route and drops the row", async () => {
    render(<BlockedExercisesCard blocks={[row]} scopeLabel="Blocked exercises" emptyHint="none yet" />)
    fireEvent.click(screen.getByRole("button", { name: /unblock/i }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe("/api/admin/exercises/blocks/b1")
    expect((init as RequestInit).method).toBe("DELETE")
    await waitFor(() => expect(screen.queryByText("Suitcase carry-Core")).not.toBeInTheDocument())
  })

  it("keeps the row when the unblock fails", async () => {
    // Control for the test above: an optimistic drop that ignores the response
    // would tell the coach the block is gone while generation still skips it.
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "no" }), { status: 500 }))
    render(<BlockedExercisesCard blocks={[row]} scopeLabel="Blocked exercises" emptyHint="none yet" />)
    fireEvent.click(screen.getByRole("button", { name: /unblock/i }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.getByText("Suitcase carry-Core")).toBeInTheDocument()
  })
})
