// Ask AI and Examples, and the one apply path they share.
//
// The thing worth guarding is that NOTHING lands in the dialog without the
// owner saying so. Both modals can rewrite the template, the step rows and the
// description — an owner who half-filled the form and clicked Ask AI out of
// curiosity must be able to back out with their work intact.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { CreateFunnelDialog } from "@/components/admin/funnels/CreateFunnelDialog"
import { deriveOwnExamples } from "@/components/admin/funnels/FunnelBoard"
import { FUNNEL_EXAMPLES } from "@/lib/funnels/examples"
import type { Funnel, FunnelStep } from "@/types/database"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))
const push = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))

const PLAN = {
  template: "event",
  name: "Summer Camp 2026",
  steps: [
    { name: "Details", slug: "index", goal: "event" },
    { name: "Register", slug: "register", goal: "leads" },
    { name: "Payment", slug: "payment", goal: "event" },
  ],
  audience: "Junior tennis players and their parents",
  description: "A four-week camp running weekday mornings.",
  offer: null,
  startsAt: "2026-06-01T00:00:00.000Z",
  endsAt: "2026-08-15T00:00:00.000Z",
}

function mockFetch(overrides: Record<string, unknown> = {}) {
  global.fetch = vi.fn(async (url: string) => {
    const href = String(url)
    if (href.includes("/ai/interview")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          questions: [
            { id: "q1", question: "What ages?", hint: "Rough range is fine", placeholder: "12-16" },
            { id: "q2", question: "Deposit or full?", hint: null, placeholder: null },
          ],
          ...overrides,
        }),
      }
    }
    if (href.includes("/ai/plan")) {
      return { ok: true, status: 200, json: async () => ({ plan: PLAN, ...overrides }) }
    }
    if (href.includes("/offers")) {
      return { ok: true, status: 200, json: async () => ({ offers: [] }) }
    }
    return { ok: true, status: 201, json: async () => ({ funnel: { id: "f9" }, entryStepId: "s9" }) }
  }) as unknown as typeof fetch
}

function open(ownExamples: React.ComponentProps<typeof CreateFunnelDialog>["ownExamples"] = []) {
  render(<CreateFunnelDialog takenSlugs={[]} ownExamples={ownExamples} />)
  fireEvent.click(screen.getByRole("button", { name: /new funnel/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch()
})

describe("Ask AI", () => {
  async function runToReview() {
    open()
    fireEvent.click(screen.getByRole("button", { name: /ask ai/i }))
    fireEvent.change(screen.getByLabelText(/what do you want to build/i), {
      target: { value: "summer camp for junior tennis" },
    })
    fireEvent.click(screen.getByRole("button", { name: /ask me questions/i }))
    await waitFor(() => expect(screen.getByLabelText(/what ages/i)).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/what ages/i), { target: { value: "12 to 16" } })
    fireEvent.click(screen.getByRole("button", { name: /build my plan/i }))
    await waitFor(() => expect(screen.getByRole("button", { name: /use this/i })).toBeInTheDocument())
  }

  it("will not call the model on an empty brief", () => {
    open()
    fireEvent.click(screen.getByRole("button", { name: /ask ai/i }))
    expect(screen.getByRole("button", { name: /ask me questions/i })).toBeDisabled()
  })

  it("asks the questions it was given, with their hints", async () => {
    open()
    fireEvent.click(screen.getByRole("button", { name: /ask ai/i }))
    fireEvent.change(screen.getByLabelText(/what do you want to build/i), {
      target: { value: "summer camp" },
    })
    fireEvent.click(screen.getByRole("button", { name: /ask me questions/i }))
    await waitFor(() => expect(screen.getByLabelText(/what ages/i)).toBeInTheDocument())
    expect(screen.getByText(/rough range is fine/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/deposit or full/i)).toBeInTheDocument()
  })

  it("sends the brief and the answers to the plan endpoint", async () => {
    await runToReview()
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    const call = fetchMock.mock.calls.find((args) => String(args[0]).includes("/ai/plan"))!
    const body = JSON.parse((call[1] as RequestInit).body as string)
    expect(body.brief).toBe("summer camp for junior tennis")
    expect(body.answers).toContainEqual({ question: "What ages?", answer: "12 to 16" })
  })

  it("shows the plan for review before anything is applied", async () => {
    // MUTANT KILLED: applying on response. The plan rewrites the template and
    // every step row; doing that without asking loses whatever the owner had.
    await runToReview()
    // SCOPED to the review card. "Fill an event or camp" is also the label of a
    // radio in the create dialog behind this modal, so an unscoped query
    // matches two nodes — and would have "passed" against a review card that
    // rendered nothing at all.
    const review = screen.getByTestId("ai-plan-review")
    expect(within(review).getByText(/fill an event or camp/i)).toBeInTheDocument()
    expect(within(review).getByText(/four-week camp/i)).toBeInTheDocument()
    // Not yet in the form behind it.
    expect(screen.getByLabelText(/^name$/i)).toHaveValue("")
  })

  it("fills the dialog on Use this", async () => {
    await runToReview()
    fireEvent.click(screen.getByRole("button", { name: /use this/i }))

    await waitFor(() => expect(screen.getByLabelText(/^name$/i)).toHaveValue("Summer Camp 2026"))
    expect(screen.getByLabelText(/^url$/i)).toHaveValue("summer-camp-2026")
    expect(screen.getByRole("radio", { name: /fill an event or camp/i })).toHaveAttribute(
      "aria-checked",
      "true",
    )
    expect(screen.getAllByTestId("step-row")).toHaveLength(3)
    expect(screen.getByLabelText(/who is this for/i)).toHaveValue(
      "Junior tennis players and their parents",
    )
    expect(screen.getByLabelText(/describe it/i)).toHaveValue(
      "A four-week camp running weekday mornings.",
    )
    expect(screen.getByLabelText(/runs from/i)).toHaveValue("2026-06-01")
  })

  it("leaves everything untouched on Discard", async () => {
    // MUTANT KILLED: Discard closing without resetting, so the next Use this
    // applies a stale plan — or worse, Discard applying anyway.
    open()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "My Own Name" } })
    fireEvent.click(screen.getByRole("button", { name: /ask ai/i }))
    fireEvent.change(screen.getByLabelText(/what do you want to build/i), {
      target: { value: "summer camp" },
    })
    fireEvent.click(screen.getByRole("button", { name: /ask me questions/i }))
    await waitFor(() => expect(screen.getByLabelText(/what ages/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: /build my plan/i }))
    await waitFor(() => expect(screen.getByRole("button", { name: /discard/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: /discard/i }))

    await waitFor(() => expect(screen.getByLabelText(/^name$/i)).toHaveValue("My Own Name"))
    expect(screen.getByRole("radio", { name: /capture leads/i })).toHaveAttribute(
      "aria-checked",
      "true",
    )
  })

  it("reports a failure and leaves the dialog usable", async () => {
    global.fetch = vi.fn(async (url: string) =>
      String(url).includes("/ai/interview")
        ? { ok: false, status: 502, json: async () => ({ error: "Could not think of questions." }) }
        : { ok: true, status: 200, json: async () => ({ offers: [] }) },
    ) as unknown as typeof fetch

    open()
    fireEvent.click(screen.getByRole("button", { name: /ask ai/i }))
    fireEvent.change(screen.getByLabelText(/what do you want to build/i), {
      target: { value: "summer camp" },
    })
    fireEvent.click(screen.getByRole("button", { name: /ask me questions/i }))

    await waitFor(() => expect(screen.getByText(/could not think of questions/i)).toBeInTheDocument())
    expect(screen.getByText(/carry on filling it in yourself/i)).toBeInTheDocument()
  })
})

describe("Examples", () => {
  it("shows a worked example for every template", () => {
    open()
    fireEvent.click(screen.getByRole("button", { name: /see examples/i }))
    expect(screen.getAllByTestId("curated-example")).toHaveLength(FUNNEL_EXAMPLES.length)
  })

  it("says why each one works", () => {
    // The reason the modal is worth opening twice.
    open()
    fireEvent.click(screen.getByRole("button", { name: /see examples/i }))
    expect(screen.getAllByText(/why it works/i).length).toBe(FUNNEL_EXAMPLES.length)
  })

  it("fills the dialog from a curated example", async () => {
    open()
    fireEvent.click(screen.getByRole("button", { name: /see examples/i }))
    const camp = screen
      .getAllByTestId("curated-example")
      .find((card) => within(card).queryByText(/summer camp 2026/i))!
    fireEvent.click(within(camp).getByRole("button", { name: /start from this/i }))

    await waitFor(() => expect(screen.getByLabelText(/^name$/i)).toHaveValue("Summer Camp 2026"))
    expect(screen.getAllByTestId("step-row")).toHaveLength(4)
  })

  it("hides the your-funnels section when there are none", () => {
    // Not an empty state: six curated cards above already answer "show me one".
    open()
    fireEvent.click(screen.getByRole("button", { name: /see examples/i }))
    expect(screen.queryByText(/your funnels/i)).not.toBeInTheDocument()
  })

  it("lists the owner's own funnels when there are some", () => {
    open([{ id: "f1", name: "Spring Camp", template: "event", stepNames: ["Details"], live: true }])
    fireEvent.click(screen.getByRole("button", { name: /see examples/i }))
    expect(screen.getByText(/your funnels/i)).toBeInTheDocument()
    expect(screen.getByText("Spring Camp")).toBeInTheDocument()
  })

  it("copies structure from an own funnel but never its name or URL", async () => {
    // MUTANT KILLED: copying the name too. Both name and slug must stay
    // unique, so this hands the owner a guaranteed 409 on submit.
    open([{ id: "f1", name: "Spring Camp", template: "event", stepNames: ["Details"], live: true }])
    fireEvent.click(screen.getByRole("button", { name: /see examples/i }))
    fireEvent.click(screen.getByRole("button", { name: /copy this structure/i }))

    await waitFor(() => expect(screen.getAllByTestId("step-row")).toHaveLength(4))
    expect(screen.getByLabelText(/^name$/i)).toHaveValue("")
    expect(screen.getByLabelText(/^url$/i)).toHaveValue("")
  })

  it("keeps a name you already typed when the plan carries none", async () => {
    // The `if (plan.name)` guard in applyPlan, which the test above does NOT
    // reach: it starts from an empty field, so it passes with or without the
    // guard. Copying a structure must not wipe the name you just chose.
    open([{ id: "f1", name: "Spring Camp", template: "event", stepNames: ["Details"], live: true }])
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Autumn Camp" } })
    fireEvent.click(screen.getByRole("button", { name: /see examples/i }))
    fireEvent.click(screen.getByRole("button", { name: /copy this structure/i }))

    await waitFor(() => expect(screen.getAllByTestId("step-row")).toHaveLength(4))
    expect(screen.getByLabelText(/^name$/i)).toHaveValue("Autumn Camp")
  })

  it("offers no copy button for a funnel with no template", () => {
    // Without a template there is no step plan to copy — the shape lives in
    // the registry, not on the row. Every pre-2026-08-16 funnel is this case.
    open([{ id: "f1", name: "Legacy", template: null, stepNames: ["Page"], live: false }])
    fireEvent.click(screen.getByRole("button", { name: /see examples/i }))
    expect(screen.queryByRole("button", { name: /copy this structure/i })).not.toBeInTheDocument()
  })
})

describe("deriveOwnExamples", () => {
  const funnel = (over: Partial<Funnel> & { id: string }): Funnel =>
    ({ name: over.id, status: "draft", template: null, ...over }) as Funnel
  const step = (id: string, name: string, position: number): FunnelStep =>
    ({ id, name, position }) as FunnelStep

  it("groups pages back into one entry per funnel", () => {
    const f = funnel({ id: "f1", name: "Camp" })
    const result = deriveOwnExamples([
      { funnel: f, step: step("s1", "Details", 0) },
      { funnel: f, step: step("s2", "Register", 1) },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].stepNames).toEqual(["Details", "Register"])
  })

  it("orders steps by position, not by arrival", () => {
    // MUTANT KILLED: trusting the array order. The board flat-maps pages and
    // nothing promises they arrive sorted, so "Payment → Details" would be
    // shown as the shape to copy.
    const f = funnel({ id: "f1" })
    const result = deriveOwnExamples([
      { funnel: f, step: step("s2", "Register", 1) },
      { funnel: f, step: step("s1", "Details", 0) },
    ])
    expect(result[0].stepNames).toEqual(["Details", "Register"])
  })

  it("puts the most-stepped funnel first", () => {
    const big = funnel({ id: "big" })
    const small = funnel({ id: "small" })
    const result = deriveOwnExamples([
      { funnel: small, step: step("a", "Only", 0) },
      { funnel: big, step: step("b", "One", 0) },
      { funnel: big, step: step("c", "Two", 1) },
    ])
    expect(result[0].id).toBe("big")
  })

  it("reports live only for a published funnel", () => {
    const result = deriveOwnExamples([
      { funnel: funnel({ id: "f1", status: "published" }), step: step("s", "A", 0) },
      { funnel: funnel({ id: "f2", status: "draft" }), step: step("t", "B", 0) },
    ])
    expect(result.find((entry) => entry.id === "f1")!.live).toBe(true)
    expect(result.find((entry) => entry.id === "f2")!.live).toBe(false)
  })
})
