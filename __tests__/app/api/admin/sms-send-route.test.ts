// @vitest-environment node
//
// POST /api/admin/sms/send — the manual send.
//
// THIS ROUTE IS THE GUARD. The compose box is disabled for a suppressed
// number too, but that is not a guard: if the claim is "no surface can text
// a suppressed number", this route is what has to enforce it, so every
// suppression assertion below calls POST directly with no UI in the picture.
//
// Every mock below is wrapped as `(...a) => xMock(...a)` rather than
// referenced bare inside the `vi.mock` factory. vi.mock factories run when
// the mocked specifier is first imported, which (per ES module semantics)
// happens before any of this file's own top-level `const` statements run —
// a bare `{ auth }` shorthand referencing `const auth = vi.fn()` hits that
// binding in its temporal dead zone and throws "Cannot access 'auth' before
// initialization" before a single test runs. Wrapping defers the read of
// the outer const until the mock is actually CALLED, by which point the
// test file's top-level code has finished running. See
// __tests__/api/admin/pipeline-move.test.ts for the same convention.
import { describe, it, expect, vi, beforeEach } from "vitest"

const sendManualSmsMock = vi.fn()
const resolveAdminTenantForRequestMock = vi.fn()
const currentActorMock = vi.fn()
const canAccessPathMock = vi.fn()
const getBusinessSettingsMock = vi.fn()
const recentOutboundExistsMock = vi.fn()
const getContactByIdMock = vi.fn()
const recordAuditMock = vi.fn()
const authMock = vi.fn()

vi.mock("@/lib/lead-engine/sms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/lead-engine/sms")>()
  return { ...actual, sendManualSms: (...a: unknown[]) => sendManualSmsMock(...a) }
})
vi.mock("@/lib/tenancy/resolve", () => ({
  resolveAdminTenantForRequest: (...a: unknown[]) => resolveAdminTenantForRequestMock(...a),
}))
vi.mock("@/lib/permissions/guard", () => ({
  currentActor: (...a: unknown[]) => currentActorMock(...a),
}))
vi.mock("@/lib/permissions/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions/registry")>()
  return { ...actual, canAccessPath: (...a: unknown[]) => canAccessPathMock(...a) }
})
vi.mock("@/lib/db/businesses", () => ({
  getBusinessSettings: (...a: unknown[]) => getBusinessSettingsMock(...a),
}))
vi.mock("@/lib/db/sms-messages", () => ({
  recentOutboundExists: (...a: unknown[]) => recentOutboundExistsMock(...a),
}))
vi.mock("@/lib/db/contact-detail", () => ({
  getContactById: (...a: unknown[]) => getContactByIdMock(...a),
}))
// Exposed as a wrapped mock (not an anonymous `vi.fn()`) so refusal-audit and
// quiet-hours tests can assert on the calls `withAudit` AND the route's own
// inline `recordAudit()` both make into this same module.
vi.mock("@/lib/audit/record", () => ({
  recordAudit: (...a: unknown[]) => recordAuditMock(...a),
}))
// The route must source `sentBy` from the SESSION, not from `currentActor()`
// — currentActor() never returns an id (lib/permissions/guard.ts:68 returns
// only { role, permissions }). Mocking @/lib/auth separately, with a value
// that never coincides with anything currentActorMock returns, is what makes
// a route reading `actor.id` fail this suite instead of passing by accident.
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))

import { POST } from "@/app/api/admin/sms/send/route"
import {
  SmsSuppressedError,
  SmsNotConfiguredError,
  SmsTooLongError,
  SmsUnparseablePhoneError,
  SmsNoConsentError,
  countSmsSegments,
  renderManualSms,
} from "@/lib/lead-engine/sms"

const BIZ = "11111111-1111-1111-1111-111111111111"
const CONTACT_ID = "22222222-2222-4222-a222-222222222222"
const SESSION_USER_ID = "user-session-42"

// This route has no dynamic segment, so there is nothing real to put in
// `context.params` — but `withAudit`'s Handler type still requires the
// second argument (see __tests__/api/admin/pipeline-move.test.ts).
const NO_PARAMS = { params: Promise.resolve({}) }

function post(body: unknown) {
  const request = new Request("https://example.com/api/admin/sms/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return POST(request, NO_PARAMS)
}

beforeEach(() => {
  vi.resetAllMocks()
  resolveAdminTenantForRequestMock.mockResolvedValue({ businessId: BIZ, choices: [], isOperator: true })
  // Deliberately NO `id` field — this is the real shape currentActor() returns.
  currentActorMock.mockResolvedValue({ role: "admin", permissions: null })
  canAccessPathMock.mockReturnValue(true)
  authMock.mockResolvedValue({ user: { id: SESSION_USER_ID, role: "admin" } })
  getBusinessSettingsMock.mockResolvedValue({ sms_messaging_service_sid: "MGtest" })
  recentOutboundExistsMock.mockResolvedValue(false)
  // A contact that DOES belong to this business, by default — tests for the
  // cross-tenant case override this to null.
  getContactByIdMock.mockResolvedValue({
    id: CONTACT_ID,
    business_id: BIZ,
    user_id: null,
    name: "Test Contact",
    email: null,
    phone_e164: "+15551230000",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    timezone: null,
  })
  recordAuditMock.mockResolvedValue(undefined)
  sendManualSmsMock.mockResolvedValue({ messageId: "m1", providerMessageId: "SM1", text: "hi" })
})

describe("POST /api/admin/sms/send — the suppression guard", () => {
  it("answers 409 and does NOT send when the number is suppressed", async () => {
    sendManualSmsMock.mockRejectedValue(new SmsSuppressedError("+15551230000"))

    const res = await post({ phone: "+15551230000", body: "hi" })

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.reason).toBe("suppressed")
  })

  it("refuses a suppressed number even with a signed-in admin and a valid body", async () => {
    // The route is the guard. The compose box being disabled proves nothing.
    sendManualSmsMock.mockRejectedValue(new SmsSuppressedError("+15551230000"))
    const res = await post({ phone: "+15551230000", body: "please reply" })
    expect(res.status).toBe(409)
  })
})

describe("POST /api/admin/sms/send — configuration", () => {
  it("answers 503 rather than a success shape when SMS is unconfigured", async () => {
    sendManualSmsMock.mockRejectedValue(new SmsNotConfiguredError(["sms_messaging_service_sid"]))
    const res = await post({ phone: "+15551230000", body: "hi" })
    expect(res.status).toBe(503)
    expect((await res.json()).reason).toBe("not_configured")
  })
})

describe("POST /api/admin/sms/send — refusal is its own audited event", () => {
  // Important 1 (fix round 1): `sms.send_refused` used to be a slug with no
  // writer. A 409/503 was only ever recorded by `withAudit` as
  // `sms.sent_manual`/outcome:failure — a send action pretending a send was
  // attempted-and-failed, rather than a refusal. These assert the SPECIFIC
  // slug is recorded, on top of (not instead of) that generic wrapper row.
  it("records sms.send_refused with reason 'suppressed' and the phone", async () => {
    sendManualSmsMock.mockRejectedValue(new SmsSuppressedError("+15551230000"))
    await post({ phone: "+15551230000", body: "hi" })
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sms.send_refused",
        category: "marketing",
        metadata: expect.objectContaining({ reason: "suppressed", phone: "+15551230000" }),
      }),
    )
  })

  it("records sms.send_refused with reason 'not_configured'", async () => {
    sendManualSmsMock.mockRejectedValue(new SmsNotConfiguredError(["sms_messaging_service_sid"]))
    await post({ phone: "+15551230000", body: "hi" })
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sms.send_refused",
        category: "marketing",
        metadata: expect.objectContaining({ reason: "not_configured", phone: "+15551230000" }),
      }),
    )
  })
})

describe("POST /api/admin/sms/send — message length (real segment math)", () => {
  // Important 2 (fix round 1): Zod's 1600-char cap on `body` does not catch
  // this. A single emoji forces the WHOLE rendered text to UCS-2 (67
  // chars/segment instead of 153), so a ~700-character body can pass Zod and
  // still be well over 10 segments. The exact segment count below comes from
  // the REAL (unmocked) countSmsSegments/renderManualSms, not a made-up
  // number, so this input genuinely reaches SmsTooLongError in production —
  // sendManualSms is still mocked at this layer (route tests assert the
  // route's mapping; sendManualSms's own segment check is covered by
  // __tests__/lib/lead-engine/send-manual-sms.test.ts).
  it("answers 400 (not 502) with the real segment count when the text exceeds 10 segments", async () => {
    const body = "a".repeat(700) + "🙂"
    const { text } = renderManualSms({ body, appendOptOut: true })
    const { segments } = countSmsSegments(text)
    expect(segments).toBeGreaterThan(10) // sanity: this input really is too long

    sendManualSmsMock.mockRejectedValue(new SmsTooLongError(segments, 10))
    const res = await post({ phone: "+15551230000", body })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.reason).toBe("too_long")
    expect(json.error).toContain(String(segments))
  })
})

describe("POST /api/admin/sms/send — phone validity", () => {
  // "+12345678" matches the route's own /^\+[1-9]\d{7,14}$/ shape check (8
  // digits total, inside the 7-14 range) but fails libphonenumber-js's
  // isValid() — it is not an assigned NANP number. Genuinely reaches
  // SmsUnparseablePhoneError once it passes Zod and hits sendManualSms.
  it("answers 400 (not 502) for a shape-valid but not-real phone number", async () => {
    const phone = "+12345678"
    sendManualSmsMock.mockRejectedValue(new SmsUnparseablePhoneError(phone))
    const res = await post({ phone, body: "hi" })
    expect(res.status).toBe(400)
    expect((await res.json()).reason).toBe("invalid_phone")
  })
})

describe("POST /api/admin/sms/send — auth", () => {
  it("answers 403 when the actor cannot reach this path", async () => {
    canAccessPathMock.mockReturnValue(false)
    const res = await post({ phone: "+15551230000", body: "hi" })
    expect(res.status).toBe(403)
    expect(sendManualSmsMock).not.toHaveBeenCalled()
  })

  it("answers 403 when there is no actor at all", async () => {
    currentActorMock.mockResolvedValue(null)
    const res = await post({ phone: "+15551230000", body: "hi" })
    expect(res.status).toBe(403)
    expect(sendManualSmsMock).not.toHaveBeenCalled()
  })
})

describe("POST /api/admin/sms/send — validation", () => {
  it("rejects an empty body", async () => {
    const res = await post({ phone: "+15551230000", body: "   " })
    expect(res.status).toBe(400)
    expect(sendManualSmsMock).not.toHaveBeenCalled()
  })

  it("rejects a phone that is not E.164", async () => {
    const res = await post({ phone: "not-a-phone", body: "hi" })
    expect(res.status).toBe(400)
    expect(sendManualSmsMock).not.toHaveBeenCalled()
  })
})

describe("POST /api/admin/sms/send — the opt-out rule", () => {
  it("appends the opt-out sentence on the first outbound in 30 days", async () => {
    recentOutboundExistsMock.mockResolvedValue(false)
    await post({ phone: "+15551230000", body: "hi" })
    expect(sendManualSmsMock).toHaveBeenCalledWith(expect.objectContaining({ appendOptOut: true }))
  })

  it("omits it when this business already texted them inside 30 days", async () => {
    recentOutboundExistsMock.mockResolvedValue(true)
    await post({ phone: "+15551230000", body: "hi" })
    expect(sendManualSmsMock).toHaveBeenCalledWith(expect.objectContaining({ appendOptOut: false }))
  })
})

describe("POST /api/admin/sms/send — the happy path", () => {
  it("sends and reports the provider id, sourcing sentBy from the session", async () => {
    const res = await post({ phone: "+15551230000", body: "hi", contactId: CONTACT_ID })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: "m1", providerMessageId: "SM1" })
    expect(sendManualSmsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+15551230000",
        businessId: BIZ,
        contactId: CONTACT_ID,
        sentBy: SESSION_USER_ID,
      }),
    )
  })

  // Minor (final review): `x-audit-target-id` is an internal channel from
  // this route to withAudit's `metadata` callback, not something the
  // browser needs to see. It used to ride all the way through to the
  // response the admin's own client receives; withAudit now strips it AFTER
  // reading it, so the audit row still gets the data but the header itself
  // never leaves the server.
  it("passes the message id to the audit row, but strips the header from the response the browser sees", async () => {
    const res = await post({ phone: "+15551230000", body: "hi" })
    expect(res.headers.get("x-audit-target-id")).toBeNull()

    const sentManualCall = recordAuditMock.mock.calls.find(
      (call: unknown[]) => (call[0] as { action?: string }).action === "sms.sent_manual",
    )
    expect((sentManualCall?.[0] as { metadata?: Record<string, unknown> } | undefined)?.metadata?.target_id).toBe("m1")
  })
})

describe("POST /api/admin/sms/send — the quiet-hours confirmation", () => {
  // Minor (fix round 1): `confirmQuietHours` was parsed and discarded, with
  // a comment claiming it was "recorded" — it never was. It is genuinely
  // useful (it tells you the admin was warned and sent anyway), so it now
  // rides the `sms.sent_manual` audit row via a response header, the same
  // channel `x-audit-target-id` already uses to get data from the handler
  // back to withAudit's metadata callback.
  it("records confirmed_quiet_hours on the sms.sent_manual row when the admin confirmed", async () => {
    await post({ phone: "+15551230000", body: "hi", confirmQuietHours: true })
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sms.sent_manual",
        metadata: expect.objectContaining({ confirmed_quiet_hours: true }),
      }),
    )
  })

  it("does not claim a confirmation that was never given", async () => {
    await post({ phone: "+15551230000", body: "hi" })
    const sentManualCall = recordAuditMock.mock.calls.find(
      (call: unknown[]) => (call[0] as { action?: string }).action === "sms.sent_manual",
    )
    expect(
      (sentManualCall?.[0] as { metadata?: Record<string, unknown> } | undefined)?.metadata?.confirmed_quiet_hours,
    ).toBeUndefined()
  })
})

describe("POST /api/admin/sms/send — the record-write-failed case", () => {
  it("still answers 200 with the provider id when messageId comes back null", async () => {
    // sendManualSms returns messageId: null when the text went out but the
    // post-send DB write failed — a delivered text must not be reported as
    // unsent. The route must not crash, and must not point the audit trail
    // at a row that does not exist.
    sendManualSmsMock.mockResolvedValue({ messageId: null, providerMessageId: "SM2", text: "hi" })
    const res = await post({ phone: "+15551230000", body: "hi" })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.id).toBeNull()
    expect(json.providerMessageId).toBe("SM2")
    expect(res.headers.get("x-audit-target-id")).toBeNull()
  })

  // Minor (final review): this used to be a silent 200 — the text really
  // did go out, so 200 is still correct, but the admin had no way to know
  // the conversation wouldn't show it. `warning` is the signal SmsComposer
  // now surfaces instead of pretending nothing happened.
  it("carries a warning explaining the text may not appear in the thread", async () => {
    sendManualSmsMock.mockResolvedValue({ messageId: null, providerMessageId: "SM2", text: "hi" })
    const res = await post({ phone: "+15551230000", body: "hi" })
    const json = await res.json()
    expect(typeof json.warning).toBe("string")
    expect(json.warning.length).toBeGreaterThan(0)
  })

  it("carries no warning at all when the record write succeeded", async () => {
    const res = await post({ phone: "+15551230000", body: "hi" })
    const json = await res.json()
    expect(json.warning).toBeUndefined()
  })
})

describe("POST /api/admin/sms/send — the opt-out lookup uses the normalised phone", () => {
  // Minor (final review): recentOutboundExists used to be called with the
  // raw request value while every WRITE on this path (via sendManualSms)
  // normalises first. For an ordinary E.164 number they agree, but a
  // trunk-prefixed variant of the same number does not, and the lookup
  // would then find nothing and redundantly append the legally-relevant
  // opt-out sentence to someone who was just texted.
  it("checks recentOutboundExists against the normalised phone, not the raw request value", async () => {
    // "+4402071838750" (the raw shape a caller could send) normalises to
    // "+442071838750" (libphonenumber-js drops the redundant trunk 0) — the
    // two values genuinely differ, so an unnormalised lookup call is
    // caught here, not just a lookup call with SOME argument.
    await post({ phone: "+4402071838750", body: "hi" })
    expect(recentOutboundExistsMock).toHaveBeenCalledWith("+442071838750", BIZ)
  })
})

describe("POST /api/admin/sms/send — a failed opt-out lookup is a mapped error", () => {
  // Minor (final review): recentOutboundExists used to run OUTSIDE the
  // try/catch that maps sendManualSms's errors, so a DB fault there was an
  // unhandled 500 rather than the same mapped 502 every other unexpected
  // failure on this route gets. It fails closed either way (no send), but
  // an unmapped 500 is worse for the caller than a mapped one.
  it("answers a mapped 502, not an unhandled crash, when the lookup itself throws", async () => {
    recentOutboundExistsMock.mockRejectedValue(new Error("db unavailable"))
    const res = await post({ phone: "+15551230000", body: "hi" })
    expect(res.status).toBe(502)
    expect((await res.json()).reason).toBe("send_failed")
    expect(sendManualSmsMock).not.toHaveBeenCalled()
  })
})

describe("POST /api/admin/sms/send — contact must belong to this business", () => {
  // Minor (fix round 1): contactId used to be written straight through to
  // insertSmsMessage with no ownership check — not a cross-tenant READ leak
  // (the row's own business_id is still the caller's), but a foreign
  // contact id could be stitched into this business's SMS thread. Every new
  // reader gets a tenant predicate.
  it("answers 400 and does not send when the contact id belongs to another business", async () => {
    getContactByIdMock.mockResolvedValue(null) // getContactById(id, businessId) — not found for THIS business
    const res = await post({ phone: "+15551230000", body: "hi", contactId: CONTACT_ID })
    expect(res.status).toBe(400)
    expect((await res.json()).reason).toBe("contact_not_found")
    expect(sendManualSmsMock).not.toHaveBeenCalled()
  })

  it("checks ownership against the resolved tenant's business id", async () => {
    await post({ phone: "+15551230000", body: "hi", contactId: CONTACT_ID })
    expect(getContactByIdMock).toHaveBeenCalledWith(CONTACT_ID, BIZ)
  })

  it("does not check ownership when no contactId is supplied", async () => {
    await post({ phone: "+15551230000", body: "hi" })
    expect(getContactByIdMock).not.toHaveBeenCalled()
  })
})

// G45. `sendManualSms` asks for consent on `contactId` and texts `phone`, and
// nothing tied the two together: a request naming contact A (who agreed) and
// any other number sent to that number on A's permission, and filed the text
// in A's thread. Consent is recorded per contact, not per number, so the
// number has to be the contact's own.
describe("POST /api/admin/sms/send — G45: the number must be the contact's own", () => {
  function contactWithPhone(phone_e164: string | null) {
    return {
      id: CONTACT_ID,
      business_id: BIZ,
      user_id: null,
      name: "Test Contact",
      email: null,
      phone_e164,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      timezone: null,
    }
  }

  it("refuses (400) and sends nothing when the number is not the contact's", async () => {
    getContactByIdMock.mockResolvedValue(contactWithPhone("+12025550123"))
    const res = await post({ phone: "+13125550199", body: "hi", contactId: CONTACT_ID })
    expect(res.status).toBe(400)
    expect((await res.json()).reason).toBe("phone_not_contacts")
    expect(sendManualSmsMock).not.toHaveBeenCalled()
  })

  it("refuses the mismatch even when the coach ticked 'Send anyway'", async () => {
    // The override answers "no consent on file"; it does not make a stranger's
    // number this contact's.
    getContactByIdMock.mockResolvedValue(contactWithPhone("+12025550123"))
    const res = await post({ phone: "+13125550199", body: "hi", contactId: CONTACT_ID, consentOverride: true })
    expect(res.status).toBe(400)
    expect(sendManualSmsMock).not.toHaveBeenCalled()
  })

  it("refuses when the contact has no number on file", async () => {
    getContactByIdMock.mockResolvedValue(contactWithPhone(null))
    const res = await post({ phone: "+12025550123", body: "hi", contactId: CONTACT_ID })
    expect(res.status).toBe(400)
    expect((await res.json()).reason).toBe("phone_not_contacts")
    expect(sendManualSmsMock).not.toHaveBeenCalled()
  })

  it("sends when the number is the contact's own (permissive control)", async () => {
    getContactByIdMock.mockResolvedValue(contactWithPhone("+12025550123"))
    const res = await post({ phone: "+12025550123", body: "hi", contactId: CONTACT_ID })
    expect(res.status).toBe(200)
    expect(sendManualSmsMock).toHaveBeenCalledTimes(1)
  })

  it("compares NORMALISED numbers, so a trunk-prefixed variant of the contact's number still sends", async () => {
    // "+4402071838750" is the same line as "+442071838750" (the UK trunk 0
    // kept after the country code). A raw string compare would refuse it.
    getContactByIdMock.mockResolvedValue(contactWithPhone("+442071838750"))
    const res = await post({ phone: "+4402071838750", body: "hi", contactId: CONTACT_ID })
    expect(res.status).toBe(200)
    expect(sendManualSmsMock).toHaveBeenCalledTimes(1)
  })

  it("does not ask for a match when no contactId is supplied (the consent gate refuses that send instead)", async () => {
    const res = await post({ phone: "+13125550199", body: "hi" })
    expect(res.status).toBe(200)
    expect(sendManualSmsMock).toHaveBeenCalledTimes(1)
  })
})

// G28 — the consent gate as the ROUTE presents it. Owner ruled 2026-09-21.
//
// The gate itself lives in `sendManualSms` and is tested there (including
// the invariant that the override cannot bypass a STOP). What is tested
// HERE is the route's half of the contract: the status and machine-readable
// reason the compose box branches on, the refusal audit row, and -- the one
// that actually matters for accountability -- that an override which
// resulted in a real text is stamped on the audit trail, and one that did
// not is NOT.
describe("POST /api/admin/sms/send — G28 consent gate", () => {
  // The contact these tests text OWNS the number they text (G45 refuses a
  // mismatch before the consent gate is ever asked).
  beforeEach(() => {
    getContactByIdMock.mockResolvedValue({
      id: CONTACT_ID,
      business_id: BIZ,
      user_id: null,
      name: "Test Contact",
      email: null,
      phone_e164: "+12025550123",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      timezone: null,
    })
  })

  it("answers 409 with a machine-readable reason the client can branch on", async () => {
    sendManualSmsMock.mockRejectedValue(new SmsNoConsentError("+12025550123"))

    const res = await post({ phone: "+12025550123", body: "hi", contactId: CONTACT_ID })

    expect(res.status).toBe(409)
    const payload = await res.json()
    expect(payload.reason).toBe("no_consent")
    // The client offers "Send without permission on file" off THIS flag,
    // never off the prose, which is free to change.
    expect(payload.canOverride).toBe(true)
    expect(payload.error).toBeTruthy()
  })

  it("records a refusal under its own slug, not as a failed send", async () => {
    sendManualSmsMock.mockRejectedValue(new SmsNoConsentError("+12025550123"))

    await post({ phone: "+12025550123", body: "hi", contactId: CONTACT_ID })

    const refusal = recordAuditMock.mock.calls.find(
      (c) => (c[0] as { action?: string })?.action === "sms.send_refused",
    )
    expect(refusal, "no sms.send_refused row was written").toBeTruthy()
    expect(refusal?.[0]).toMatchObject({
      action: "sms.send_refused",
      outcome: "failure",
      metadata: { reason: "no_consent", contact_id: CONTACT_ID },
    })
  })

  it("does NOT pass an override that was never asked for", async () => {
    sendManualSmsMock.mockResolvedValue({ messageId: "m1", providerMessageId: "SM1", text: "hi" })

    await post({ phone: "+12025550123", body: "hi", contactId: CONTACT_ID })

    expect(sendManualSmsMock.mock.calls[0][0]).toMatchObject({ consentOverride: false })
  })

  it("passes the override through when the coach ticked it", async () => {
    sendManualSmsMock.mockResolvedValue({ messageId: "m1", providerMessageId: "SM1", text: "hi" })

    await post({ phone: "+12025550123", body: "hi", contactId: CONTACT_ID, consentOverride: true })

    expect(sendManualSmsMock.mock.calls[0][0]).toMatchObject({ consentOverride: true })
  })

  it("REJECTS a non-boolean override at the schema, and sends nothing", async () => {
    // Measured, not assumed: `z.boolean().optional()` REJECTS `"yes"`, so
    // the request 400s and never reaches `sendManualSms`. The earlier
    // version of this test accepted either a 400 or a coerced-false send,
    // which pinned neither.
    //
    // KNOWN EQUIVALENT MUTANT: because the schema guarantees the field is
    // `true | false | undefined`, the route's `consentOverride === true` and
    // a plain `Boolean(consentOverride)` behave identically, and swapping
    // them survives this suite. That is not a coverage gap -- there is no
    // input that distinguishes them. The `=== true` stays because it states
    // the intent at the point of use rather than relying on a schema three
    // screens away.
    sendManualSmsMock.mockResolvedValue({ messageId: "m1", providerMessageId: "SM1", text: "hi" })

    const res = await post({ phone: "+12025550123", body: "hi", contactId: CONTACT_ID, consentOverride: "yes" })

    expect(res.status).toBe(400)
    expect(sendManualSmsMock).not.toHaveBeenCalled()
  })

  // Asserted on the AUDIT ROW, not on the response header. `withAudit`
  // strips every `x-audit-*` header before the response leaves the wrapper
  // -- they are an internal handler->wrapper channel, deliberately not sent
  // to the browser. Asserting the header would have been testing the
  // plumbing; the row is the thing that has to be right.
  function sentManualMetadata(): Record<string, unknown> | undefined {
    const row = recordAuditMock.mock.calls.find((c) => (c[0] as { action?: string })?.action === "sms.sent_manual")
    return (row?.[0] as { metadata?: Record<string, unknown> } | undefined)?.metadata
  }

  it("STAMPS consent_override on the audit row of a send that actually went out", async () => {
    sendManualSmsMock.mockResolvedValue({ messageId: "m1", providerMessageId: "SM1", text: "hi" })

    const res = await post({ phone: "+12025550123", body: "hi", contactId: CONTACT_ID, consentOverride: true })

    expect(res.status).toBe(200)
    expect(sentManualMetadata()).toMatchObject({ consent_override: true })
    // And it is NOT leaked to the browser.
    expect(res.headers.get("x-audit-consent-override")).toBeNull()
  })

  it("does NOT stamp consent_override when the send was refused anyway", async () => {
    // The presence control is the test above. A request can carry the tick
    // and still be refused -- by a STOP, most importantly. Stamping the
    // flag then would put "texted without consent" in the audit trail for
    // a text that was never sent.
    sendManualSmsMock.mockRejectedValue(new SmsSuppressedError("+12025550123"))

    const res = await post({ phone: "+12025550123", body: "hi", contactId: CONTACT_ID, consentOverride: true })

    expect(res.status).toBe(409)
    expect(sentManualMetadata() ?? {}).not.toHaveProperty("consent_override")
  })

  it("does not stamp consent_override on an ordinary send", async () => {
    sendManualSmsMock.mockResolvedValue({ messageId: "m1", providerMessageId: "SM1", text: "hi" })

    await post({ phone: "+12025550123", body: "hi", contactId: CONTACT_ID })

    expect(sentManualMetadata() ?? {}).not.toHaveProperty("consent_override")
  })

  it("leaves an unreadable consent row as a 502, not a refusal", async () => {
    // hasConsent throws rather than returning false when it cannot read.
    // That must surface as "try again", never as "they have not agreed" --
    // the two are different answers and only one is about the person.
    sendManualSmsMock.mockRejectedValue(new Error("consents read failed"))

    const res = await post({ phone: "+12025550123", body: "hi", contactId: CONTACT_ID })

    expect(res.status).toBe(502)
    const payload = await res.json()
    expect(payload.reason).not.toBe("no_consent")
  })
})
