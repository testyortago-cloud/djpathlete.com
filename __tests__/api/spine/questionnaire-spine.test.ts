// @vitest-environment node
//
// G20. POST /api/questionnaire joining the contact spine. Before this, the
// route wrote `client_profiles` and pushed the person to GoHighLevel and
// nothing else — a completed questionnaire, one of the richest signals of
// intent the product collects, left no trace on the contact timeline at all.
//
// `recordContactEvent` is mocked directly rather than driven through a fake
// database (the same lighter-weight approach as contact-spine.test.ts): what
// this route owes the spine is one correctly-shaped call on BOTH of its write
// branches, and the DAL's own behaviour is pinned in
// __tests__/db/contacts-record-event.test.ts.
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getProfileByUserId: vi.fn(),
  createProfile: vi.fn(),
  updateProfile: vi.fn(),
  recordContactEvent: vi.fn(),
  ghlCreateContact: vi.fn(),
  ghlTriggerWorkflow: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/db/client-profiles", () => ({
  getProfileByUserId: mocks.getProfileByUserId,
  createProfile: mocks.createProfile,
  updateProfile: mocks.updateProfile,
}))
vi.mock("@/lib/db/contacts", () => ({ recordContactEvent: mocks.recordContactEvent }))
vi.mock("@/lib/ghl", () => ({
  ghlCreateContact: mocks.ghlCreateContact,
  ghlTriggerWorkflow: mocks.ghlTriggerWorkflow,
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: mocks.recordAudit }))

// The tenant seam, mocked to a sentinel that is NOT the platform's real id, so
// a route that reached past `platformBusinessId()` for the constant could not
// pass this file.
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "seam-biz" }))

import { POST } from "@/app/api/questionnaire/route"

// The questionnaire validator is strict and long; this is the minimum body it
// accepts, with every value taken from lib/validators/questionnaire.ts rather
// than invented. `preferred_day_names` really is an array of NUMBERS (1-7)
// despite the column's name — the route stores `.length` of it as
// `preferred_training_days`.
const VALID_BODY = {
  goals: ["muscle_gain"],
  experience_level: "intermediate",
  available_equipment: ["barbell"],
  preferred_day_names: [1, 3],
  preferred_session_minutes: 60,
  injury_details: [],
}

function post(body: unknown = VALID_BODY) {
  return POST(
    new Request("http://localhost/api/questionnaire", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
}

const SESSION = {
  user: { id: "user-1", email: "Jamie@Example.com", name: "Jamie Rivera", role: "client" },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(SESSION)
  mocks.createProfile.mockResolvedValue({ id: "profile-1" })
  mocks.updateProfile.mockResolvedValue({ id: "profile-1" })
  mocks.recordContactEvent.mockResolvedValue({ contactId: "contact-1", created: true, merged: false })
  mocks.ghlCreateContact.mockResolvedValue(null)
  mocks.ghlTriggerWorkflow.mockResolvedValue(true)
  mocks.recordAudit.mockResolvedValue(undefined)
})

describe("POST /api/questionnaire — joins the contact spine (G20)", () => {
  it("records a questionnaire event when the profile is CREATED", async () => {
    mocks.getProfileByUserId.mockResolvedValue(null)

    const res = await post()
    expect(res.status).toBe(200)

    expect(mocks.recordContactEvent).toHaveBeenCalledTimes(1)
    expect(mocks.recordContactEvent.mock.calls[0][0]).toMatchObject({
      source: "questionnaire",
      email: "Jamie@Example.com",
      name: "Jamie Rivera",
      userId: "user-1",
      businessId: "seam-biz",
    })
  })

  // The route returns from two different places. The create branch returns
  // early, so a capture written only after it would miss every RE-submission —
  // and re-submitting is the ordinary case for a questionnaire, not the edge
  // one.
  it("records a questionnaire event when the profile is UPDATED", async () => {
    mocks.getProfileByUserId.mockResolvedValue({ id: "profile-1" })

    const res = await post()
    expect(res.status).toBe(200)

    expect(mocks.recordContactEvent).toHaveBeenCalledTimes(1)
    expect(mocks.recordContactEvent.mock.calls[0][0]).toMatchObject({
      source: "questionnaire",
      email: "Jamie@Example.com",
      userId: "user-1",
      businessId: "seam-biz",
    })
  })

  // The submitter is a logged-in account, so the name on offer is the
  // account's — not something typed on this form. It must fill a blank, never
  // replace a name the person gave a different surface.
  it("asks for the name to be filled only, never overwritten", async () => {
    mocks.getProfileByUserId.mockResolvedValue(null)

    await post()

    expect(mocks.recordContactEvent.mock.calls[0][0]).toMatchObject({ nameFillOnly: true })
  })

  it("carries the questionnaire's own profile id as metadata, so the timeline row is traceable", async () => {
    mocks.getProfileByUserId.mockResolvedValue(null)

    await post()

    expect(mocks.recordContactEvent.mock.calls[0][0].metadata).toMatchObject({
      client_profile_id: "profile-1",
    })
  })
})

// Each test here asserts recordContactEvent was ACTUALLY CALLED before
// asserting the route survived it throwing. Without that line both tests pass
// on a route that never joins the spine at all — which is exactly the state
// this gap exists to leave behind, so they would have gone green on the
// unfixed route and stayed green if the call were later deleted.
describe("POST /api/questionnaire — a spine failure never costs the submitter their answers", () => {
  it("still saves the profile and answers 200 when recordContactEvent throws", async () => {
    mocks.getProfileByUserId.mockResolvedValue(null)
    mocks.recordContactEvent.mockRejectedValueOnce(new Error("PGRST204 column missing"))

    const res = await post()
    const body = await res.json()

    expect(mocks.recordContactEvent).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(200)
    expect(body).toEqual({ profile: { id: "profile-1" } })
    expect(mocks.createProfile).toHaveBeenCalledTimes(1)
    expect(mocks.recordAudit).toHaveBeenCalledTimes(1)
  })

  it("still saves the profile and answers 200 on the update branch too", async () => {
    mocks.getProfileByUserId.mockResolvedValue({ id: "profile-1" })
    mocks.recordContactEvent.mockRejectedValueOnce(new Error("PGRST204 column missing"))

    const res = await post()

    expect(mocks.recordContactEvent).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(200)
    expect(mocks.updateProfile).toHaveBeenCalledTimes(1)
    expect(mocks.recordAudit).toHaveBeenCalledTimes(1)
  })
})

describe("POST /api/questionnaire — who it will not capture", () => {
  it("captures nothing when there is no session, because the route 401s first", async () => {
    mocks.auth.mockResolvedValue(null)

    const res = await post()

    expect(res.status).toBe(401)
    expect(mocks.recordContactEvent).not.toHaveBeenCalled()
  })

  // captureLead returns null rather than writing when it has no identifier at
  // all. A session with no email is the only way this route can reach that,
  // and it must not mint an identifier-less contact row.
  it("captures nothing when the session carries no email", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-1", email: null, name: "Jamie Rivera", role: "client" } })
    mocks.getProfileByUserId.mockResolvedValue(null)

    const res = await post()

    expect(res.status).toBe(200)
    expect(mocks.recordContactEvent).not.toHaveBeenCalled()
  })
})
