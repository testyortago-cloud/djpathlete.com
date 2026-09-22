// @vitest-environment node
//
// The operator alert, and the difference between SENDING and NOT THROWING.
//
// `lib/email.ts` returns a success shape when RESEND_API_KEY is unset — about
// 38 senders in this app cannot tell whether anything was delivered. So the
// assertion that matters here is not "it was called": it is that an
// unconfigured mailer reports `delivered: false`, so the attempt is recorded
// as `failed` and somebody goes looking.
import { describe, it, expect, beforeEach, vi } from "vitest"
import type { QuizDefinition } from "@/lib/quizzes/types"

const sendQuizAlertEmail = vi.fn()
vi.mock("@/lib/email", () => ({ sendQuizAlertEmail: (...a: unknown[]) => sendQuizAlertEmail(...a) }))

import { sendQuizAlert, shouldAlert } from "@/lib/quizzes/alert"

const DEF: QuizDefinition = {
  id: "q",
  key: "rpi",
  name: "RPI",
  status: "active",
  introHeadline: "",
  introBody: "",
  gateHeadline: "",
  gateBody: "",
  resultHeadline: "",
  seedMarker: null,
  branches: [{ id: "b1", quizId: "q", key: "rebuilder", name: "Rebuilder", description: null, position: 1 }],
  profiles: [{ id: "p1", quizId: "q", key: "tight", name: "Explosive but tight", description: "d", position: 1 }],
  tiers: [
    {
      id: "t1",
      quizId: "q",
      key: "red",
      position: 1,
      minScore: 0,
      maxScore: 39,
      headline: "Large gaps",
      body: "b",
      ctaLabel: null,
      ctaHref: null,
    },
    {
      id: "t4",
      quizId: "q",
      key: "green",
      position: 4,
      minScore: 80,
      maxScore: 100,
      headline: "Well prepared",
      body: "b",
      ctaLabel: null,
      ctaHref: null,
    },
  ],
  questions: [],
}

const base = {
  businessId: "b0000000-0000-0000-0000-00000000000a",
  definition: DEF,
  attemptId: "att-1",
  name: "Sam Athlete",
  email: "sam@example.com",
  score: 20,
  tierKey: "red" as string | null,
  profileKey: "tight" as string | null,
  branchKey: "rebuilder" as string | null,
}

beforeEach(() => {
  vi.resetAllMocks()
  sendQuizAlertEmail.mockResolvedValue({ delivered: true })
})

describe("shouldAlert", () => {
  it("1. alerts on red and orange, and on nothing else", () => {
    expect(shouldAlert("red")).toBe(true)
    expect(shouldAlert("orange")).toBe(true)
    expect(shouldAlert("yellow")).toBe(false)
    expect(shouldAlert("green")).toBe(false)
    expect(shouldAlert(null)).toBe(false)
    // An unknown tier must not alert. A renamed band should go quiet, not
    // start interrupting someone's day on a guess.
    expect(shouldAlert("chartreuse")).toBe(false)
  })
})

describe("sendQuizAlert", () => {
  it("1b. sends for a red result and not for a green one", async () => {
    await sendQuizAlert(base)
    expect(sendQuizAlertEmail).toHaveBeenCalledTimes(1)

    sendQuizAlertEmail.mockClear()
    await sendQuizAlert({ ...base, tierKey: "green", score: 90 })
    expect(sendQuizAlertEmail).not.toHaveBeenCalled()
  })

  it("2. reports NOT delivered when the mailer says so — an unconfigured mailer is not a send", async () => {
    // This is the whole reason the function returns a flag rather than void.
    sendQuizAlertEmail.mockResolvedValue({ delivered: false })
    expect(await sendQuizAlert(base)).toEqual({ delivered: false })
  })

  it("3. reports delivered when the mailer actually delivered", async () => {
    expect(await sendQuizAlert(base)).toEqual({ delivered: true })
  })

  it("resolves the tier headline, branch name and profile name from the definition", async () => {
    await sendQuizAlert(base)
    expect(sendQuizAlertEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        tierHeadline: "Large gaps",
        branchName: "Rebuilder",
        profileName: "Explosive but tight",
        score: 20,
        attemptId: "att-1",
      }),
    )
  })

  it("names the business and invents no recipient of its own", async () => {
    // RETARGETED, not deleted. This used to pass `to: ""` and assert that a
    // missing recipient was never recorded as a delivery. Since G30 this
    // function does not choose a recipient at all -- `sendQuizAlertEmail`
    // reads the tenant's own `reply_to` -- so the invariant moved with it, to
    // "reports NOT delivered, and sends nothing, when the tenant has no
    // reply_to" in __tests__/lib/email/lead-alerts.test.ts.
    //
    // What is left to pin here is the half that stayed: this function hands
    // over WHOSE lead it is, and does not smuggle an address alongside it.
    await sendQuizAlert(base)

    const arg = sendQuizAlertEmail.mock.calls[0][0]
    expect(arg.businessId).toBe("b0000000-0000-0000-0000-00000000000a")
    expect(arg).not.toHaveProperty("to")
  })
})
