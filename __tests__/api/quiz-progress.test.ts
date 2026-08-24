// @vitest-environment node
//
// Route-level tests for POST /api/quiz/progress.
//
// `@/lib/db/quizzes` is mocked so the CALL SHAPE is observable — "the second
// call updated THAT attempt id" is the assertion the plan asks for, and "it
// did not throw" would pass even if the route created a second row. The pure
// modules (`sanitiseAnswers`) run for real: they are the thing deciding what
// gets stored, and stubbing them would make every sanitisation test vacuous.
//
// Spec: docs/superpowers/specs/2026-08-23-athlete-quiz-funnel-design.md §4.2
import fs from "node:fs"
import path from "node:path"
import { describe, it, expect, beforeEach, vi } from "vitest"
import type { QuizDefinition } from "@/lib/quizzes/types"

const QUIZ_ID = "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9"
const ATTEMPT_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
const Q_ROUTER = "11111111-1111-4111-8111-111111111111"
const O_TO_A = "11111111-1111-4111-8111-111111111112"
const O_TO_B = "11111111-1111-4111-8111-111111111113"
const Q_A1 = "22222222-2222-4222-8222-222222222221"
const O_A1_BEST = "22222222-2222-4222-8222-222222222222"
const Q_OTHER = "33333333-3333-4333-8333-333333333331"
const O_OTHER = "33333333-3333-4333-8333-333333333332"
const BRANCH_A = "44444444-4444-4444-8444-444444444441"
const BRANCH_B = "44444444-4444-4444-8444-444444444442"

function definition(status = "active"): QuizDefinition {
  return {
    id: QUIZ_ID,
    key: "rpi",
    name: "RPI",
    status: status as QuizDefinition["status"],
    introHeadline: "",
    introBody: "",
    gateHeadline: "",
    gateBody: "",
    resultHeadline: "",
    seedMarker: null,
    branches: [
      { id: BRANCH_A, quizId: QUIZ_ID, key: "alpha", name: "Alpha", description: null, position: 1 },
      { id: BRANCH_B, quizId: QUIZ_ID, key: "beta", name: "Beta", description: null, position: 2 },
    ],
    profiles: [],
    tiers: [],
    questions: [
      {
        id: Q_ROUTER,
        quizId: QUIZ_ID,
        branchId: null,
        position: 10,
        prompt: "Which describes you?",
        helpText: null,
        isActive: true,
        options: [
          { id: O_TO_A, questionId: Q_ROUTER, position: 1, label: "A", weight: 0, routesToBranchId: BRANCH_A, profileId: null },
          { id: O_TO_B, questionId: Q_ROUTER, position: 2, label: "B", weight: 0, routesToBranchId: BRANCH_B, profileId: null },
        ],
      },
      {
        id: Q_A1,
        quizId: QUIZ_ID,
        branchId: BRANCH_A,
        position: 50,
        prompt: "Alpha one",
        helpText: null,
        isActive: true,
        options: [
          { id: O_A1_BEST, questionId: Q_A1, position: 1, label: "Best", weight: 3, routesToBranchId: null, profileId: null },
        ],
      },
      {
        id: Q_OTHER,
        quizId: QUIZ_ID,
        branchId: BRANCH_B,
        position: 60,
        prompt: "Beta one",
        helpText: null,
        isActive: true,
        options: [
          { id: O_OTHER, questionId: Q_OTHER, position: 1, label: "Other", weight: 3, routesToBranchId: null, profileId: null },
        ],
      },
    ],
  }
}

const getQuizDefinition = vi.fn()
const createAttempt = vi.fn()
const saveAttemptProgress = vi.fn()
const getAttempt = vi.fn()

vi.mock("@/lib/db/quizzes", () => ({
  getQuizDefinition: (...a: unknown[]) => getQuizDefinition(...a),
  createAttempt: (...a: unknown[]) => createAttempt(...a),
  saveAttemptProgress: (...a: unknown[]) => saveAttemptProgress(...a),
  getAttempt: (...a: unknown[]) => getAttempt(...a),
}))

async function post(body: unknown, ip = "1.2.3.4") {
  const { POST } = await import("@/app/api/quiz/progress/route")
  return POST(
    new Request("https://www.darrenjpaul.com/api/quiz/progress", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  )
}

let ipCounter = 0
const freshIp = () => `10.0.0.${++ipCounter % 200}`

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: a queued *Once implementation left by a
  // previous test leaks across boundaries and misattributes the failure.
  vi.resetAllMocks()
  getQuizDefinition.mockResolvedValue(definition())
  createAttempt.mockResolvedValue(ATTEMPT_ID)
  saveAttemptProgress.mockResolvedValue(undefined)
  getAttempt.mockResolvedValue({ id: ATTEMPT_ID, quizId: QUIZ_ID, branchId: null, status: "in_progress", answers: [] })
})

describe("POST /api/quiz/progress", () => {
  it("1. creates a row on a first call with no attemptId, and returns its id", async () => {
    const res = await post({ quizId: QUIZ_ID, answers: [{ questionId: Q_ROUTER, optionId: O_TO_A }] }, freshIp())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ attemptId: ATTEMPT_ID })
    expect(createAttempt).toHaveBeenCalledTimes(1)
  })

  it("2. updates THAT row on a second call, rather than creating another", async () => {
    await post({ quizId: QUIZ_ID, attemptId: ATTEMPT_ID, answers: [{ questionId: Q_ROUTER, optionId: O_TO_A }] }, freshIp())
    expect(createAttempt).not.toHaveBeenCalled()
    // The id is asserted, not merely that a save happened: "it did not throw"
    // passes just as happily when the route writes to the wrong attempt.
    expect(saveAttemptProgress).toHaveBeenCalledWith(expect.objectContaining({ attemptId: ATTEMPT_ID }))
  })

  it("3. drops an option that is not on the named question, and never stores it", async () => {
    await post(
      { quizId: QUIZ_ID, answers: [{ questionId: Q_A1, optionId: O_OTHER }] },
      freshIp(),
    )
    expect(saveAttemptProgress).toHaveBeenCalledWith(expect.objectContaining({ answers: [] }))
  })

  it("4. drops an answer to a question that is not in this quiz", async () => {
    await post(
      { quizId: QUIZ_ID, answers: [{ questionId: "99999999-9999-4999-8999-999999999999", optionId: O_A1_BEST }] },
      freshIp(),
    )
    expect(saveAttemptProgress).toHaveBeenCalledWith(expect.objectContaining({ answers: [] }))
  })

  it("5. refuses further progress on a completed attempt", async () => {
    getAttempt.mockResolvedValue({ id: ATTEMPT_ID, quizId: QUIZ_ID, branchId: null, status: "completed", answers: [] })
    const res = await post({ quizId: QUIZ_ID, attemptId: ATTEMPT_ID, answers: [] }, freshIp())
    expect(res.status).toBe(409)
    expect(saveAttemptProgress).not.toHaveBeenCalled()
  })

  it("6. 404s when the quiz is not active", async () => {
    getQuizDefinition.mockResolvedValue(definition("draft"))
    const res = await post({ quizId: QUIZ_ID, answers: [] }, freshIp())
    expect(res.status).toBe(404)
    expect(createAttempt).not.toHaveBeenCalled()
  })

  it("6b. 404s when the quiz does not exist", async () => {
    getQuizDefinition.mockResolvedValue(null)
    expect((await post({ quizId: QUIZ_ID, answers: [] }, freshIp())).status).toBe(404)
  })

  it("7. throttles a single IP once it is over the window's limit", async () => {
    const ip = freshIp()
    let last = 200
    // The limit is 40 — one post per question for a dozen questions must NOT
    // trip it, so the throttle is asserted well above a real walk's length.
    for (let i = 0; i < 45; i++) {
      last = (await post({ quizId: QUIZ_ID, answers: [] }, ip)).status
    }
    expect(last).toBe(429)
  })

  it("7b. does not throttle a legitimate twelve-question walk", async () => {
    const ip = freshIp()
    let last = 200
    for (let i = 0; i < 12; i++) last = (await post({ quizId: QUIZ_ID, answers: [] }, ip)).status
    expect(last).toBe(200)
  })

  it("has NOWHERE for the client to name a branch — asserted on the source", () => {
    // The behavioural test below cannot see this on its own: Zod strips
    // unknown keys, so a body carrying `branchId` is already gone by the time
    // the handler runs, and a mutation that reads `body.branchId` SURVIVES.
    // What actually guarantees the property is that neither the schema nor the
    // handler ever mentions it, so that is what is asserted.
    const source = fs.readFileSync(
      path.join(process.cwd(), "app", "api", "quiz", "progress", "route.ts"),
      "utf8",
    )
    expect(source).not.toMatch(/body\.branchId/)
    expect(source).not.toMatch(/branchId:\s*z\./)
  })

  it("derives the branch from the router ANSWER, never from the body", async () => {
    await post(
      {
        quizId: QUIZ_ID,
        // A body field naming the other branch. There is nowhere for it to go.
        branchId: BRANCH_B,
        answers: [{ questionId: Q_ROUTER, optionId: O_TO_A }],
      },
      freshIp(),
    )
    expect(saveAttemptProgress).toHaveBeenCalledWith(expect.objectContaining({ branchId: BRANCH_A }))
  })

  it("refuses an attemptId belonging to a different quiz", async () => {
    getAttempt.mockResolvedValue({ id: ATTEMPT_ID, quizId: "other", branchId: null, status: "in_progress", answers: [] })
    const res = await post({ quizId: QUIZ_ID, attemptId: ATTEMPT_ID, answers: [] }, freshIp())
    expect(res.status).toBe(404)
    expect(saveAttemptProgress).not.toHaveBeenCalled()
  })
})
