import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { BlockExerciseDialog } from "@/components/admin/BlockExerciseDialog"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  exerciseId: "ex-1",
  exerciseName: "Suitcase carry-Core",
  movementPattern: "carry",
  onBlocked: vi.fn(),
}

function respond(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
}

function postBody(fetchMock: ReturnType<typeof vi.fn>) {
  return JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
}

describe("BlockExerciseDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = respond({ block: { id: "b1" }, remainingInPattern: 3, movementPattern: "carry" })
  })

  it("names the exercise and says the block does not touch existing programs", () => {
    render(<BlockExerciseDialog {...baseProps} />)
    expect(screen.getByText(/Suitcase carry-Core/)).toBeInTheDocument()
    expect(screen.getByText(/already/i)).toBeInTheDocument()
  })

  it("offers a client-scoped option only when a client is given", () => {
    const { rerender } = render(<BlockExerciseDialog {...baseProps} />)
    expect(screen.queryByLabelText(/only/i)).not.toBeInTheDocument()
    // Presence control for the absence assertion above: the option must be
    // reachable at all, or "not on screen" proves nothing.
    rerender(<BlockExerciseDialog {...baseProps} clientId="c-9" clientName="Marcus" />)
    expect(screen.getByLabelText(/Marcus only/i)).toBeInTheDocument()
  })

  it("posts a studio-wide block by default", async () => {
    const f = respond({ block: { id: "b1" }, remainingInPattern: 3, movementPattern: "carry" })
    global.fetch = f
    render(<BlockExerciseDialog {...baseProps} />)
    fireEvent.click(screen.getByRole("button", { name: "Block" }))
    await waitFor(() => expect(f).toHaveBeenCalled())
    const body = postBody(f)
    expect(body.exercise_id).toBe("ex-1")
    expect(body.client_id ?? null).toBeNull()
  })

  it("posts a client-scoped block when that option is chosen", async () => {
    const f = respond({ block: { id: "b2" }, remainingInPattern: 3, movementPattern: "carry" })
    global.fetch = f
    render(<BlockExerciseDialog {...baseProps} clientId="c-9" clientName="Marcus" />)
    fireEvent.click(screen.getByLabelText(/Marcus only/i))
    fireEvent.click(screen.getByRole("button", { name: "Block" }))
    await waitFor(() => expect(f).toHaveBeenCalled())
    expect(postBody(f).client_id).toBe("c-9")
  })

  it("sends the reason when one is typed", async () => {
    const f = respond({ block: { id: "b1" }, remainingInPattern: 3, movementPattern: "carry" })
    global.fetch = f
    render(<BlockExerciseDialog {...baseProps} />)
    fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: "Shows up in every day" } })
    fireEvent.click(screen.getByRole("button", { name: "Block" }))
    await waitFor(() => expect(f).toHaveBeenCalled())
    expect(postBody(f).reason).toBe("Shows up in every day")
  })

  it("warns and stays open when the block leaves the movement pattern empty", async () => {
    global.fetch = respond({ block: { id: "b1" }, remainingInPattern: 0, movementPattern: "carry" })
    const onOpenChange = vi.fn()
    render(<BlockExerciseDialog {...baseProps} onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getByRole("button", { name: "Block" }))
    await waitFor(() => expect(screen.getByText(/last usable/i)).toBeInTheDocument())
    expect(screen.getByText(/fall back to a related movement/i)).toBeInTheDocument()
    // Closing straight past this warning is the failure mode it exists to stop.
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it("closes without warning when the pattern still has exercises", async () => {
    // Control for the test above: proves the warning is driven by the count and
    // is not simply always shown.
    global.fetch = respond({ block: { id: "b1" }, remainingInPattern: 4, movementPattern: "carry" })
    const onOpenChange = vi.fn()
    render(<BlockExerciseDialog {...baseProps} onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getByRole("button", { name: "Block" }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(screen.queryByText(/last usable/i)).not.toBeInTheDocument()
  })

  it("reports a failed block instead of claiming success", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "nope" }), { status: 500 }))
    const onBlocked = vi.fn()
    render(<BlockExerciseDialog {...baseProps} onBlocked={onBlocked} />)
    fireEvent.click(screen.getByRole("button", { name: "Block" }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(onBlocked).not.toHaveBeenCalled()
  })
})
