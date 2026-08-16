// A funnel is a sequence, so its dialog plans the sequence: pick what the
// funnel is for, get its steps, edit them, and land in step one already
// drafting.
//
// TWO TESTS IN HERE WERE REVERSED ON 2026-08-16 and each says so at its own
// site. They were not wrong when written — they pinned a deliberate decision
// that this redesign overturns — so they are rewritten rather than deleted, and
// the reasoning travels with them so the next reader does not "fix" them back.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { CreateFunnelDialog } from "@/components/admin/funnels/CreateFunnelDialog"
import { MAX_FUNNEL_STEPS } from "@/lib/funnels/templates"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const push = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn(async (url: string) => {
    if (String(url).includes("/offers")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ offers: [{ id: "e1", name: "Summer Camp 2026" }] }),
      }
    }
    return {
      ok: true,
      status: 201,
      json: async () => ({ funnel: { id: "f9" }, entryStepId: "s9" }),
    }
  }) as unknown as typeof fetch
})

function open() {
  render(<CreateFunnelDialog takenSlugs={[]} />)
  fireEvent.click(screen.getByRole("button", { name: /new funnel/i }))
}

function pick(label: RegExp) {
  fireEvent.click(screen.getByRole("radio", { name: label }))
}

function rows() {
  return screen.getAllByTestId("step-row")
}

/** The POST to /api/admin/funnels, ignoring the offers GET. */
function createBody() {
  const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
  const call = fetchMock.mock.calls.find(
    (args) => args[1] && (args[1] as RequestInit).method === "POST",
  )
  return JSON.parse((call![1] as RequestInit).body as string)
}

describe("<CreateFunnelDialog> — the template", () => {
  it("asks which kind of funnel this is", () => {
    // REVERSED 2026-08-16. This used to assert the dialog does NOT offer a
    // goal, on the reasoning that a funnel is a container whose STEPS hold the
    // goals. The reasoning holds; the conclusion did not. The goals do belong
    // to the steps — and a template is how creation learns what those steps
    // are, so the dialog asks once per funnel and writes a goal per step. No
    // goal is stored on the funnel row itself.
    // See docs/superpowers/specs/2026-08-16-funnel-create-templates-design.md §1.
    open()
    expect(screen.getByRole("radio", { name: /fill an event or camp/i })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /start from scratch/i })).toBeInTheDocument()
  })

  it("still posts kind funnel and never a funnel-level goal", () => {
    open()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Camp 2026" } })
    fireEvent.click(screen.getByRole("button", { name: /create funnel/i }))
    return waitFor(() => {
      const body = createBody()
      expect(body).toMatchObject({ name: "Camp 2026", slug: "camp-2026", kind: "funnel" })
      expect(body.goal).toBeUndefined()
    })
  })

  it("swaps the step rows when the template changes", () => {
    // MUTANT KILLED: rendering the template picker but keeping one hard-coded
    // step, which is the old behaviour wearing a new control.
    open()
    pick(/capture leads/i)
    expect(rows()).toHaveLength(2)
    pick(/fill an event or camp/i)
    expect(rows()).toHaveLength(4)
    pick(/start from scratch/i)
    expect(rows()).toHaveLength(1)
  })
})

describe("<CreateFunnelDialog> — conditional intake", () => {
  it("shows the run window only for a template that asks for it", () => {
    // MUTANT KILLED: rendering every intake field for every template, which is
    // the exact overload this redesign exists to avoid. `asks` is what decides.
    open()
    pick(/capture leads/i)
    expect(screen.queryByLabelText(/runs from/i)).not.toBeInTheDocument()
    pick(/fill an event or camp/i)
    expect(screen.getByLabelText(/runs from/i)).toBeInTheDocument()
  })

  it("shows the offer picker only for a template that sells something", () => {
    open()
    pick(/capture leads/i)
    expect(screen.queryByLabelText(/which one/i)).not.toBeInTheDocument()
    pick(/sell a program/i)
    expect(screen.getByLabelText(/which one/i)).toBeInTheDocument()
  })

  it("asks for lead recipients only where a step captures leads", () => {
    open()
    pick(/sell a program/i)
    expect(screen.queryByLabelText(/email me new leads/i)).not.toBeInTheDocument()
    pick(/capture leads/i)
    expect(screen.getByLabelText(/email me new leads/i)).toBeInTheDocument()
  })

  it("does not post a field the new template stopped asking for", async () => {
    // MUTANT KILLED: building the POST body from state alone, without asking
    // `asks()` first. The server refuses fields the template does not list, so
    // the whole create would fail with a message naming a field that is no
    // longer on screen.
    //
    // NAMING THE MECHANISM MATTERS HERE. There are TWO defences — this filter,
    // and `selectTemplate` clearing the state — and a mutation run showed this
    // test only fails for the first. The second has its own test below. A test
    // whose comment claims a mechanism it does not exercise is how this repo's
    // dominant defect (`tests_that_cannot_fail`) gets written.
    open()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Camp" } })
    pick(/fill an event or camp/i)
    fireEvent.change(screen.getByLabelText(/runs from/i), { target: { value: "2026-06-01" } })
    pick(/capture leads/i)
    fireEvent.click(screen.getByRole("button", { name: /create funnel/i }))

    await waitFor(() => expect(createBody().template).toBe("leads"))
    expect(createBody().starts_at).toBeUndefined()
  })

  it("clears a hidden field's value rather than only hiding it", () => {
    // The SECOND defence, which the POST-body test above does not reach: switch
    // away and back, and the date must be gone. Without this, a value the owner
    // can no longer see survives in state — and the moment the POST filter is
    // refactored, that stale value ships. Belt and braces, both tested.
    open()
    pick(/fill an event or camp/i)
    fireEvent.change(screen.getByLabelText(/runs from/i), { target: { value: "2026-06-01" } })
    expect(screen.getByLabelText(/runs from/i)).toHaveValue("2026-06-01")

    pick(/capture leads/i)
    pick(/fill an event or camp/i)
    expect(screen.getByLabelText(/runs from/i)).toHaveValue("")
  })

  it("refuses a run window that ends before it starts", () => {
    open()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Camp" } })
    pick(/fill an event or camp/i)
    fireEvent.change(screen.getByLabelText(/runs from/i), { target: { value: "2026-08-15" } })
    fireEvent.change(screen.getByLabelText(/until/i), { target: { value: "2026-06-01" } })
    expect(screen.getByText(/end must come after the start/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /create funnel/i })).toBeDisabled()
  })

  it("sends the offer under the template's own catalogue", async () => {
    open()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Camp" } })
    pick(/fill an event or camp/i)
    await waitFor(() => expect(screen.getByRole("option", { name: /summer camp 2026/i })).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/which one/i), { target: { value: "Summer Camp 2026" } })
    fireEvent.click(screen.getByRole("button", { name: /create funnel/i }))

    await waitFor(() => expect(createBody().offer).toBeDefined())
    expect(createBody().offer).toEqual({ kind: "event", ref: "Summer Camp 2026" })
  })
})

describe("<CreateFunnelDialog> — the step plan", () => {
  it("posts the plan it is showing, not the template id alone", async () => {
    // MUTANT KILLED: posting `template` and letting the server expand it, which
    // silently discards every edit the owner made to the rows.
    open()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Camp 2026" } })
    pick(/fill an event or camp/i)
    // Scoped to the row: an unscoped remove query across a four-row editor is
    // exactly the "passed for the wrong reason" trap this repo has hit before.
    fireEvent.click(within(rows()[3]).getByRole("button", { name: /remove step 4/i }))
    fireEvent.click(screen.getByRole("button", { name: /create funnel/i }))

    await waitFor(() => expect(createBody().steps).toBeDefined())
    expect(createBody().steps.map((step: { slug: string }) => step.slug)).toEqual([
      "index",
      "register",
      "payment",
    ])
  })

  it("carries each step's goal from the template", async () => {
    open()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Camp" } })
    pick(/capture leads/i)
    fireEvent.click(screen.getByRole("button", { name: /create funnel/i }))

    await waitFor(() => expect(createBody().steps).toBeDefined())
    expect(createBody().steps.map((step: { goal: string | null }) => step.goal)).toEqual([
      "leads",
      null,
    ])
  })

  it("will not let the entry row be removed or re-pathed", () => {
    // MUTANT KILLED: a generic row editor. Removing row 1 leaves a funnel with
    // no page at /go/<slug>; re-pathing it leaves the address unreachable.
    open()
    const first = rows()[0]
    expect(within(first).queryByRole("button", { name: /remove/i })).not.toBeInTheDocument()
    expect(within(first).getByLabelText(/step 1 path/i)).toBeDisabled()
  })

  it("reorders the steps it posts", async () => {
    open()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Camp" } })
    pick(/fill an event or camp/i)
    fireEvent.click(within(rows()[2]).getByRole("button", { name: /move step 3 up/i }))
    fireEvent.click(screen.getByRole("button", { name: /create funnel/i }))

    await waitFor(() => expect(createBody().steps).toBeDefined())
    expect(createBody().steps.map((step: { slug: string }) => step.slug)).toEqual([
      "index",
      "payment",
      "register",
      "thank-you",
    ])
  })

  it("cannot move a step into the entry slot", () => {
    // The entry step must stay first — moving row 2 up would silently change
    // which page /go/<slug> serves.
    open()
    pick(/fill an event or camp/i)
    expect(within(rows()[1]).getByRole("button", { name: /move step 2 up/i })).toBeDisabled()
  })

  it("blocks submit while a step has no name", () => {
    open()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Camp" } })
    pick(/capture leads/i)
    fireEvent.change(screen.getByLabelText(/step 2 name/i), { target: { value: "" } })
    expect(screen.getByRole("button", { name: /create funnel/i })).toBeDisabled()
  })

  it("blocks submit when two steps share a path", () => {
    open()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Camp" } })
    pick(/fill an event or camp/i)
    fireEvent.change(screen.getByLabelText(/step 3 path/i), { target: { value: "register" } })
    expect(screen.getByText(/cannot share a path/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /create funnel/i })).toBeDisabled()
  })

  it(`stops adding rows at ${MAX_FUNNEL_STEPS}`, () => {
    open()
    pick(/start from scratch/i)
    for (let i = 1; i < MAX_FUNNEL_STEPS; i++) {
      fireEvent.click(screen.getByRole("button", { name: /add step/i }))
    }
    expect(rows()).toHaveLength(MAX_FUNNEL_STEPS)
    expect(screen.queryByRole("button", { name: /add step/i })).not.toBeInTheDocument()
  })
})

describe("<CreateFunnelDialog> — after creating", () => {
  it("routes into the entry step's builder so it starts drafting", async () => {
    // REVERSED 2026-08-16. This used to assert a push to the step list, on the
    // reasoning that the owner had not yet decided what the steps were. With a
    // template they have — the list would only show them what they just typed.
    // Steps 2..N draft lazily when first opened (spec §4), so the builder is
    // now the honest next screen.
    open()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Camp 2026" } })
    fireEvent.click(screen.getByRole("button", { name: /create funnel/i }))

    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/funnels/f9/edit/s9?start=1"))
  })

  it("falls back to the funnel when no entry step came back", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ funnel: { id: "f9" } }),
    })) as unknown as typeof fetch

    open()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Camp 2026" } })
    fireEvent.click(screen.getByRole("button", { name: /create funnel/i }))

    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/funnels/f9"))
  })

  it("stays open on failure so a whole step plan is not lost", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: "That slug is already in use." }),
    })) as unknown as typeof fetch

    open()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Camp 2026" } })
    fireEvent.click(screen.getByRole("button", { name: /create funnel/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That slug is already in use."))
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/^name$/i)).toHaveValue("Camp 2026")
  })

  it("refuses a reserved slug", () => {
    // MUTANT KILLED: validating slugs in the page dialog only, so the funnel
    // dialog would send a reserved slug and meet a 400.
    open()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Login" } })
    expect(screen.getByText(/reserved/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /create funnel/i })).toBeDisabled()
  })
})
