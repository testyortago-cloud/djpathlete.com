// __tests__/app/api/admin/funnels/delete-route-quiz.test.ts
//
// THE DEFECT THIS FILE EXISTS FOR: `deleteFunnel` deletes one row. A quiz is
// NOT that row -- a `quiz` block holds a POINTER by id -- so deleting a quiz
// funnel left its quiz behind. That was survivable while a quizzes LIST screen
// existed; with the quiz reachable only from the funnel that runs it, an
// outliving quiz is reachable only by typing its URL.
//
// IT CANNOT HAPPEN FORWARDS. `POST /api/admin/funnels` with the quiz template
// creates the pair in one call and deletes the quiz if the funnel insert fails,
// so a quiz never exists without a funnel until one is deleted.
//
// WHAT MAKES THIS DELETE DANGEROUS, and why the tests below are shaped the way
// they are: `quiz_attempts.quiz_id` is ON DELETE CASCADE, so removing a quiz
// destroys every answer, score and tier anyone recorded against it -- and that
// is the LAST copy, because `funnel_submissions` cascades away with the funnel
// itself. So the rule is narrow on purpose:
//
//   · a quiz ANY other funnel's page still points at is never touched;
//   · a failed quiz delete never fails the funnel delete, which already
//     succeeded -- the funnel row is gone by then and a 500 would tell the
//     owner nothing happened when half of it did.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/funnels", () => ({
  getFunnelById: vi.fn(),
  updateFunnel: vi.fn(),
  deleteFunnel: vi.fn(),
  listSteps: vi.fn(),
  listStepDocuments: vi.fn(),
}))
vi.mock("@/lib/db/quizzes", () => ({ deleteQuiz: vi.fn() }))

import { DELETE } from "@/app/api/admin/funnels/[id]/route"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { deleteFunnel, listSteps, listStepDocuments } from "@/lib/db/funnels"
import { deleteQuiz } from "@/lib/db/quizzes"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const FUNNEL_ID = "ffffffff-1111-4222-8333-444444444444"
const OTHER_FUNNEL_ID = "eeeeeeee-1111-4222-8333-444444444444"
const ADMIN_ID = "aaaaaaaa-1111-4222-8333-444444444444"
const QUIZ_ID = "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9"

function doc(sections: unknown[]) {
  return { v: 1, engine: "sections", theme: { tone: "light", accent: "accent", radius: "soft" }, sections }
}
const quizSection = (quizId: string) => ({
  id: "q1",
  kind: "quiz",
  variant: "boxed",
  style: {},
  props: { quizId, submitLabel: "See my result" },
})
const heroSection = () => ({ id: "h1", kind: "hero", variant: "centered", style: {}, props: { headline: "Hi" } })

const step = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  funnel_id: FUNNEL_ID,
  name: "Quiz",
  slug: "index",
  is_entry: true,
  project_data: doc([quizSection(QUIZ_ID)]),
  ...over,
})

const request = () => new Request(`http://localhost/api/admin/funnels/${FUNNEL_ID}`, { method: "DELETE" })
const ctx = { params: Promise.resolve({ id: FUNNEL_ID }) }

beforeEach(() => {
  vi.clearAllMocks()
  mock(auth).mockResolvedValue({ user: { id: ADMIN_ID, role: "admin" } })
  mock(canAccessAdminPath).mockResolvedValue(true)
  mock(deleteFunnel).mockResolvedValue(undefined)
  mock(deleteQuiz).mockResolvedValue(undefined)
  mock(listSteps).mockResolvedValue([step()])
  // What is LEFT after the funnel is gone. Its own steps cascaded away.
  mock(listStepDocuments).mockResolvedValue([])
})

describe("DELETE /api/admin/funnels/[id] and the quiz its pages ran", () => {
  it("deletes a quiz no remaining page points at", async () => {
    const res = await DELETE(request(), ctx)
    expect(res.status).toBe(200)
    expect(deleteQuiz).toHaveBeenCalledWith(QUIZ_ID)
  })

  it("reads the funnel's pages BEFORE deleting it, or there is nothing left to read", async () => {
    // `funnel_steps.funnel_id` is ON DELETE CASCADE: after the funnel row goes,
    // its steps are gone and the quiz pointer with them. Order is the whole
    // mechanism, so it is asserted rather than assumed.
    const order: string[] = []
    mock(listSteps).mockImplementation(async () => {
      order.push("listSteps")
      return [step()]
    })
    mock(deleteFunnel).mockImplementation(async () => {
      order.push("deleteFunnel")
    })
    await DELETE(request(), ctx)
    expect(order).toEqual(["listSteps", "deleteFunnel"])
  })

  it("NEVER deletes a quiz another funnel's page still points at", async () => {
    // Two funnels can legitimately point at one quiz -- that is why the quiz
    // editor has its own URL rather than nesting under a funnel id.
    mock(listStepDocuments).mockResolvedValue([
      { id: "s9", funnel_id: OTHER_FUNNEL_ID, name: "Retake", project_data: doc([quizSection(QUIZ_ID)]) },
    ])
    const res = await DELETE(request(), ctx)
    expect(res.status).toBe(200)
    expect(deleteQuiz).not.toHaveBeenCalled()
  })

  it("does not scan anything when the funnel ran no quiz", async () => {
    // The scan reads every step's document in the app. A funnel with no quiz
    // is the overwhelmingly common case and must not pay for this.
    mock(listSteps).mockResolvedValue([step({ project_data: doc([heroSection()]) })])
    await DELETE(request(), ctx)
    expect(listStepDocuments).not.toHaveBeenCalled()
    expect(deleteQuiz).not.toHaveBeenCalled()
  })

  it("still reports success when the quiz delete fails, because the funnel is already gone", async () => {
    // A 500 here would tell the owner nothing happened when the funnel row
    // HAS gone. The orphan is logged instead -- the same call the create path
    // makes when it has to undo a half-made quiz funnel.
    mock(deleteQuiz).mockRejectedValue(new Error("nope"))
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await DELETE(request(), ctx)
    expect(res.status).toBe(200)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it("still deletes the funnel when the leftover-page scan itself fails", async () => {
    // Failing closed here would mean a read error blocks every delete of a
    // quiz funnel. The funnel goes; the quiz is left and logged.
    mock(listStepDocuments).mockRejectedValue(new Error("unreadable"))
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await DELETE(request(), ctx)
    expect(res.status).toBe(200)
    expect(deleteFunnel).toHaveBeenCalledWith(FUNNEL_ID)
    expect(deleteQuiz).not.toHaveBeenCalled()
    error.mockRestore()
  })

  it("refuses without a session, and touches nothing", async () => {
    mock(auth).mockResolvedValue(null)
    const res = await DELETE(request(), ctx)
    expect(res.status).toBe(403)
    expect(deleteFunnel).not.toHaveBeenCalled()
    expect(deleteQuiz).not.toHaveBeenCalled()
  })
})
