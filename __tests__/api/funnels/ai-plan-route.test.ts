// The two Ask AI routes.
//
// What these are really about is what happens when something goes wrong. The
// happy path is one call and a sanitiser that already has its own tests; the
// interesting question is whether a model failure, a truncated catalogue or a
// signed-out caller costs the owner the assist, the offer, or the whole dialog.

import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const canAccessMock = vi.fn()
const questionsMock = vi.fn()
const draftMock = vi.fn()
const loadCataloguesMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/permissions/guard", () => ({
  canAccessAdminPath: (...args: unknown[]) => canAccessMock(...args),
}))
vi.mock("@/lib/ai/funnel-interview", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/funnel-interview")>(
    "@/lib/ai/funnel-interview",
  )
  return {
    ...actual,
    interviewQuestions: (...a: unknown[]) => questionsMock(...a),
    draftFunnelPlan: (...a: unknown[]) => draftMock(...a),
  }
})
vi.mock("@/lib/funnels/sections/resolve", () => ({
  loadCatalogues: () => loadCataloguesMock(),
}))

function post(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

const EVENT_PLAN = {
  template: "event",
  name: "Summer Camp 2026",
  steps: [
    { name: "Details", slug: "index", goal: "event" },
    { name: "Register", slug: "register", goal: "leads" },
  ],
  audience: "Junior tennis players",
  description: "A four-week camp.",
  offer: { kind: "event", ref: "Summer Camp 2026" },
  starts_at: null,
  ends_at: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "u1", role: "admin" } })
  canAccessMock.mockResolvedValue(true)
  questionsMock.mockResolvedValue([{ id: "q1", question: "What ages?", hint: null, placeholder: null }])
  draftMock.mockResolvedValue(EVENT_PLAN)
  loadCataloguesMock.mockResolvedValue({
    offer: { program: [], session_pack: [], event: [{ id: "e1", name: "Summer Camp 2026" }] },
    recognition: { program: [], session_pack: [], event: [] },
    faqPageKeys: [],
  })
})

describe("POST /api/admin/funnels/ai/interview", () => {
  it("refuses a signed-out caller", async () => {
    authMock.mockResolvedValue(null)
    const { POST } = await import("@/app/api/admin/funnels/ai/interview/route")
    expect((await POST(post("http://x/i", { brief: "camp" }))).status).toBe(403)
  })

  it("refuses a signed-in non-admin", async () => {
    canAccessMock.mockResolvedValue(false)
    const { POST } = await import("@/app/api/admin/funnels/ai/interview/route")
    expect((await POST(post("http://x/i", { brief: "camp" }))).status).toBe(403)
  })

  it("rejects an empty brief without spending a model call", async () => {
    // MUTANT KILLED: calling the model on whitespace. It costs money to be
    // told nothing, and the questions would be generic.
    const { POST } = await import("@/app/api/admin/funnels/ai/interview/route")
    for (const brief of ["", "  ", "a"]) {
      expect((await POST(post("http://x/i", { brief }))).status, JSON.stringify(brief)).toBe(400)
    }
    expect(questionsMock).not.toHaveBeenCalled()
  })

  it("returns the questions", async () => {
    const { POST } = await import("@/app/api/admin/funnels/ai/interview/route")
    const body = await (await POST(post("http://x/i", { brief: "summer camp" }))).json()
    expect(body.questions).toHaveLength(1)
  })

  it("turns a model failure into a message, not a crash", async () => {
    questionsMock.mockRejectedValue(new Error("overloaded"))
    const { POST } = await import("@/app/api/admin/funnels/ai/interview/route")
    const response = await POST(post("http://x/i", { brief: "summer camp" }))
    expect(response.status).toBe(502)
    expect((await response.json()).error).toMatch(/could not/i)
  })
})

describe("POST /api/admin/funnels/ai/plan", () => {
  it("refuses a non-admin", async () => {
    canAccessMock.mockResolvedValue(false)
    const { POST } = await import("@/app/api/admin/funnels/ai/plan/route")
    expect((await POST(post("http://x/p", { brief: "camp", answers: [] }))).status).toBe(403)
  })

  it("keeps an offer the catalogue contains", async () => {
    const { POST } = await import("@/app/api/admin/funnels/ai/plan/route")
    const body = await (await POST(post("http://x/p", { brief: "camp", answers: [] }))).json()
    expect(body.plan.offer).toEqual({ kind: "event", ref: "Summer Camp 2026" })
  })

  it("drops an offer the catalogue does not contain", async () => {
    // MUTANT KILLED: passing the model's ref straight through. This is the one
    // field where an invention survives every schema and renders as a dead
    // button on a page the owner believes is finished.
    draftMock.mockResolvedValue({ ...EVENT_PLAN, offer: { kind: "event", ref: "Camp That Never Was" } })
    const { POST } = await import("@/app/api/admin/funnels/ai/plan/route")
    const body = await (await POST(post("http://x/p", { brief: "camp", answers: [] }))).json()
    expect(body.plan.offer).toBeNull()
  })

  it("still returns a plan when the catalogue cannot be read", async () => {
    // `loadCatalogues` throws on a truncated read and its own comment says
    // every caller must wrap it. Here a throw must cost the OFFER, never the
    // interview the owner just sat through.
    loadCataloguesMock.mockRejectedValue(new Error("programs came back truncated"))
    const { POST } = await import("@/app/api/admin/funnels/ai/plan/route")
    const response = await POST(post("http://x/p", { brief: "camp", answers: [] }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.plan.template).toBe("event")
    expect(body.plan.offer).toBeNull()
  })

  it("does not read the catalogue for a template that sells nothing", async () => {
    // MUTANT KILLED: reading it unconditionally. That is three table reads on
    // every lead-capture plan, for a field the template does not even ask for.
    draftMock.mockResolvedValue({ ...EVENT_PLAN, template: "leads", offer: null })
    const { POST } = await import("@/app/api/admin/funnels/ai/plan/route")
    await POST(post("http://x/p", { brief: "camp", answers: [] }))
    expect(loadCataloguesMock).not.toHaveBeenCalled()
  })

  it("drops unanswered questions rather than sending them blank", async () => {
    // An empty answer tells the model the coach had nothing to say, when they
    // simply skipped it — and the plan then asserts that absence as fact.
    const { POST } = await import("@/app/api/admin/funnels/ai/plan/route")
    await POST(
      post("http://x/p", {
        brief: "camp",
        answers: [
          { question: "What ages?", answer: "12 to 16" },
          { question: "Deposit?", answer: "   " },
        ],
      }),
    )
    expect(draftMock.mock.calls[0][1]).toEqual([{ question: "What ages?", answer: "12 to 16" }])
  })

  it("turns a model failure into a message, not a crash", async () => {
    draftMock.mockRejectedValue(new Error("overloaded"))
    const { POST } = await import("@/app/api/admin/funnels/ai/plan/route")
    expect((await POST(post("http://x/p", { brief: "camp", answers: [] }))).status).toBe(502)
  })
})
