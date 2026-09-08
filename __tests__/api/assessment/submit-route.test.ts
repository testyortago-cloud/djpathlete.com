// @vitest-environment node
//
// Gap #14, Task 2 — the `assessment` contact-event write, and the ruling it
// must never violate: this route 401s without a session, so everyone who
// submits is already a registered client, not a lead. `recordContactEvent`
// mints a contact unconditionally, which would change what the contacts
// list contains — a product decision this task does not make. So: record
// the event ONLY when a contact already exists for this user, and write
// NOTHING at all otherwise, without ever failing the submission itself.
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const createAssessmentResultMock = vi.fn()
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
vi.mock("@/lib/db/contacts", () => ({
  findContactByIdentifiers: (...a: unknown[]) => findContactMock(...a),
  recordEventForExistingContact: (...a: unknown[]) => recordEventMock(...a),
}))
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz" }))

const USER_ID = "11111111-1111-4111-8111-111111111111"
const QUESTION_ID = "22222222-2222-4222-8222-222222222222"

function requestBody() {
  return {
    assessment_type: "initial",
    answers: { [QUESTION_ID]: "yes" },
    feedback: null,
  }
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
  authMock.mockResolvedValue({ user: { id: USER_ID, email: "athlete@example.com" } })
  createAssessmentResultMock.mockResolvedValue({ id: "result-1", user_id: USER_ID })
  findContactMock.mockResolvedValue(null)
})

describe("assessment submit — the contact-event write", () => {
  it("records an assessment event when a contact already exists for this user", async () => {
    findContactMock.mockResolvedValue("contact-1")
    const { POST } = await import("@/app/api/assessment/submit/route")
    const res = await POST(postRequest())
    expect(res.status).toBe(201)
    // Assert the LITERAL arguments, not merely that a call happened.
    expect(findContactMock).toHaveBeenCalledWith({ userId: USER_ID, businessId: "platform-biz" })
    expect(recordEventMock).toHaveBeenCalledTimes(1)
    expect(recordEventMock.mock.calls[0][0]).toMatchObject({
      contactId: "contact-1",
      businessId: "platform-biz",
      source: "assessment",
    })
  })

  // THE ABSENCE ASSERTION, paired with a presence control (the test above):
  // nothing is written when no contact exists, and the route still succeeds
  // normally rather than throwing.
  it("writes nothing at all when no contact exists for this user, and the submission still succeeds", async () => {
    findContactMock.mockResolvedValue(null)
    const { POST } = await import("@/app/api/assessment/submit/route")
    const res = await POST(postRequest())
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe("result-1")
    expect(recordEventMock).not.toHaveBeenCalled()
  })

  // A contact write must never fail an assessment submission — same
  // discipline as the Stripe webhook's tryCaptureLeadFromCheckout.
  it("still succeeds when the contact lookup throws", async () => {
    findContactMock.mockRejectedValue(new Error("contacts read failed"))
    const { POST } = await import("@/app/api/assessment/submit/route")
    const res = await POST(postRequest())
    expect(res.status).toBe(201)
    expect(recordEventMock).not.toHaveBeenCalled()
  })

  it("still succeeds when the contact-event write itself throws", async () => {
    findContactMock.mockResolvedValue("contact-1")
    recordEventMock.mockRejectedValue(new Error("timeline insert failed"))
    const { POST } = await import("@/app/api/assessment/submit/route")
    const res = await POST(postRequest())
    expect(res.status).toBe(201)
  })

  it("401s without a session, before any contact lookup", async () => {
    authMock.mockResolvedValue(null)
    const { POST } = await import("@/app/api/assessment/submit/route")
    const res = await POST(postRequest())
    expect(res.status).toBe(401)
    expect(findContactMock).not.toHaveBeenCalled()
    expect(recordEventMock).not.toHaveBeenCalled()
  })
})
