// @vitest-environment node
//
// POST /api/quiz/preview-submit — a test run that scores and writes nothing.
//
// Same shape as __tests__/app/api/funnels/preview-submit.test.ts, including
// its closing source assertion: a spy proves only that THIS request did not
// write, never that the route cannot.
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/quizzes", () => ({ getQuizDefinition: vi.fn() }))

import { POST } from "@/app/api/quiz/preview-submit/route"
import { auth } from "@/lib/auth"
import { getQuizDefinition } from "@/lib/db/quizzes"
import type { QuizDefinition } from "@/lib/quizzes/types"

const QUIZ_ID = "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9"
const Q_ROUTER = "11111111-1111-4111-8111-111111111111"
const O_TO_A = "11111111-1111-4111-8111-111111111112"
const Q_A1 = "22222222-2222-4222-8222-222222222221"
const O_BEST = "22222222-2222-4222-8222-222222222222"
const BRANCH_A = "44444444-4444-4444-8444-444444444441"

/** DRAFT on purpose — the live route refuses this, and that is the point. */
function draftDefinition(): QuizDefinition {
  return {
    id: QUIZ_ID, key: "rpi", name: "RPI", status: "draft",
    introHeadline: "", introBody: "", gateHeadline: "", gateBody: "", resultHeadline: "",
    seedMarker: null,
    branches: [{ id: BRANCH_A, quizId: QUIZ_ID, key: "ceiling_breaker", name: "Ceiling Breaker", description: null, position: 1 }],
    profiles: [{ id: "pf0", quizId: QUIZ_ID, key: "not_sure", name: "Not sure", description: "d", position: 0 }],
    tiers: [{ id: "t2", quizId: QUIZ_ID, key: "green", position: 1, minScore: 0, maxScore: 100, headline: "Well prepared", body: "b", ctaLabel: null, ctaHref: null }],
    questions: [
      { id: Q_ROUTER, quizId: QUIZ_ID, branchId: null, position: 10, prompt: "Which?", helpText: null, isActive: true,
        options: [{ id: O_TO_A, questionId: Q_ROUTER, position: 1, label: "A", weight: 0, routesToBranchId: BRANCH_A, profileId: null }] },
      { id: Q_A1, quizId: QUIZ_ID, branchId: BRANCH_A, position: 50, prompt: "How?", helpText: null, isActive: true,
        options: [{ id: O_BEST, questionId: Q_A1, position: 1, label: "Great", weight: 3, routesToBranchId: null, profileId: null }] },
    ],
  }
}

function post(body: unknown) {
  return POST(
    new Request("https://www.darrenjpaul.com/api/quiz/preview-submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({ user: { role: "admin" } } as never)
  vi.mocked(getQuizDefinition).mockResolvedValue(draftDefinition())
})

describe("POST /api/quiz/preview-submit", () => {
  it("1. scores against a DRAFT definition — the case the live route refuses", async () => {
    const res = await post({
      quizId: QUIZ_ID,
      answers: [{ questionId: Q_ROUTER, optionId: O_TO_A }, { questionId: Q_A1, optionId: O_BEST }],
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.testRun).toBe(true)
    expect(json.score).toBe(100)
    expect(json.tier.key).toBe("green")
    expect(json.branch.key).toBe("ceiling_breaker")
  })

  it("3. 404s for an anonymous request", async () => {
    vi.mocked(auth).mockResolvedValue(null as never)
    expect((await post({ quizId: QUIZ_ID, answers: [] })).status).toBe(404)
    expect(getQuizDefinition).not.toHaveBeenCalled()
  })

  it("3b. 404s for a signed-in CLIENT — staff and admin only", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { role: "client" } } as never)
    expect((await post({ quizId: QUIZ_ID, answers: [] })).status).toBe(404)
    expect(getQuizDefinition).not.toHaveBeenCalled()
  })

  it("3c. allows staff", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { role: "staff" } } as never)
    expect((await post({ quizId: QUIZ_ID, answers: [] })).status).toBe(200)
  })

  it("still drops a forged option, so the preview does not flatter the page", async () => {
    const res = await post({ quizId: QUIZ_ID, answers: [{ questionId: Q_ROUTER, optionId: O_BEST }] })
    // O_BEST belongs to Q_A1: no branch is derived and nothing is scored.
    expect((await res.json()).branch).toBeNull()
  })

  it("404s for a quiz that does not exist", async () => {
    vi.mocked(getQuizDefinition).mockResolvedValue(null)
    expect((await post({ quizId: QUIZ_ID, answers: [] })).status).toBe(404)
  })
})

describe("it writes nothing — the whole reason this route exists", () => {
  it("2. does not reference a single write path", async () => {
    // MUTANT KILLED: someone adding createAttempt "so the owner can see the
    // test run in the report". The module SOURCE is the assertion — a spy
    // would only prove this request did not write, not that the route cannot.
    const { readFile } = await import("node:fs/promises")
    const source = await readFile("app/api/quiz/preview-submit/route.ts", "utf8")
    for (const forbidden of [
      "createAttempt",
      "saveAttemptProgress",
      "completeAttempt",
      "setAttemptAlert",
      "recordContactEvent",
      "recordConsent",
      "applyPipelineEvent",
      "createServiceRoleClient",
      ".insert(",
      ".update(",
      ".upsert(",
      "sendEmail",
    ]) {
      expect(source, `${forbidden} must not appear in a route that writes nothing`).not.toContain(forbidden)
    }
  })
})
