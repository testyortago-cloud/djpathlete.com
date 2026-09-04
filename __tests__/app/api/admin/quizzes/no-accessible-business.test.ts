// @vitest-environment node
// __tests__/app/api/admin/quizzes/no-accessible-business.test.ts
//
// Final holistic review, Important: `NoAccessibleBusinessError` used to be
// answered three different ways across admin route handlers -- 403
// {"error":"Forbidden"} on `businesses` (x3) and `funnels` (x2), but 404
// {"error":"Not found."} on GET /api/admin/quizzes and a bare `notFound()`
// helper on PATCH /api/admin/quizzes/[id] and POST
// /api/admin/quizzes/[id]/add-to-step (that third route's own coverage lives
// in add-to-step-tenancy.test.ts). No test covered any quiz route's
// NoAccessibleBusinessError branch before this file.
//
// This is about the CALLER having no business it can access at all -- not
// about a resource this route is declining to confirm exists. The
// missing/foreign-QUIZ 404 posture is untouched and unrelated; these two
// routes still answer 404 for a bad id or a quiz that does not exist (see
// admin-quiz-save.test.ts). Only the NoAccessibleBusinessError branch moves
// to the majority 403 shape.
//
// Every dependency besides `auth` and `resolveAdminTenantForRequest` is
// mocked to a function that throws if called -- `NoAccessibleBusinessError`
// must short-circuit before any of them run.

import { describe, it, expect, vi, beforeEach } from "vitest"

class NoAccessibleBusinessError extends Error {}

const authMock = vi.fn()
const resolveAdminTenantForRequestMock = vi.fn()

function unreachable(name: string) {
  return vi.fn(() => {
    throw new Error(`${name} must not be called when the caller has no accessible business`)
  })
}

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/tenancy/resolve", () => ({
  resolveAdminTenantForRequest: (...args: unknown[]) => resolveAdminTenantForRequestMock(...args),
  NoAccessibleBusinessError,
}))
vi.mock("@/lib/db/quizzes", () => ({
  getQuizAttemptCounts: unreachable("getQuizAttemptCounts"),
  listQuizzes: unreachable("listQuizzes"),
  getAnsweredQuestionIds: unreachable("getAnsweredQuestionIds"),
  getQuizDefinition: unreachable("getQuizDefinition"),
  getQuizDefinitionForEditor: unreachable("getQuizDefinitionForEditor"),
  saveQuizDefinition: unreachable("saveQuizDefinition"),
  QuizAnsweredOptionError: class QuizAnsweredOptionError extends Error {},
  QuizNotInBusinessError: class QuizNotInBusinessError extends Error {},
}))
vi.mock("@/lib/quizzes/gate", () => ({ quizGate: unreachable("quizGate") }))

const QUIZ_ID = "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9"

beforeEach(() => {
  vi.resetAllMocks()
  authMock.mockResolvedValue({ user: { id: "u1", role: "admin" } })
  resolveAdminTenantForRequestMock.mockRejectedValue(new NoAccessibleBusinessError())
})

describe("GET /api/admin/quizzes — NoAccessibleBusinessError", () => {
  it("answers 403 {error:'Forbidden'}, matching the majority admin-route shape", async () => {
    // MUTANT: reverting this branch to `{error:"Not found."}`/404 must fail
    // both assertions below.
    const { GET } = await import("@/app/api/admin/quizzes/route")
    const res = await GET(new Request("https://www.darrenjpaul.com/api/admin/quizzes"))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "Forbidden" })
  })
})

describe("PATCH /api/admin/quizzes/[id] — NoAccessibleBusinessError", () => {
  it("answers 403 {error:'Forbidden'}, not the shared 404 notFound() helper", async () => {
    // MUTANT: reverting this branch to `return notFound()` (the shared
    // 404 helper this route also uses for a missing/foreign quiz) must
    // fail both assertions below.
    const { PATCH } = await import("@/app/api/admin/quizzes/[id]/route")
    const res = await PATCH(
      new Request(`https://www.darrenjpaul.com/api/admin/quizzes/${QUIZ_ID}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: QUIZ_ID }) },
    )
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "Forbidden" })
  })

  it("still answers 404 for an admin session that resolves fine but sends a malformed id", async () => {
    // Presence control: proves the two postures are actually distinguishable
    // in this file's own mocks, not just in the other test's — i.e. the
    // 403 above is not simply "whatever this route always returns".
    resolveAdminTenantForRequestMock.mockResolvedValueOnce({
      businessId: "bbb",
      choices: [],
      isOperator: true,
    })
    const { PATCH } = await import("@/app/api/admin/quizzes/[id]/route")
    const res = await PATCH(
      new Request("https://www.darrenjpaul.com/api/admin/quizzes/not-a-uuid", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    )
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "Not found." })
  })
})
