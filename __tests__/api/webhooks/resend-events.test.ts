// @vitest-environment node
//
// G09. The endpoint Resend posts engagement events to. It is UNAUTHENTICATED
// in the ordinary sense — the Svix signature is the whole authorisation — so
// the refusal path matters more than the happy one: a forged delivery could
// mark any message opened, and, through the bounce arm, suppress any address
// the engine knows.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createHmac } from "node:crypto"

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"

const mocks = vi.hoisted(() => ({
  // Typed with their real arity: a zero-arg mock gives `mock.calls` an empty
  // tuple type, so asserting on an argument is a tsc error rather than a test.
  applyResendEmailEvent: vi.fn(async (..._a: unknown[]) => "updated" as string),
  sequenceMessageRecipient: vi.fn(
    async (..._a: unknown[]) =>
      ({ businessId: "biz-1", toIdentifier: "row@example.com" }) as { businessId: string; toIdentifier: string } | null,
  ),
  suppress: vi.fn(async (..._a: unknown[]) => undefined),
}))

vi.mock("@/lib/db/sequences", () => ({
  applyResendEmailEvent: mocks.applyResendEmailEvent,
  sequenceMessageRecipient: mocks.sequenceMessageRecipient,
}))
vi.mock("@/lib/db/contact-consents", () => ({ suppress: mocks.suppress }))

import { POST } from "@/app/api/webhooks/resend/route"

function signedRequest(payload: unknown, opts: { secret?: string; id?: string; timestamp?: number } = {}) {
  const body = JSON.stringify(payload)
  const id = opts.id ?? "msg_2abc"
  const t = opts.timestamp ?? Math.floor(Date.now() / 1000)
  const key = Buffer.from((opts.secret ?? SECRET).replace(/^whsec_/, ""), "base64")
  const digest = createHmac("sha256", key).update(`${id}.${t}.${body}`).digest("base64")
  return new Request("http://localhost/api/webhooks/resend", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": String(t),
      "svix-signature": `v1,${digest}`,
    },
    body,
  })
}

const OPENED = {
  type: "email.opened",
  created_at: "2026-08-18T14:00:00.000Z",
  data: { email_id: "re_abc123", to: ["lead@example.com"] },
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.RESEND_WEBHOOK_SECRET = SECRET
  mocks.applyResendEmailEvent.mockResolvedValue("updated")
  mocks.sequenceMessageRecipient.mockResolvedValue({ businessId: "biz-1", toIdentifier: "row@example.com" })
  mocks.suppress.mockResolvedValue(undefined)
})

describe("POST /api/webhooks/resend — the signature is the authorisation", () => {
  it("records the event on a correctly signed delivery", async () => {
    const res = await POST(signedRequest(OPENED))
    expect(res.status).toBe(200)
    expect(mocks.applyResendEmailEvent).toHaveBeenCalledWith("re_abc123", "opened", expect.any(Date))
  })

  it("403s an unsigned delivery and writes NOTHING", async () => {
    const res = await POST(
      new Request("http://localhost/api/webhooks/resend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(OPENED),
      }),
    )
    expect(res.status).toBe(403)
    expect(mocks.applyResendEmailEvent).not.toHaveBeenCalled()
  })

  it("403s a delivery signed with the wrong secret", async () => {
    const res = await POST(signedRequest(OPENED, { secret: "whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }))
    expect(res.status).toBe(403)
    expect(mocks.applyResendEmailEvent).not.toHaveBeenCalled()
  })

  it("403s a replayed delivery outside the tolerance window", async () => {
    const res = await POST(signedRequest(OPENED, { timestamp: Math.floor(Date.now() / 1000) - 4000 }))
    expect(res.status).toBe(403)
    expect(mocks.applyResendEmailEvent).not.toHaveBeenCalled()
  })

  it("500s rather than 403s when the SECRET IS NOT CONFIGURED", async () => {
    // A deployment missing the env var is an operator fault, not an attack.
    // Answering 403 would bury it under "invalid signature" in the logs and
    // tell Svix to stop retrying; a 5xx is retried and is visibly our problem.
    delete process.env.RESEND_WEBHOOK_SECRET
    const res = await POST(signedRequest(OPENED))
    expect(res.status).toBe(500)
    expect(mocks.applyResendEmailEvent).not.toHaveBeenCalled()
  })
})

describe("POST /api/webhooks/resend — what it does with each event", () => {
  const cases: Array<[string, string]> = [
    ["email.delivered", "delivered"],
    ["email.opened", "opened"],
    ["email.clicked", "clicked"],
    ["email.bounced", "bounced"],
  ]

  for (const [type, kind] of cases) {
    it(`maps ${type} to ${kind}`, async () => {
      await POST(signedRequest({ ...OPENED, type }))
      expect(mocks.applyResendEmailEvent).toHaveBeenCalledWith("re_abc123", kind, expect.any(Date))
    })
  }

  it("ignores an event type it does not handle, and still answers 200", async () => {
    // email.sent, email.delivery_delayed, email.complained and anything Resend
    // adds later. A non-2xx would make Svix retry forever.
    const res = await POST(signedRequest({ ...OPENED, type: "email.delivery_delayed" }))
    expect(res.status).toBe(200)
    expect(mocks.applyResendEmailEvent).not.toHaveBeenCalled()
  })

  it("answers 200 for an email that is not a sequence message", async () => {
    // Resend fires for EVERY email the account sends — most are transactional
    // and have no sequence_messages row. That is the common case, not a fault.
    mocks.applyResendEmailEvent.mockResolvedValue("unknown_message")
    const res = await POST(signedRequest(OPENED))
    expect(res.status).toBe(200)
  })

  it("verifies the RAW body — a pretty-printed payload still passes", async () => {
    // THE INVARIANT THIS FILE'S HEADER NAMES, and the one every other fixture
    // here is blind to: they all round-trip byte-identically through
    // JSON.parse/stringify, so a `JSON.stringify(await request.json())` mutant
    // survives all of them. A pretty-printed body does NOT round-trip, so this
    // is the case that fails if the route ever re-serialises before verifying.
    const pretty = JSON.stringify(OPENED, null, 2)
    expect(JSON.stringify(JSON.parse(pretty))).not.toBe(pretty)

    const id = "msg_pretty"
    const t = Math.floor(Date.now() / 1000)
    const key = Buffer.from(SECRET.replace(/^whsec_/, ""), "base64")
    const digest = createHmac("sha256", key).update(`${id}.${t}.${pretty}`).digest("base64")
    const res = await POST(
      new Request("http://localhost/api/webhooks/resend", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "svix-id": id,
          "svix-timestamp": String(t),
          "svix-signature": `v1,${digest}`,
        },
        body: pretty,
      }),
    )

    expect(res.status).toBe(200)
    expect(mocks.applyResendEmailEvent).toHaveBeenCalledWith("re_abc123", "opened", expect.any(Date))
  })

  it("uses the event's own timestamp, not the moment we processed it", async () => {
    // Svix retries. A delivery replayed an hour later must not record the open
    // as having happened an hour late.
    await POST(signedRequest({ ...OPENED, created_at: "2026-08-18T14:00:00.000Z" }))
    const at = mocks.applyResendEmailEvent.mock.calls[0][2] as unknown as Date
    expect(at.toISOString()).toBe("2026-08-18T14:00:00.000Z")
  })
})

describe("POST /api/webhooks/resend — a hard bounce suppresses the address", () => {
  it("suppresses the recipient under the message's own business, on a PERMANENT bounce", async () => {
    await POST(
      signedRequest({
        ...OPENED,
        type: "email.bounced",
        data: { ...OPENED.data, bounce: { type: "Permanent", subType: "General" } },
      }),
    )
    // The address comes from the message ROW, not the payload: a bounce report
    // does not always name the address we actually sent to.
    expect(mocks.suppress).toHaveBeenCalledWith("row@example.com", "bounced", "biz-1")
  })

  it("does NOT suppress a TRANSIENT bounce — a full mailbox is not a dead one", async () => {
    // The presence control is the test above: a Permanent bounce with this
    // exact shape DOES suppress, so this passing means the type mattered and
    // not that the path is simply unreachable.
    //
    // Why this is the most dangerous line in the file: `suppress` never
    // expires, an email suppression exits the WHOLE run (not just email), and
    // no admin screen can undo it. One out-of-office would silently eject a
    // live lead from every sequence, forever.
    await POST(
      signedRequest({
        ...OPENED,
        type: "email.bounced",
        data: { ...OPENED.data, bounce: { type: "Transient", subType: "MailboxFull" } },
      }),
    )
    expect(mocks.suppress).not.toHaveBeenCalled()
  })

  it("does NOT suppress an UNDETERMINED bounce", async () => {
    await POST(
      signedRequest({
        ...OPENED,
        type: "email.bounced",
        data: { ...OPENED.data, bounce: { type: "Undetermined", subType: "Undetermined" } },
      }),
    )
    expect(mocks.suppress).not.toHaveBeenCalled()
  })

  it("does NOT suppress a bounce carrying no type at all", async () => {
    await POST(signedRequest({ ...OPENED, type: "email.bounced" }))
    expect(mocks.suppress).not.toHaveBeenCalled()
  })

  it("marks the row failed for a transient bounce even though it does not suppress", async () => {
    // The record of what happened is not the same thing as a life sentence.
    await POST(
      signedRequest({
        ...OPENED,
        type: "email.bounced",
        data: { ...OPENED.data, bounce: { type: "Transient", subType: "MailboxFull" } },
      }),
    )
    expect(mocks.applyResendEmailEvent).toHaveBeenCalledWith("re_abc123", "bounced", expect.any(Date))
  })

  it("does NOT suppress on an open or a click", async () => {
    await POST(signedRequest(OPENED))
    expect(mocks.suppress).not.toHaveBeenCalled()
  })

  it("does not suppress when the bounce belongs to no sequence message", async () => {
    // No row means no tenant to suppress under. Suppression is keyed on the
    // identifier and survives merges, so guessing a business here would be a
    // cross-tenant write driven by an unauthenticated endpoint.
    //
    // sequenceMessageRecipient DELIBERATELY still returns a recipient here.
    // Mocking both it and the outcome as empty let either one satisfy the
    // assertion, so removing the `unknown_message` check survived mutation —
    // two guards masking each other. Leaving a tenant available means only the
    // real guard can keep `suppress` unreached.
    mocks.applyResendEmailEvent.mockResolvedValue("unknown_message")
    mocks.sequenceMessageRecipient.mockResolvedValue({ businessId: "biz-1", toIdentifier: "row@example.com" })
    const res = await POST(
      signedRequest({
        ...OPENED,
        type: "email.bounced",
        data: { ...OPENED.data, bounce: { type: "Permanent", subType: "General" } },
      }),
    )
    expect(res.status).toBe(200)
    expect(mocks.suppress).not.toHaveBeenCalled()
    // And the lookup itself is never reached — no row, no question to ask.
    expect(mocks.sequenceMessageRecipient).not.toHaveBeenCalled()
  })

  it("still answers 200 when the suppression write throws", async () => {
    // The engagement row is already written. A 5xx here would make Svix
    // redeliver and re-apply everything above it.
    mocks.suppress.mockRejectedValueOnce(new Error("consents unreachable"))
    const res = await POST(
      signedRequest({
        ...OPENED,
        type: "email.bounced",
        data: { ...OPENED.data, bounce: { type: "Permanent", subType: "General" } },
      }),
    )
    expect(res.status).toBe(200)
  })
})
