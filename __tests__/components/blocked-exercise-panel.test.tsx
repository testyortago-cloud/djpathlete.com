import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { BlockedExercisePanel } from "@/components/admin/BlockedExercisePanel"
import type { Exercise } from "@/types/database"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
import { toast } from "sonner"

function ex(id: string, name: string, extra: Partial<Exercise> = {}): Exercise {
  return {
    id,
    name,
    category: ["strength"],
    muscle_group: "core",
    primary_muscles: ["core"],
    movement_pattern: "carry",
    video_url: null,
    ...extra,
  } as unknown as Exercise
}

const LIBRARY = [
  ex("ex-1", "Suitcase carry-Core"),
  ex("ex-2", "Weighted deadbug_Core"),
  ex("ex-3", "Bench Press"),
]

function blockRow(over: Record<string, unknown> = {}) {
  return {
    id: "b1",
    coach_id: "coach-1",
    client_id: null,
    exercise_id: "ex-1",
    reason: null,
    created_by: "coach-1",
    created_at: "2026-08-28T00:00:00Z",
    exercises: { id: "ex-1", name: "Suitcase carry-Core", movement_pattern: "carry" },
    ...over,
  }
}

/** Routes each URL/method to a canned response. */
function mockFetch(handlers: { studio?: unknown[]; client?: unknown[]; post?: unknown; postStatus?: number; delStatus?: number }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET"
    if (method === "POST") {
      return new Response(JSON.stringify(handlers.post ?? { block: { id: "new" }, remainingInPattern: 3, movementPattern: "carry" }), {
        status: handlers.postStatus ?? 200,
      })
    }
    if (method === "DELETE") return new Response(JSON.stringify({ ok: true }), { status: handlers.delStatus ?? 200 })
    const isClient = url.includes("client_id=")
    return new Response(JSON.stringify({ blocks: isClient ? (handlers.client ?? []) : (handlers.studio ?? []) }), { status: 200 })
  })
}

describe("BlockedExercisePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("loads and lists existing blocks", async () => {
    global.fetch = mockFetch({ studio: [blockRow()] }) as unknown as typeof fetch
    render(<BlockedExercisePanel allExercises={LIBRARY} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByText("Suitcase carry-Core").length).toBeGreaterThan(0))
    expect(screen.getByText("everyone")).toBeInTheDocument()
  })

  it("reads studio-wide blocks only when there is no client", async () => {
    const f = mockFetch({ studio: [] })
    global.fetch = f as unknown as typeof fetch
    render(<BlockedExercisePanel allExercises={LIBRARY} onClose={vi.fn()} />)
    await waitFor(() => expect(f).toHaveBeenCalled())
    expect(f.mock.calls.every(([u]) => !String(u).includes("client_id="))).toBe(true)
  })

  it("also reads that client's blocks when a client is given", async () => {
    const f = mockFetch({ studio: [], client: [blockRow({ id: "b2", client_id: "c-9" })] })
    global.fetch = f as unknown as typeof fetch
    render(<BlockedExercisePanel allExercises={LIBRARY} clientId="c-9" clientName="Victor Okonjo" onClose={vi.fn()} />)
    await waitFor(() => expect(f.mock.calls.some(([u]) => String(u).includes("client_id=c-9"))).toBe(true))
    // "Victor only" is BOTH the scope button and the row's badge, so a bare
    // getByText finds two and throws. The badge is the span — pin that, or this
    // test passes on the button alone and proves nothing about the loaded row.
    await waitFor(() =>
      expect(screen.getAllByText("Victor only").some((el) => el.tagName === "SPAN")).toBe(true),
    )
  })

  it("blocks studio-wide by default when a library row is clicked", async () => {
    const f = mockFetch({ studio: [] })
    global.fetch = f as unknown as typeof fetch
    render(<BlockedExercisePanel allExercises={LIBRARY} clientId="c-9" clientName="Victor Okonjo" onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText("Bench Press")).toBeInTheDocument())
    fireEvent.click(screen.getByText("Bench Press"))
    await waitFor(() => expect(f.mock.calls.some(([, i]) => (i as RequestInit)?.method === "POST")).toBe(true))
    const post = f.mock.calls.find(([, i]) => (i as RequestInit)?.method === "POST")!
    const body = JSON.parse((post[1] as RequestInit).body as string)
    expect(body.exercise_id).toBe("ex-3")
    expect(body.client_id).toBeUndefined()
  })

  it("scopes the block to the client once that scope is picked", async () => {
    const f = mockFetch({ studio: [] })
    global.fetch = f as unknown as typeof fetch
    render(<BlockedExercisePanel allExercises={LIBRARY} clientId="c-9" clientName="Victor Okonjo" onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText("Bench Press")).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: "Victor only" }))
    fireEvent.click(screen.getByText("Bench Press"))
    await waitFor(() => expect(f.mock.calls.some(([, i]) => (i as RequestInit)?.method === "POST")).toBe(true))
    const post = f.mock.calls.find(([, i]) => (i as RequestInit)?.method === "POST")!
    expect(JSON.parse((post[1] as RequestInit).body as string).client_id).toBe("c-9")
  })

  it("offers no scope choice when the program has no assigned client", async () => {
    global.fetch = mockFetch({ studio: [] }) as unknown as typeof fetch
    render(<BlockedExercisePanel allExercises={LIBRARY} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText("Bench Press")).toBeInTheDocument())
    expect(screen.queryByRole("button", { name: /only$/ })).not.toBeInTheDocument()
    // Presence control for the absence above.
    expect(screen.getByPlaceholderText(/Search exercises/)).toBeInTheDocument()
  })

  it("warns when the block empties a movement pattern", async () => {
    global.fetch = mockFetch({
      studio: [],
      post: { block: { id: "new" }, remainingInPattern: 0, movementPattern: "carry" },
    }) as unknown as typeof fetch
    render(<BlockedExercisePanel allExercises={LIBRARY} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText("Bench Press")).toBeInTheDocument())
    fireEvent.click(screen.getByText("Bench Press"))
    await waitFor(() => expect(toast.warning).toHaveBeenCalled())
    expect(vi.mocked(toast.warning).mock.calls[0][0]).toMatch(/last usable carry/)
  })

  it("does not warn when the pattern still has exercises", async () => {
    // Control: proves the warning tracks the count rather than always firing.
    global.fetch = mockFetch({ studio: [] }) as unknown as typeof fetch
    render(<BlockedExercisePanel allExercises={LIBRARY} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText("Bench Press")).toBeInTheDocument())
    fireEvent.click(screen.getByText("Bench Press"))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it("unblocks through the DELETE route", async () => {
    const f = mockFetch({ studio: [blockRow()] })
    global.fetch = f as unknown as typeof fetch
    render(<BlockedExercisePanel allExercises={LIBRARY} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByTitle("Unblock")).toBeInTheDocument())
    fireEvent.click(screen.getByTitle("Unblock"))
    await waitFor(() => expect(f.mock.calls.some(([, i]) => (i as RequestInit)?.method === "DELETE")).toBe(true))
    const del = f.mock.calls.find(([, i]) => (i as RequestInit)?.method === "DELETE")!
    expect(del[0]).toBe("/api/admin/exercises/blocks/b1")
  })

  it("says blocks outlive this program", async () => {
    // The one thing that separates this panel from the Exercise Pool it copies:
    // the pool is per-program and dies with the tab, a block is forever.
    global.fetch = mockFetch({ studio: [blockRow()] }) as unknown as typeof fetch
    render(<BlockedExercisePanel allExercises={LIBRARY} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/apply to every program/i)).toBeInTheDocument())
  })
})
