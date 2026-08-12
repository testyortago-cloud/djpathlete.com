// Without this control the funnel half of the split is a promise the app
// cannot keep: "Convert to funnel" says the page "gains multi-step ordering",
// and until now nothing in the UI could add a second step. POST
// /api/admin/funnels/steps has existed since 00202 with no caller.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { AddStepDialog } from "@/components/admin/funnels/AddStepDialog"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const refresh = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 201,
    json: async () => ({ step: { id: "s2" } }),
  })) as unknown as typeof fetch
})

function open(taken: string[] = []) {
  render(<AddStepDialog funnelId="f1" funnelSlug="camp-2026" takenSlugs={taken} />)
  fireEvent.click(screen.getByRole("button", { name: /add step/i }))
}

describe("<AddStepDialog>", () => {
  it("shows the full address the step will live at", () => {
    // MUTANT KILLED: showing only the step slug. A step's address is the
    // FUNNEL's slug plus its own, and getting that wrong is how you publish a
    // step nobody can reach.
    open()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Thank you" } })
    expect(screen.getByText(/\/go\/camp-2026\/thank-you/)).toBeInTheDocument()
  })

  it("posts the funnel id with the new step", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    open()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Thank you" } })
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/admin/funnels/steps")
    expect(JSON.parse(init.body as string)).toEqual({
      funnel_id: "f1",
      name: "Thank you",
      slug: "thank-you",
    })
  })

  it("refuses a path already used in this funnel", () => {
    // MUTANT KILLED: skipping the check and letting the server's 409 be the
    // first the owner hears of it — after typing everything.
    open(["thank-you"])
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Thank you" } })
    expect(screen.getByText(/already used/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^add$/i })).toBeDisabled()
  })

  it("refuses the reserved index path", () => {
    // MUTANT KILLED: allowing "index", which is the entry step's own slug — the
    // insert would 409 on a constraint the owner cannot see or reason about.
    open()
    fireEvent.change(screen.getByLabelText(/path/i), { target: { value: "index" } })
    expect(screen.getByText(/entry page/i)).toBeInTheDocument()
  })

  it("refreshes so the new step appears", async () => {
    open()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Thank you" } })
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })
})
