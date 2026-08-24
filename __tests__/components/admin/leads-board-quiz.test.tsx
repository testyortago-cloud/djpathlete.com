// "Quiz completions should show there alongside form fills, distinguishable
// from them." Distinguishable means visible WITHOUT opening the row, and
// readable once opened -- a coach picking up the phone wants the archetype and
// the tier, not a JSON blob.
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { LeadsBoard } from "@/components/admin/funnels/LeadsBoard"
import type { FunnelLead, QuizLeadOutcome } from "@/lib/db/funnel-leads"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

const ATTEMPT_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"

function lead(over: Partial<FunnelLead> = {}): FunnelLead {
  return {
    id: "lead-1",
    funnel_id: "f1",
    step_id: "s1",
    form_key: "optin",
    email: "sam@example.com",
    name: "Sam Athlete",
    phone: null,
    payload: { sport: "Soccer" },
    attribution_session_id: null,
    ip_address: null,
    user_agent: null,
    lead_user_id: null,
    created_at: new Date().toISOString(),
    status: "new",
    notes: null,
    status_changed_at: null,
    kind: "form",
    quiz_attempt_id: null,
    funnel_name: "Athlete Quiz",
    funnel_slug: "athlete-quiz",
    step_name: "Quiz",
    ...over,
  }
}

const quizLead = (over: Partial<FunnelLead> = {}) =>
  lead({
    id: "lead-2",
    kind: "quiz",
    quiz_attempt_id: ATTEMPT_ID,
    form_key: "rpi_athlete_quiz",
    payload: { "How many sessions a week?": "Three or four" },
    ...over,
  })

function board(leads: FunnelLead[], quizOutcomes: Record<string, QuizLeadOutcome> = {}) {
  return render(
    <LeadsBoard
      leads={leads}
      total={leads.length}
      counts={{ new: leads.length, contacted: 0, signed_up: 0 }}
      funnels={[{ id: "f1", name: "Athlete Quiz" }]}
      filters={{ funnelId: "", status: "", days: "", search: "" }}
      exportHref="/api/admin/funnels/leads/export"
      quizOutcomes={quizOutcomes}
    />,
  )
}

describe("LeadsBoard with quiz completions", () => {
  it("marks a quiz completion as one, in the row", () => {
    board([quizLead()])
    expect(screen.getByText("Quiz")).toBeTruthy()
  })

  it("does not mark a form fill as a quiz", () => {
    board([lead()])
    expect(screen.queryByText("Quiz")).toBeNull()
  })

  it("shows the result when the row is opened", () => {
    board([quizLead()], { [ATTEMPT_ID]: { score: 42, tierKey: "red", profileKey: "ceiling_breaker" } })
    fireEvent.click(screen.getByRole("button", { name: /Show Sam Athlete's answers/i }))
    expect(screen.getByText(/42/)).toBeTruthy()
    expect(screen.getByText(/\bRed\b/)).toBeTruthy()
    expect(screen.getByText(/Ceiling breaker/)).toBeTruthy()
  })

  it("opens cleanly when the result could not be read", () => {
    // The outcome read fails soft on the page. A lead whose score is missing
    // must still show WHO they are and WHAT they answered -- that is the part
    // somebody makes a phone call from.
    board([quizLead()], {})
    fireEvent.click(screen.getByRole("button", { name: /Show Sam Athlete's answers/i }))
    expect(screen.getByText("Three or four")).toBeTruthy()
    expect(screen.getByText(/could not be read/i)).toBeTruthy()
  })

  it("heads a quiz taker's answers with a sentence that fits a quiz", () => {
    board([quizLead()], {})
    fireEvent.click(screen.getByRole("button", { name: /Show Sam Athlete's answers/i }))
    expect(screen.getByText(/what they answered/i)).toBeTruthy()
  })

  it("still heads a form fill's answers with what they WROTE", () => {
    board([lead()])
    fireEvent.click(screen.getByRole("button", { name: /Show Sam Athlete's answers/i }))
    expect(screen.getByText(/what they wrote/i)).toBeTruthy()
  })

  it("shows no result line at all on a form fill -- neither branch of it", () => {
    // BOTH BRANCHES. A form fill has no attempt, so a result line rendered for
    // it would take the "could not be read" path -- which reads as a quiz lead
    // whose score is broken, on a lead that never took a quiz. Asserting only
    // the "Scored" half would let exactly that through.
    board([lead()], { [ATTEMPT_ID]: { score: 42, tierKey: "red", profileKey: "ceiling_breaker" } })
    fireEvent.click(screen.getByRole("button", { name: /Show Sam Athlete's answers/i }))
    expect(screen.queryByText(/Scored/i)).toBeNull()
    expect(screen.queryByText(/could not be read/i)).toBeNull()
  })

  it("tells a first-time owner that quizzes land here too", () => {
    board([])
    expect(screen.getByText(/finishes a quiz/i)).toBeTruthy()
  })
})
