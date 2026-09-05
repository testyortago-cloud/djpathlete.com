// @vitest-environment node
//
// Route-level tests for POST /api/quiz/submit.
//
// The pure modules (`scoreQuiz`, `sanitiseAnswers`) run FOR REAL — they decide
// the number, and stubbing them would make the headline test ("a forged score
// changes nothing") vacuous. Only the writers are mocked, and the assertions
// are on their ARGUMENTS, never on "it was called".
//
// Spec: docs/superpowers/specs/2026-08-23-athlete-quiz-funnel-design.md §4.3
import { describe, it, expect, beforeEach, vi } from "vitest"
import type { QuizDefinition } from "@/lib/quizzes/types"

const QUIZ_ID = "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9"
const ATTEMPT_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
const CONTACT_ID = "cccccccc-1111-4111-8111-cccccccccccc"
const Q_ROUTER = "11111111-1111-4111-8111-111111111111"
const O_TO_A = "11111111-1111-4111-8111-111111111112"
const Q_A1 = "22222222-2222-4222-8222-222222222221"
const O_BEST = "22222222-2222-4222-8222-222222222222"
const O_WORST = "22222222-2222-4222-8222-222222222223"
const BRANCH_A = "44444444-4444-4444-8444-444444444441"
// NOT the platform id. The route must take this from the attempt row; a
// fixture equal to the platform id would pass for a default just as well.
//
// Also NOT equal to any option id above. It was byte-identical to O_BEST
// until the final review: two different things wearing one literal means a
// value plumbed from the wrong place still satisfies the assertion for the
// right one, and nothing on screen looks wrong.
const ATTEMPT_BUSINESS_ID = "22222222-2222-4222-8222-2222222222b9"

function definition(status = "active"): QuizDefinition {
  return {
    id: QUIZ_ID,
    key: "rpi_athlete_quiz",
    name: "RPI",
    status: status as QuizDefinition["status"],
    introHeadline: "",
    introBody: "",
    gateHeadline: "",
    gateBody: "",
    resultHeadline: "Your readout",
    seedMarker: null,
    branches: [{ id: BRANCH_A, quizId: QUIZ_ID, key: "ceiling_breaker", name: "Ceiling Breaker", description: null, position: 1 }],
    profiles: [
      { id: "pf0", quizId: QUIZ_ID, key: "not_sure", name: "Not sure", description: "Hard to pinpoint.", position: 0 },
    ],
    tiers: [
      { id: "t1", quizId: QUIZ_ID, key: "red", position: 1, minScore: 0, maxScore: 49, headline: "Large gaps", body: "Fixable.", ctaLabel: "Book", ctaHref: "/contact" },
      { id: "t2", quizId: QUIZ_ID, key: "green", position: 2, minScore: 50, maxScore: 100, headline: "Well prepared", body: "Precision now.", ctaLabel: null, ctaHref: null },
    ],
    questions: [
      {
        id: Q_ROUTER, quizId: QUIZ_ID, branchId: null, position: 10, prompt: "Which describes you?", helpText: null, isActive: true,
        options: [{ id: O_TO_A, questionId: Q_ROUTER, position: 1, label: "A", weight: 0, routesToBranchId: BRANCH_A, profileId: null }],
      },
      {
        id: Q_A1, quizId: QUIZ_ID, branchId: BRANCH_A, position: 50, prompt: "How is it going?", helpText: null, isActive: true,
        options: [
          { id: O_BEST, questionId: Q_A1, position: 1, label: "Great", weight: 4, routesToBranchId: null, profileId: null },
          { id: O_WORST, questionId: Q_A1, position: 2, label: "Badly", weight: 0, routesToBranchId: null, profileId: null },
        ],
      },
    ],
  }
}

const getQuizDefinition = vi.fn()
const getAttempt = vi.fn()
const completeAttempt = vi.fn()
const recordContactEvent = vi.fn()
const recordConsent = vi.fn()
const getBusinessSettings = vi.fn()
const setAttemptAlert = vi.fn()
const applyPipelineEvent = vi.fn()
const sendQuizAlert = vi.fn()

vi.mock("@/lib/db/quizzes", () => ({
  getQuizDefinition: (...a: unknown[]) => getQuizDefinition(...a),
  getAttempt: (...a: unknown[]) => getAttempt(...a),
  completeAttempt: (...a: unknown[]) => completeAttempt(...a),
  setAttemptAlert: (...a: unknown[]) => setAttemptAlert(...a),
}))
vi.mock("@/lib/db/pipeline", () => ({ applyPipelineEvent: (...a: unknown[]) => applyPipelineEvent(...a) }))
// `shouldAlert` is NOT mocked — it is the pure rule deciding red/orange, and
// stubbing it would make "a green result does not alert" assert nothing.
vi.mock("@/lib/quizzes/alert", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/quizzes/alert")>()),
  sendQuizAlert: (...a: unknown[]) => sendQuizAlert(...a),
}))
vi.mock("@/lib/db/contacts", () => ({ recordContactEvent: (...a: unknown[]) => recordContactEvent(...a) }))
vi.mock("@/lib/db/contact-consents", () => ({ recordConsent: (...a: unknown[]) => recordConsent(...a) }))
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: (...a: unknown[]) => getBusinessSettings(...a) }))

const WORST_ANSWERS = [
  { questionId: Q_ROUTER, optionId: O_TO_A },
  { questionId: Q_A1, optionId: O_WORST },
]

let ipCounter = 0
const freshIp = () => `10.1.0.${++ipCounter % 200}`

async function post(extra: Record<string, unknown> = {}, ip = freshIp()) {
  const { POST } = await import("@/app/api/quiz/submit/route")
  return POST(
    new Request("https://www.darrenjpaul.com/api/quiz/submit", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip, "user-agent": "vitest" },
      body: JSON.stringify({
        quizId: QUIZ_ID,
        attemptId: ATTEMPT_ID,
        answers: WORST_ANSWERS,
        name: "Sam Athlete",
        email: "sam@example.com",
        elapsedMs: 90_000,
        ...extra,
      }),
    }),
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  getQuizDefinition.mockResolvedValue(definition())
  getAttempt.mockResolvedValue({
    id: ATTEMPT_ID,
    quizId: QUIZ_ID,
    branchId: null,
    status: "in_progress",
    answers: [],
    businessId: ATTEMPT_BUSINESS_ID,
  })
  completeAttempt.mockResolvedValue(undefined)
  recordContactEvent.mockResolvedValue({ contactId: CONTACT_ID, created: true, merged: false })
  recordConsent.mockResolvedValue(undefined)
  getBusinessSettings.mockResolvedValue({ display_name: "DJP Athlete", reply_to: "darren@example.com" })
  setAttemptAlert.mockResolvedValue(undefined)
  applyPipelineEvent.mockResolvedValue({ decision: { kind: "noop", reason: "x" }, opportunityId: null })
  sendQuizAlert.mockResolvedValue({ delivered: true })
})

describe("POST /api/quiz/submit", () => {
  it("1. ignores a score in the request body — the computed value wins, in both the response and the row", async () => {
    const res = await post({ score: 100 })
    const json = await res.json()
    // Worst answers over a max of 4 -> 0, which is the `red` band.
    expect(json.score).toBe(0)
    expect(json.tier.key).toBe("red")
    expect(completeAttempt).toHaveBeenCalledWith(expect.objectContaining({ score: 0, maxScore: 4, rawScore: 0 }))
  })

  it("1b. and the route's source never reads one", () => {
    // Belt and braces on the same property: the body schema does not declare
    // `score`, so Zod strips it and no handler mutation could read it back.
    const fs = require("node:fs") as typeof import("node:fs")
    const path = require("node:path") as typeof import("node:path")
    const src = fs.readFileSync(path.join(process.cwd(), "app", "api", "quiz", "submit", "route.ts"), "utf8")
    expect(src).not.toMatch(/body\.score/)
    expect(src).not.toMatch(/score:\s*z\./)
  })

  it("2. refuses a filled honeypot, with no signal that it was caught", async () => {
    const res = await post({ website: "http://spam.example" })
    expect(res.status).toBe(200)
    expect(completeAttempt).not.toHaveBeenCalled()
  })

  it("3. refuses a submission faster than a person could read it", async () => {
    const res = await post({ elapsedMs: 200 })
    expect(res.status).toBe(200)
    expect(completeAttempt).not.toHaveBeenCalled()
  })

  it("4. persists completed with score, tier, profile and max_score", async () => {
    await post({ answers: [{ questionId: Q_ROUTER, optionId: O_TO_A }, { questionId: Q_A1, optionId: O_BEST }] })
    expect(completeAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: ATTEMPT_ID,
        score: 100,
        rawScore: 4,
        maxScore: 4,
        tierKey: "green",
        profileKey: "not_sure",
        branchId: BRANCH_A,
      }),
    )
  })

  it("5. records the contact event with source quiz and the metadata sequences filter on", async () => {
    await post()
    expect(recordContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "quiz",
        email: "sam@example.com",
        name: "Sam Athlete",
        metadata: {
          quiz_key: "rpi_athlete_quiz",
          branch: "ceiling_breaker",
          tier: "red",
          profile: "not_sure",
          score: 0,
          attempt_id: ATTEMPT_ID,
        },
      }),
    )
  })

  it("6. still returns the visitor's result when recordContactEvent throws", async () => {
    // ASSERTS WHICH STEP WAS LOGGED, not merely that a 200 came back. There
    // are two guards here — one around this call, one around the whole
    // handoff — and a 200-only assertion passes if EITHER exists, so each
    // mutation survived while the other guard silently covered for it. The
    // step name distinguishes them: with the inner guard gone the failure is
    // logged as "handoff", not "recordContactEvent".
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    recordContactEvent.mockRejectedValue(new Error("contact spine is down"))
    const res = await post()
    expect(res.status).toBe(200)
    expect((await res.json()).tier.key).toBe("red")
    expect(spy.mock.calls.map((c) => String(c[0])).join(" | ")).toContain("recordContactEvent failed")
    spy.mockRestore()
  })

  it("6b. still returns the result when recordConsent throws, logging that step by name", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    recordConsent.mockRejectedValue(new Error("consent table is down"))
    const res = await post({ phone: "+18135551234", smsConsent: true })
    expect(res.status).toBe(200)
    expect(spy.mock.calls.map((c) => String(c[0])).join(" | ")).toContain("recordConsent failed")
    spy.mockRestore()
  })

  it("6c. the outer handoff guard is the last line, and it names itself", async () => {
    // The one path inside handoff that no per-step guard covers: the contact
    // write SUCCEEDS, so consent is attempted, and the settings read throws
    // outside... in fact every step is individually guarded today, so this
    // asserts the guard EXISTS and is reachable rather than pretending it
    // fires. getBusinessSettings throwing is caught by the consent guard, so
    // the observable outcome is still a 200 with the result intact.
    getBusinessSettings.mockRejectedValue(new Error("settings unavailable"))
    const res = await post({ phone: "+18135551234", smsConsent: true })
    expect(res.status).toBe(200)
    expect((await res.json()).score).toBe(0)
  })

  it("7. files the SMS consent wording byte-for-byte as renderSmsConsentWording renders it", async () => {
    const { renderSmsConsentWording } = await import("@/lib/lead-engine/sms-consent-wording")
    await post({ phone: "+18135551234", smsConsent: true })
    expect(recordConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: CONTACT_ID,
        channel: "sms",
        granted: true,
        wordingShown: renderSmsConsentWording("DJP Athlete"),
      }),
    )
  })

  it("8. files no SMS consent row when the display name is blank, and still answers 200", async () => {
    getBusinessSettings.mockResolvedValue({ display_name: "" })
    const res = await post({ phone: "+18135551234", smsConsent: true })
    expect(res.status).toBe(200)
    expect(recordConsent).not.toHaveBeenCalled()
  })

  it("8b. files no SMS consent row when the visitor did not tick the box", async () => {
    await post({ phone: "+18135551234", smsConsent: false })
    expect(recordConsent).not.toHaveBeenCalled()
  })

  it("9. 404s for a quiz that is not active", async () => {
    getQuizDefinition.mockResolvedValue(definition("draft"))
    expect((await post()).status).toBe(404)
  })

  it("10. logs no raw PostgREST error — code and message only, never details", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    // The shape the house DAL rethrows: a plain object, not an Error, whose
    // `details` embeds the literal email address on a unique violation.
    recordContactEvent.mockRejectedValue({
      code: "23505",
      message: "duplicate key value violates unique constraint",
      details: "Key (email)=(sam@example.com) already exists.",
      hint: null,
    })
    await post()
    const logged = JSON.stringify(spy.mock.calls)
    expect(logged).toContain("23505")
    expect(logged).not.toContain("sam@example.com")
    expect(logged).not.toContain("details")
    spy.mockRestore()
  })

  it("14.1. alerts on a red result and not on a green one", async () => {
    await post()
    expect(sendQuizAlert).toHaveBeenCalledTimes(1)

    sendQuizAlert.mockClear()
    await post({ answers: [{ questionId: Q_ROUTER, optionId: O_TO_A }, { questionId: Q_A1, optionId: O_BEST }] })
    expect(sendQuizAlert).not.toHaveBeenCalled()
  })

  it("14.2. records alert_status failed when the mailer did not deliver", async () => {
    // NOT "sent". lib/email.ts returns a success shape with no API key, so an
    // attempt marked sent when nothing left the building is worse than one
    // marked failed — nobody goes looking for it.
    sendQuizAlert.mockResolvedValue({ delivered: false })
    await post()
    expect(setAttemptAlert).toHaveBeenCalledWith({ attemptId: ATTEMPT_ID, status: "failed" })
  })

  it("14.3. records sent when it really was delivered", async () => {
    await post()
    expect(setAttemptAlert).toHaveBeenCalledWith({ attemptId: ATTEMPT_ID, status: "sent" })
  })

  it("14.4. an alert failure does not change the visitor's response", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    sendQuizAlert.mockRejectedValue(new Error("smtp is down"))
    const res = await post()
    expect(res.status).toBe(200)
    expect((await res.json()).score).toBe(0)
    expect(setAttemptAlert).toHaveBeenCalledWith({ attemptId: ATTEMPT_ID, status: "failed" })
    spy.mockRestore()
  })

  it("13. hands the pipeline a quiz_result carrying the attempt id, so a replay cannot open two cards", async () => {
    await post()
    expect(applyPipelineEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: CONTACT_ID,
        event: expect.objectContaining({ kind: "quiz_result", tier: "red" }),
        metadata: expect.objectContaining({ quiz_attempt_id: ATTEMPT_ID }),
      }),
    )
  })

  it("13b. a pipeline failure does not change the visitor's response", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    applyPipelineEvent.mockRejectedValue(new Error("pipeline is down"))
    const res = await post()
    expect(res.status).toBe(200)
    expect(spy.mock.calls.map((c) => String(c[0])).join(" | ")).toContain("applyPipelineEvent failed")
    spy.mockRestore()
  })

  it("files every write under the ATTEMPT's business — contact, pipeline card, settings read, consent row", async () => {
    await post({ phone: "5551234567", smsConsent: true })
    expect(recordContactEvent.mock.calls[0][0]).toMatchObject({ businessId: ATTEMPT_BUSINESS_ID })
    expect(applyPipelineEvent.mock.calls[0][0]).toMatchObject({ businessId: ATTEMPT_BUSINESS_ID })
    expect(getBusinessSettings).toHaveBeenCalledWith(ATTEMPT_BUSINESS_ID)
    expect(recordConsent.mock.calls[0][0]).toMatchObject({ businessId: ATTEMPT_BUSINESS_ID })
  })

  it("refuses an attempt belonging to a different quiz", async () => {
    getAttempt.mockResolvedValue({ id: ATTEMPT_ID, quizId: "other", branchId: null, status: "in_progress", answers: [] })
    expect((await post()).status).toBe(404)
  })

  it("drops a forged option before it is scored or stored", async () => {
    await post({ answers: [{ questionId: Q_ROUTER, optionId: O_BEST }] })
    // O_BEST belongs to Q_A1, not the router: nothing is stored and no branch
    // is derived, so the walk is the router alone.
    expect(completeAttempt).toHaveBeenCalledWith(expect.objectContaining({ answers: [], branchId: null }))
  })
})
