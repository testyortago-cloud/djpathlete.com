// @vitest-environment node
//
// G21 — the assessment route MINTS a contact, reversing the 8 Sept
// attach-only ruling. Owner ruled 2026-09-21.
//
// WHY THE OLD RULING FELL. It argued from "`contacts.user_id` has no
// originating writer anywhere in this repo … 0 of 170 production contacts
// have a user_id", and concluded that minting was a product decision the
// task could not make. G04 gave the column a writer and backfilled it:
// production is 43 of 170, re-verified 2026-09-21. The premise is gone.
//
// WHAT THIS ROUTE NOW MATCHES. `app/api/questionnaire/route.ts` (G20) is
// equally session-gated and already mints through `captureLead`. The two
// routes disagreeing on purpose was written into both files, into
// lib/tenancy/platform.ts and into the ledger. They now agree, and the
// questionnaire's comment anticipating this convergence is updated too.
//
// THESE TESTS ARE RETARGETED, NOT REPLACED -- but the mapping is not
// one-to-one, and claiming it was would overstate what is covered here.
//
// The attach-only suite had a "contact exists" case and a "contact does not
// exist" case because the ROUTE branched on that. It no longer does: it
// makes one unconditional `captureLead` call and the exists/does-not-exist
// decision now lives entirely inside `recordContactEvent`. With
// `captureLead` mocked, this file CANNOT distinguish those two, and no test
// below pretends to. That behaviour is covered where it actually lives, in
// the contacts DAL suites (`__tests__/db/contacts-record-event.test.ts`).
//
// What this file pins is the route's side of the contract: that the call
// happens, with exactly the right arguments, in the right order, and that
// no failure of it can cost the submitter their answers. The cases that DO
// carry over are the spine-write failure, the 401 and the 400.
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const createAssessmentResultMock = vi.fn()
const captureLeadMock = vi.fn(async (..._args: unknown[]) => "contact-1" as string | null)
const findContactMock = vi.fn()
const recordEventMock = vi.fn(async (..._args: unknown[]) => undefined)

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/assessments", () => ({
  getActiveQuestions: vi.fn(async () => []),
  getLatestAssessmentResult: vi.fn(async () => null),
  createAssessmentResult: (row: unknown) => createAssessmentResultMock(row),
}))
vi.mock("@/lib/assessment-scoring", () => ({
  computeAssessmentScores: vi.fn(() => ({ computed_levels: {}, max_difficulty_score: 5 })),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn(async () => undefined) }))
vi.mock("@/lib/lead-engine/capture", () => ({
  captureLead: (...a: unknown[]) => captureLeadMock(...a),
}))
// Kept mocked so the ATTACH-ONLY helpers can be asserted ABSENT. Without
// this the "no longer attaches" test below would pass because the module
// was never imported at all, rather than because the route stopped calling
// it -- an absence assertion with nothing behind it.
vi.mock("@/lib/db/contacts", () => ({
  findContactByIdentifiers: (...a: unknown[]) => findContactMock(...a),
  recordEventForExistingContact: (...a: unknown[]) => recordEventMock(...a),
}))
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz" }))

const USER_ID = "11111111-1111-4111-8111-111111111111"
const QUESTION_ID = "22222222-2222-4222-8222-222222222222"

function requestBody() {
  return { assessment_type: "initial", answers: { [QUESTION_ID]: "yes" }, feedback: null }
}

function postRequest(body: unknown = requestBody()) {
  return new Request("http://localhost/api/assessment/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: USER_ID, email: "athlete@example.com", name: "Sam Rivera" } })
  createAssessmentResultMock.mockResolvedValue({ id: "result-1", user_id: USER_ID })
  // clearAllMocks wipes the factory's implementation, not just the calls, so
  // the default has to be restored here or every test sees undefined.
  captureLeadMock.mockResolvedValue("contact-1")
})

describe("assessment submit — G21, the route joins the contact spine", () => {
  it("captures the lead with the exact arguments, so a contact is minted when none exists", async () => {
    const { POST } = await import("@/app/api/assessment/submit/route")
    const res = await POST(postRequest())
    expect(res.status).toBe(201)

    // The LITERAL argument object, not merely that a call happened.
    expect(captureLeadMock).toHaveBeenCalledTimes(1)
    expect(captureLeadMock.mock.calls[0][0]).toEqual({
      source: "assessment",
      email: "athlete@example.com",
      // The ACCOUNT's name, fill-only: it fills a contact that has none and
      // never overwrites a name the same person gave another surface.
      name: "Sam Rivera",
      nameFillOnly: true,
      userId: USER_ID,
      businessId: "platform-biz",
      metadata: { assessment_result_id: "result-1" },
    })
  })

  it("no longer ATTACHES -- the old findContactByIdentifiers path is gone", async () => {
    // The presence control for this absence is the captureLead assertion in
    // the test above: something IS called, just not these two.
    const { POST } = await import("@/app/api/assessment/submit/route")
    await POST(postRequest())
    expect(findContactMock).not.toHaveBeenCalled()
    expect(recordEventMock).not.toHaveBeenCalled()
  })

  it("passes the assessment result id, which is what makes the timeline row traceable", async () => {
    createAssessmentResultMock.mockResolvedValue({ id: "result-99", user_id: USER_ID })
    const { POST } = await import("@/app/api/assessment/submit/route")
    await POST(postRequest())
    expect(captureLeadMock.mock.calls[0][0]).toMatchObject({
      metadata: { assessment_result_id: "result-99" },
    })
  })

  it("captures AFTER the assessment row is written, so the id it carries is real", async () => {
    // Ordering, not just presence. Called one line earlier, the metadata
    // would reference a row that does not exist yet, and a failed insert
    // would still have minted a contact for an assessment nobody took.
    const order: string[] = []
    createAssessmentResultMock.mockImplementation(async () => {
      order.push("assessment")
      return { id: "result-1", user_id: USER_ID }
    })
    captureLeadMock.mockImplementation(async () => {
      order.push("capture")
      return "contact-1"
    })
    const { POST } = await import("@/app/api/assessment/submit/route")
    await POST(postRequest())
    expect(order).toEqual(["assessment", "capture"])
  })

  it("does not fail the submission when the assessment row insert fails, and captures nothing", async () => {
    createAssessmentResultMock.mockRejectedValue(new Error("insert failed"))
    const { POST } = await import("@/app/api/assessment/submit/route")
    const res = await POST(postRequest())
    expect(res.status).toBe(500)
    expect(captureLeadMock).not.toHaveBeenCalled()
  })

  it("still returns 201 when the spine write throws", async () => {
    // captureLead documents that it never throws. This asserts the route
    // does not DEPEND on that promise: a contact write must never cost a
    // submitter the answers they just filled in.
    captureLeadMock.mockRejectedValue(new Error("spine exploded"))
    const { POST } = await import("@/app/api/assessment/submit/route")
    const res = await POST(postRequest())
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe("result-1")
  })

  it("still returns 201 when captureLead declines and returns null", async () => {
    // captureLead returns null rather than throwing when there is no email
    // and no phone. The route must not treat that as an error.
    captureLeadMock.mockResolvedValue(null)
    const { POST } = await import("@/app/api/assessment/submit/route")
    const res = await POST(postRequest())
    expect(res.status).toBe(201)
  })

  it("passes a null name through rather than inventing one", async () => {
    authMock.mockResolvedValue({ user: { id: USER_ID, email: "athlete@example.com", name: null } })
    const { POST } = await import("@/app/api/assessment/submit/route")
    await POST(postRequest())
    expect(captureLeadMock.mock.calls[0][0]).toMatchObject({ name: null, nameFillOnly: true })
  })

  it("401s without a session, before any capture", async () => {
    authMock.mockResolvedValue(null)
    const { POST } = await import("@/app/api/assessment/submit/route")
    const res = await POST(postRequest())
    expect(res.status).toBe(401)
    expect(captureLeadMock).not.toHaveBeenCalled()
  })

  it("400s on an invalid body, before any capture", async () => {
    const { POST } = await import("@/app/api/assessment/submit/route")
    const res = await POST(postRequest({ assessment_type: "nonsense" }))
    expect(res.status).toBe(400)
    expect(captureLeadMock).not.toHaveBeenCalled()
  })
})
