// @vitest-environment node
// __tests__/app/api/admin/quizzes/add-to-step-tenancy.test.ts
//
// POST /api/admin/quizzes/[id]/add-to-step composes another record's data
// (`quiz.name`, `quizId`) onto THIS business's draft page. `getQuizDefinition`
// is scoped by id alone -- several of its other callers are public,
// unauthenticated quiz-taking routes with no tenant to check against yet --
// so without an explicit ownership check, an admin could compose another
// business's quiz onto their own funnel page. Same class of hole as the
// `saveQuizDefinition` child-table write this task's first pass already
// closed, except this route already holds a real, resolved businessId with
// no architectural reason to skip the check.

import { describe, it, expect, vi, beforeEach } from "vitest"

const BUSINESS_ID = "bbb"
const QUIZ_ID = "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9"
const STEP_ID = "11111111-1111-4111-8111-111111111111"

const authMock = vi.fn()
const getQuizDefinitionMock = vi.fn()
const assertQuizInBusinessMock = vi.fn()
const getDraftMock = vi.fn()
const appendTurnMock = vi.fn()
const applyOpsMock = vi.fn()
const resolveAdminTenantForRequestMock = vi.fn()

// Dynamic `await import(...)` per test below, so — like
// create-quiz-funnel.test.ts — a bare top-level class here is safe: the mock
// factories only run once a test actually imports the route, well after this
// class declaration has executed.
class QuizNotInBusinessError extends Error {
  constructor(public readonly quizId: string) {
    super(`Quiz ${quizId} does not belong to this business`)
    this.name = "QuizNotInBusinessError"
  }
}
class NoAccessibleBusinessError extends Error {}

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/audit/with-audit", () => ({
  withAudit: (_config: unknown, handler: (request: Request, ctx: unknown) => unknown) => handler,
}))
vi.mock("@/lib/db/funnel-builder", () => ({
  getDraft: (...args: unknown[]) => getDraftMock(...args),
  appendTurn: (...args: unknown[]) => appendTurnMock(...args),
}))
vi.mock("@/lib/funnels/sections/apply", () => ({
  applyOps: (...args: unknown[]) => applyOpsMock(...args),
}))
vi.mock("@/lib/db/quizzes", () => ({
  getQuizDefinition: (...args: unknown[]) => getQuizDefinitionMock(...args),
  assertQuizInBusiness: (...args: unknown[]) => assertQuizInBusinessMock(...args),
  QuizNotInBusinessError,
}))
vi.mock("@/lib/tenancy/resolve", () => ({
  resolveAdminTenantForRequest: (...args: unknown[]) => resolveAdminTenantForRequestMock(...args),
  NoAccessibleBusinessError,
}))

function post(body: unknown) {
  return new Request(`https://www.darrenjpaul.com/api/admin/quizzes/${QUIZ_ID}/add-to-step`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const ctx = { params: Promise.resolve({ id: QUIZ_ID }) }

beforeEach(() => {
  vi.resetAllMocks()
  authMock.mockResolvedValue({ user: { id: "u1", role: "admin" } })
  resolveAdminTenantForRequestMock.mockResolvedValue({ businessId: BUSINESS_ID, choices: [], isOperator: true })
  assertQuizInBusinessMock.mockResolvedValue(undefined)
  getQuizDefinitionMock.mockResolvedValue({ id: QUIZ_ID, name: "RPI Athlete Quiz" })
  getDraftMock.mockResolvedValue({
    revision: 1,
    doc: { v: 1, engine: "sections", theme: { tone: "light", accent: "accent", radius: "soft" }, sections: [] },
  })
  applyOpsMock.mockReturnValue({ ok: true, doc: { sections: [] } })
  appendTurnMock.mockResolvedValue({ ok: true })
})

describe("POST /api/admin/quizzes/[id]/add-to-step", () => {
  it("checks ownership of the quiz with the resolved business, before reading its definition", async () => {
    const { POST } = await import("@/app/api/admin/quizzes/[id]/add-to-step/route")
    await POST(post({ stepId: STEP_ID }), ctx)
    expect(assertQuizInBusinessMock).toHaveBeenCalledWith(BUSINESS_ID, QUIZ_ID)
  })

  it("succeeds and composes the quiz onto the draft when ownership checks out", async () => {
    const { POST } = await import("@/app/api/admin/quizzes/[id]/add-to-step/route")
    const res = await POST(post({ stepId: STEP_ID }), ctx)
    expect(res.status).toBe(200)
    expect(appendTurnMock).toHaveBeenCalledTimes(1)
  })

  it("refuses to compose a quiz that belongs to another business, and reads/writes nothing", async () => {
    // THE HOLE THIS GUARD CLOSES. Without it, naming another business's
    // quizId here would read that quiz's full definition and write its name
    // and id into THIS business's draft page.
    assertQuizInBusinessMock.mockRejectedValue(new QuizNotInBusinessError(QUIZ_ID))
    const { POST } = await import("@/app/api/admin/quizzes/[id]/add-to-step/route")
    const res = await POST(post({ stepId: STEP_ID }), ctx)
    expect(res.status).toBe(404)
    expect(getQuizDefinitionMock).not.toHaveBeenCalled()
    expect(getDraftMock).not.toHaveBeenCalled()
    expect(appendTurnMock).not.toHaveBeenCalled()
  })

  it("is admin only — a client gets 404 and the guard never runs", async () => {
    authMock.mockResolvedValue({ user: { role: "client" } })
    const { POST } = await import("@/app/api/admin/quizzes/[id]/add-to-step/route")
    const res = await POST(post({ stepId: STEP_ID }), ctx)
    expect(res.status).toBe(404)
    expect(assertQuizInBusinessMock).not.toHaveBeenCalled()
  })

  it("403-shaped 404 when the caller has no accessible business", async () => {
    resolveAdminTenantForRequestMock.mockRejectedValueOnce(new NoAccessibleBusinessError())
    const { POST } = await import("@/app/api/admin/quizzes/[id]/add-to-step/route")
    const res = await POST(post({ stepId: STEP_ID }), ctx)
    expect(res.status).toBe(404)
    expect(assertQuizInBusinessMock).not.toHaveBeenCalled()
  })
})
