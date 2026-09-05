// @vitest-environment jsdom
// The panel exists so the quiz is reachable FROM THE FUNNEL THAT USES IT. The
// assertions are therefore about the link and about the two states that are
// easy to get wrong: a quiz that is still a draft (so the page it is on cannot
// publish) and a quizId whose row is gone.
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { FunnelQuizPanel, type FunnelQuizPanelItem } from "@/components/admin/funnels/FunnelQuizPanel"

const QUIZ_ID = "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9"

function item(over: Partial<FunnelQuizPanelItem> = {}): FunnelQuizPanelItem {
  return {
    quizId: QUIZ_ID,
    stepName: "Athlete Quiz",
    quiz: {
      id: QUIZ_ID,
      key: "rpi_athlete_quiz",
      name: "Athlete Readiness Quiz",
      status: "active",
      seedMarker: null,
      updatedAt: "2026-08-24T10:00:00.000Z",
    },
    attempts: { total: 9, completed: 4 },
    ...over,
  }
}

describe("FunnelQuizPanel", () => {
  it("links the quiz to its editor", () => {
    render(<FunnelQuizPanel items={[item()]} />)
    const link = screen.getByRole("link", { name: /Athlete Readiness Quiz/ })
    expect(link.getAttribute("href")).toBe(`/admin/funnels/quizzes/${QUIZ_ID}`)
  })

  it("names the step the quiz is on", () => {
    render(<FunnelQuizPanel items={[item()]} />)
    expect(screen.getByText("Athlete Quiz")).toBeTruthy()
  })

  it("shows completions and starts as separate numbers", () => {
    // The gap between them IS the drop-off; showing only completions makes an
    // abandoned quiz look like an unused one.
    render(<FunnelQuizPanel items={[item()]} />)
    expect(screen.getByText("4")).toBeTruthy()
    expect(screen.getByText("9")).toBeTruthy()
  })

  it("says a draft quiz is a draft", () => {
    render(<FunnelQuizPanel items={[item({ quiz: { ...item().quiz!, status: "draft" } })]} />)
    expect(screen.getByText("draft")).toBeTruthy()
  })

  it("says so when the quiz this page points at no longer exists", () => {
    render(<FunnelQuizPanel items={[item({ quiz: null })]} />)
    expect(screen.getByText(/no longer exists/i)).toBeTruthy()
    expect(screen.queryByRole("link", { name: /Athlete Readiness Quiz/ })).toBeNull()
  })

  it("renders nothing at all when the funnel uses no quiz", () => {
    const { container } = render(<FunnelQuizPanel items={[]} />)
    expect(container.innerHTML).toBe("")
  })

  it("warns when the scoring was reconstructed rather than recovered", () => {
    render(<FunnelQuizPanel items={[item({ quiz: { ...item().quiz!, seedMarker: "ghl-export" } })]} />)
    expect(screen.getByText(/Unverified scoring/i)).toBeTruthy()
  })
})
