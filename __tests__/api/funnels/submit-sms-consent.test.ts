// @vitest-environment node
//
// Pinned to node: the default jsdom environment crashes on worker start
// in this repo (ERR_REQUIRE_ESM in html-encoding-sniffer), and reports as
// "Test Files no tests" rather than a failure. Without this line the suite
// silently runs nothing.
// POST /api/funnels/submit — SMS consent capture (Lead Engine Stage 2, Task 6).
//
// The checkbox lives on the client; this is the half that matters legally.
// `contact_consents.wording_shown` has to reproduce EXACTLY what the visitor
// saw, so the server re-renders it from the same `renderSmsConsentWording`
// function the form island used, fed the same `business_settings.display_name`
// input — never a copy of the string, never a guess.
//
// And the consent write must never be the reason a lead is lost: a phone
// number handed over is worth more than a consent row, so a `recordConsent`
// failure has to leave the submission (and the response) untouched.

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
import { renderSmsConsentWording } from "@/lib/lead-engine/sms-consent-wording"

const FUNNEL_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
const STEP_ID = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"
const CONTACT_ID = "cccccccc-3333-4333-8333-cccccccccccc"

const FIELDS = [{ name: "phone", label: "Phone number", type: "tel", required: true }]

let ipCounter = 0
function request(overrides: Record<string, unknown> = {}) {
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
      formKey: "optin",
      values: { phone: "5551234567" },
      elapsedMs: 9000,
      ...overrides,
    }),
  })
}

beforeEach(() => {
  getPublishedFormConfig.mockReset().mockResolvedValue({
    formKey: "optin",
    successMode: "message",
    fields: FIELDS,
  })
  createSubmission.mockReset().mockResolvedValue({ id: "sub1" })
  captureContactFromSubmission.mockReset().mockResolvedValue(CONTACT_ID)
  recordConsent.mockReset().mockResolvedValue(undefined)
  getBusinessSettings.mockReset().mockResolvedValue({
    business_id: "biz-1",
    display_name: "Acme Fitness",
  })
  recordAudit.mockReset()
  sendNewFunnelLeadEmail.mockReset().mockResolvedValue(undefined)
  getFunnelById.mockReset().mockResolvedValue({ id: FUNNEL_ID, slug: "camp", name: "Camp" })
  getStep.mockReset().mockResolvedValue({ id: STEP_ID, slug: "optin", name: "Opt in" })
})

/** recordConsent runs fire-and-forget; give its microtask chain a turn. */
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe("POST /api/funnels/submit — SMS consent", () => {
  it("writes a consent row quoting the exact rendered wording when sms_consent is true and phone is present", async () => {
    const res = await POST(request({ sms_consent: true }))
    await flush()

    expect(res.status).toBe(200)
    expect(recordConsent).toHaveBeenCalledWith({
      contactId: CONTACT_ID,
      channel: "sms",
      granted: true,
      source: "funnel_form",
      wordingShown: renderSmsConsentWording("Acme Fitness"),
      ip: "203.0.113.1",
      userAgent: "test-agent",
      businessId: "host-biz",
    })
  })

  it("writes no consent row when sms_consent is false", async () => {
    const res = await POST(request({ sms_consent: false }))
    await flush()

    expect(res.status).toBe(200)
    expect(recordConsent).not.toHaveBeenCalled()
  })

  it("writes no consent row when sms_consent is absent from the payload", async () => {
    const res = await POST(request())
    await flush()

    expect(res.status).toBe(200)
    expect(recordConsent).not.toHaveBeenCalled()
  })

  it("still captures the lead, and still responds success, when the consent write throws", async () => {
    recordConsent.mockRejectedValue(new Error("db is down"))
    const res = await POST(request({ sms_consent: true }))
    await flush()

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })
    expect(createSubmission).toHaveBeenCalled()
    expect(recordConsent).toHaveBeenCalled()
  })

  it("writes no consent row when sms_consent is true but no contact was captured", async () => {
    captureContactFromSubmission.mockResolvedValue(null)
    const res = await POST(request({ sms_consent: true }))
    await flush()

    expect(res.status).toBe(200)
    expect(recordConsent).not.toHaveBeenCalled()
  })

  it("writes no consent row when business_settings.display_name is blank, even though sms_consent is true and phone is present — the lead is still captured", async () => {
    // A sentence that cannot name the business is not consent to anything —
    // the same rule the form island applies before it will even show the
    // checkbox (FormIsland.tsx / hasSmsConsentDisplayName). Checked here too
    // in case the two reads disagree: a page rendered while a name was
    // configured, then business_settings went blank before this request
    // reached the server (or vice versa).
    getBusinessSettings.mockResolvedValue({ business_id: "biz-1", display_name: "" })
    const res = await POST(request({ sms_consent: true }))
    await flush()

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })
    expect(createSubmission).toHaveBeenCalled()
    expect(recordConsent).not.toHaveBeenCalled()
  })

  it("writes no consent row when business_settings.display_name is whitespace-only", async () => {
    getBusinessSettings.mockResolvedValue({ business_id: "biz-1", display_name: "   " })
    const res = await POST(request({ sms_consent: true }))
    await flush()

    expect(res.status).toBe(200)
    expect(recordConsent).not.toHaveBeenCalled()
  })
})

describe("POST /api/funnels/submit — tenant", () => {
  it("resolves the tenant once through the seam and threads it into the bridge, the settings read and the consent row", async () => {
    const res = await POST(request({ sms_consent: true }))
    await flush()
    expect(res.status).toBe(200)
    expect(captureContactFromSubmission.mock.calls[0][0]).toMatchObject({ businessId: "host-biz" })
    expect(getBusinessSettings).toHaveBeenCalledWith("host-biz")
    expect(recordConsent.mock.calls[0][0]).toMatchObject({ businessId: "host-biz" })
  })
})
