// THE QUIZ LIVES IN THE FUNNEL, and nowhere else.
//
// There is no quizzes list any more. A quiz is not a thing this product has
// alongside funnels — it is something a funnel can run, the way a funnel can
// take a payment. That matters beyond tidiness: this app is being white-
// labelled, and a customer whose work has no quizzes in it must never meet the
// word. So every quiz surface has to be CONDITIONAL on a funnel actually
// running one, which is what these tests pin.
//
// The mirror of __tests__/components/admin/funnel-board-quiz.test.tsx, which
// pins the same control on the landing-pages board.
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { FunnelList } from "@/components/admin/funnels/FunnelList"
import type { Funnel, FunnelStep } from "@/types/database"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const QUIZ_ID = "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9"

// CAST AT THE END. A `Partial<Funnel>` spread widens every optional-in-the-
// partial field to include `undefined`, which `Funnel` does not accept.
const funnel = (over: Partial<Funnel> = {}): Funnel =>
  ({
    id: "f1",
    slug: "performance-gap-map",
    name: "Performance Gap Map",
    description: null,
    status: "draft",
    kind: "funnel",
    goal: null,
    created_by: null,
    created_at: "",
    updated_at: "",
    ...over,
  }) as Funnel

const step = (over: Partial<FunnelStep> = {}): FunnelStep =>
  ({
    id: "s1",
    funnel_id: "f1",
    slug: "index",
    // DELIBERATELY NOT "Quiz". The quiz template names its step that, and a
    // step name is the OWNER's text -- letting it sit in the fixture would make
    // the "shows the word nowhere" assertion below pass on their typing rather
    // than on the product's chrome.
    name: "Signup",
    position: 0,
    is_entry: true,
    published_version_id: null,
    project_data: null,
    created_at: "",
    updated_at: "",
    ...over,
  }) as FunnelStep

function renderBoard(quizByStepId: Record<string, { id: string; name: string }>) {
  return render(
    <FunnelList
      funnels={[{ funnel: funnel(), steps: [step()] }]}
      leadCounts={{}}
      quizByStepId={quizByStepId}
    />,
  )
}

describe("the quiz on a funnel's own card", () => {
  it("offers the quiz from the funnel that runs it", () => {
    renderBoard({ s1: { id: QUIZ_ID, name: "Athlete Quiz (RPI)" } })
    const link = screen.getByRole("link", { name: /Quiz/ })
    expect(link.getAttribute("href")).toBe(`/admin/funnels/quizzes/${QUIZ_ID}`)
  })

  it("names the quiz on the control, so two quizzes are told apart", () => {
    // A funnel can run a quiz whose name is nothing like the funnel's. The
    // title is what the owner hovers to find out which one this is.
    renderBoard({ s1: { id: QUIZ_ID, name: "Return to Sport Screen" } })
    expect(screen.getByTitle("Edit Return to Sport Screen")).toBeTruthy()
  })

  it("SHOWS NOTHING AT ALL when this funnel runs no quiz", () => {
    // The white-label requirement, as an assertion. A customer with no quizzes
    // must not see the word anywhere — not a disabled button, not an empty
    // slot, nothing.
    const { container } = renderBoard({})
    expect(screen.queryByRole("link", { name: /Quiz/ })).toBeNull()
    expect(container.textContent).not.toMatch(/quiz/i)
  })

  it("shows nothing when the funnel's OTHER step runs a quiz but this one does not", () => {
    // Keyed by STEP, not by funnel: the map that arrives is the whole board's,
    // so a card must not offer a quiz belonging to a different card's step.
    renderBoard({ "some-other-step": { id: QUIZ_ID, name: "Athlete Quiz (RPI)" } })
    expect(screen.queryByRole("link", { name: /Quiz/ })).toBeNull()
  })

  it("still renders the funnel's own controls beside it", () => {
    // The quiz button is an ADDITION to the card, not a replacement for it —
    // a regression here would read as "the quiz ate the funnel".
    renderBoard({ s1: { id: QUIZ_ID, name: "Athlete Quiz (RPI)" } })
    expect(screen.getByRole("link", { name: "Open" })).toBeTruthy()
    expect(screen.getByLabelText("Performance Gap Map settings")).toBeTruthy()
  })
})
