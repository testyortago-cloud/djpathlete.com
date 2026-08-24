// The editor's add, remove and restore.
//
// Every test here asks what the SAVE PAYLOAD says, not what the screen shows,
// because the screen showing a new question is worth nothing if the request
// never carries it. The one exception is the retired group, which is a claim
// about the screen.
//
// Spec: docs/superpowers/specs/2026-08-24-quiz-funnel-creator-design.md §5
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { QuizEditor } from "@/components/admin/quizzes/QuizEditor"
import type { QuizDefinition } from "@/lib/quizzes/types"

const QUIZ_ID = "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9"
const BRANCH_A = "44444444-4444-4444-8444-444444444441"
const Q_ROUTER = "11111111-1111-4111-8111-111111111111"
const Q_A1 = "22222222-2222-4222-8222-222222222221"
const Q_RETIRED = "55555555-5555-4555-8555-555555555551"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

function definition(): QuizDefinition {
  return {
    id: QUIZ_ID, key: "rpi", name: "RPI", status: "draft",
    introHeadline: "", introBody: "", gateHeadline: "", gateBody: "", resultHeadline: "",
    seedMarker: null,
    branches: [{ id: BRANCH_A, quizId: QUIZ_ID, key: "alpha", name: "Alpha", description: null, position: 1 }],
    profiles: [{ id: "pf0", quizId: QUIZ_ID, key: "unsure", name: "Unsure", description: "d", position: 0 }],
    tiers: [{ id: "t1", quizId: QUIZ_ID, key: "red", position: 1, minScore: 0, maxScore: 100, headline: "h", body: "b", ctaLabel: null, ctaHref: null }],
    questions: [
      { id: Q_ROUTER, quizId: QUIZ_ID, branchId: null, position: 10, prompt: "Which describes you?", helpText: null, isActive: true,
        options: [
          { id: "o1", questionId: Q_ROUTER, position: 1, label: "A", weight: 0, routesToBranchId: BRANCH_A, profileId: null },
          { id: "o2", questionId: Q_ROUTER, position: 2, label: "B", weight: 0, routesToBranchId: BRANCH_A, profileId: null },
        ] },
      { id: Q_A1, quizId: QUIZ_ID, branchId: BRANCH_A, position: 50, prompt: "Alpha question", helpText: null, isActive: true,
        options: [
          { id: "o3", questionId: Q_A1, position: 1, label: "Yes", weight: 3, routesToBranchId: null, profileId: null },
          { id: "o4", questionId: Q_A1, position: 2, label: "No", weight: 0, routesToBranchId: null, profileId: null },
        ] },
    ],
  }
}

function withRetired(): QuizDefinition {
  const quiz = definition()
  quiz.questions.push({
    id: Q_RETIRED, quizId: QUIZ_ID, branchId: null, position: 20,
    prompt: "A question somebody already answered", helpText: null, isActive: false,
    options: [{ id: "o9", questionId: Q_RETIRED, position: 1, label: "Only answer", weight: 0, routesToBranchId: null, profileId: null }],
  })
  return quiz
}

let saveResponse: Record<string, unknown>

beforeEach(() => {
  vi.resetAllMocks()
  saveResponse = { ok: true, gate: { ok: true, blockers: [], warnings: [] }, quiz: definition(), retiredQuestionIds: [] }
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => saveResponse,
  })) as unknown as typeof fetch
})

/** The PATCH body the editor last sent. */
function body() {
  const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
  const call = fetchMock.mock.calls.at(-1)!
  return JSON.parse((call[1] as RequestInit).body as string)
}

function openQuestions() {
  fireEvent.click(screen.getByRole("button", { name: "Questions" }))
}

function save() {
  fireEvent.click(screen.getByRole("button", { name: "Save" }))
}

describe("QuizEditor — adding", () => {
  it("adds the question to the branch group that is open", async () => {
    render(<QuizEditor initial={definition()} />)
    openQuestions()
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }))
    fireEvent.click(screen.getByRole("button", { name: /add a question/i }))
    save()
    // MUTANT KILLED: always add to the shared group (branchId null). The owner
    // adds a question while looking at Alpha and it appears under Everyone.
    await waitFor(() => expect(body().addQuestions[0].branchId).toBe(BRANCH_A))
  })

  it("adds to the shared group from the Everyone tab", async () => {
    render(<QuizEditor initial={definition()} />)
    openQuestions()
    fireEvent.click(screen.getByRole("button", { name: /add a question/i }))
    save()
    await waitFor(() => expect(body().addQuestions[0].branchId).toBeNull())
  })

  it("gives a new question two options, so it can pass the gate once turned on", async () => {
    render(<QuizEditor initial={definition()} />)
    openQuestions()
    fireEvent.click(screen.getByRole("button", { name: /add a question/i }))
    save()
    // The route refuses fewer than two, matching the gate's own floor.
    await waitFor(() => expect(body().addQuestions[0].options).toHaveLength(2))
  })

  it("adds it switched off, so a half-typed question cannot reach a visitor", async () => {
    render(<QuizEditor initial={definition()} />)
    openQuestions()
    fireEvent.click(screen.getByRole("button", { name: /add a question/i }))
    save()
    // MUTANT KILLED: isActive true. Editing a LIVE quiz would put a question
    // reading "Option 1" in front of the next person who takes it.
    await waitFor(() => expect(body().addQuestions[0].isActive).toBe(false))
  })

  it("puts the new question after every existing one", async () => {
    render(<QuizEditor initial={definition()} />)
    openQuestions()
    fireEvent.click(screen.getByRole("button", { name: /add a question/i }))
    save()
    // Position is GLOBAL across the quiz, not per branch — so max() must be
    // taken over every question, not over the visible group.
    await waitFor(() => expect(body().addQuestions[0].position).toBeGreaterThan(50))
  })

  it("does not send a new row in the update list as well", async () => {
    render(<QuizEditor initial={definition()} />)
    openQuestions()
    fireEvent.click(screen.getByRole("button", { name: /add a question/i }))
    save()
    // MUTANT KILLED: send every question in `questions` too. The server would
    // insert the row and then update a row it had just inserted — harmless
    // today, and an update of a row the insert may have rejected tomorrow.
    await waitFor(() => {
      const newId = body().addQuestions[0].id
      expect(body().questions.map((q: { id: string }) => q.id)).not.toContain(newId)
    })
  })

  it("adds an option to an existing question", async () => {
    render(<QuizEditor initial={definition()} />)
    openQuestions()
    fireEvent.click(screen.getAllByRole("button", { name: /add an answer/i })[0])
    save()
    await waitFor(() => expect(body().addOptions[0].questionId).toBe(Q_ROUTER))
  })
})

describe("QuizEditor — removing", () => {
  it("sends a delete for an existing question", async () => {
    render(<QuizEditor initial={definition()} />)
    openQuestions()
    fireEvent.click(screen.getAllByRole("button", { name: /remove this question/i })[0])
    save()
    await waitFor(() => expect(body().deleteQuestionIds).toEqual([Q_ROUTER]))
  })

  it("stops sending an existing question in the update list once it is removed", async () => {
    render(<QuizEditor initial={definition()} />)
    openQuestions()
    fireEvent.click(screen.getAllByRole("button", { name: /remove this question/i })[0])
    save()
    await waitFor(() => expect(body().questions.map((q: { id: string }) => q.id)).not.toContain(Q_ROUTER))
  })

  it("sends nothing at all for a question added and removed before saving", async () => {
    render(<QuizEditor initial={definition()} />)
    openQuestions()
    fireEvent.click(screen.getByRole("button", { name: /add a question/i }))
    fireEvent.click(screen.getAllByRole("button", { name: /remove this question/i }).at(-1)!)
    save()
    // MUTANT KILLED: record the delete regardless. The server is asked to
    // delete a row that was never inserted — a uuid it has never seen.
    await waitFor(() => {
      expect(body().addQuestions ?? []).toHaveLength(0)
      expect(body().deleteQuestionIds ?? []).toHaveLength(0)
    })
  })

  it("sends a delete for an option", async () => {
    render(<QuizEditor initial={definition()} />)
    openQuestions()
    fireEvent.click(screen.getAllByRole("button", { name: /remove this answer/i })[0])
    save()
    await waitFor(() => expect(body().deleteOptionIds).toEqual(["o1"]))
  })
})

describe("QuizEditor — retired questions", () => {
  it("shows a retired question apart from the live ones, and says so", async () => {
    render(<QuizEditor initial={withRetired()} />)
    openQuestions()
    expect(screen.getByText(/retired/i)).toBeTruthy()
    expect(screen.getByText("A question somebody already answered")).toBeTruthy()
  })

  it("does not number a retired question among the live ones", async () => {
    // MUTANT KILLED: render inactive questions inline. "Question 2" becomes
    // one nobody is being asked, and the numbering stops matching the walk.
    render(<QuizEditor initial={withRetired()} />)
    openQuestions()
    const live = screen.getByTestId("live-questions")
    expect(within(live).queryByText("A question somebody already answered")).toBeNull()
  })

  it("brings one back", async () => {
    render(<QuizEditor initial={withRetired()} />)
    openQuestions()
    fireEvent.click(screen.getByRole("button", { name: /bring this question back/i }))
    save()
    await waitFor(() =>
      expect(body().questions.find((q: { id: string }) => q.id === Q_RETIRED).isActive).toBe(true),
    )
  })

  it("says what happened when the server retired instead of deleting", async () => {
    saveResponse = { ...saveResponse, retiredQuestionIds: [Q_ROUTER], quiz: withRetired() }
    render(<QuizEditor initial={definition()} />)
    openQuestions()
    fireEvent.click(screen.getAllByRole("button", { name: /remove this question/i })[0])
    save()
    // MUTANT KILLED: report "Saved." either way. The owner asked for a delete,
    // was given a retirement, and is never told the difference.
    expect(await screen.findByText(/retired rather than removed/i)).toBeTruthy()
  })

  it("shows the refusal the server sends back for an answered option", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: "Somebody has already picked that answer, so it cannot be removed." }),
    })) as unknown as typeof fetch
    render(<QuizEditor initial={definition()} />)
    openQuestions()
    fireEvent.click(screen.getAllByRole("button", { name: /remove this answer/i })[0])
    save()
    expect(await screen.findByText(/already picked that answer/i)).toBeTruthy()
  })

  it("keeps the removal pending after a refusal, so the owner can undo it themselves", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: "Somebody has already picked that answer, so it cannot be removed." }),
    })) as unknown as typeof fetch
    render(<QuizEditor initial={definition()} />)
    openQuestions()
    fireEvent.click(screen.getAllByRole("button", { name: /remove this answer/i })[0])
    save()
    await screen.findByText(/already picked that answer/i)
    // MUTANT KILLED: clear the pending sets on a failed save. The refusal is
    // shown, the local edit is silently reverted, and the next save is a
    // no-op the owner cannot explain.
    save()
    await waitFor(() => expect(body().deleteOptionIds).toEqual(["o1"]))
  })
})

describe("QuizEditor — not live yet is not the same as retired", () => {
  it("keeps a newly added question with the ones being worked on", async () => {
    // MUTANT KILLED: group by `isActive` alone. A question added a second ago
    // appears under a heading reading "Retired", which is both wrong and
    // alarming — and its Remove button is then in the wrong group, which is
    // how this was found.
    render(<QuizEditor initial={withRetired()} />)
    openQuestions()
    fireEvent.click(screen.getByRole("button", { name: /add a question/i }))
    const live = screen.getByTestId("live-questions")
    expect(within(live).getByText(/not live yet/i)).toBeTruthy()
    const retired = screen.getByTestId("retired-questions")
    expect(within(retired).queryByText(/not live yet/i)).toBeNull()
  })

  it("turns a new question on, and sends it on", async () => {
    render(<QuizEditor initial={definition()} />)
    openQuestions()
    fireEvent.click(screen.getByRole("button", { name: /add a question/i }))
    fireEvent.click(screen.getByRole("button", { name: /turn this question on/i }))
    save()
    await waitFor(() => expect(body().addQuestions[0].isActive).toBe(true))
  })

  it("turns an existing question off without removing it", async () => {
    render(<QuizEditor initial={definition()} />)
    openQuestions()
    fireEvent.click(screen.getAllByRole("button", { name: /turn this question off/i })[0])
    save()
    await waitFor(() => {
      expect(body().deleteQuestionIds ?? []).toHaveLength(0)
      expect(body().questions.find((q: { id: string }) => q.id === Q_ROUTER).isActive).toBe(false)
    })
  })
})

describe("QuizEditor — after the save", () => {
  it("shows the retired question straight away, without a reload", async () => {
    // MUTANT KILLED: keep local state instead of adopting the server's. Local
    // state asked for a DELETE, so it has already dropped the question — the
    // owner is told it was retired and then cannot see it anywhere. Only the
    // server's own editor read knows it is still there.
    saveResponse = { ...saveResponse, retiredQuestionIds: [Q_ROUTER], quiz: withRetired() }
    render(<QuizEditor initial={definition()} />)
    openQuestions()
    expect(screen.queryByTestId("retired-questions")).toBeNull()
    fireEvent.click(screen.getAllByRole("button", { name: /remove this question/i })[0])
    save()
    const retired = await screen.findByTestId("retired-questions")
    expect(within(retired).getByText("A question somebody already answered")).toBeTruthy()
  })
})
