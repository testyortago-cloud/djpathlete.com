// @vitest-environment node
//
// app/api/webhooks/calendly/route.ts — the ADAPTER. What a booking means is
// lib/bookings/ingest.ts's job and is exercised through the GHL route by the
// three existing webhook suites (pipeline-hooks, sequence-exit-hooks,
// ghl-booking-attribution) and through THIS route by the Calendly describe
// blocks appended to the first two. This file owns what only this route does:
//
//   * the signature gate, in the order the header comment promises — no key →
//     403 before the body is read; bad or stale signature → 403 with the
//     database untouched
//   * the translation of Calendly's envelope into `BookingIngestInput`,
//     including the reschedule rule (cancel-half → `rescheduled: true`) and
//     the click ids decoded off `payload.tracking`
//   * acknowledging what it does not handle (other events, other event types)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync } from "fs"

import { buildSignatureHeader } from "@/lib/calendly/signature"

const ingestBookingMock = vi.fn(
  async (..._a: any[]): Promise<{ action: "created" | "updated"; bookingId: string | null }> => ({ action: "created", bookingId: "bk-cal-1" }),
)
vi.mock("@/lib/bookings/ingest", () => ({
  ingestBooking: (...a: unknown[]) => ingestBookingMock(...a),
}))

// The route must not touch the database before the signature passes. Any
// call through this mock before then is the failure this test file exists
// to catch, so the mock THROWS rather than returning canned rows.
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => {
    throw new Error("the route reached the database — it must not")
  },
}))

const KEY = "test-signing-key-0123456789"
const FIXTURE = JSON.parse(readFileSync("__tests__/fixtures/calendly/invitee-created.json", "utf8"))

function envelope(overrides: Record<string, unknown> = {}, payloadOverrides: Record<string, unknown> = {}) {
  return {
    ...FIXTURE,
    ...overrides,
    payload: { ...FIXTURE.payload, ...payloadOverrides },
  }
}

function signedRequest(body: unknown, opts: { key?: string; at?: number; header?: string | null } = {}): Request {
  const raw = typeof body === "string" ? body : JSON.stringify(body)
  const at = opts.at ?? Math.floor(Date.now() / 1000)
  const header =
    opts.header === undefined ? buildSignatureHeader({ rawBody: raw, signingKey: opts.key ?? KEY, timestampSeconds: at }) : opts.header
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (header !== null) headers["calendly-webhook-signature"] = header
  return new Request("http://localhost/api/webhooks/calendly", { method: "POST", headers, body: raw })
}

async function post(req: Request) {
  const { POST } = await import("@/app/api/webhooks/calendly/route")
  return POST(req)
}

beforeEach(() => {
  vi.clearAllMocks()
  ingestBookingMock.mockReset().mockResolvedValue({ action: "created", bookingId: "bk-cal-1" })
  process.env.CALENDLY_WEBHOOK_SIGNING_KEY = KEY
  process.env.CALENDLY_EVENT_TYPE_URI = "https://api.calendly.com/event_types/EVENTTYPE000001"
})

afterEach(() => {
  delete process.env.CALENDLY_WEBHOOK_SIGNING_KEY
  delete process.env.CALENDLY_EVENT_TYPE_URI
})

describe("the signature gate", () => {
  it("answers 403 BEFORE reading the body when no signing key is configured", async () => {
    delete process.env.CALENDLY_WEBHOOK_SIGNING_KEY
    // The claim in the route's header is "403 before the body is read"; a test
    // that only checks the status passes with request.text() moved above the
    // key check. So every body reader on the request is spied. (A first
    // version used a ReadableStream whose pull() recorded — undici pulls it
    // while constructing the Request, so it observed nothing about the route.)
    const req = signedRequest(envelope())
    const readers = (["text", "json", "arrayBuffer", "formData", "blob"] as const).map((name) => vi.spyOn(req, name))
    const res = await post(req)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "calendly not configured" })
    for (const reader of readers) expect(reader).not.toHaveBeenCalled()
    expect(ingestBookingMock).not.toHaveBeenCalled()
  })

  it("answers 403 and ingests nothing without a signature header", async () => {
    const res = await post(signedRequest(envelope(), { header: null }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/missing/)
    expect(ingestBookingMock).not.toHaveBeenCalled()
  })

  it("answers 403 on a digest made with the wrong key", async () => {
    const res = await post(signedRequest(envelope(), { key: "someone-else" }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/mismatch/)
    expect(ingestBookingMock).not.toHaveBeenCalled()
  })

  it("answers 403 on a stale timestamp even with a correct digest (replay)", async () => {
    const res = await post(signedRequest(envelope(), { at: Math.floor(Date.now() / 1000) - 600 }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/stale/)
    expect(ingestBookingMock).not.toHaveBeenCalled()
  })

  // MUTANT KILLED: `JSON.stringify(await request.json())` in place of
  // `request.text()`. A compact body round-trips byte-identical through that,
  // so every other test here passes with the mutant in place; a body with
  // whitespace does not, and Calendly's bytes are not ours to re-serialise.
  it("verifies the bytes AS SENT — a pretty-printed body signed as sent is accepted", async () => {
    const raw = JSON.stringify(envelope(), null, 2)
    const header = buildSignatureHeader({ rawBody: raw, signingKey: KEY, timestampSeconds: Math.floor(Date.now() / 1000) })
    const res = await post(
      new Request("http://localhost/api/webhooks/calendly", {
        method: "POST",
        headers: { "content-type": "application/json", "calendly-webhook-signature": header },
        body: raw,
      }),
    )
    expect(res.status).toBe(201)
    expect(ingestBookingMock).toHaveBeenCalledTimes(1)
  })

  it("verifies the RAW body — a byte changed after signing is refused", async () => {
    const raw = JSON.stringify(envelope())
    const header = buildSignatureHeader({ rawBody: raw, signingKey: KEY, timestampSeconds: Math.floor(Date.now() / 1000) })
    const tampered = raw.replace("priya.raman+seed@example.test", "attacker@example.test")
    const res = await post(
      new Request("http://localhost/api/webhooks/calendly", {
        method: "POST",
        headers: { "content-type": "application/json", "calendly-webhook-signature": header },
        body: tampered,
      }),
    )
    expect(res.status).toBe(403)
    expect(ingestBookingMock).not.toHaveBeenCalled()
  })
})

describe("invitee.created", () => {
  it("translates the payload into a scheduled booking keyed on the scheduled_event URI", async () => {
    const res = await post(signedRequest(envelope()))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ success: true, action: "created" })

    expect(ingestBookingMock).toHaveBeenCalledTimes(1)
    const input = ingestBookingMock.mock.calls[0][0]
    expect(input).toMatchObject({
      source: "calendly",
      key: { column: "calendly_event_uri", value: "https://api.calendly.com/scheduled_events/SCHEDEVENT0001" },
      contact: { name: "Priya Raman", email: "priya.raman+seed@example.test" },
      bookingDate: "2026-09-08T14:00:00.000000Z",
      durationMinutes: 30,
      status: "scheduled",
      rescheduled: false,
      actor: "calendly",
      auditSource: "calendly_webhook",
      columns: {
        calendly_event_uri: "https://api.calendly.com/scheduled_events/SCHEDEVENT0001",
        reschedule_url: "https://calendly.com/reschedulings/INVITEE00000001",
        cancel_url: "https://calendly.com/cancellations/INVITEE00000001",
      },
    })
  })

  it("normalises the phone-call number to E.164 so it matches contacts.phone_e164", async () => {
    await post(signedRequest(envelope()))
    expect(ingestBookingMock.mock.calls[0][0].contact.phone).toBe("+16176504548")
  })

  it("falls back to the SMS reminder number when the event is not a phone call", async () => {
    await post(
      signedRequest(
        envelope({}, {
          scheduled_event: { ...FIXTURE.payload.scheduled_event, location: { type: "zoom_conference", location: null } },
          text_reminder_number: "(617) 650-4548",
        }),
      ),
    )
    expect(ingestBookingMock.mock.calls[0][0].contact.phone).toBe("+16176504548")
  })

  it("decodes the click ids and the conversation id off payload.tracking", async () => {
    await post(signedRequest(envelope()))
    const input = ingestBookingMock.mock.calls[0][0]
    expect(input.clickIds).toEqual({ gclid: "TeSt_gclid-123", gbraid: null, wbraid: null, fbclid: null })
    expect(input.auditMetadata.chat_conversation_id).toBe("0f3b2e9a-6c1d-4f0e-9b7a-2c4d6e8f0a1b")
  })

  it("carries no click ids when the tracking is not ours", async () => {
    await post(signedRequest(envelope({}, { tracking: { utm_source: "google", utm_content: "ad-b" } })))
    expect(ingestBookingMock.mock.calls[0][0].clickIds).toEqual({ gclid: null, gbraid: null, wbraid: null, fbclid: null })
  })

  it("marks invitee.created as an immutable event (ignoreIfTerminal) so a late retry cannot reopen a cancelled booking", async () => {
    await post(signedRequest(envelope()))
    expect(ingestBookingMock.mock.calls[0][0].ignoreIfTerminal).toBe(true)
    expect(ingestBookingMock.mock.calls[0][0].rescheduledFrom).toBeNull()
  })

  it("answers 200 updated on a redelivery (the ingest found the row)", async () => {
    ingestBookingMock.mockResolvedValueOnce({ action: "updated", bookingId: "bk-cal-1" })
    const res = await post(signedRequest(envelope()))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, action: "updated" })
  })

  it("takes the duration from start/end and defaults to 30 without an end", async () => {
    await post(signedRequest(envelope({}, { scheduled_event: { ...FIXTURE.payload.scheduled_event, end_time: "2026-09-08T14:45:00.000000Z" } })))
    expect(ingestBookingMock.mock.calls[0][0].durationMinutes).toBe(45)
    await post(signedRequest(envelope({}, { scheduled_event: { ...FIXTURE.payload.scheduled_event, end_time: null } })))
    expect(ingestBookingMock.mock.calls[1][0].durationMinutes).toBe(30)
  })
})

describe("invitee.canceled", () => {
  it("marks the booking cancelled with the reason, and lets the ingest close the card", async () => {
    const res = await post(
      signedRequest(
        envelope({ event: "invitee.canceled" }, { status: "canceled", cancellation: { canceled_by: "Priya Raman", reason: "Clash" } }),
      ),
    )
    expect(res.status).toBe(201)
    const input = ingestBookingMock.mock.calls[0][0]
    expect(input.status).toBe("cancelled")
    expect(input.rescheduled).toBe(false)
    expect(input.notes).toBe("Cancelled via Calendly. Reason: Clash")
    expect(input.key.value).toBe("https://api.calendly.com/scheduled_events/SCHEDEVENT0001")
  })

  // Spec §8.2. A reschedule is a cancel of the old invitee PLUS a create of
  // the new one, in no guaranteed order. The cancel half must not be allowed
  // to close the card, or somebody who moved their call by a day is Lost.
  it("passes rescheduled:true on the cancel half of a reschedule so the pipeline is left alone", async () => {
    await post(
      signedRequest(
        envelope(
          { event: "invitee.canceled" },
          { status: "canceled", rescheduled: true, new_invitee: "https://api.calendly.com/scheduled_events/SCHEDEVENT0002/invitees/INVITEE00000002" },
        ),
      ),
    )
    const input = ingestBookingMock.mock.calls[0][0]
    expect(input.status).toBe("cancelled")
    expect(input.rescheduled).toBe(true)
    expect(input.notes).toBe("Rescheduled via Calendly → https://api.calendly.com/scheduled_events/SCHEDEVENT0002/invitees/INVITEE00000002")
  })

  it("the create half of a reschedule is a scheduled booking that names the invitee it replaces", async () => {
    await post(signedRequest(envelope({}, { old_invitee: "https://api.calendly.com/scheduled_events/SCHEDEVENT0000/invitees/INVITEE00000000" })))
    const input = ingestBookingMock.mock.calls[0][0]
    expect(input.status).toBe("scheduled")
    expect(input.rescheduled).toBe(false)
    expect(input.rescheduledFrom).toBe("https://api.calendly.com/scheduled_events/SCHEDEVENT0000/invitees/INVITEE00000000")
    expect(input.notes).toMatch(/^Rescheduled via Calendly from /)
  })

  it("the cancel half never carries rescheduledFrom or ignoreIfTerminal", async () => {
    await post(signedRequest(envelope({ event: "invitee.canceled" }, { status: "canceled", rescheduled: true })))
    const input = ingestBookingMock.mock.calls[0][0]
    expect(input.rescheduledFrom).toBeNull()
    expect(input.ignoreIfTerminal).toBe(false)
  })
})

describe("what it does not handle", () => {
  it("acknowledges an event it did not subscribe to without ingesting", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const res = await post(signedRequest(envelope({ event: "routing_form_submission.created" })))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ignored: true, event: "routing_form_submission.created" })
    expect(ingestBookingMock).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("acknowledges a booking of a different event type on the same account without ingesting", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const res = await post(
      signedRequest(envelope({}, { scheduled_event: { ...FIXTURE.payload.scheduled_event, event_type: "https://api.calendly.com/event_types/OTHER" } })),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).ignored).toBe(true)
    expect(ingestBookingMock).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("fails CLOSED: a delivery with no event_type while one is configured is ignored", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { event_type: _dropped, ...withoutType } = FIXTURE.payload.scheduled_event
    const res = await post(signedRequest(envelope({}, { scheduled_event: withoutType })))
    expect(res.status).toBe(200)
    expect((await res.json()).ignored).toBe(true)
    expect(ingestBookingMock).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("ingests every event type when no consult event type is configured", async () => {
    delete process.env.CALENDLY_EVENT_TYPE_URI
    await post(signedRequest(envelope({}, { scheduled_event: { ...FIXTURE.payload.scheduled_event, event_type: "https://api.calendly.com/event_types/OTHER" } })))
    expect(ingestBookingMock).toHaveBeenCalledTimes(1)
  })

  it("answers 400 on a signed body that is not the invitee shape, and ingests nothing", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await post(signedRequest({ event: "invitee.created", payload: { hello: "world" } }))
    expect(res.status).toBe(400)
    expect(ingestBookingMock).not.toHaveBeenCalled()
    err.mockRestore()
  })

  it("answers 500 when the ingest throws, so Calendly retries", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    ingestBookingMock.mockRejectedValueOnce(new Error("db down"))
    const res = await post(signedRequest(envelope()))
    expect(res.status).toBe(500)
    err.mockRestore()
  })
})
