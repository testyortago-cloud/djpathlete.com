// @vitest-environment jsdom
// A LANDING PAGE HAS NO DETAIL SCREEN -- `/admin/pages/<id>` redirects to the
// list, on purpose (see landing-page-has-no-detail-screen.test.tsx). So the
// quiz panel on the funnel settings screen cannot be the whole answer to
// "reach the quiz from the thing it belongs to": the seeded Athlete Quiz is a
// LANDING PAGE, and for pages this board IS the screen.
//
// Every control a landing page needs already moved onto this card for exactly
// that reason -- go live, convert, delete. The quiz is the next one.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { FunnelList } from "@/components/admin/funnels/FunnelList"
import type { Funnel, FunnelStep } from "@/types/database"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const QUIZ_ID = "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9"

// CAST AT THE END, like the `step` factory below. A `Partial<Funnel>` spread
// widens every optional-in-the-partial field to include `undefined`, which
// `Funnel` does not accept -- the two older board tests carry that error
// today, and this file is not adding a third to the baseline.
const funnel = (over: Partial<Funnel> = {}): Funnel =>
  ({
    id: "f1",
    slug: "athlete-quiz",
    name: "Athlete Quiz",
    description: null,
    status: "published",
    kind: "page",
    goal: "leads",
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
    name: "Landing page",
    position: 0,
    is_entry: true,
    published_version_id: "v1",
    project_data: null,
    ...over,
  }) as FunnelStep

// RENDERS `FunnelList` NOW, not the deleted `FunnelBoard`. The guarantee is
// unchanged -- a page running a quiz offers it from the card -- and only the
// component that has to keep it has moved. Retargeted rather than deleted:
// dropping a test whose premise changed is how a guarantee silently lapses.
function board(quizByStepId: Record<string, { id: string; name: string }> = {}) {
  return render(
    <FunnelList
      kind="page"
      funnels={[{ funnel: funnel(), steps: [step()] }]}
      leadCounts={{ f1: 3 }}
      quizByStepId={quizByStepId}
    />,
  )
}

beforeEach(() => vi.clearAllMocks())

// THE FIXTURE'S PAGE IS CALLED "Athlete Quiz" ON PURPOSE. A name matcher of
// /quiz/i finds the card's own title too, so every assertion below matches the
// button's EXACT accessible name -- otherwise "the quiz is offered" would be
// satisfied by the page's title and the button could be deleted with the suite
// still green.
describe("the landing pages board and the quiz a page runs", () => {
  it("offers the quiz on the card of the page that runs it", () => {
    board({ s1: { id: QUIZ_ID, name: "Athlete Quiz (RPI)" } })
    const link = screen.getByRole("link", { name: "Quiz" })
    expect(link.getAttribute("href")).toBe(`/admin/funnels/quizzes/${QUIZ_ID}`)
  })

  it("names the quiz, so a page running one of several says which", () => {
    board({ s1: { id: QUIZ_ID, name: "Athlete Quiz (RPI)" } })
    expect(screen.getByTitle(/Athlete Quiz \(RPI\)/)).toBeTruthy()
  })

  it("offers nothing on a page that runs no quiz", () => {
    board({})
    expect(screen.queryByRole("link", { name: "Quiz" })).toBeNull()
  })

  it("offers nothing on a page whose OWN step has no quiz, even when another does", () => {
    // Keyed by step, not by funnel: a funnel's third page running a quiz must
    // not put an Edit-quiz button on its first.
    board({ "some-other-step": { id: QUIZ_ID, name: "Athlete Quiz (RPI)" } })
    expect(screen.queryByRole("link", { name: "Quiz" })).toBeNull()
  })
})
