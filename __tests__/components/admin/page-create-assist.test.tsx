// The same assist, on the landing pages screen.
//
// A page is NOT a one-step funnel, and these tests exist mostly to hold that
// line: the modals are shared, so the cheapest wrong implementation is one that
// shows a page owner a template picker, a step list and a run window they
// cannot have.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { CreatePageDialog } from "@/components/admin/funnels/CreatePageDialog"
import { PAGE_EXAMPLES } from "@/lib/funnels/examples"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))
const push = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))

const PAGE_PLAN = {
  kind: "page",
  goal: "booking",
  name: "Free Consult",
  audience: "People weighing up coaching",
  description: "A twenty-minute call to work out the next step.",
}

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn(async (url: string) => {
    const href = String(url)
    if (href.includes("/ai/interview")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          questions: [{ id: "q1", question: "Who is it for?", hint: null, placeholder: null }],
        }),
      }
    }
    if (href.includes("/ai/plan")) {
      return { ok: true, status: 200, json: async () => ({ plan: PAGE_PLAN }) }
    }
    return { ok: true, status: 201, json: async () => ({ funnel: { id: "p9" }, entryStepId: "s9" }) }
  }) as unknown as typeof fetch
})

function open() {
  render(<CreatePageDialog takenSlugs={[]} />)
  fireEvent.click(screen.getByRole("button", { name: /new landing page/i }))
}

function lastPost() {
  const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
  const call = fetchMock.mock.calls.find(
    (args) => String(args[0]).endsWith("/api/admin/funnels") && (args[1] as RequestInit)?.method === "POST",
  )!
  return JSON.parse((call[1] as RequestInit).body as string)
}

describe("Examples on the pages screen", () => {
  it("shows a page example for every goal, not funnel templates", () => {
    // MUTANT KILLED: reusing FUNNEL_EXAMPLES here. It would offer a page owner
    // a four-step camp funnel as the thing to start from.
    open()
    fireEvent.click(screen.getByRole("button", { name: /see examples/i }))
    expect(screen.getAllByTestId("curated-example")).toHaveLength(PAGE_EXAMPLES.length)
    expect(screen.queryByText(/summer camp 2026/i)).not.toBeInTheDocument()
  })

  it("shows no step list, because a page has no steps", () => {
    open()
    fireEvent.click(screen.getByRole("button", { name: /see examples/i }))
    expect(screen.queryByTestId("step-row")).not.toBeInTheDocument()
  })

  it("never offers the your-funnels section", () => {
    // "Copy this structure" copies a TEMPLATE's step plan. A page has neither,
    // so the button could not do anything.
    open()
    fireEvent.click(screen.getByRole("button", { name: /see examples/i }))
    expect(screen.queryByText(/your funnels/i)).not.toBeInTheDocument()
  })

  it("fills goal, name, audience and description from an example", async () => {
    open()
    fireEvent.click(screen.getByRole("button", { name: /see examples/i }))
    const consult = screen
      .getAllByTestId("curated-example")
      .find((card) => within(card).queryByText(/free consult/i))!
    fireEvent.click(within(consult).getByRole("button", { name: /start from this/i }))

    await waitFor(() => expect(screen.getByLabelText(/^name$/i)).toHaveValue("Free Consult"))
    expect(screen.getByRole("radio", { name: /book a consult/i })).toHaveAttribute(
      "aria-checked",
      "true",
    )
    expect(screen.getByLabelText(/who is this for/i)).not.toHaveValue("")
    expect(screen.getByLabelText(/describe it/i)).not.toHaveValue("")
  })
})

describe("Ask AI on the pages screen", () => {
  async function runToReview() {
    open()
    fireEvent.click(screen.getByRole("button", { name: /ask ai/i }))
    fireEvent.change(screen.getByLabelText(/what do you want to build/i), {
      target: { value: "a consult booking page" },
    })
    fireEvent.click(screen.getByRole("button", { name: /ask me questions/i }))
    await waitFor(() => expect(screen.getByLabelText(/who is it for/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: /build my plan/i }))
    await waitFor(() => expect(screen.getByRole("button", { name: /use this/i })).toBeInTheDocument())
  }

  it("tells the endpoints this is a page", async () => {
    // MUTANT KILLED: omitting `kind`. The routes default to "funnel", so the
    // page dialog would get funnel questions ("what happens after signup?" on
    // a one-page site) and a plan it cannot apply.
    await runToReview()
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    for (const path of ["/ai/interview", "/ai/plan"]) {
      const call = fetchMock.mock.calls.find((args) => String(args[0]).includes(path))!
      expect(JSON.parse((call[1] as RequestInit).body as string).kind, path).toBe("page")
    }
  })

  it("reviews a goal rather than a template and steps", async () => {
    await runToReview()
    const review = screen.getByTestId("ai-plan-review")
    expect(within(review).getByText(/book a consult/i)).toBeInTheDocument()
    expect(within(review).queryByText(/^steps$/i)).not.toBeInTheDocument()
  })

  it("fills the page dialog on Use this", async () => {
    await runToReview()
    fireEvent.click(screen.getByRole("button", { name: /use this/i }))

    await waitFor(() => expect(screen.getByLabelText(/^name$/i)).toHaveValue("Free Consult"))
    expect(screen.getByLabelText(/^url$/i)).toHaveValue("free-consult")
    expect(screen.getByRole("radio", { name: /book a consult/i })).toHaveAttribute(
      "aria-checked",
      "true",
    )
    expect(screen.getByLabelText(/who is this for/i)).toHaveValue("People weighing up coaching")
  })

  it("leaves the dialog untouched on Discard", async () => {
    open()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "My Own Page" } })
    fireEvent.click(screen.getByRole("button", { name: /ask ai/i }))
    fireEvent.change(screen.getByLabelText(/what do you want to build/i), {
      target: { value: "a consult page" },
    })
    fireEvent.click(screen.getByRole("button", { name: /ask me questions/i }))
    await waitFor(() => expect(screen.getByLabelText(/who is it for/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: /build my plan/i }))
    await waitFor(() => expect(screen.getByRole("button", { name: /discard/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: /discard/i }))

    await waitFor(() => expect(screen.getByLabelText(/^name$/i)).toHaveValue("My Own Page"))
    expect(screen.getByRole("radio", { name: /capture leads/i })).toHaveAttribute(
      "aria-checked",
      "true",
    )
  })
})

describe("the audience field", () => {
  it("posts the audience it was given", async () => {
    // MUTANT KILLED: rendering the field and never sending it — which is the
    // collected-and-ignored defect this area has already shipped twice.
    open()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Trial" } })
    fireEvent.change(screen.getByLabelText(/who is this for/i), {
      target: { value: "High-school athletes" },
    })
    fireEvent.click(screen.getByRole("button", { name: /create & build/i }))

    await waitFor(() => expect(lastPost().audience).toBe("High-school athletes"))
  })

  it("omits the audience entirely when it is blank", async () => {
    open()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Trial" } })
    fireEvent.click(screen.getByRole("button", { name: /create & build/i }))

    await waitFor(() => expect(lastPost().name).toBe("Trial"))
    expect(lastPost()).not.toHaveProperty("audience")
  })

  it("still posts kind page and a goal", async () => {
    open()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Trial" } })
    fireEvent.click(screen.getByRole("button", { name: /create & build/i }))

    await waitFor(() => expect(lastPost().kind).toBe("page"))
    expect(lastPost().goal).toBe("leads")
  })
})
