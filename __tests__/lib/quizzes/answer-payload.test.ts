// The leads inbox renders `funnel_submissions.payload` as a definition list of
// key -> value, and 00204's comment is explicit that payload is the VISITOR's
// answers verbatim. So a quiz completion's payload is what they were ASKED and
// what they PICKED -- not the score, which is ours and lives on the attempt.
//
// No mocks: types only, like `scoreQuiz` and `quizGate`.
import { describe, expect, it } from "vitest"
import { quizAnswerPayload } from "@/lib/quizzes/answer-payload"
import type { QuizDefinition, QuizQuestion } from "@/lib/quizzes/types"

const QUIZ_ID = "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9"
const Q1 = "11111111-1111-4111-8111-111111111111"
const Q1_A = "11111111-1111-4111-8111-111111111112"
const Q2 = "22222222-2222-4222-8222-222222222221"
const Q2_A = "22222222-2222-4222-8222-222222222222"
const Q3 = "33333333-3333-4333-8333-333333333331"
const Q3_A = "33333333-3333-4333-8333-333333333332"

function question(id: string, position: number, prompt: string, optionId: string, label: string): QuizQuestion {
  return {
    id,
    quizId: QUIZ_ID,
    branchId: null,
    position,
    prompt,
    helpText: null,
    isActive: true,
    options: [{ id: optionId, questionId: id, position: 1, label, weight: 1, routesToBranchId: null, profileId: null }],
  }
}

function definition(questions: QuizQuestion[]): QuizDefinition {
  return {
    id: QUIZ_ID,
    key: "rpi_athlete_quiz",
    name: "RPI",
    status: "active",
    introHeadline: "",
    introBody: "",
    gateHeadline: "",
    gateBody: "",
    resultHeadline: "",
    seedMarker: null,
    branches: [],
    profiles: [],
    tiers: [],
    questions,
  }
}

describe("quizAnswerPayload", () => {
  it("keys each answer by the question the visitor was asked", () => {
    const def = definition([question(Q1, 10, "How many sessions a week?", Q1_A, "Three or four")])
    expect(quizAnswerPayload(def, [{ questionId: Q1, optionId: Q1_A }])).toEqual({
      "How many sessions a week?": "Three or four",
    })
  })

  it("orders the entries by question position, not by answer order", () => {
    // A branching quiz's answers arrive in walk order, and the walk interleaves
    // the shared questions with the branch's own. The transcript should read
    // top to bottom the way the quiz did. The definition here is deliberately
    // OUT of position order too, so neither input order can flatter the test.
    const def = definition([
      question(Q2, 20, "Second", Q2_A, "B"),
      question(Q3, 30, "Third", Q3_A, "C"),
      question(Q1, 10, "First", Q1_A, "A"),
    ])
    const payload = quizAnswerPayload(def, [
      { questionId: Q3, optionId: Q3_A },
      { questionId: Q1, optionId: Q1_A },
      { questionId: Q2, optionId: Q2_A },
    ])
    expect(Object.keys(payload)).toEqual(["First", "Second", "Third"])
  })

  it("drops an answer whose question is not in the definition", () => {
    const def = definition([question(Q1, 10, "First", Q1_A, "A")])
    expect(quizAnswerPayload(def, [{ questionId: Q2, optionId: Q2_A }])).toEqual({})
  })

  it("drops an answer whose option does not belong to that question", () => {
    const def = definition([question(Q1, 10, "First", Q1_A, "A"), question(Q2, 20, "Second", Q2_A, "B")])
    expect(quizAnswerPayload(def, [{ questionId: Q1, optionId: Q2_A }])).toEqual({})
  })

  it("keeps both answers when two questions share a prompt", () => {
    // Two questions CAN carry the same words -- the same question asked of two
    // archetypes is the obvious case. Collapsing them would silently drop one
    // of the visitor's answers from the record of what they said.
    const def = definition([question(Q1, 10, "Same words", Q1_A, "A"), question(Q2, 20, "Same words", Q2_A, "B")])
    const payload = quizAnswerPayload(def, [
      { questionId: Q1, optionId: Q1_A },
      { questionId: Q2, optionId: Q2_A },
    ])
    expect(Object.values(payload).sort()).toEqual(["A", "B"])
    expect(Object.keys(payload)).toHaveLength(2)
  })

  it("includes a question that has since been retired", () => {
    // They answered it. Hiding it because the owner later switched the
    // question off would rewrite the record of the conversation.
    const retired: QuizQuestion = { ...question(Q1, 10, "Retired one", Q1_A, "A"), isActive: false }
    expect(quizAnswerPayload(definition([retired]), [{ questionId: Q1, optionId: Q1_A }])).toEqual({
      "Retired one": "A",
    })
  })

  it("answers {} for no answers at all", () => {
    expect(quizAnswerPayload(definition([question(Q1, 10, "First", Q1_A, "A")]), [])).toEqual({})
  })
})
