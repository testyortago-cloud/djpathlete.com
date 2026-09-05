// @vitest-environment jsdom
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
    expect(rows()).toHaveLength(3)
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
    // Scoped to the row: an unscoped remove query across a multi-row editor is
    // exactly the "passed for the wrong reason" trap this repo has hit before.
    fireEvent.click(within(rows()[2]).getByRole("button", { name: /remove step 3/i }))
    fireEvent.click(screen.getByRole("button", { name: /create funnel/i }))

    await waitFor(() => expect(createBody().steps).toBeDefined())
    expect(createBody().steps.map((step: { slug: string }) => step.slug)).toEqual([
      "index",
      "register",
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
      "thank-you",
      "register",
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

// ---------------------------------------------------------------------------
// The quiz picker.
// Spec: docs/superpowers/specs/2026-08-24-quiz-funnel-creator-design.md §1, §2
// ---------------------------------------------------------------------------

describe("CreateFunnelDialog — the quiz template", () => {
  const PICKER = /copy questions from/i

  function fillName(value: string) {
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value } })
  }

  it("shows the picker only for the quiz template", async () => {
    open()
    pick(/capture leads/i)
    expect(screen.queryByLabelText(PICKER)).toBeNull()
    pick(/run a quiz/i)
    expect(await screen.findByLabelText(PICKER)).toBeTruthy()
  })

  it("offers the built-in even when there are no quizzes yet", async () => {
    // MUTANT KILLED: build the options from the fetched list alone. On a
    // database with no quizzes — every database before the seed script has been
    // run — the picker is empty and a quiz funnel cannot be created at all.
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes("/api/admin/quizzes")) {
        return { ok: true, status: 200, json: async () => ({ quizzes: [] }) }
      }
      return { ok: true, status: 201, json: async () => ({ funnel: { id: "f9" }, entryStepId: "s9" }) }
    }) as unknown as typeof fetch

    open()
    pick(/run a quiz/i)
    const picker = await screen.findByLabelText(PICKER)
    await waitFor(() => expect(within(picker).getAllByRole("option").length).toBeGreaterThan(0))
    expect(within(picker).getByRole("option", { name: /the original/i })).toBeTruthy()
  })

  it("lists the quizzes that do exist, alongside the original", async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes("/api/admin/quizzes")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ quizzes: [{ id: "quiz-1", name: "Rotational Reboot", status: "active" }] }),
        }
      }
      return { ok: true, status: 201, json: async () => ({ funnel: { id: "f9" }, entryStepId: "s9" }) }
    }) as unknown as typeof fetch

    open()
    pick(/run a quiz/i)
    const picker = await screen.findByLabelText(PICKER)
    await waitFor(() => expect(within(picker).getAllByRole("option").length).toBe(2))
    expect(within(picker).getByRole("option", { name: /rotational reboot/i })).toBeTruthy()
  })

  it("sends copyFrom with the create", async () => {
    open()
    pick(/run a quiz/i)
    fillName("Rotational Reboot Check")
    await screen.findByLabelText(PICKER)
    fireEvent.click(screen.getByRole("button", { name: /create funnel/i }))
    // MUTANT KILLED: omit `quiz` from the body. The server refuses the quiz
    // template with no quiz, so the owner meets a validation error on a field
    // the dialog did fill in.
    await waitFor(() => expect(createBody().quiz).toEqual({ copyFrom: "builtin:rpi" }))
  })

  it("sends no quiz for any other template", async () => {
    open()
    pick(/capture leads/i)
    fillName("Free Trial Week")
    fireEvent.click(screen.getByRole("button", { name: /create funnel/i }))
    // The server refuses a quiz on a template that does not ask for one, so
    // sending it anyway is a 400 on a funnel that should have been created.
    await waitFor(() => expect(createBody().quiz).toBeUndefined())
  })

  it("does not spend a request on the quiz list for other templates", async () => {
    // AN EVENT FUNNEL, not a lead-capture one. `leads` fetches nothing at all,
    // so "no quizzes request" would be true there with the effect's guard
    // deleted — the assertion would pin nothing. `event` fetches its offers,
    // which proves the effects ran and that this one chose not to fire.
    open()
    pick(/fill an event or camp/i)
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((args) => String(args[0]).includes("/offers"))).toBe(true),
    )
    expect(fetchMock.mock.calls.some((args) => String(args[0]).includes("/api/admin/quizzes"))).toBe(false)
  })
})

describe("CreateFunnelDialog — where a quiz funnel lands", () => {
  it("opens the quiz, not the page builder", async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes("/api/admin/quizzes")) {
        return { ok: true, status: 200, json: async () => ({ quizzes: [] }) }
      }
      return {
        ok: true,
        status: 201,
        json: async () => ({ funnel: { id: "f9" }, entryStepId: "s9", quizId: "quiz-9" }),
      }
    }) as unknown as typeof fetch

    open()
    pick(/run a quiz/i)
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Rotational Reboot Check" } })
    await screen.findByLabelText(/copy questions from/i)
    fireEvent.click(screen.getByRole("button", { name: /create funnel/i }))
    // MUTANT KILLED: route to the builder anyway. The owner lands on a page
    // that is already written, and never sees the questions that are not.
    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/funnels/quizzes/quiz-9"))
  })

  it("still opens the page builder for every other template", async () => {
    open()
    pick(/capture leads/i)
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Free Trial Week" } })
    fireEvent.click(screen.getByRole("button", { name: /create funnel/i }))
    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/funnels/f9/edit/s9?start=1"))
  })
})

describe("CreateFunnelDialog — what 'Describe it' claims", () => {
  it("does not tell a quiz funnel that its description drafts the page", async () => {
    // MUTANT KILLED: one sentence for every template. A quiz funnel's page is
    // written at creation, so "used to write the first draft of every step"
    // teaches the owner that this field does something it does not.
    open()
    pick(/run a quiz/i)
    await screen.findByLabelText(/copy questions from/i)
    expect(screen.queryByText(/first draft of every step/i)).toBeNull()
    expect(screen.getByText(/page is already written/i)).toBeTruthy()
  })

  it("keeps the original sentence everywhere else", async () => {
    open()
    pick(/capture leads/i)
    expect(screen.getByText(/first draft of every step/i)).toBeTruthy()
  })
})
