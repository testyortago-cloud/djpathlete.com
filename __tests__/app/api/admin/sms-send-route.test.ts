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

  it("sets the x-audit-target-id header to the returned message id", async () => {
    const res = await post({ phone: "+15551230000", body: "hi" })
    expect(res.headers.get("x-audit-target-id")).toBe("m1")
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
    expect((sentManualCall?.[0] as { metadata?: Record<string, unknown> } | undefined)?.metadata?.confirmed_quiet_hours).toBeUndefined()
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
