// @vitest-environment node
//
// Pinned to node: the default jsdom environment crashes on worker start
// in this repo (ERR_REQUIRE_ESM in html-encoding-sniffer), and reports as
// "Test Files no tests" rather than a failure. Without this line the suite
// silently runs nothing.
//
// POST /api/funnels/submit — capturing the lead's name (Lead Engine audit
// §3.2).
//
// The AI builder names its fields `athlete_name` / `parent_name`, tagged with
// a matching `role` (FORM_FIELD_ROLES in lib/funnels/islands.ts). The old
// `buildName()` read only `first_name` / `name` / `last_name`, so every lead
// the AI builder produces reached Contacts, the submissions board and the
// coach alert email with no name at all — email and phone survived only
// because they are found by field TYPE, not by name.
//
// These tests pin the fix's precedence, in order: an explicit role wins (the
// parent's, since the parent is who the coach calls); then the legacy shape
// older, pre-role templates already rely on; then a best-effort scan of any
// text field whose name says "name" (a parent/guardian-ish one preferred);
// and finally `null` when nothing on the form looks like a name at all.

import { describe, expect, it, vi, beforeEach } from "vitest"

const getPublishedFormConfig = vi.fn()
const createSubmission = vi.fn()
const captureContactFromSubmission = vi.fn()
const recordConsent = vi.fn()
const getBusinessSettings = vi.fn()
const recordAudit = vi.fn()
const sendNewFunnelLeadEmail = vi.fn()
const getFunnelById = vi.fn()
const getStep = vi.fn()

vi.mock("@/lib/db/funnels", () => ({
  getPublishedFormConfig: (...a: unknown[]) => getPublishedFormConfig(...a),
  createSubmission: (...a: unknown[]) => createSubmission(...a),
  getFunnelById: (...a: unknown[]) => getFunnelById(...a),
  getStep: (...a: unknown[]) => getStep(...a),
  listSteps: vi.fn(async () => []),
}))
vi.mock("@/lib/funnels/capture-contact", () => ({
  captureContactFromSubmission: (...a: unknown[]) => captureContactFromSubmission(...a),
}))
vi.mock("@/lib/db/contact-consents", () => ({
  recordConsent: (...a: unknown[]) => recordConsent(...a),
}))
vi.mock("@/lib/db/businesses", () => ({
  getBusinessSettings: (...a: unknown[]) => getBusinessSettings(...a),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...a) }))
vi.mock("@/lib/email", () => ({ sendNewFunnelLeadEmail: (...a: unknown[]) => sendNewFunnelLeadEmail(...a) }))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: vi.fn(async () => false) }))
vi.mock("@/lib/db/marketing-attribution", () => ({ getAttributionBySession: vi.fn(async () => null) }))
vi.mock("@/lib/marketing/cookies", () => ({ parseAttrCookie: () => null }))
vi.mock("@/lib/db/events", () => ({ getEventById: vi.fn(async () => null) }))
vi.mock("@/lib/events/checkout", () => ({ createEventSignupCheckout: vi.fn() }))
// The route resolves its tenant from the request's Host through the ONE Host
// boundary (lib/tenancy/public.ts). Mocked to a sentinel that is not the
// platform's, so a route that hard-codes platformBusinessId() cannot pass.
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: async () => "host-biz" }))

import { POST } from "@/app/api/funnels/submit/route"

const FUNNEL_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
const STEP_ID = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"

/** What the AI builder actually emits: role-tagged athlete/parent fields. */
const ROLE_FIELDS = [
  { name: "athlete_name", label: "Athlete", type: "text", role: "athlete_name" },
  { name: "parent_name", label: "Parent", type: "text", role: "parent_name" },
  { name: "email", label: "Email", type: "email" },
]

/** The shape the first templates used, before roles existed. */
const LEGACY_FIELDS = [
  { name: "first_name", label: "First name", type: "text" },
  { name: "last_name", label: "Last name", type: "text" },
  { name: "email", label: "Email", type: "email" },
]

/** No role, no legacy key — just a plain field an owner named themselves. */
const FALLBACK_FIELDS = [
  { name: "your_name", label: "Your name", type: "text" },
  { name: "email", label: "Email", type: "email" },
]

/** Nothing on this form is name-shaped at all. */
const NAMELESS_FIELDS = [
  { name: "email", label: "Email", type: "email" },
  { name: "message", label: "Message", type: "textarea" },
]

let ipCounter = 0
/**
 * Never fills in an email VALUE, even on fixtures that declare an email
 * field: a filled email drives the route into `upsertLead`, which hits the
 * real `@/lib/supabase` client (not mocked here, unlike submit-checkout's
 * suite). Leaving it blank keeps `email` (and therefore that branch) null,
 * which this suite has no reason to exercise.
 */
function request(values: Record<string, string>) {
  ipCounter += 1
  return new Request("http://t.test/api/funnels/submit", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "test-agent",
      "x-forwarded-for": `203.0.113.${ipCounter}`,
    },
    body: JSON.stringify({
      funnelId: FUNNEL_ID,
      stepId: STEP_ID,
      formKey: "signup",
      values,
      elapsedMs: 9000,
    }),
  })
}

function mockForm(fields: unknown[]) {
  getPublishedFormConfig.mockResolvedValue({ formKey: "signup", fields })
}

/** notifyCoachOfLead runs fire-and-forget; give its microtask chain a turn. */
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  getPublishedFormConfig.mockReset()
  createSubmission.mockReset().mockResolvedValue({ id: "sub1" })
  captureContactFromSubmission.mockReset().mockResolvedValue(null)
  recordConsent.mockReset().mockResolvedValue(undefined)
  getBusinessSettings.mockReset().mockResolvedValue({ business_id: "biz-1", display_name: "Acme Fitness" })
  recordAudit.mockReset()
  sendNewFunnelLeadEmail.mockReset().mockResolvedValue(undefined)
  // Task 4 (later) makes the route 404 unless the funnel it looks up is
  // published — resolved here so this suite survives that change too.
  getFunnelById.mockReset().mockResolvedValue({
    id: "f1",
    name: "Off-Season Speed Camp",
    status: "published",
    notify_emails: null,
  })
  getStep.mockReset().mockResolvedValue({ id: STEP_ID, funnel_id: FUNNEL_ID, slug: "signup", name: "Sign up" })
})

describe("POST /api/funnels/submit — lead name capture", () => {
  it("prefers the parent's name when both parent and athlete roles are filled", async () => {
    // MUTANT: swapping the [parent_name, athlete_name] preference order in
    // buildName's role loop returns "Riley Audit" here instead. Reverting
    // buildName to its pre-fix form (reading only first_name/name/last_name)
    // returns null instead, since neither role field is named "first_name".
    mockForm(ROLE_FIELDS)
    const res = await POST(request({ athlete_name: "Riley Audit", parent_name: "Aean Audit" }))
    await flush()

    expect(res.status).toBe(200)
    expect(createSubmission).toHaveBeenCalledWith(expect.objectContaining({ name: "Aean Audit" }))
    expect(sendNewFunnelLeadEmail).toHaveBeenCalledWith(expect.objectContaining({ name: "Aean Audit" }))
  })

  it("falls back to the athlete's name when only the athlete field is filled", async () => {
    // MUTANT: a role lookup that doesn't skip a blank match (e.g. returning ""
    // instead of falling through to the next tier) leaves this lead nameless
    // even though "Riley Audit" was typed right there on the form.
    mockForm(ROLE_FIELDS)
    const res = await POST(request({ athlete_name: "Riley Audit" }))
    await flush()

    expect(res.status).toBe(200)
    expect(createSubmission).toHaveBeenCalledWith(expect.objectContaining({ name: "Riley Audit" }))
  })

  it("still reads the legacy first_name/last_name shape older templates use", async () => {
    // MUTANT: dropping the legacy tier once roles exist would break every
    // funnel built before roles existed. Regression control for the fix.
    mockForm(LEGACY_FIELDS)
    const res = await POST(request({ first_name: "Riley", last_name: "Audit" }))
    await flush()

    expect(res.status).toBe(200)
    expect(createSubmission).toHaveBeenCalledWith(expect.objectContaining({ name: "Riley Audit" }))
  })

  it("falls back to a plain *name* text field when there is no role or legacy key", async () => {
    // MUTANT: removing the fallback scan (the third tier) entirely leaves a
    // form whose owner simply called their field "your_name" nameless, same
    // as before the fix.
    mockForm(FALLBACK_FIELDS)
    const res = await POST(request({ your_name: "Casey Audit" }))
    await flush()

    expect(res.status).toBe(200)
    expect(createSubmission).toHaveBeenCalledWith(expect.objectContaining({ name: "Casey Audit" }))
  })

  it("returns null when nothing on the form looks like a name", async () => {
    // MUTANT: `|| ""` instead of `|| null` at the end of buildName makes a
    // genuinely nameless lead indistinguishable from one whose name field was
    // merely left blank — both would read as an empty string, not "no name".
    mockForm(NAMELESS_FIELDS)
    const res = await POST(request({ message: "Interested in the camp" }))
    await flush()

    expect(res.status).toBe(200)
    expect(createSubmission).toHaveBeenCalledWith(expect.objectContaining({ name: null }))
  })
})
