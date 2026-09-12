// @vitest-environment node
//
// Route-level tests for POST /api/webhooks/twilio/status. Unlike most DAL
// suites in this repo, `applyDeliveryStatus` (lib/db/sequences.ts) is NOT
// mocked here — only `@/lib/supabase`'s `createServiceRoleClient` is, behind
// a tiny in-memory `sequence_messages` table. That lets this one file cover
// everything task-4-brief.md's Step 1 asks for through real POST requests:
// signature validation, the route's 403/200 shape, AND the DAL's monotonic
// delivery-status rules — there is no separate `lib/db/sequences` test file
// for `applyDeliveryStatus`, this is it.
//
// `validateTwilioSignature` (lib/lead-engine/twilio-signature.ts) is real
// too; its own algorithm is unit-tested independently in
// __tests__/lib/lead-engine/twilio-signature.test.ts. Signed requests here
// are built with node:crypto directly against Twilio's documented scheme,
// not by calling the module under test — a broken implementation can't sign
// its own way past these tests.
//
// The in-memory mock supports exactly the two query shapes
// `applyDeliveryStatus` issues (a two-`eq` `.maybeSingle()` read, and an
// `.eq().neq()` update) — per the brief, these mocks elsewhere in the repo
// support only one `.order()` per query; this DAL function uses none at all,
// so that constraint doesn't bind here, but the mock is still built narrow
// and on purpose rather than as a generic fake table.

import { describe, it, expect, beforeEach, vi } from "vitest"
import { createHmac } from "node:crypto"

// The conversation-record mirror (Task 7, 2026-09-12-two-way-sms) is a
// separate DAL function from `applyDeliveryStatus` above, so it is mocked
// directly rather than folded into the in-memory `sequence_messages` table:
// these tests need to assert the EXACT arguments the route passes through
// (verbatim status, the raw ErrorCode), which a behavioural row-state check
// can't distinguish as precisely.
vi.mock("@/lib/db/sms-messages", () => ({ updateSmsStatusBySid: vi.fn() }))

type Row = {
  id: string
  status: string
  provider: string
  provider_message_id: string
  delivered_at: string | null
}

const { db } = vi.hoisted(() => ({
  db: {
    rows: [] as Row[],
    // Set by exactly one test to simulate a genuine Supabase read failure
    // (a `{ error }` shape, not a thrown exception — that's what the real
    // supabase-js client returns on failure) — the infra-fault path
    // `applyDeliveryStatus` turns into a throw via its `if (readErr) throw
    // readErr`.
    forceReadError: null as Error | null,
  },
}))

// The `update` chain below is a real (if tiny) fluent query builder, not a
// fixed-depth stub: each `.eq()`/`.neq()` call returns a builder that is
// itself awaitable (via `.then`) AND further chainable, accumulating
// filters as it goes and applying whichever ones were actually chained at
// the point something awaits it. A fixed-depth stub — one where the
// row-mutating logic lives only inside the LAST method in the chain
// (`.neq()`) — would silently no-op instead of actually updating when the
// brief's Step 5 mutation check removes that final `.neq("status",
// "delivered")` call from the real `applyDeliveryStatus`: the row would
// stay unmutated by coincidence of the mock's shape, not because the
// guard did its job, which would make the mutation check pass for the
// wrong reason. This builder applies exactly the filters it was actually
// given, so removing a `.neq()` call in the source really does remove that
// constraint from the query the mock executes — the same thing removing it
// would do against a real Supabase `.update()` chain.
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table !== "sequence_messages") throw new Error(`unmocked table: ${table}`)

      // Untyped on purpose: a `PromiseLike<{ error: null }>` return
      // annotation here fights TypeScript's structural `.then()` overload
      // resolution for no real benefit — this is a test-only mock, not
      // shipped code, and every call site above still gets full type
      // checking on `db.rows`, `patch`, and the filter predicates.
      function updateBuilder(patch: Partial<Row>, filters: Array<(r: Row) => boolean>): any {
        const exec = async () => {
          const idx = db.rows.findIndex((r) => filters.every((f) => f(r)))
          if (idx >= 0) db.rows[idx] = { ...db.rows[idx], ...patch }
          return { error: null }
        }
        return {
          eq: (col: string, val: string) =>
            updateBuilder(patch, [...filters, (r: Row) => (r as unknown as Record<string, unknown>)[col] === val]),
          neq: (col: string, val: string) =>
            updateBuilder(patch, [...filters, (r: Row) => (r as unknown as Record<string, unknown>)[col] !== val]),
          then: (onFulfilled: (v: { error: null }) => unknown, onRejected?: (e: unknown) => unknown) =>
            exec().then(onFulfilled, onRejected),
        }
      }

      return {
        select: () => ({
          eq: (colA: string, valA: string) => ({
            eq: (colB: string, valB: string) => ({
              maybeSingle: async () => {
                if (db.forceReadError) return { data: null, error: db.forceReadError }
                const row = db.rows.find(
                  (r) =>
                    (r as unknown as Record<string, unknown>)[colA] === valA &&
                    (r as unknown as Record<string, unknown>)[colB] === valB,
                )
                return { data: row ? { ...row } : null, error: null }
              },
            }),
          }),
        }),
        update: (patch: Partial<Row>) => updateBuilder(patch, []),
      }
    },
  }),
}))

import { POST } from "@/app/api/webhooks/twilio/status/route"
import { updateSmsStatusBySid } from "@/lib/db/sms-messages"

const AUTH_TOKEN = "route_test_auth_token"
const ORIGIN = "https://app.example.test"
const PATH = "/api/webhooks/twilio/status"

function sign(params: Record<string, string>, authToken = AUTH_TOKEN): string {
  const url = `${ORIGIN}${PATH}`
  const sortedKeys = Object.keys(params).sort()
  const data = url + sortedKeys.map((k) => `${k}${params[k]}`).join("")
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64")
}

function statusRequest(params: Record<string, string>, opts: { signature?: string } = {}): Request {
  return new Request(`${ORIGIN}${PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": opts.signature ?? sign(params),
    },
    body: new URLSearchParams(params).toString(),
  })
}

function seedRow(overrides: Partial<Row> = {}): Row {
  const row: Row = {
    id: `msg-${db.rows.length + 1}`,
    status: "sent",
    provider: "twilio",
    provider_message_id: `SM${db.rows.length + 1}`,
    delivered_at: null,
    ...overrides,
  }
  db.rows.push(row)
  return row
}

beforeEach(() => {
  db.rows = []
  db.forceReadError = null
  process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN
  process.env.NEXTAUTH_URL = ORIGIN
  // mockReset (not clearAllMocks): a prior test's mockRejectedValue/
  // mockResolvedValue must not leak into the next one via a queued
  // implementation clearAllMocks would leave behind.
  ;(updateSmsStatusBySid as ReturnType<typeof vi.fn>).mockReset()
  ;(updateSmsStatusBySid as ReturnType<typeof vi.fn>).mockResolvedValue("updated")
})

describe("POST /api/webhooks/twilio/status", () => {
  it("a delivered callback updates a sent row", async () => {
    const row = seedRow({ status: "sent" })

    const res = await POST(statusRequest({ MessageSid: row.provider_message_id, MessageStatus: "delivered" }))

    expect(res.status).toBe(200)
    expect(res.headers.get("x-twilio-status-outcome")).toBe("updated")
    expect(db.rows.find((r) => r.id === row.id)?.status).toBe("delivered")
  })

  it("a later failed callback on an already-delivered row is ignored and leaves it delivered", async () => {
    const row = seedRow({ status: "delivered" })

    const res = await POST(statusRequest({ MessageSid: row.provider_message_id, MessageStatus: "failed" }))

    expect(res.status).toBe(200)
    expect(res.headers.get("x-twilio-status-outcome")).toBe("ignored")
    expect(db.rows.find((r) => r.id === row.id)?.status).toBe("delivered")
  })

  it("a later undelivered callback on an already-delivered row is also ignored", async () => {
    const row = seedRow({ status: "delivered" })

    const res = await POST(statusRequest({ MessageSid: row.provider_message_id, MessageStatus: "undelivered" }))

    expect(res.status).toBe(200)
    expect(res.headers.get("x-twilio-status-outcome")).toBe("ignored")
    expect(db.rows.find((r) => r.id === row.id)?.status).toBe("delivered")
  })

  it("a failed callback on a sent row updates it", async () => {
    const row = seedRow({ status: "sent" })

    const res = await POST(statusRequest({ MessageSid: row.provider_message_id, MessageStatus: "failed" }))

    expect(res.status).toBe(200)
    expect(res.headers.get("x-twilio-status-outcome")).toBe("updated")
    expect(db.rows.find((r) => r.id === row.id)?.status).toBe("failed")
  })

  it("a delivered callback overwrites an earlier failed callback (late delivery beats an earlier pessimistic one)", async () => {
    const row = seedRow({ status: "failed" })

    const res = await POST(statusRequest({ MessageSid: row.provider_message_id, MessageStatus: "delivered" }))

    expect(res.status).toBe(200)
    expect(res.headers.get("x-twilio-status-outcome")).toBe("updated")
    expect(db.rows.find((r) => r.id === row.id)?.status).toBe("delivered")
  })

  it("an unknown sid answers 200 unknown_message", async () => {
    const res = await POST(statusRequest({ MessageSid: "SM-does-not-exist", MessageStatus: "delivered" }))

    expect(res.status).toBe(200)
    expect(res.headers.get("x-twilio-status-outcome")).toBe("unknown_message")
  })

  it("a sent/queued/accepted callback is ignored without touching the row (we already recorded sent at send time)", async () => {
    const row = seedRow({ status: "sent" })

    const res = await POST(statusRequest({ MessageSid: row.provider_message_id, MessageStatus: "queued" }))

    expect(res.status).toBe(200)
    expect(res.headers.get("x-twilio-status-outcome")).toBe("ignored")
    expect(db.rows.find((r) => r.id === row.id)?.status).toBe("sent")
  })

  it("a bad signature 403s and leaves the row untouched", async () => {
    const row = seedRow({ status: "sent" })

    const res = await POST(
      statusRequest(
        { MessageSid: row.provider_message_id, MessageStatus: "delivered" },
        { signature: "not-the-right-signature-value=" },
      ),
    )

    expect(res.status).toBe(403)
    expect(db.rows.find((r) => r.id === row.id)?.status).toBe("sent")
  })

  it("a missing TWILIO_AUTH_TOKEN 403s with zero DB access", async () => {
    delete process.env.TWILIO_AUTH_TOKEN
    const row = seedRow({ status: "sent" })

    const res = await POST(statusRequest({ MessageSid: row.provider_message_id, MessageStatus: "delivered" }))

    expect(res.status).toBe(403)
    expect(db.rows.find((r) => r.id === row.id)?.status).toBe("sent")
  })

  // Fix (task review, Concern 3): a THROWN applyDeliveryStatus failure is,
  // by construction, an infra fault — nothing in its mapped path
  // (updated/ignored/unknown_message) throws for a bad or unrecognized
  // payload. It used to be swallowed into a 200, which means Twilio never
  // retries and that delivery status is lost permanently behind nothing
  // more than a console.error. It must 500 instead, so Twilio's own
  // retry-with-backoff gets a chance to self-heal a transient DB fault —
  // and the response body must stay generic, never echoing the underlying
  // error detail through a public webhook response.
  it("an unexpected applyDeliveryStatus failure 500s so Twilio retries, without leaking the error detail", async () => {
    const row = seedRow({ status: "sent" })
    db.forceReadError = new Error("supabase connection reset: dsn=postgres://internal-db-host.internal/prod")
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const res = await POST(statusRequest({ MessageSid: row.provider_message_id, MessageStatus: "delivered" }))

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: "internal" })
    expect(JSON.stringify(body)).not.toContain("supabase connection reset")
    expect(JSON.stringify(body)).not.toContain("internal-db-host")
    // The row is untouched — the read never even got far enough to see it.
    expect(db.rows.find((r) => r.id === row.id)?.status).toBe("sent")
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Response contract, mirroring the inbound webhook's suite.
//
// This route was NOT observed producing a 12300 -- a delivered test message on
// 2026-08-25 fired this callback and logged no Twilio alert, so status
// callbacks appear to tolerate JSON where inbound messages do not. These tests
// pin TwiML anyway, because the two routes are meant to mirror each other and
// TwiML is never wrong for a Twilio webhook. Pinning it stops the twins
// drifting apart again.
// ---------------------------------------------------------------------------
describe("POST /api/webhooks/twilio/status — Twilio response contract", () => {
  it("answers TwiML, never JSON", async () => {
    const row = seedRow({ status: "sent" })
    const res = await POST(statusRequest({ MessageSid: row.provider_message_id, MessageStatus: "delivered" }))

    expect(res.status).toBe(200)
    const contentType = res.headers.get("content-type") ?? ""
    expect(contentType).not.toContain("application/json")
    expect(contentType).toContain("text/xml")

    const text = await res.text()
    expect(text).toContain("<Response>")
    // A status callback reports on a message this app already sent -- there is
    // nobody to reply to, so a <Message> here would text a lead at random.
    expect(text).not.toContain("<Message>")
  })

  it("carries the outcome on a header now that the body is TwiML", async () => {
    const row = seedRow({ status: "sent" })
    const res = await POST(statusRequest({ MessageSid: row.provider_message_id, MessageStatus: "delivered" }))
    expect(res.headers.get("x-twilio-status-outcome")).toBe("updated")
  })

  it("still answers TwiML for an unrecognised sid, which must not 500", async () => {
    const res = await POST(statusRequest({ MessageSid: "SM-does-not-exist", MessageStatus: "delivered" }))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type") ?? "").toContain("text/xml")
    expect(res.headers.get("x-twilio-status-outcome")).toBe("unknown_message")
  })

  it("keeps the diagnostic JSON on the rejection path", async () => {
    const res = await POST(
      statusRequest({ MessageSid: "SM1", MessageStatus: "delivered" }, { signature: "wrong" }),
    )
    expect(res.status).toBe(403)
    expect(res.headers.get("content-type") ?? "").toContain("application/json")
  })
})

// ---------------------------------------------------------------------------
// Task 7 (2026-09-12-two-way-sms): the same callback also updates the
// conversation's own row in `sms_messages`, via `updateSmsStatusBySid`
// (lib/db/sms-messages.ts). `applyDeliveryStatus` above still owns
// `sequence_messages` and the response's mapped outcome/status code; this is
// a second, independent side effect with its own try/catch, so a broken
// conversation-record write can never turn a delivery receipt into a 500
// Twilio would retry forever.
// ---------------------------------------------------------------------------
describe("POST /api/webhooks/twilio/status — sms_messages mirror", () => {
  it("updates the conversation row by twilio_sid, passing Twilio's status through verbatim", async () => {
    const row = seedRow({ status: "sent" })

    const res = await POST(statusRequest({ MessageSid: row.provider_message_id, MessageStatus: "delivered" }))

    expect(res.status).toBe(200)
    // Verbatim, not mapped: applyDeliveryStatus maps to a four-value space
    // because it drives the engine; the conversation just shows what the
    // carrier said, so "delivered" must reach the DAL unchanged.
    expect(updateSmsStatusBySid).toHaveBeenCalledWith(row.provider_message_id, "delivered", null)
  })

  it("passes the carrier error code through when one is present", async () => {
    const row = seedRow({ status: "sent" })

    await POST(
      statusRequest({ MessageSid: row.provider_message_id, MessageStatus: "failed", ErrorCode: "30006" }),
    )

    expect(updateSmsStatusBySid).toHaveBeenCalledWith(row.provider_message_id, "failed", "30006")
  })

  it("still answers 200 and empty TwiML when only the sequence row matched", async () => {
    ;(updateSmsStatusBySid as ReturnType<typeof vi.fn>).mockResolvedValue("unknown_message")
    const row = seedRow({ status: "sent" })

    const res = await POST(statusRequest({ MessageSid: row.provider_message_id, MessageStatus: "delivered" }))

    expect(res.status).toBe(200)
    // Assert the BODY, not just res.status -- this repo shipped a production
    // outage answering JSON to a Twilio webhook (error 12300) while 27 tests
    // asserted only res.status and none asserted the body.
    expect(await res.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
    expect(res.headers.get("content-type") ?? "").toContain("text/xml")
  })

  it("does not 500 the webhook when the conversation update throws", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    ;(updateSmsStatusBySid as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"))
    const row = seedRow({ status: "sent" })

    const res = await POST(statusRequest({ MessageSid: row.provider_message_id, MessageStatus: "delivered" }))

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })
})
