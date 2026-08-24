// @vitest-environment node
//
// A COMPLETED QUIZ IS A LEAD ON THE FUNNEL IT WAS TAKEN ON.
//
// Mirrors quiz-submit.test.ts: the pure modules run FOR REAL and only the
// writers are mocked, with the assertions on their ARGUMENTS. The claims that
// matter here are the ones that cost something when wrong -- a lead filed
// against the wrong funnel, a lead filed for a quiz taken outside any funnel
// (`funnel_id` is NOT NULL, so there is no honest value to invent), and the
// visitor's result being lost because our marketing plumbing failed.
import { describe, it, expect, beforeEach, vi } from "vitest"
import type { QuizDefinition } from "@/lib/quizzes/types"

const QUIZ_ID = "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9"
const ATTEMPT_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
const FUNNEL_ID = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb"
const STEP_ID = "dddddddd-1111-4111-8111-dddddddddddd"
const CONTACT_ID = "cccccccc-1111-4111-8111-cccccccccccc"
const Q_ROUTER = "11111111-1111-4111-8111-111111111111"
const O_TO_A = "11111111-1111-4111-8111-111111111112"
const Q_A1 = "22222222-2222-4222-8222-222222222221"
const O_BEST = "22222222-2222-4222-8222-222222222222"
const BRANCH_A = "44444444-4444-4444-8444-444444444441"

function definition(): QuizDefinition {
  return {
    id: QUIZ_ID,
    key: "rpi_athlete_quiz",
    name: "RPI",
    status: "active",
    introHeadline: "",
    introBody: "",
    gateHeadline: "",
    gateBody: "",
    resultHeadline: "Your readout",
    seedMarker: null,
    branches: [
      { id: BRANCH_A, quizId: QUIZ_ID, key: "ceiling_breaker", name: "Ceiling Breaker", description: null, position: 1 },
    ],
    profiles: [],
    tiers: [
      { id: "t1", quizId: QUIZ_ID, key: "red", position: 1, minScore: 0, maxScore: 49, headline: "Gaps", body: "Fixable.", ctaLabel: null, ctaHref: null },
      { id: "t2", quizId: QUIZ_ID, key: "green", position: 2, minScore: 50, maxScore: 100, headline: "Ready", body: "Precision.", ctaLabel: null, ctaHref: null },
    ],
    questions: [
      {
        id: Q_ROUTER, quizId: QUIZ_ID, branchId: null, position: 10, prompt: "Which describes you?", helpText: null, isActive: true,
        options: [{ id: O_TO_A, questionId: Q_ROUTER, position: 1, label: "Nearly there", weight: 0, routesToBranchId: BRANCH_A, profileId: null }],
      },
      {
        id: Q_A1, quizId: QUIZ_ID, branchId: BRANCH_A, position: 50, prompt: "How is training going?", helpText: null, isActive: true,
        options: [{ id: O_BEST, questionId: Q_A1, position: 1, label: "Great", weight: 4, routesToBranchId: null, profileId: null }],
      },
    ],
  }
}

const getQuizDefinition = vi.fn()
const getAttempt = vi.fn()
const completeAttempt = vi.fn()
const setAttemptAlert = vi.fn()
const recordContactEvent = vi.fn()
const recordConsent = vi.fn()
const getBusinessSettings = vi.fn()
const applyPipelineEvent = vi.fn()
const sendQuizAlert = vi.fn()
const createSubmission = vi.fn()
const recordAudit = vi.fn()

vi.mock("@/lib/db/quizzes", () => ({
  getQuizDefinition: (...a: unknown[]) => getQuizDefinition(...a),
  getAttempt: (...a: unknown[]) => getAttempt(...a),
  completeAttempt: (...a: unknown[]) => completeAttempt(...a),
  setAttemptAlert: (...a: unknown[]) => setAttemptAlert(...a),
}))
vi.mock("@/lib/db/funnels", () => ({ createSubmission: (...a: unknown[]) => createSubmission(...a) }))
vi.mock("@/lib/db/pipeline", () => ({ applyPipelineEvent: (...a: unknown[]) => applyPipelineEvent(...a) }))
vi.mock("@/lib/quizzes/alert", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/quizzes/alert")>()),
  sendQuizAlert: (...a: unknown[]) => sendQuizAlert(...a),
}))
vi.mock("@/lib/db/contacts", () => ({ recordContactEvent: (...a: unknown[]) => recordContactEvent(...a) }))
vi.mock("@/lib/db/contact-consents", () => ({ recordConsent: (...a: unknown[]) => recordConsent(...a) }))
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: (...a: unknown[]) => getBusinessSettings(...a) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...a) }))

const ANSWERS = [
  { questionId: Q_ROUTER, optionId: O_TO_A },
  { questionId: Q_A1, optionId: O_BEST },
]

let ipCounter = 0
const freshIp = () => `10.7.0.${++ipCounter % 200}`

async function post(extra: Record<string, unknown> = {}, ip = freshIp()) {
  const { POST } = await import("@/app/api/quiz/submit/route")
  const body: Record<string, unknown> = {
    quizId: QUIZ_ID,
    attemptId: ATTEMPT_ID,
    answers: ANSWERS,
    name: "Sam Athlete",
    email: "sam@example.com",
    phone: "0400 000 000",
    elapsedMs: 90_000,
    funnelId: FUNNEL_ID,
    stepId: STEP_ID,
    ...extra,
  }
  for (const [key, value] of Object.entries(extra)) if (value === undefined) delete body[key]
  return POST(
    new Request("https://www.darrenjpaul.com/api/quiz/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
        "user-agent": "vitest",
        cookie: "djp_attr=sessabc123",
      },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  getQuizDefinition.mockResolvedValue(definition())
  getAttempt.mockResolvedValue({ id: ATTEMPT_ID, quizId: QUIZ_ID, branchId: null, status: "in_progress", answers: [] })
  completeAttempt.mockResolvedValue(undefined)
  recordContactEvent.mockResolvedValue({ contactId: CONTACT_ID, created: true, merged: false })
  recordConsent.mockResolvedValue(undefined)
  getBusinessSettings.mockResolvedValue({ display_name: "DJP Athlete", reply_to: "darren@example.com" })
  setAttemptAlert.mockResolvedValue(undefined)
  applyPipelineEvent.mockResolvedValue({ decision: { kind: "noop", reason: "x" }, opportunityId: null })
  sendQuizAlert.mockResolvedValue({ delivered: true })
  createSubmission.mockResolvedValue({ id: "sub-1" })
})

describe("POST /api/quiz/submit -- the funnel lead", () => {
  it("files the completion against the funnel and step it was taken on", async () => {
    await post()
    expect(createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ funnel_id: FUNNEL_ID, step_id: STEP_ID, kind: "quiz", quiz_attempt_id: ATTEMPT_ID }),
    )
  })

  it("carries the person, so the inbox can call them", async () => {
    await post()
    expect(createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Sam Athlete", email: "sam@example.com", phone: "0400 000 000" }),
    )
  })

  it("carries what they were asked and what they picked, not the score", async () => {
    await post()
    const arg = createSubmission.mock.calls[0][0] as { payload: Record<string, string> }
    expect(arg.payload).toEqual({ "Which describes you?": "Nearly there", "How is training going?": "Great" })
    expect(JSON.stringify(arg.payload)).not.toContain("score")
  })

  it("names the quiz in form_key, so the inbox can say which quiz it was", async () => {
    await post()
    expect(createSubmission).toHaveBeenCalledWith(expect.objectContaining({ form_key: "rpi_athlete_quiz" }))
  })

  it("leaves lead_user_id null -- the quiz feeds the contact spine, not a second identity", async () => {
    await post()
    expect(createSubmission.mock.calls[0][0]).not.toHaveProperty("lead_user_id", expect.anything())
  })

  it("writes NO submission when the quiz was not taken on a funnel", async () => {
    // funnel_submissions.funnel_id is NOT NULL. There is no honest value to
    // invent for a quiz embedded somewhere that is not a funnel page.
    await post({ funnelId: undefined, stepId: undefined })
    expect(createSubmission).not.toHaveBeenCalled()
  })

  it("writes NO submission when only half the pair arrives", async () => {
    await post({ stepId: undefined })
    expect(createSubmission).not.toHaveBeenCalled()
  })

  it("still returns the visitor's result when the lead write throws", async () => {
    // They answered every question. A failure in our marketing plumbing is not
    // their problem -- the whole handoff is non-fatal by design.
    createSubmission.mockRejectedValue(new Error("boom"))
    const res = await post()
    expect(res.status).toBe(200)
    expect((await res.json()).tier.key).toBe("green")
  })

  it("still records the contact when the lead write throws", async () => {
    // Each step inside the handoff is individually guarded: one failing must
    // not swallow the ones after it.
    createSubmission.mockRejectedValue(new Error("boom"))
    await post()
    expect(recordContactEvent).toHaveBeenCalled()
  })

  it("files the lead BEFORE the contact spine runs", async () => {
    // The lead is the thing this route exists to capture, and it should not be
    // lost because the contact spine had a bad minute. Order is asserted from
    // the call log rather than from reading the file.
    const order: string[] = []
    createSubmission.mockImplementation(async () => {
      order.push("submission")
      return { id: "sub-1" }
    })
    recordContactEvent.mockImplementation(async () => {
      order.push("contact")
      return { contactId: CONTACT_ID, created: true, merged: false }
    })
    await post()
    expect(order).toEqual(["submission", "contact"])
  })

  it("carries the attribution session from the cookie, joining the lead to first touch", async () => {
    await post()
    expect(createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ attribution_session_id: "sessabc123" }),
    )
  })

  it("gives the contact spine the SAME session the lead got", async () => {
    // Two rows about one visit disagreeing about which visit it was would
    // split that person across the attribution join.
    await post()
    expect(recordContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({ attributionSessionId: "sessabc123" }),
    )
  })

  it("records the audit row the form path records", async () => {
    await post()
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "funnel.submission_received", category: "marketing" }),
    )
  })

  it("writes nothing when the honeypot is filled", async () => {
    await post({ website: "http://spam.example" })
    expect(createSubmission).not.toHaveBeenCalled()
    expect(completeAttempt).not.toHaveBeenCalled()
  })

  it("writes nothing for a quiz that is not active", async () => {
    getQuizDefinition.mockResolvedValue({ ...definition(), status: "draft" })
    const res = await post()
    expect(res.status).toBe(404)
    expect(createSubmission).not.toHaveBeenCalled()
  })
})
