// POST /api/admin/funnels — the quiz template's orchestration.
//
// This is the only place in the app where creating a funnel also creates a
// ROW IN ANOTHER SUBSYSTEM and writes a page. Three things can go wrong that
// nothing else here can catch:
//
//   1. the page is written but names no quiz, or names the wrong one
//   2. every OTHER template starts writing a page it never wrote before
//   3. the clone is made and the funnel insert then fails, leaving an orphan
//
// The DAL functions themselves are tested against a filtering mock in
// __tests__/lib/quizzes/quiz-create.test.ts. What is tested here is the
// sequence: what gets called, in what order, with what.
//
// Spec: docs/superpowers/specs/2026-08-24-quiz-funnel-creator-design.md §4
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { sectionDocSchema } from "@/lib/funnels/sections/registry"
import { BUILTIN_QUIZ_SOURCE } from "@/lib/quizzes/sources"

const BUSINESS_ID = "bbb"

const authMock = vi.fn()
const canAccessMock = vi.fn()
const createFunnelMock = vi.fn()
const getQuizDefinitionMock = vi.fn()
const createQuizFromMock = vi.fn()
const deleteQuizMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/permissions/guard", () => ({
  canAccessAdminPath: (...args: unknown[]) => canAccessMock(...args),
}))
// The audit wrapper is not what this file is about; pass the handler through.
vi.mock("@/lib/audit/with-audit", () => ({
  withAudit: (_config: unknown, handler: (request: Request) => unknown) => handler,
}))
vi.mock("@/lib/db/funnels", () => ({
  listFunnels: vi.fn(),
  createFunnel: (...args: unknown[]) => createFunnelMock(...args),
}))
vi.mock("@/lib/db/quizzes", () => ({
  getQuizDefinition: (...args: unknown[]) => getQuizDefinitionMock(...args),
  createQuizFrom: (...args: unknown[]) => createQuizFromMock(...args),
  deleteQuiz: (...args: unknown[]) => deleteQuizMock(...args),
}))
class NoAccessibleBusinessError extends Error {}
vi.mock("@/lib/tenancy/resolve", () => ({
  resolveAdminTenantForRequest: () => Promise.resolve({ businessId: BUSINESS_ID, choices: [], isOperator: true }),
  NoAccessibleBusinessError,
}))

const CLONE_ID = "5f2b7c1e-0000-4000-8000-0000000000aa"
const EXISTING_QUIZ_ID = "5f2b7c1e-0000-4000-8000-0000000000bb"

function post(body: unknown) {
  return new NextRequest("http://localhost:3050/api/admin/funnels", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const quizBody = {
  name: "Rotational Reboot Check",
  slug: "rotational-reboot-check",
  kind: "funnel" as const,
  template: "quiz" as const,
  steps: [{ name: "Quiz", slug: "index" }],
  quiz: { copyFrom: BUILTIN_QUIZ_SOURCE },
}

/**
 * The route context Next hands a non-dynamic route. `withAudit` types its
 * handler as `(request, context)`, so the real POST takes two arguments even
 * though this one reads none of the second — passing it keeps the call honest
 * against the type rather than casting the arity away.
 */
const NO_PARAMS = { params: Promise.resolve({}) }

/** The step plan `createFunnel` was actually handed. */
function plannedSteps(): { name: string; slug: string; projectData?: unknown }[] {
  return (createFunnelMock.mock.calls[0]?.[0] as { steps?: never[] } | undefined)?.steps ?? []
}

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: a queued *Once implementation that is
  // never consumed leaks across test boundaries in this repo and misattributes
  // the failure to whichever test runs next.
  vi.resetAllMocks()
  authMock.mockResolvedValue({ user: { id: "u1", role: "admin" } })
  canAccessMock.mockResolvedValue(true)
  createFunnelMock.mockResolvedValue({ id: "f1", slug: "rotational-reboot-check", entryStepId: "s1" })
  createQuizFromMock.mockResolvedValue({ id: CLONE_ID, key: "rotational-reboot-check" })
  deleteQuizMock.mockResolvedValue(undefined)
})

describe("POST /api/admin/funnels — the quiz template", () => {
  it("writes the page onto the entry step in the same insert as the step", async () => {
    const { POST } = await import("@/app/api/admin/funnels/route")
    const res = await POST(post(quizBody), NO_PARAMS)
    expect(res.status).toBe(201)

    const entry = plannedSteps()[0]
    // MUTANT: leave project_data null and PUT the section afterwards. Two
    // writes from one button, and a failure on the second leaves a quiz funnel
    // whose page has no quiz on it.
    expect(entry.projectData).toBeTruthy()
    expect(sectionDocSchema.safeParse(entry.projectData).success).toBe(true)
  })

  it("points the page at the quiz it just created, not at the one it copied", async () => {
    const { POST } = await import("@/app/api/admin/funnels/route")
    await POST(post(quizBody), NO_PARAMS)

    const doc = sectionDocSchema.parse(plannedSteps()[0].projectData)
    const section = doc.sections.find((s) => s.kind === "quiz")!
    expect((section.props as { quizId: string }).quizId).toBe(CLONE_ID)
  })

  it("names the clone after the funnel", async () => {
    const { POST } = await import("@/app/api/admin/funnels/route")
    await POST(post(quizBody), NO_PARAMS)
    expect(createQuizFromMock.mock.calls[0][0]).toBe(BUSINESS_ID)
    expect(createQuizFromMock.mock.calls[0][1]).toMatchObject({ name: "Rotational Reboot Check" })
  })

  it("copies the built-in blueprint without going to the database for it", async () => {
    const { POST } = await import("@/app/api/admin/funnels/route")
    await POST(post(quizBody), NO_PARAMS)
    // MUTANT: treat the sentinel as an id. `getQuizDefinition("builtin:rpi")`
    // finds nothing, so a fresh database can never make a quiz funnel.
    expect(getQuizDefinitionMock).not.toHaveBeenCalled()
    expect(createQuizFromMock).toHaveBeenCalledTimes(1)
  })

  it("reads an existing quiz when one is named", async () => {
    getQuizDefinitionMock.mockResolvedValue({ id: EXISTING_QUIZ_ID, questions: [], branches: [], tiers: [], profiles: [] })
    const { POST } = await import("@/app/api/admin/funnels/route")
    await POST(post({ ...quizBody, quiz: { copyFrom: EXISTING_QUIZ_ID } }), NO_PARAMS)
    expect(getQuizDefinitionMock).toHaveBeenCalledWith(EXISTING_QUIZ_ID)
  })

  it("refuses a copyFrom naming a quiz that does not exist, before creating anything", async () => {
    getQuizDefinitionMock.mockResolvedValue(null)
    const { POST } = await import("@/app/api/admin/funnels/route")
    const res = await POST(post({ ...quizBody, quiz: { copyFrom: EXISTING_QUIZ_ID } }), NO_PARAMS)
    // MUTANT: carry on with a null source. `createQuizFrom` throws on a null
    // definition and the owner gets a 500 with no idea which field was wrong.
    expect(res.status).toBe(400)
    expect(createQuizFromMock).not.toHaveBeenCalled()
    expect(createFunnelMock).not.toHaveBeenCalled()
  })

  it("still writes the page when the body sends no step plan", async () => {
    const { name, slug, kind, template, quiz } = quizBody
    const { POST } = await import("@/app/api/admin/funnels/route")
    const res = await POST(post({ name, slug, kind, template, quiz }), NO_PARAMS)
    expect(res.status).toBe(201)
    // MUTANT: map over `body.steps ?? []`. With no plan the map is empty,
    // `createFunnel` falls back to its own unnamed entry step, and the quiz
    // funnel is created with a blank page — silently.
    expect(plannedSteps()[0]?.projectData).toBeTruthy()
    expect(plannedSteps()[0]?.slug).toBe("index")
  })

  it("deletes the clone it just made when the funnel insert fails", async () => {
    createFunnelMock.mockRejectedValue(new Error("insert exploded"))
    const { POST } = await import("@/app/api/admin/funnels/route")
    const res = await POST(post(quizBody), NO_PARAMS)
    expect(res.status).toBe(500)
    // MUTANT: drop the compensating delete. The quizzes list gains a draft
    // nobody asked for, and nothing on it says where it came from.
    expect(deleteQuizMock).toHaveBeenCalledWith(BUSINESS_ID, CLONE_ID)
  })

  it("reports the original failure even when the cleanup also fails", async () => {
    createFunnelMock.mockRejectedValue(new Error("insert exploded"))
    deleteQuizMock.mockRejectedValue(new Error("cleanup exploded"))
    const { POST } = await import("@/app/api/admin/funnels/route")
    const res = await POST(post(quizBody), NO_PARAMS)
    // An orphan quiz is a smaller problem than the one already being reported,
    // so the cleanup's own failure must not replace it.
    expect(res.status).toBe(500)
  })
})

describe("POST /api/admin/funnels — every other template", () => {
  it("creates no quiz and writes no page", async () => {
    const { POST } = await import("@/app/api/admin/funnels/route")
    const res = await POST(
      post({
        name: "Free Trial Week",
        slug: "free-trial-week",
        kind: "funnel",
        template: "leads",
        steps: [
          { name: "Signup", slug: "index" },
          { name: "Thank you", slug: "thank-you" },
        ],
      }),
      NO_PARAMS,
    )
    expect(res.status).toBe(201)
    expect(createQuizFromMock).not.toHaveBeenCalled()
    // MUTANT: run the quiz branch for every template (`if (quizIntake || true)`).
    // Every funnel in the app would stop arriving blank for the page builder.
    //
    // Note what this canNOT see: `lib/db/funnels.ts` is mocked here, so writing
    // `project_data: step.projectData ?? null` in the DAL survives. That one is
    // an EQUIVALENT MUTANT rather than a gap — `funnel_steps.project_data` is
    // `jsonb` with no default (migration 00202), so an explicit null and an
    // absent key produce the same row. The spread is kept for intent, not for
    // a behaviour difference.
    for (const step of plannedSteps()) expect(step.projectData).toBeUndefined()
  })

  it("does not pass the quiz intake through to the funnel row", async () => {
    const { POST } = await import("@/app/api/admin/funnels/route")
    await POST(post(quizBody), NO_PARAMS)
    // `funnels` has no `quiz` column. Spreading `parsed.data` straight through
    // is how a PATCH carrying `offer` once reached Postgres and 500'd.
    expect(createFunnelMock.mock.calls[0][0]).not.toHaveProperty("quiz")
  })
})
