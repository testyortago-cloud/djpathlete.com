// The create dialog exists because a bare name field could not ask anything
// useful. These tests hold it to that: the URL it promises must be the URL it
// sends, and the rules it enforces must be the validator's rules, not a copy.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { CreatePageDialog } from "@/components/admin/funnels/CreatePageDialog"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const push = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 201,
    json: async () => ({ funnel: { id: "f1" }, entryStepId: "s1" }),
  })) as unknown as typeof fetch
})

function open(taken: string[] = []) {
  render(<CreatePageDialog takenSlugs={taken} />)
  fireEvent.click(screen.getByRole("button", { name: /new landing page/i }))
}

describe("<CreatePageDialog>", () => {
  it("derives the slug from the name and shows the resulting URL", () => {
    // MUTANT KILLED: showing a static /go/ placeholder. The owner must be able
    // to read the real address before committing to it.
    open()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Free Trial Week" } })
    expect(screen.getByLabelText(/url/i)).toHaveValue("free-trial-week")
  })

  it("stops deriving once the slug is edited by hand", () => {
    // MUTANT KILLED: re-deriving on every keystroke, which silently discards a
    // hand-picked URL the moment the name is touched again.
    open()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Free Trial" } })
    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: "trial" } })
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Free Trial Week" } })
    expect(screen.getByLabelText(/url/i)).toHaveValue("trial")
  })

  it("refuses a reserved slug using the validator's own list", () => {
    // MUTANT KILLED: a hard-coded reserved list in the component that drifts
    // from lib/validators/funnel.ts.
    open()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Admin" } })
    expect(screen.getByText(/reserved/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /create & build/i })).toBeDisabled()
  })

  it("warns when the slug is already used", () => {
    // MUTANT KILLED: dropping the takenSlugs check, leaving the owner to
    // discover the clash only after the AI has spent a turn building.
    open(["free-trial-week"])
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Free Trial Week" } })
    expect(screen.getByText(/already in use/i)).toBeInTheDocument()
  })

  it("posts kind page with the chosen goal and description", async () => {
    // MUTANT KILLED: collecting the fields and posting only name+slug — the
    // dialog would look rich and change nothing about what gets stored.
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    open()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Free Trial Week" } })
    fireEvent.click(screen.getByRole("radio", { name: /book a consult/i }))
    fireEvent.change(screen.getByLabelText(/describe/i), { target: { value: "For HS athletes." } })
    fireEvent.click(screen.getByRole("button", { name: /create & build/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).toMatchObject({
      name: "Free Trial Week",
      slug: "free-trial-week",
      kind: "page",
      goal: "booking",
      description: "For HS athletes.",
    })
  })

  it("routes into the builder with the start flag", async () => {
    // MUTANT KILLED: creating the page and leaving the owner on the list, which
    // is the shipped behaviour this whole feature exists to replace.
    open()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Free Trial Week" } })
    fireEvent.click(screen.getByRole("button", { name: /create & build/i }))

    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/pages/f1/edit/s1?start=1"))
  })

  it("keeps the dialog open and reports the error when the server refuses", async () => {
    // MUTANT KILLED: closing on failure, which loses everything typed.
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: "That slug is already in use." }),
    })) as unknown as typeof fetch
    open()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Free Trial Week" } })
    fireEvent.click(screen.getByRole("button", { name: /create & build/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That slug is already in use."))
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })
})
