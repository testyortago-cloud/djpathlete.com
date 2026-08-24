// @vitest-environment node
//
// The save API's structural half: adding and removing questions and options.
//
// The rule itself is tested against a filtering mock in
// __tests__/lib/quizzes/quiz-structural-save.test.ts. What this file asks is
// whether the ROUTE carries it — whether a refusal reaches the owner as
// something they can act on, whether a retirement is reported rather than
// passed off as a delete, and whether the gate still stands in front of a
// structural edit the way it stands in front of a content one.
//
// Spec: docs/superpowers/specs/2026-08-24-quiz-funnel-creator-design.md §5
import { describe, it, expect, beforeEach, vi } from "vitest"
import { QuizAnsweredOptionError } from "@/lib/db/quizzes"
import type { QuizDefinition } from "@/lib/quizzes/types"

const QUIZ_ID = "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9"
const Q_ROUTER = "11111111-1111-4111-8111-111111111111"
const O_TO_A = "11111111-1111-4111-8111-111111111112"
const O_TO_B = "11111111-1111-4111-8111-111111111113"
const Q_A1 = "22222222-2222-4222-8222-222222222221"
const O_A1 = "22222222-2222-4222-8222-222222222222"
const O_A2 = "22222222-2222-4222-8222-222222222223"
const Q_B1 = "33333333-3333-4333-8333-333333333331"
const O_B1 = "33333333-3333-4333-8333-333333333332"
const O_B2 = "33333333-3333-4333-8333-333333333333"
const Q_RETIRED = "55555555-5555-4555-8555-555555555551"
const O_RETIRED = "55555555-5555-4555-8555-555555555552"
const BRANCH_A = "44444444-4444-4444-8444-444444444441"
const BRANCH_B = "44444444-4444-4444-8444-444444444442"
const NEW_Q = "66666666-6666-4666-8666-666666666661"
const NEW_O1 = "66666666-6666-4666-8666-666666666662"
const NEW_O2 = "66666666-6666-4666-8666-666666666663"

/** A quiz that PASSES the gate. */
function healthy(): QuizDefinition {
  return {
    id: QUIZ_ID, key: "rpi", name: "RPI", status: "draft",
    introHeadline: "", introBody: "", gateHeadline: "", gateBody: "", resultHeadline: "",
    seedMarker: null,
    branches: [
      { id: BRANCH_A, quizId: QUIZ_ID, key: "alpha", name: "Alpha", description: null, position: 1 },
      { id: BRANCH_B, quizId: QUIZ_ID, key: "beta", name: "Beta", description: null, position: 2 },
    ],
    profiles: [{ id: "pf0", quizId: QUIZ_ID, key: "unsure", name: "Unsure", description: "d", position: 0 }],
    tiers: [{ id: "t1", quizId: QUIZ_ID, key: "red", position: 1, minScore: 0, maxScore: 100, headline: "h", body: "b", ctaLabel: null, ctaHref: null }],
    questions: [
      { id: Q_ROUTER, quizId: QUIZ_ID, branchId: null, position: 10, prompt: "Which?", helpText: null, isActive: true,
        options: [
          { id: O_TO_A, questionId: Q_ROUTER, position: 1, label: "A", weight: 0, routesToBranchId: BRANCH_A, profileId: "pf0" },
          { id: O_TO_B, questionId: Q_ROUTER, position: 2, label: "B", weight: 0, routesToBranchId: BRANCH_B, profileId: null },
        ] },
      { id: Q_A1, quizId: QUIZ_ID, branchId: BRANCH_A, position: 50, prompt: "Alpha", helpText: null, isActive: true,
        options: [
          { id: O_A1, questionId: Q_A1, position: 1, label: "Yes", weight: 3, routesToBranchId: null, profileId: null },
          { id: O_A2, questionId: Q_A1, position: 2, label: "No", weight: 0, routesToBranchId: null, profileId: null },
        ] },
      { id: Q_B1, quizId: QUIZ_ID, branchId: BRANCH_B, position: 50, prompt: "Beta", helpText: null, isActive: true,
        options: [
          { id: O_B1, questionId: Q_B1, position: 1, label: "Yes", weight: 3, routesToBranchId: null, profileId: null },
          { id: O_B2, questionId: Q_B1, position: 2, label: "No", weight: 0, routesToBranchId: null, profileId: null },
        ] },
    ],
  }
}

/** What the EDITOR read returns: the same quiz plus a retired question. */
function withRetired(): QuizDefinition {
  const definition = healthy()
  definition.questions.push({
    id: Q_RETIRED, quizId: QUIZ_ID, branchId: null, position: 20,
    prompt: "Retired", helpText: null, isActive: false,
    options: [{ id: O_RETIRED, questionId: Q_RETIRED, position: 1, label: "Only answer", weight: 0, routesToBranchId: null, profileId: null }],
  })
  return definition
}

/** The router's only two options gone — the gate refuses this. */
function noRouter(): QuizDefinition {
  const definition = healthy()
  definition.questions[0].options = []
  return definition
}

const auth = vi.fn()
const getQuizDefinition = vi.fn()
const getQuizDefinitionForEditor = vi.fn()
const saveQuizDefinition = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => auth() }))
vi.mock("@/lib/db/quizzes", async () => {
  // The error class is REAL, not a stub: the route matches on `instanceof`,
  // and a stubbed class would make that check pass or fail for the wrong
  // reason. Only the IO functions are replaced.
  const actual = await vi.importActual<typeof import("@/lib/db/quizzes")>("@/lib/db/quizzes")
  return {
    QuizAnsweredOptionError: actual.QuizAnsweredOptionError,
    getQuizDefinition: (...a: unknown[]) => getQuizDefinition(...a),
    getQuizDefinitionForEditor: (...a: unknown[]) => getQuizDefinitionForEditor(...a),
    saveQuizDefinition: (...a: unknown[]) => saveQuizDefinition(...a),
  }
})

async function patch(body: unknown, id = QUIZ_ID) {
  const { PATCH } = await import("@/app/api/admin/quizzes/[id]/route")
  return PATCH(
    new Request(`https://www.darrenjpaul.com/api/admin/quizzes/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  )
}

const NEW_QUESTION = {
  id: NEW_Q,
  branchId: BRANCH_A,
  position: 99,
  prompt: "How does the shoulder feel overhead?",
  helpText: null,
  isActive: false,
  options: [
    { id: NEW_O1, position: 1, label: "Option 1", weight: 0, routesToBranchId: null, profileId: null },
    { id: NEW_O2, position: 2, label: "Option 2", weight: 0, routesToBranchId: null, profileId: null },
  ],
}

beforeEach(() => {
  vi.resetAllMocks()
  auth.mockResolvedValue({ user: { role: "admin" } })
  getQuizDefinition.mockResolvedValue(healthy())
  getQuizDefinitionForEditor.mockResolvedValue(withRetired())
  saveQuizDefinition.mockResolvedValue({ retiredQuestionIds: [] })
})

describe("PATCH /api/admin/quizzes/[id] — structural edits", () => {
  it("passes a new question and its options through to the save", async () => {
    const res = await patch({ addQuestions: [NEW_QUESTION] })
    expect(res.status).toBe(200)
    expect(saveQuizDefinition.mock.calls[0][0]).toMatchObject({ quizId: QUIZ_ID, addQuestions: [NEW_QUESTION] })
  })

  it("passes deletions through", async () => {
    await patch({ deleteQuestionIds: [Q_A1], deleteOptionIds: [O_A2] })
    expect(saveQuizDefinition.mock.calls[0][0]).toMatchObject({
      deleteQuestionIds: [Q_A1],
      deleteOptionIds: [O_A2],
    })
  })

  it("answers 400 and says what to do when an answered option cannot be removed", async () => {
    saveQuizDefinition.mockRejectedValue(
      new QuizAnsweredOptionError([O_A1], "Somebody has already picked that answer, so it cannot be removed."),
    )
    const res = await patch({ deleteOptionIds: [O_A1] })
    // MUTANT KILLED: let it escape as a 500. The owner is told the save
    // failed, with nothing naming the field or the way out.
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/already picked/i)
  })

  it("reports a retirement rather than passing it off as a delete", async () => {
    saveQuizDefinition.mockResolvedValue({ retiredQuestionIds: [Q_ROUTER] })
    const res = await patch({ deleteQuestionIds: [Q_ROUTER] })
    // MUTANT KILLED: drop retiredQuestionIds from the response. The question
    // disappears from the editor and the owner is never told it still exists.
    expect((await res.json()).retiredQuestionIds).toEqual([Q_ROUTER])
  })

  it("returns the definition the EDITOR needs, inactive questions included", async () => {
    // MUTANT KILLED: return `getQuizDefinition`. The question just retired
    // vanishes with no way back, and a question added switched-off disappears
    // the moment it is saved.
    const res = await patch({ addQuestions: [NEW_QUESTION] })
    const json = (await res.json()) as { quiz: QuizDefinition }
    expect(json.quiz.questions.map((question) => question.id)).toContain(Q_RETIRED)
  })

  it("still gates the quiz AS SAVED, not as it was", async () => {
    // The gate must read the post-save state through the same read it always
    // did. A structural edit does not change that argument.
    getQuizDefinition.mockResolvedValueOnce(healthy()).mockResolvedValueOnce(noRouter())
    const res = await patch({ quiz: { status: "active" }, deleteOptionIds: [O_TO_A, O_TO_B] })
    expect(res.status).toBe(409)
    expect((await res.json()).blockers.join(" | ")).toMatch(/router/i)
  })

  it("keeps the content edits when the gate refuses the activation", async () => {
    getQuizDefinition.mockResolvedValueOnce(healthy()).mockResolvedValueOnce(noRouter())
    await patch({ quiz: { status: "active", name: "Renamed" }, addQuestions: [NEW_QUESTION] })
    // Losing somebody's morning of copy because their last change did not yet
    // satisfy the gate would be its own bug. The save runs; only the flip does not.
    expect(saveQuizDefinition.mock.calls[0][0]).toMatchObject({ quiz: { name: "Renamed" } })
    const statusWrites = saveQuizDefinition.mock.calls.filter(
      (call) => (call[0] as { quiz?: { status?: string } })?.quiz?.status,
    )
    expect(statusWrites).toHaveLength(0)
  })

  it("refuses a structural payload from anybody who is not an admin", async () => {
    auth.mockResolvedValue({ user: { role: "client" } })
    const res = await patch({ deleteQuestionIds: [Q_A1] })
    // 404 rather than 403 — the route does not confirm what exists to a
    // stranger. Same gate shape as the funnel preview routes.
    expect(res.status).toBe(404)
    expect(saveQuizDefinition).not.toHaveBeenCalled()
  })

  it("refuses a question id that is not a uuid", async () => {
    const res = await patch({ deleteQuestionIds: ["not-a-uuid"] })
    expect(res.status).toBe(400)
    expect(saveQuizDefinition).not.toHaveBeenCalled()
  })

  it("refuses a new question with no options at all", async () => {
    // Two is what the gate requires of an ACTIVE question. Accepting zero here
    // would let the editor create a question that can never be turned on and
    // whose only symptom is a blocker the owner cannot act on.
    const res = await patch({ addQuestions: [{ ...NEW_QUESTION, options: [] }] })
    expect(res.status).toBe(400)
  })
})
