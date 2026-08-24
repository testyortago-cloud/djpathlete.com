// @vitest-environment node
//
// The save API, and the gate it enforces.
//
// THE POINT OF THIS FILE is test 5: a disabled Activate button is a courtesy
// to the person looking at it, not a control. Anyone who can reach this route
// can post `status: "active"` on a quiz that routes nowhere, and this check is
// the only thing standing between that and a live page collecting answers it
// cannot score.
import { describe, it, expect, beforeEach, vi } from "vitest"
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
const BRANCH_A = "44444444-4444-4444-8444-444444444441"
const BRANCH_B = "44444444-4444-4444-8444-444444444442"

/** A quiz that PASSES the gate. Cases below break exactly one thing. */
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

/** Unreachable branch — the gate refuses it. */
function broken(): QuizDefinition {
  const d = healthy()
  d.questions[0].options[1].routesToBranchId = BRANCH_A
  return d
}

const auth = vi.fn()
const getQuizDefinition = vi.fn()
const saveQuizDefinition = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => auth() }))
vi.mock("@/lib/db/quizzes", () => ({
  getQuizDefinition: (...a: unknown[]) => getQuizDefinition(...a),
  saveQuizDefinition: (...a: unknown[]) => saveQuizDefinition(...a),
}))

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

beforeEach(() => {
  vi.resetAllMocks()
  auth.mockResolvedValue({ user: { role: "admin" } })
  getQuizDefinition.mockResolvedValue(healthy())
  saveQuizDefinition.mockResolvedValue(undefined)
})

describe("PATCH /api/admin/quizzes/[id]", () => {
  it("5. REFUSES to activate a quiz that would fail the gate, and says why", async () => {
    getQuizDefinition.mockResolvedValue(broken())
    const res = await patch({ quiz: { status: "active" } })
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.blockers.join(" | ")).toMatch(/unreachable/)
    // The status flip must not have been written.
    const statusWrites = saveQuizDefinition.mock.calls.filter((c) => (c[0] as { quiz?: { status?: string } })?.quiz?.status)
    expect(statusWrites).toHaveLength(0)
  })

  it("5b. allows activation once the quiz passes", async () => {
    const res = await patch({ quiz: { status: "active" } })
    expect(res.status).toBe(200)
    expect(saveQuizDefinition).toHaveBeenCalledWith({ quizId: QUIZ_ID, quiz: { status: "active" } })
  })

  it("5c. keeps the content edits even when activation is refused", async () => {
    // Losing a morning of copy because the last change did not yet satisfy the
    // gate would be its own bug. The edits land; only the flip is refused.
    getQuizDefinition.mockResolvedValue(broken())
    const res = await patch({ quiz: { status: "active", name: "Renamed" }, options: [{ id: O_A1, weight: 2 }] })
    expect(res.status).toBe(409)
    expect(saveQuizDefinition).toHaveBeenCalledWith(
      expect.objectContaining({ quiz: expect.objectContaining({ name: "Renamed" }), options: [{ id: O_A1, weight: 2 }] }),
    )
  })

  it("5d. never writes a status inside the content save", async () => {
    // The content write must be status-free, or a rejected activation would
    // already have flipped it before the gate ran.
    await patch({ quiz: { status: "active", name: "Renamed" } })
    const contentCall = saveQuizDefinition.mock.calls[0][0] as { quiz?: Record<string, unknown> }
    expect(contentCall.quiz).not.toHaveProperty("status")
  })

  it("5e. gates the quiz AS IT WILL BE, not as it was — a save that FIXES it may activate it", async () => {
    // The mutation this kills: `quizGate(existing)` instead of
    // `quizGate(after)`. With one definition returned for both reads the two
    // are indistinguishable, so the fixture has to change between them —
    // BROKEN before the save, HEALTHY after. Gating the pre-save state would
    // refuse an activation whose whole purpose was to make it activatable.
    getQuizDefinition.mockResolvedValueOnce(broken()).mockResolvedValueOnce(healthy())
    const res = await patch({
      quiz: { status: "active" },
      options: [{ id: O_TO_B, routesToBranchId: BRANCH_B }],
    })
    expect(res.status).toBe(200)
    expect(saveQuizDefinition).toHaveBeenCalledWith({ quizId: QUIZ_ID, quiz: { status: "active" } })
  })

  it("5f. and refuses when the save BREAKS a quiz that was fine before", async () => {
    // The mirror, so 5e cannot pass by ignoring the gate entirely.
    getQuizDefinition.mockResolvedValueOnce(healthy()).mockResolvedValueOnce(broken())
    const res = await patch({ quiz: { status: "active" } })
    expect(res.status).toBe(409)
  })

  it("6. is admin only — a client gets 404 and nothing is written", async () => {
    auth.mockResolvedValue({ user: { role: "client" } })
    expect((await patch({ quiz: { name: "x" } })).status).toBe(404)
    expect(saveQuizDefinition).not.toHaveBeenCalled()
  })

  it("6b. 404s an anonymous request", async () => {
    auth.mockResolvedValue(null)
    expect((await patch({ quiz: { name: "x" } })).status).toBe(404)
    expect(saveQuizDefinition).not.toHaveBeenCalled()
  })

  it("6c. 404s a staff request — this one is admin only, unlike the previews", async () => {
    auth.mockResolvedValue({ user: { role: "staff" } })
    expect((await patch({ quiz: { name: "x" } })).status).toBe(404)
  })

  it("saves an ordinary edit with no status change", async () => {
    const res = await patch({ questions: [{ id: Q_A1, position: 60 }] })
    expect(res.status).toBe(200)
    expect(saveQuizDefinition).toHaveBeenCalledWith(expect.objectContaining({ questions: [{ id: Q_A1, position: 60 }] }))
  })

  it("rejects a malformed payload before writing anything", async () => {
    expect((await patch({ options: [{ id: "not-a-uuid", weight: 1 }] })).status).toBe(400)
    expect(saveQuizDefinition).not.toHaveBeenCalled()
  })

  it("404s a quiz that does not exist", async () => {
    getQuizDefinition.mockResolvedValue(null)
    expect((await patch({ quiz: { name: "x" } })).status).toBe(404)
  })

  it("returns the gate result on a successful save, so the editor can show blockers", async () => {
    getQuizDefinition.mockResolvedValue(broken())
    const res = await patch({ questions: [{ id: Q_A1, position: 60 }] })
    expect(res.status).toBe(200)
    expect((await res.json()).gate.ok).toBe(false)
  })
})
