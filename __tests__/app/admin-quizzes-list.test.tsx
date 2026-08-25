// The quizzes list renders the SAME preview card the funnels board renders.
//
// It used to be the house table, and that was the owner's report: a quiz had a
// row where a funnel had a card, so the one screen that is about a quiz was the
// one screen that could not show it. A quiz has no page of its own — its block
// is a POINTER — so the card previews the funnel page running it, and a quiz on
// no page keeps `PreviewCard`'s own "No preview yet" rather than inventing one.
//
// THE URL RULE IS THE POINT OF MOST OF THESE ASSERTIONS. It has to stay the
// identical rule `FunnelBoard` follows — live route when the step is published,
// draft route when it is not — because a preview and the page it previews
// disagreeing is this subsystem's worst failure mode.
import { describe, expect, it } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { QuizList, type QuizListItem, type QuizPlacementView } from "@/components/admin/quizzes/QuizList"

const QUIZ_ID = "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9"
const FUNNEL_ID = "11111111-1111-4111-8111-111111111111"

function placement(over: Partial<QuizPlacementView> = {}): QuizPlacementView {
  return {
    funnelId: FUNNEL_ID,
    funnelName: "Performance Gap Map",
    funnelSlug: "performance-gap-map",
    funnelKind: "funnel",
    funnelStatus: "draft",
    stepId: "step-1",
    stepName: "Quiz",
    stepSlug: "index",
    isEntry: true,
    published: false,
    ...over,
  }
}

function quiz(over: Partial<QuizListItem> = {}): QuizListItem {
  return {
    id: QUIZ_ID,
    key: "rpi_athlete_quiz",
    name: "Athlete Quiz (RPI)",
    status: "draft",
    seedMarker: null,
    updatedAt: "2026-08-24T10:00:00Z",
    attempts: { total: 12, completed: 5 },
    placement: placement(),
    ...over,
  }
}

function frame(name: string) {
  return document.querySelector<HTMLIFrameElement>(`iframe[title="Preview of ${name}"]`)
}

describe("the quizzes list", () => {
  it("renders a preview card per quiz, not a table row", () => {
    const { container } = render(<QuizList quizzes={[quiz()]} />)
    expect(container.querySelectorAll("table"), "a card grid has no table").toHaveLength(0)
    expect(screen.getByTestId("card-title").textContent).toBe("Athlete Quiz (RPI)")
  })

  it("previews the DRAFT route while the page running it is unpublished", () => {
    render(<QuizList quizzes={[quiz({ placement: placement({ published: false }) })]} />)
    expect(frame("Athlete Quiz (RPI)")?.getAttribute("src")).toBe("/preview/performance-gap-map")
  })

  it("previews the LIVE route once that page is published", () => {
    render(<QuizList quizzes={[quiz({ placement: placement({ published: true }) })]} />)
    expect(frame("Athlete Quiz (RPI)")?.getAttribute("src")).toBe("/go/performance-gap-map?preview=1")
  })

  it("appends the step slug for a quiz on a page that is not the front door", () => {
    // `/go/<slug>` is served by the ENTRY step. A quiz on a later step lives at
    // `/go/<slug>/<step>`, and previewing the entry would show a page with no
    // quiz on it at all.
    render(<QuizList quizzes={[quiz({ placement: placement({ isEntry: false, stepSlug: "retake" }) })]} />)
    expect(frame("Athlete Quiz (RPI)")?.getAttribute("src")).toBe("/preview/performance-gap-map/retake")
  })

  it("offers the Preview button only while the preview is a draft", () => {
    const { rerender } = render(<QuizList quizzes={[quiz({ placement: placement({ published: false }) })]} />)
    expect(screen.getByRole("link", { name: /Preview/ })).toBeTruthy()
    rerender(<QuizList quizzes={[quiz({ placement: placement({ published: true }) })]} />)
    expect(screen.queryByRole("link", { name: /Preview/ })).toBeNull()
  })

  it("says No preview yet for a quiz no page shows, and offers no preview link", () => {
    render(<QuizList quizzes={[quiz({ placement: null })]} />)
    expect(frame("Athlete Quiz (RPI)")).toBeNull()
    expect(screen.getByText("No preview yet")).toBeTruthy()
    expect(screen.getByText(/not on any page yet/i)).toBeTruthy()
    expect(screen.queryByRole("link", { name: /Preview/ })).toBeNull()
  })

  it("does not claim a quiz is on no page when the pages could not be read", () => {
    // "null and [] are different answers." If the steps read fails, every quiz
    // has NO placement — which renders identically to "no page shows this",
    // turning a failed read into a false statement about the owner's own work.
    // The screen says it does not know instead.
    render(<QuizList quizzes={[quiz({ placement: null })]} placementsKnown={false} />)
    expect(screen.queryByText(/not on any page yet/i)).toBeNull()
    // The CARD's own wording, not just the banner above it: the card is what
    // an owner reads, and it is the half that would otherwise state the lie.
    const card = screen.getByTestId("quiz-card")
    expect(within(card).getByText(/could not be checked/i)).toBeTruthy()
  })

  it("still says No preview yet when the pages read fails, because it has nothing to show", () => {
    render(<QuizList quizzes={[quiz({ placement: null })]} placementsKnown={false} />)
    expect(frame("Athlete Quiz (RPI)")).toBeNull()
    expect(screen.getByText("No preview yet")).toBeTruthy()
  })

  it("shows the QUIZ's own status on the badge, never the funnel's", () => {
    // The funnel here is a draft and the quiz is active. This screen is about
    // the quiz, so a card reading "draft" would answer a question nobody asked
    // and hide the one thing that decides whether it can take an answer.
    render(<QuizList quizzes={[quiz({ status: "active", placement: placement({ funnelStatus: "draft" }) })]} />)
    expect(screen.getByTestId("card-badge").textContent).toBe("active")
  })

  it("opens the question editor from the card, and the funnel from beside it", () => {
    render(<QuizList quizzes={[quiz()]} />)
    expect(screen.getByRole("link", { name: "Open" }).getAttribute("href")).toBe(
      `/admin/funnels/quizzes/${QUIZ_ID}`,
    )
    expect(screen.getByRole("link", { name: /Performance Gap Map/ }).getAttribute("href")).toBe(
      `/admin/funnels/${FUNNEL_ID}/edit/step-1`,
    )
  })

  it("sends a landing page's button to its page editor, which is the only screen it has", () => {
    // `/admin/pages/<id>` redirects to the list, so a funnel-detail link would
    // bounce the owner back to where they started.
    render(<QuizList quizzes={[quiz({ placement: placement({ funnelKind: "page" }) })]} />)
    expect(screen.getByRole("link", { name: /Performance Gap Map/ }).getAttribute("href")).toBe(
      `/admin/pages/${FUNNEL_ID}/edit/step-1`,
    )
  })

  it("shows completed AND started, because the gap between them is the drop-off", () => {
    render(<QuizList quizzes={[quiz({ attempts: { total: 12, completed: 5 } })]} />)
    const card = screen.getByTestId("quiz-card")
    expect(within(card).getByText(/5 completed/)).toBeTruthy()
    expect(within(card).getByText(/12 started/)).toBeTruthy()
  })

  it("keeps the quiz key on the card, because it is what the seed scripts name", () => {
    render(<QuizList quizzes={[quiz()]} />)
    expect(screen.getByText("rpi_athlete_quiz")).toBeTruthy()
  })

  it("warns that a seeded quiz carries reconstructed scoring", () => {
    render(<QuizList quizzes={[quiz({ seedMarker: "reconstructed-from-ghl-export-2026-08-23" })]} />)
    expect(screen.getByText(/reconstructed/)).toBeTruthy()
    expect(screen.getByText("Unverified scoring")).toBeTruthy()
  })

  it("does not warn when nothing carries the seed marker", () => {
    render(<QuizList quizzes={[quiz({ seedMarker: null })]} />)
    expect(screen.queryByText("Unverified scoring")).toBeNull()
    expect(screen.queryByText(/reconstructed/)).toBeNull()
  })

  it("explains the empty screen instead of showing an empty grid", () => {
    render(<QuizList quizzes={[]} />)
    expect(screen.getByText(/No quizzes yet/)).toBeTruthy()
    expect(screen.queryByTestId("quiz-card")).toBeNull()
  })
})
