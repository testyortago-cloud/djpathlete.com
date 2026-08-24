// The quizzes list renders in the HOUSE table.
//
// The regression this guards is not cosmetic: /admin/team hand-rolled a
// <table> and ended up with a grey header bar and square corners, reading as
// a different app. The assertions below are on the house components' own
// chrome, so a hand-rolled replacement fails even if it looks close.
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { QuizList, type QuizListItem } from "@/components/admin/quizzes/QuizList"

function quiz(over: Partial<QuizListItem> = {}): QuizListItem {
  return {
    id: "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9",
    key: "rpi_athlete_quiz",
    name: "Athlete Quiz (RPI)",
    status: "draft",
    seedMarker: null,
    updatedAt: "2026-08-24T10:00:00Z",
    attempts: { total: 12, completed: 5 },
    ...over,
  }
}

describe("the quizzes list", () => {
  it("renders inside the house DataTableCard chrome, not a hand-rolled table", () => {
    const { container } = render(<QuizList quizzes={[quiz()]} />)
    const card = container.querySelector(".rounded-xl.border")
    expect(card, "the list must sit in a DataTableCard").toBeTruthy()
    expect(container.querySelectorAll("table")).toHaveLength(1)
  })

  it("shows the status as a badge", () => {
    render(<QuizList quizzes={[quiz({ status: "active" })]} />)
    expect(screen.getByText("active")).toBeTruthy()
  })

  it("shows completed AND started, because the gap between them is the drop-off", () => {
    render(<QuizList quizzes={[quiz({ attempts: { total: 12, completed: 5 } })]} />)
    expect(screen.getByText("5")).toBeTruthy()
    expect(screen.getByText("12")).toBeTruthy()
  })

  it("uses the house empty state when there are no quizzes", () => {
    render(<QuizList quizzes={[]} />)
    expect(screen.getByText(/No quizzes yet/)).toBeTruthy()
    expect(screen.queryByText("Athlete Quiz (RPI)")).toBeNull()
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

  it("links each quiz to its editor", () => {
    render(<QuizList quizzes={[quiz()]} />)
    expect(screen.getByRole("link", { name: "Athlete Quiz (RPI)" }).getAttribute("href")).toBe(
      "/admin/funnels/quizzes/f15ef258-3f0a-494b-a8c9-deb2de7b2aa9",
    )
  })
})
