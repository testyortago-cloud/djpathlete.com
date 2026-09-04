// @vitest-environment node
//
// Route-level tests for POST /api/webhooks/twilio/inbound — Twilio's inbound
// SMS webhook, covering the STOP/START/HELP/anything-else compliance flows
// (spec §5).
//
// Same shape as __tests__/api/webhooks/twilio-status.test.ts: signature
// validation is REAL (node:crypto, Twilio's documented scheme, signed
// independently of the module under test), and only `@/lib/supabase` is
// mocked, behind a small in-memory multi-table store — so the actual DAL
// functions this route calls (`findContactByIdentifiers`, `recordConsent`,
// `suppress`, `unsuppress`, `exitRunsForContact`, `getBusinessSettings`) all
// run for real against that store, same rationale as
// __tests__/app/unsubscribe-token-route.test.ts: a mock of `suppress` itself
// would prove nothing about its real 23505 idempotency handling, and this
// route's "STOP with no matched contact still suppresses" behavior depends
// on that being real too.
//
// `@/lib/lead-engine/email` is SPIED, not stubbed. `sendRenderedSequenceEmail`
// is a plain vi.fn() — it is the one piece of this route that reaches an
// external provider (Resend) in real code, and this suite asserts the CALL
// SHAPE (to, includeUnsubscribeFooter: false) rather than re-testing delivery.
// `renderSequenceEmail` is a vi.fn() that DELEGATES to the real one. It has to
// be: this route hands the renderer a body built out of a lead's own words,
// and the renderer treats its `body` as a TEMPLATE — it substitutes
// `{{name}}` and it THROWS on `{{sms_consent_url}}` when no URL was supplied.
// A canned stub that returns a fixed object cannot fail that way, so it would
// have reported the "a reply quoting template syntax" suite below as passing
// while the real route 500'd. Rendering itself still has its own suite
// (__tests__/lib/lead-engine/email.test.ts); what is being pinned here is that
// this route survives the real renderer's guards.

import { describe, it, expect, beforeEach, vi } from "vitest"
import { createHmac } from "node:crypto"

type Row = Record<string, any>

const store: {
  contacts: Row[]
  consents: Row[]
  suppressions: Row[]
  timeline: Row[]
  sequenceRuns: Row[]
  businessSettings: Row[]
} = { contacts: [], consents: [], suppressions: [], timeline: [], sequenceRuns: [], businessSettings: [] }

const KNOWN_TABLES = new Set([
  "contacts",
  "contact_consents",
  "contact_suppressions",
  "contact_timeline_events",
  "sequence_runs",
  "business_settings",
])

// Fix round 1, Important 1: getBusinessBySmsNumber must THROW on a genuine
// read error rather than swallow it into the same null a no-match returns.
// Scoped to the sms_sender_phone-keyed query specifically (via the `filters`
// check below), so injecting this does not also break getBusinessSettings's
// business_id-keyed read of the SAME table.
let businessSettingsReadError: { code: string; message: string } | null = null

function collectionFor(table: string): Row[] {
  switch (table) {
    case "contacts":
      return store.contacts
    case "contact_consents":
      return store.consents
    case "contact_suppressions":
      return store.suppressions
    case "contact_timeline_events":
      return store.timeline
    case "sequence_runs":
      return store.sequenceRuns
    case "business_settings":
      return store.businessSettings
    default:
      return []
  }
}

// A real (if tiny) fluent query builder — filters accumulate across
// `.eq()` calls and are applied at the point something awaits the chain
// (`.then()`) or calls `.maybeSingle()`, exactly like the reference mocks
// in twilio-status.test.ts and unsubscribe-token-route.test.ts. This matters
// for the same reason those comments give: a fixed-depth stub would let a
// mutation that drops a `.eq()` filter (e.g. narrowing suppress's insert or
// exitRunsForContact's update) pass by coincidence of the mock's shape
// rather than because the real filter did its job.
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      if (!KNOWN_TABLES.has(table)) throw new Error(`unmocked table: ${table}`)

      const filters: Array<[string, any]> = []
      let updatePatch: Row | null = null
      let deleteMode = false

      const applyFilter = (rows: Row[]) => rows.filter((row) => filters.every(([k, v]) => row[k] === v))

      const api: any = {
        select() {
          return api
        },
        eq(col: string, val: any) {
          filters.push([col, val])
          return api
        },
        insert(payload: Row) {
          if (table === "contact_suppressions") {
            const dupe = collectionFor(table).find(
              (r) => r.business_id === payload.business_id && r.identifier === payload.identifier,
            )
            if (dupe) {
              return Promise.resolve({
                data: null,
                error: {
                  message: 'duplicate key value violates unique constraint "contact_suppressions_uniq"',
                  code: "23505",
                },
              })
            }
          }
          const row = { id: `row-${collectionFor(table).length + 1}`, ...payload }
          collectionFor(table).push(row)
          return Promise.resolve({ data: row, error: null })
        },
        update(patch: Row) {
          updatePatch = patch
          return api
        },
        delete() {
          deleteMode = true
          return api
        },
        maybeSingle: async () => {
          if (
            table === "business_settings" &&
            businessSettingsReadError &&
            filters.some(([k]) => k === "sms_sender_phone")
          ) {
            return { data: null, error: businessSettingsReadError }
          }
          const rows = applyFilter(collectionFor(table))
          return { data: rows[0] ?? null, error: null }
        },
        then(resolve: any) {
          const matched = applyFilter(collectionFor(table))
          if (deleteMode) {
            const remaining = collectionFor(table).filter((r) => !matched.includes(r))
            collectionFor(table).length = 0
            collectionFor(table).push(...remaining)
            return resolve({ error: null })
          }
          if (updatePatch) {
            for (const row of matched) Object.assign(row, updatePatch)
          }
          return resolve({ data: matched.map((r) => ({ id: r.id })), error: null })
        },
      }
      return api
    },
  }),
}))

vi.mock("@/lib/lead-engine/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/lead-engine/email")>()
  return {
    ...actual,
    renderSequenceEmail: vi.fn((args: Parameters<typeof actual.renderSequenceEmail>[0]) =>
      actual.renderSequenceEmail(args),
    ),
    sendRenderedSequenceEmail: vi.fn().mockResolvedValue({ providerMessageId: "resend-fake-1" }),
  }
})

import { renderSequenceEmail, sendRenderedSequenceEmail } from "@/lib/lead-engine/email"
import { POST } from "@/app/api/webhooks/twilio/inbound/route"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

const AUTH_TOKEN = "route_test_auth_token"
const ORIGIN = "https://app.example.test"
const PATH = "/api/webhooks/twilio/inbound"
const BUSINESS = "00000000-0000-0000-0000-000000000001"
// Real, libphonenumber-js-VALID numbers — not the classic 555-fake-number
// block. NANP reserves 555-01xx as the only "fictional" exchange range and
// treats every other 555 number as invalid, so `normalisePhone` (real code,
// not mocked here) rejects "+15551234567" outright and every contact-match
// assertion below would silently see `contactId: null`. These are numbers
// that pass `parsePhoneNumberFromString(...).isValid()` for real.
const PHONE = "+16176504548" // 617-650-4548
const CONTACT = "contact-1"
const OTHER_CONTACT = "contact-2"
const OTHER_PHONE = "+14158675309" // 415-867-5309

// A business DISTINCT from BUSINESS/SINGLETON_BUSINESS_ID on purpose: BUSINESS
// above IS the literal SINGLETON_BUSINESS_ID value, which would make any
// tenancy assertion pass identically against a hardcoded-singleton
// implementation. OTHER_BUSINESS is how the tests below prove the route
// actually threads a RESOLVED, non-singleton id through every call.
const OTHER_BUSINESS = "22222222-2222-2222-2222-222222222222"
const OTHER_BUSINESS_TO = "+15550002222"
const OTHER_BUSINESS_PHONE = "+16175559911" // real, libphonenumber-valid
const OTHER_BUSINESS_CONTACT = "contact-bbb-1"
const UNCLAIMED_TO = "+15550009999" // no business_settings row claims this

function sign(params: Record<string, string>, authToken = AUTH_TOKEN): string {
  const url = `${ORIGIN}${PATH}`
  const sortedKeys = Object.keys(params).sort()
  const data = url + sortedKeys.map((k) => `${k}${params[k]}`).join("")
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64")
}

function inboundRequest(params: Record<string, string>, opts: { signature?: string } = {}): Request {
  return new Request(`${ORIGIN}${PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": opts.signature ?? sign(params),
    },
    body: new URLSearchParams(params).toString(),
  })
}

function smsBody(body: string, from = PHONE, to = "+15550001111"): Record<string, string> {
  return { From: from, To: to, Body: body, MessageSid: "SMinbound1" }
}

const SETTINGS = {
  business_id: BUSINESS,
  display_name: "Test Business",
  sender_name: "Test Sender",
  sender_email: "sender@example.com",
  reply_to: "ops@example.test",
  logo_url: null,
  timezone: "UTC",
  quiet_hours_start: 0,
  quiet_hours_end: 24,
  daily_message_cap: 50,
  postal_address: "123 Main St",
  sms_help_text: "Reply STOP to opt out.",
  sms_messaging_service_sid: "MG123",
  sms_sender_phone: "+15550001111",
}

beforeEach(() => {
  store.contacts = [{ id: CONTACT, business_id: BUSINESS, email: "lead@example.com", phone_e164: PHONE }]
  store.consents = []
  store.suppressions = []
  store.timeline = []
  store.sequenceRuns = [
    { id: "run-1", contact_id: CONTACT, business_id: BUSINESS, status: "active" },
    { id: "run-2", contact_id: OTHER_CONTACT, business_id: BUSINESS, status: "active" },
  ]
  store.businessSettings = [{ ...SETTINGS }]
  businessSettingsReadError = null
  process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN
  process.env.NEXTAUTH_URL = ORIGIN
  vi.clearAllMocks()
})

describe("POST /api/webhooks/twilio/inbound — signature gate", () => {
  it("a bad signature 403s and writes nothing", async () => {
    const res = await POST(inboundRequest(smsBody("STOP"), { signature: "not-the-right-signature=" }))

    expect(res.status).toBe(403)
    expect(store.suppressions).toHaveLength(0)
    expect(store.consents).toHaveLength(0)
    expect(store.timeline).toHaveLength(0)
    expect(store.sequenceRuns.every((r) => r.status === "active")).toBe(true)
  })

  it("a missing TWILIO_AUTH_TOKEN 403s with zero DB access", async () => {
    delete process.env.TWILIO_AUTH_TOKEN
    const res = await POST(inboundRequest(smsBody("STOP")))

    expect(res.status).toBe(403)
    expect(store.suppressions).toHaveLength(0)
    expect(store.consents).toHaveLength(0)
    expect(store.timeline).toHaveLength(0)
  })
})

describe("POST /api/webhooks/twilio/inbound — STOP", () => {
  it("suppresses, revokes consent, exits runs, and writes a timeline event — all four, for a matched contact", async () => {
    const res = await POST(inboundRequest(smsBody("STOP")))

    expect(res.status).toBe(200)

    expect(store.suppressions).toHaveLength(1)
    expect(store.suppressions[0].identifier).toBe(PHONE.toLowerCase())
    expect(store.suppressions[0].reason).toBe("sms_stop")

    expect(store.consents).toHaveLength(1)
    expect(store.consents[0]).toMatchObject({
      contact_id: CONTACT,
      channel: "sms",
      granted: false,
      source: "sms_inbound",
      wording_shown: "STOP",
    })

    const ours = store.sequenceRuns.find((r) => r.id === "run-1")
    expect(ours?.status).toBe("exited")
    expect(ours?.exit_reason).toBe("sms_stop")
    const theirs = store.sequenceRuns.find((r) => r.id === "run-2")
    expect(theirs?.status).toBe("active")

    expect(store.timeline).toHaveLength(1)
    expect(store.timeline[0]).toMatchObject({ contact_id: CONTACT, kind: "sms_stop_received" })
  })

  it("matches case-insensitively", async () => {
    const res = await POST(inboundRequest(smsBody("Stop")))
    expect(res.status).toBe(200)
    expect(store.suppressions).toHaveLength(1)
    expect(store.consents[0].granted).toBe(false)
  })

  it("matches with surrounding whitespace, and quotes the RAW (untrimmed) body as consent evidence", async () => {
    const res = await POST(inboundRequest(smsBody(" STOP ")))
    expect(res.status).toBe(200)
    expect(store.suppressions).toHaveLength(1)
    // The keyword MATCH is on the trimmed/uppercased body, but wording_shown
    // is the evidence of the act and must quote exactly what arrived,
    // whitespace included — never the normalised match key.
    expect(store.consents[0].wording_shown).toBe(" STOP ")
  })

  it.each(["STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"])("recognizes %s as a STOP keyword", async (word) => {
    const res = await POST(inboundRequest(smsBody(word)))
    expect(res.status).toBe(200)
    expect(store.suppressions).toHaveLength(1)
    expect(store.suppressions[0].reason).toBe("sms_stop")
  })

  it.each(["Stop.", "STOP!"])(
    "trailing punctuation does not dodge the keyword — %s is still the full STOP motion",
    async (word) => {
      const res = await POST(inboundRequest(smsBody(word)))

      expect(res.status).toBe(200)
      expect(store.suppressions).toHaveLength(1)
      expect(store.consents).toHaveLength(1)
      expect(store.consents[0]).toMatchObject({ granted: false, source: "sms_inbound" })
      // wording_shown still quotes the raw body, punctuation and all — only
      // the MATCH strips trailing punctuation, never the evidence.
      expect(store.consents[0].wording_shown).toBe(word)
      expect(store.sequenceRuns.find((r) => r.id === "run-1")?.status).toBe("exited")
      expect(store.timeline[0].kind).toBe("sms_stop_received")
    },
  )

  it('"STOP IT" (extra words) is NOT a STOP keyword — it falls through to the anything-else path', async () => {
    const res = await POST(inboundRequest(smsBody("STOP IT")))

    expect(res.status).toBe(200)
    expect(store.suppressions).toHaveLength(0)
    expect(store.consents).toHaveLength(0)
    // Falls into "anything else": a timeline row IS written (contact matched)
    // but it must be the generic inbound kind, not a stop.
    expect(store.timeline).toHaveLength(1)
    expect(store.timeline[0].kind).toBe("sms_inbound")
  })

  it("with no matched contact: still suppresses the phone (identifier-keyed) but writes no consent or timeline row", async () => {
    store.contacts = [] // nobody in this business has this phone number on file
    const res = await POST(inboundRequest(smsBody("STOP")))

    expect(res.status).toBe(200)
    expect(store.suppressions).toHaveLength(1)
    expect(store.suppressions[0].identifier).toBe(PHONE.toLowerCase())
    // There is no contact_id to attach either row to — contact_consents.contact_id
    // and contact_timeline_events.contact_id are both NOT NULL, and there is
    // nobody to exit a sequence run for either.
    expect(store.consents).toHaveLength(0)
    expect(store.timeline).toHaveLength(0)
    expect(store.sequenceRuns.every((r) => r.status === "active")).toBe(true)
  })

  it("is idempotent — a second STOP does not throw or double-suppress", async () => {
    await POST(inboundRequest(smsBody("STOP")))
    const second = await POST(inboundRequest(smsBody("STOP")))

    expect(second.status).toBe(200)
    expect(store.suppressions).toHaveLength(1)
    // Consent is an append-only log, like the unsubscribe flow's — a second
    // revocation event is a legitimate second record.
    expect(store.consents).toHaveLength(2)
  })

  // Fix (task review, Finding 1): a suppression keyed on a raw string that
  // failed E.164 parsing protects nobody — every send path checks
  // `isSuppressed` against the contact's NORMALISED `phone_e164`, so this
  // row can never match a future send lookup. Without a matched contact
  // there is also no timeline row possible. The only remaining way to make
  // this failure visible is the ops-alert email, same mechanism as the
  // anything-else path.
  it("with an unparseable From: suppresses the raw string defensively, but escalates to a human via the ops-alert email — no consent row", async () => {
    const res = await POST(inboundRequest(smsBody("STOP", "not-a-real-phone")))

    expect(res.status).toBe(200)
    expect(store.suppressions).toHaveLength(1)
    expect(store.suppressions[0].identifier).toBe("not-a-real-phone")
    expect(store.suppressions[0].reason).toBe("sms_stop")

    // No contact matched (the phone never even got a lookup), so no consent
    // row and no timeline row.
    expect(store.consents).toHaveLength(0)
    expect(store.timeline).toHaveLength(0)

    expect(renderSequenceEmail).toHaveBeenCalledTimes(1)
    const renderArg = (renderSequenceEmail as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(renderArg.subject).toBe("SMS STOP needs manual review")
    expect(renderArg.includeUnsubscribeFooter).toBe(false)
    expect(renderArg.body).toContain("not-a-real-phone")

    expect(sendRenderedSequenceEmail).toHaveBeenCalledTimes(1)
    const sendArg = (sendRenderedSequenceEmail as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(sendArg.to).toBe(SETTINGS.reply_to)
    expect(sendArg.includeUnsubscribeFooter).toBe(false)
  })

  it("a matched STOP (valid phone, real contact) never sends the manual-review alert", async () => {
    await POST(inboundRequest(smsBody("STOP")))
    expect(renderSequenceEmail).not.toHaveBeenCalled()
    expect(sendRenderedSequenceEmail).not.toHaveBeenCalled()
  })

  it("STOP from a valid but unrecognized phone number does not send the manual-review alert either — the suppression is real and sufficient", async () => {
    store.contacts = []
    await POST(inboundRequest(smsBody("STOP")))
    expect(renderSequenceEmail).not.toHaveBeenCalled()
    expect(sendRenderedSequenceEmail).not.toHaveBeenCalled()
  })
})

describe("POST /api/webhooks/twilio/inbound — START", () => {
  beforeEach(() => {
    store.suppressions = [{ id: "sup-1", business_id: BUSINESS, identifier: PHONE.toLowerCase(), reason: "sms_stop" }]
  })

  it("unsuppresses, grants consent, and writes a timeline event for a matched contact", async () => {
    const res = await POST(inboundRequest(smsBody("START")))

    expect(res.status).toBe(200)
    expect(store.suppressions).toHaveLength(0)

    expect(store.consents).toHaveLength(1)
    expect(store.consents[0]).toMatchObject({
      contact_id: CONTACT,
      channel: "sms",
      granted: true,
      source: "sms_inbound",
      wording_shown: "START",
    })

    expect(store.timeline).toHaveLength(1)
    expect(store.timeline[0]).toMatchObject({ contact_id: CONTACT, kind: "sms_start_received" })

    // START never touches sequence runs.
    expect(store.sequenceRuns.every((r) => r.status === "active")).toBe(true)
  })

  it.each(["UNSTOP", "YES"])("recognizes %s as a START keyword", async (word) => {
    const res = await POST(inboundRequest(smsBody(word)))
    expect(res.status).toBe(200)
    expect(store.suppressions).toHaveLength(0)
    expect(store.consents[0].granted).toBe(true)
  })

  it("with no matched contact: still unsuppresses the phone but writes no consent or timeline row", async () => {
    store.contacts = []
    const res = await POST(inboundRequest(smsBody("START")))

    expect(res.status).toBe(200)
    expect(store.suppressions).toHaveLength(0)
    expect(store.consents).toHaveLength(0)
    expect(store.timeline).toHaveLength(0)
  })

  it("unsuppressing an identifier that was never suppressed succeeds (absent row is success)", async () => {
    store.suppressions = []
    const res = await POST(inboundRequest(smsBody("START")))
    expect(res.status).toBe(200)
    expect(store.suppressions).toHaveLength(0)
  })
})

describe("POST /api/webhooks/twilio/inbound — HELP", () => {
  it("writes only a sms_help_received timeline event for a matched contact", async () => {
    const res = await POST(inboundRequest(smsBody("HELP")))

    expect(res.status).toBe(200)
    expect(store.timeline).toHaveLength(1)
    expect(store.timeline[0]).toMatchObject({ contact_id: CONTACT, kind: "sms_help_received" })
    expect(store.suppressions).toHaveLength(0)
    expect(store.consents).toHaveLength(0)
  })

  it("with no matched contact: writes nothing (no contact_id to attach a timeline row to)", async () => {
    store.contacts = []
    const res = await POST(inboundRequest(smsBody("HELP")))

    expect(res.status).toBe(200)
    expect(store.timeline).toHaveLength(0)
  })
})

describe("POST /api/webhooks/twilio/inbound — anything else", () => {
  it("writes a sms_inbound timeline event with the body in metadata, and sends the ops-alert email, for a matched contact", async () => {
    const res = await POST(inboundRequest(smsBody("Can I switch my session to Tuesday?")))

    expect(res.status).toBe(200)
    expect(store.timeline).toHaveLength(1)
    expect(store.timeline[0]).toMatchObject({ contact_id: CONTACT, kind: "sms_inbound" })
    expect(store.timeline[0].metadata.body).toBe("Can I switch my session to Tuesday?")

    expect(renderSequenceEmail).toHaveBeenCalledTimes(1)
    const renderArg = (renderSequenceEmail as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(renderArg.includeUnsubscribeFooter).toBe(false)
    expect(renderArg.subject).toBe("New SMS reply")
    expect(renderArg.body).toContain(PHONE)
    expect(renderArg.body).toContain("Can I switch my session to Tuesday?")

    expect(sendRenderedSequenceEmail).toHaveBeenCalledTimes(1)
    const sendArg = (sendRenderedSequenceEmail as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(sendArg.to).toBe(SETTINGS.reply_to)
    expect(sendArg.includeUnsubscribeFooter).toBe(false)
  })

  it("caps the stored body at 500 chars in timeline metadata", async () => {
    const longBody = "x".repeat(600)
    const res = await POST(inboundRequest(smsBody(longBody)))

    expect(res.status).toBe(200)
    expect(store.timeline[0].metadata.body).toHaveLength(500)
    expect(store.timeline[0].metadata.body).toBe(longBody.slice(0, 500))
  })

  it("with no matched contact: writes no timeline row and sends no alert email", async () => {
    store.contacts = []
    const res = await POST(inboundRequest(smsBody("Can I switch my session to Tuesday?")))

    expect(res.status).toBe(200)
    expect(store.timeline).toHaveLength(0)
    expect(renderSequenceEmail).not.toHaveBeenCalled()
    expect(sendRenderedSequenceEmail).not.toHaveBeenCalled()
  })

  it("a failed ops-alert email is logged but not fatal — the timeline row still lands and the route still 200s", async () => {
    ;(sendRenderedSequenceEmail as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("resend down"))
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const res = await POST(inboundRequest(smsBody("Can I switch my session to Tuesday?")))

    expect(res.status).toBe(200)
    expect(store.timeline).toHaveLength(1)
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Regression, and the reason it is not a theoretical one.
//
// The operator alert quotes a lead's own words straight into the email body,
// and `renderSequenceEmail` treats `body` as a TEMPLATE: it substitutes
// `{{name}}`, and it THROWS on `{{sms_consent_url}}` unless a URL is supplied.
// This route has no URL to supply and should not have one — the consent link
// is signed for a CONTACT and belongs in mail sent TO that contact, never in
// an internal notification about them.
//
// Migration 00226 mails that placeholder's rendered link to real people, so
// the literal coming back is an ordinary thing for a suspicious or confused
// reader to do: quote it, forward it, or retype it while asking "is this
// really you?". Before the fix, that text made the render throw OUTSIDE the
// alert's own try/catch. The webhook answered 500, the operator never saw the
// reply, and Twilio retried the same poison payload forever (an 11200 in its
// logs). None of the four outcomes this route documents is allowed to fail
// that way: a poison body is a 200, only an infra fault is a 500.
describe("POST /api/webhooks/twilio/inbound — a reply that quotes template syntax", () => {
  it("does not 500, and the operator still gets the alert", async () => {
    const res = await POST(inboundRequest(smsBody("is this really you? {{sms_consent_url}}")))

    expect(res.status).toBe(200)
    expect(store.timeline).toHaveLength(1)
    expect(store.timeline[0].kind).toBe("sms_inbound")
    // The timeline row is the RECORD and quotes the raw bytes untouched.
    expect(store.timeline[0].metadata.body).toBe("is this really you? {{sms_consent_url}}")
    expect(sendRenderedSequenceEmail).toHaveBeenCalledTimes(1)
  })

  it("leaves the operator able to read what was actually sent", async () => {
    await POST(inboundRequest(smsBody("what is {{sms_consent_url}} supposed to be?")))

    const sendArg = (sendRenderedSequenceEmail as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(sendArg.rendered.text).toContain("sms_consent_url")
    expect(sendArg.rendered.text).toContain("supposed to be?")
  })

  it("mints no consent link — a lead must not be able to talk this route into one", async () => {
    await POST(inboundRequest(smsBody("{{sms_consent_url}}")))

    const sendArg = (sendRenderedSequenceEmail as ReturnType<typeof vi.fn>).mock.calls[0][0]
    // "Yes, you can text me" is the anchor text renderSequenceEmail uses
    // wherever it DOES substitute the placeholder. Its absence is the proof
    // that nothing was substituted here.
    expect(sendArg.rendered.html).not.toContain("Yes, you can text me")
    expect(sendArg.rendered.html).not.toContain("/sms-consent/")
  })

  it("does not silently eat a {{name}} the lead typed, either", async () => {
    // Same class of bug, quieter: substituteName falls back to "" for a
    // nameless contact, so an un-defanged {{name}} would vanish out of the
    // quoted text and the operator would read a sentence with a hole in it.
    await POST(inboundRequest(smsBody("do you address me as {{name}} in these?")))

    const sendArg = (sendRenderedSequenceEmail as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(sendArg.rendered.text).toContain("name")
    expect(sendArg.rendered.text).toContain("do you address me as")
    expect(sendArg.rendered.text).toContain("in these?")
  })

  it("covers the STOP manual-review alert too, whose From is quoted the same way", async () => {
    // `From` is Twilio's field, not the sender's, but alphanumeric sender IDs
    // put arbitrary text in it and this is the one alert that exists because
    // a compliance opt-out could NOT be honored. Losing it is the worst of
    // the two losses.
    const res = await POST(inboundRequest(smsBody("STOP", "{{sms_consent_url}}")))

    expect(res.status).toBe(200)
    expect(sendRenderedSequenceEmail).toHaveBeenCalledTimes(1)
    const sendArg = (sendRenderedSequenceEmail as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(sendArg.rendered.subject).toBe("SMS STOP needs manual review")
  })

  it("treats a render that throws for any other reason as a lost alert, not a lost webhook", async () => {
    // Belt and braces on top of the defanging above: the alert step is
    // log-not-fatal in full, render included, so a future guard added to
    // renderSequenceEmail cannot reintroduce this same 500.
    ;(renderSequenceEmail as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("renderer exploded")
    })
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const res = await POST(inboundRequest(smsBody("Can I switch my session to Tuesday?")))

    expect(res.status).toBe(200)
    expect(store.timeline).toHaveLength(1)
    expect(sendRenderedSequenceEmail).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })
})

describe("POST /api/webhooks/twilio/inbound — infra faults", () => {
  it("an unexpected DAL failure 500s so Twilio retries, without leaking the error detail", async () => {
    // Force findContactByIdentifiers's read to blow up by making the mocked
    // contacts table's maybeSingle explode via an unknown-table style fault:
    // simplest real trigger is a business_settings read failure on the
    // anything-else + matched path, since that is the one branch that reads
    // a second table after the contact lookup.
    store.businessSettings = [] // getBusinessSettings throws "row missing" when none is seeded
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const res = await POST(inboundRequest(smsBody("Can I switch my session to Tuesday?")))

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: "internal" })
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// The response CONTRACT, as Twilio actually enforces it.
//
// These exist because 27 tests covered this route and every one of them
// passed while production logged error 12300 on every STOP and START:
// "Invalid Content-Type: application/json supplied". They all asserted
// res.status and the database side effects. None asserted what Twilio
// parses, which is the body and its content type.
//
// A status assertion cannot fail on this bug: the route answered 200 the
// whole time. Only a content-type assertion can.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Tenant resolution (Task 11). The `To` number is the ONLY tenant evidence an
// inbound SMS carries. These prove the route resolves a REAL, non-singleton
// business from it via getBusinessBySmsNumber, and threads that SAME value
// through every sibling call (writeTimelineEvent, exitRunsForContact,
// findContactByIdentifiers, suppress, recordConsent) rather than resolving it
// once and defaulting to the singleton for the rest.
// ---------------------------------------------------------------------------
describe("POST /api/webhooks/twilio/inbound — tenant resolution", () => {
  beforeEach(() => {
    store.businessSettings.push({ ...SETTINGS, business_id: OTHER_BUSINESS, sms_sender_phone: OTHER_BUSINESS_TO })
    store.contacts.push({
      id: OTHER_BUSINESS_CONTACT,
      business_id: OTHER_BUSINESS,
      email: "other-biz-lead@example.com",
      phone_e164: OTHER_BUSINESS_PHONE,
    })
    store.sequenceRuns.push({
      id: "run-bbb-1",
      contact_id: OTHER_BUSINESS_CONTACT,
      business_id: OTHER_BUSINESS,
      status: "active",
    })
  })

  it("resolves the business from the To number, and stamps it on the timeline row and the exited run", async () => {
    const res = await POST(inboundRequest(smsBody("STOP", OTHER_BUSINESS_PHONE, OTHER_BUSINESS_TO)))

    expect(res.status).toBe(200)
    expect(store.timeline).toHaveLength(1)
    expect(store.timeline[0]).toMatchObject({ contact_id: OTHER_BUSINESS_CONTACT, business_id: OTHER_BUSINESS })

    const theirRun = store.sequenceRuns.find((r) => r.id === "run-bbb-1")
    expect(theirRun?.status).toBe("exited")
    // The SINGLETON's own run must be untouched -- proof this is scoped, not
    // a business-blind exit.
    const singletonRun = store.sequenceRuns.find((r) => r.id === "run-1")
    expect(singletonRun?.status).toBe("active")

    expect(store.consents[0]).toMatchObject({ contact_id: OTHER_BUSINESS_CONTACT, business_id: OTHER_BUSINESS })
    expect(store.suppressions[0]).toMatchObject({ business_id: OTHER_BUSINESS })
  })

  it("falls back to the platform business when no business claims the To number", async () => {
    // Correct, not lazy: sms_sender_phone defaults to '' and the singleton's
    // number lives in env today, so an unmatched number is the ORDINARY case
    // until a coach's number is configured. The default CONTACT (seeded in
    // the top-level beforeEach) is on the singleton, so it still matches.
    const res = await POST(inboundRequest(smsBody("STOP", PHONE, UNCLAIMED_TO)))

    expect(res.status).toBe(200)
    expect(store.timeline).toHaveLength(1)
    expect(store.timeline[0]).toMatchObject({ contact_id: CONTACT, business_id: BUSINESS })
    expect(BUSINESS).toBe(SINGLETON_BUSINESS_ID) // the fixture IS the singleton -- documents the fallback claim
  })

  // Fix round 1, Important 1. A failed read is NOT the same answer as "no
  // business claims this number" -- collapsing them would fall back to the
  // platform business on a TRANSIENT read failure, suppressing/consenting a
  // coach's opt-out under the wrong tenant while the coach's own sequences
  // keep texting them. This must be the fail-safe direction the route
  // documents 100 lines below for getBusinessSettings: throw, and let
  // Twilio's retry-on-500 semantics do their job.
  it("a business_settings read failure is a retryable 500, NOT a silent fallback to the platform business", async () => {
    businessSettingsReadError = { code: "53300", message: "too many connections" }
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const res = await POST(inboundRequest(smsBody("STOP", OTHER_BUSINESS_PHONE, OTHER_BUSINESS_TO)))

    expect(res.status).toBe(500)
    // Nothing wrote under ANY business -- not the resolved one, not the
    // platform fallback either. A silent fallback would show up here as a
    // suppression/consent row stamped with the platform business's id.
    expect(store.suppressions).toHaveLength(0)
    expect(store.consents).toHaveLength(0)
    expect(store.timeline).toHaveLength(0)
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  // sms_sender_phone is NOT NULL DEFAULT '', so a naive query would match
  // every business that has not configured a number -- including one that
  // isn't the platform's own. Seed exactly that trap: a second, unrelated
  // business row also sitting on ''.
  it("does NOT look up an empty To number, even when another business's row also has an empty sms_sender_phone", async () => {
    store.businessSettings.push({
      ...SETTINGS,
      business_id: "33333333-3333-3333-3333-333333333333",
      sms_sender_phone: "",
    })

    const res = await POST(inboundRequest(smsBody("STOP", PHONE, "")))

    expect(res.status).toBe(200)
    expect(store.timeline[0]).toMatchObject({ contact_id: CONTACT, business_id: SINGLETON_BUSINESS_ID })
  })

  it("still answers TwiML when resolving a non-singleton business", async () => {
    const res = await POST(inboundRequest(smsBody("STOP", OTHER_BUSINESS_PHONE, OTHER_BUSINESS_TO)))
    expect(res.headers.get("content-type")).toMatch(/xml/)
  })

  // START and the anything-else path both write through the same resolved
  // businessId -- proving the threading isn't STOP-only.
  it("threads the resolved business through START (unsuppress + consent + timeline)", async () => {
    store.suppressions = [
      { id: "sup-bbb", business_id: OTHER_BUSINESS, identifier: OTHER_BUSINESS_PHONE.toLowerCase(), reason: "sms_stop" },
    ]
    const res = await POST(inboundRequest(smsBody("START", OTHER_BUSINESS_PHONE, OTHER_BUSINESS_TO)))

    expect(res.status).toBe(200)
    expect(store.suppressions).toHaveLength(0)
    expect(store.consents[0]).toMatchObject({ contact_id: OTHER_BUSINESS_CONTACT, business_id: OTHER_BUSINESS })
    expect(store.timeline[0]).toMatchObject({ contact_id: OTHER_BUSINESS_CONTACT, business_id: OTHER_BUSINESS })
  })

  it("threads the resolved business through the anything-else path, and reads THAT business's settings for the ops alert", async () => {
    store.businessSettings = store.businessSettings.map((row) =>
      row.business_id === OTHER_BUSINESS ? { ...row, reply_to: "other-biz-ops@example.test" } : row,
    )
    const res = await POST(inboundRequest(smsBody("Can I reschedule?", OTHER_BUSINESS_PHONE, OTHER_BUSINESS_TO)))

    expect(res.status).toBe(200)
    expect(store.timeline[0]).toMatchObject({ contact_id: OTHER_BUSINESS_CONTACT, business_id: OTHER_BUSINESS })
    const sendArg = (sendRenderedSequenceEmail as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(sendArg.to).toBe("other-biz-ops@example.test")
  })
})

describe("POST /api/webhooks/twilio/inbound — Twilio response contract", () => {
  // Every handled branch, not just one: the JSON bug was uniform across all
  // four returns, so a single-branch test would have been green on a route
  // that was still three-quarters broken.
  const HANDLED_BRANCHES: Array<{ label: string; body: string; outcome: string }> = [
    { label: "STOP", body: "STOP", outcome: "stop" },
    { label: "START", body: "START", outcome: "start" },
    { label: "HELP", body: "HELP", outcome: "help" },
    { label: "anything else", body: "Can I move my session?", outcome: "inbound" },
  ]

  for (const branch of HANDLED_BRANCHES) {
    it(`${branch.label} answers TwiML, never JSON — the 12300 regression`, async () => {
      const res = await POST(inboundRequest(smsBody(branch.body)))

      expect(res.status).toBe(200)

      const contentType = res.headers.get("content-type") ?? ""
      // The exact string Twilio rejected. Asserted directly so the failure
      // message names the bug rather than a mismatched MIME type.
      expect(contentType).not.toContain("application/json")
      expect(contentType).toContain("text/xml")

      const text = await res.text()
      expect(text).toContain("<Response>")
      // Empty on purpose: spec §5 puts the HELP/STOP reply text on Messaging
      // Service configuration. A <Message> here would mean this route had
      // started originating replies, which its doc comment forbids.
      expect(text).not.toContain("<Message>")
    })
  }

  it("carries the outcome on a header, so the branch stays visible without a JSON body", async () => {
    const res = await POST(inboundRequest(smsBody("STOP")))
    expect(res.headers.get("x-twilio-inbound-outcome")).toBe("stop")
    expect(res.headers.get("x-twilio-inbound-matched")).toBe("true")
  })

  it("distinguishes matched from unmatched on the header", async () => {
    const res = await POST(inboundRequest(smsBody("STOP", "+15559998888")))
    expect(res.headers.get("x-twilio-inbound-outcome")).toBe("stop")
    expect(res.headers.get("x-twilio-inbound-matched")).toBe("false")
  })

  // The 403 and 500 paths deliberately stay JSON. Twilio treats any non-2xx
  // as a failure regardless of content type, and the two distinct 403 bodies
  // are the diagnostic that revealed production had no Twilio env vars set.
  it("keeps the diagnostic JSON on the rejection paths", async () => {
    const res = await POST(inboundRequest(smsBody("STOP"), { signature: "wrong" }))
    expect(res.status).toBe(403)
    expect(res.headers.get("content-type")).toContain("application/json")
    expect(await res.json()).toEqual({ error: "invalid signature" })
  })
})
