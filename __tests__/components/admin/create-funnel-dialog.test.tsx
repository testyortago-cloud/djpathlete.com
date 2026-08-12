// A funnel is a container, so its dialog asks less than the page one and lands
// somewhere else: the step list, where you decide what the sequence is, rather
// than the builder, which only ever edits one step.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { CreateFunnelDialog } from "@/components/admin/funnels/CreateFunnelDialog"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const push = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 201,
    json: async () => ({ funnel: { id: "f9" }, entryStepId: "s9" }),
  })) as unknown as typeof fetch
})

function open() {
  render(<CreateFunnelDialog takenSlugs={[]} />)
  fireEvent.click(screen.getByRole("button", { name: /new funnel/i }))
}

describe("<CreateFunnelDialog>", () => {
  it("does not ask for a goal", () => {
    // MUTANT KILLED: copying CreatePageDialog wholesale. A funnel has no single
    // goal — its steps do — so asking would store a fact that is not true.
    open()
    expect(screen.queryByText(/capture leads/i)).not.toBeInTheDocument()
  })

  it("posts kind funnel", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    open()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Camp 2026" } })
    fireEvent.click(screen.getByRole("button", { name: /create funnel/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).toMatchObject({ name: "Camp 2026", slug: "camp-2026", kind: "funnel" })
  })

  it("routes to the funnel's step list, not the builder", async () => {
    // MUTANT KILLED: reusing the page hand-off, which would drop the owner into
    // step one's canvas before they have decided what the steps are.
    open()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Camp 2026" } })
    fireEvent.click(screen.getByRole("button", { name: /create funnel/i }))

    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/funnels/f9"))
  })

  it("refuses a reserved slug", () => {
    // MUTANT KILLED: validating slugs in the page dialog only, so the funnel
    // dialog would send a reserved slug and meet a 400.
    open()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Login" } })
    expect(screen.getByText(/reserved/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /create funnel/i })).toBeDisabled()
  })
})
