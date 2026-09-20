// @vitest-environment node
//
// G07 (ledger 2026-09-19, D17). The LEGACY newsletter unsubscribe wrote one
// thing: `newsletter_subscribers.unsubscribed_at`. The Lead Engine never heard
// about it — no consent revocation, no suppression, no sequence exit — so
// someone who unsubscribed through this route kept receiving sequence email,
// which is the one outcome an unsubscribe exists to prevent.
//
// The signed-token route (lib/lead-engine/unsubscribe.ts) has always done the
// full revocation. This file pins that the legacy route now performs the SAME
// writes, by sharing that code rather than re-implementing it.
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  removeSubscriber: vi.fn(async () => undefined),
  revokeEmailConsentForContact: vi.fn(async () => undefined),
  findContactByIdentifiers: vi.fn(async () => null as string | null),
  resolvePublicTenant: vi.fn(async () => "biz-from-host"),
}))

vi.mock("@/lib/db/newsletter", () => ({ removeSubscriber: mocks.removeSubscriber }))
vi.mock("@/lib/lead-engine/unsubscribe", () => ({
  revokeEmailConsentForContact: mocks.revokeEmailConsentForContact,
}))
vi.mock("@/lib/db/contacts", () => ({ findContactByIdentifiers: mocks.findContactByIdentifiers }))
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: mocks.resolvePublicTenant }))
vi.mock("@/lib/audit/with-audit", () => ({
  withAudit: (_cfg: unknown, handler: (req: Request) => Promise<Response>) => handler,
}))

import { POST } from "@/app/api/newsletter/unsubscribe/route"

// withAudit's Handler type is (request, context). This route reads no route
// params, but the second argument is not optional.
const ctx = { params: Promise.resolve({} as Record<string, string>) }

let ipCounter = 0

function req(body: unknown, ip?: string) {
  // A FRESH ip per request by default: the route is rate-limited on it, and a
  // shared module-level bucket would otherwise make later tests in this file
  // fail depending on how many ran before them.
  const forwarded = ip ?? `198.51.100.${++ipCounter}`
  return new Request("http://localhost/api/newsletter/unsubscribe", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": forwarded },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.removeSubscriber.mockResolvedValue(undefined)
  mocks.revokeEmailConsentForContact.mockResolvedValue(undefined)
  mocks.findContactByIdentifiers.mockResolvedValue(null)
  mocks.resolvePublicTenant.mockResolvedValue("biz-from-host")
})

describe("POST /api/newsletter/unsubscribe — reaching the engine (G07)", () => {
  it("revokes consent, suppresses and exits runs when the address belongs to a contact", async () => {
    mocks.findContactByIdentifiers.mockResolvedValue("contact-9")

    const res = await POST(req({ email: "lead@example.com" }, "203.0.113.9"), ctx)

    expect(res.status).toBe(200)
    // The subscriber row is still updated — this route's original job.
    expect(mocks.removeSubscriber).toHaveBeenCalledWith("lead@example.com")
    // ...and now the engine hears about it, through the SAME helper the
    // signed-token route uses, so the two can never drift apart.
    expect(mocks.revokeEmailConsentForContact).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: "contact-9",
        email: "lead@example.com",
        businessId: "biz-from-host",
        // The ORIGIN matters as much as the call. Without it the route could
        // pass "unsubscribe_link" and silently falsify the one piece of
        // evidence that says which surface this person actually used — which
        // is the entire reason the parameter exists.
        origin: "newsletter_form",
        // And the IP, because on an endpoint where anyone can submit anyone
        // else's address it is the only thing that tells a genuine request
        // from an abusive one after the fact.
        ip: "203.0.113.9",
      }),
    )
  })

  it("looks the contact up inside the resolved tenant, never across all of them", async () => {
    mocks.findContactByIdentifiers.mockResolvedValue("contact-9")

    await POST(req({ email: "lead@example.com" }), ctx)

    expect(mocks.findContactByIdentifiers).toHaveBeenCalledWith(
      expect.objectContaining({ email: "lead@example.com", businessId: "biz-from-host" }),
    )
  })

  it("still unsubscribes the newsletter row when the address is not a contact", async () => {
    // A subscriber who never became a contact is the common legacy case. The
    // newsletter row must still be updated, and nothing engine-side attempted.
    mocks.findContactByIdentifiers.mockResolvedValue(null)

    const res = await POST(req({ email: "only-a-subscriber@example.com" }), ctx)

    expect(res.status).toBe(200)
    expect(mocks.removeSubscriber).toHaveBeenCalledWith("only-a-subscriber@example.com")
    expect(mocks.revokeEmailConsentForContact).not.toHaveBeenCalled()
  })

  it("still answers 200 when the engine writes throw — the unsubscribe itself must not fail", async () => {
    // The person asked to stop hearing from us. Answering 500 invites a retry
    // and, worse, makes the UI tell them it did not work when the subscriber
    // row has already been updated.
    mocks.findContactByIdentifiers.mockResolvedValue("contact-9")
    mocks.revokeEmailConsentForContact.mockRejectedValueOnce(new Error("consents unreachable"))

    const res = await POST(req({ email: "lead@example.com" }), ctx)

    expect(res.status).toBe(200)
    expect(mocks.removeSubscriber).toHaveBeenCalled()
  })

  it("throttles a script hammering the endpoint, because anyone can post anyone's address", async () => {
    // The stage1b design rejected extending this route precisely because it is
    // an unauthenticated raw-email POST. G07 widened what that buys an
    // attacker from a newsletter row to a consent revocation, a suppression
    // and destroyed sequence runs, so the rate it can be driven at is bounded.
    mocks.findContactByIdentifiers.mockResolvedValue("contact-9")
    const attacker = "192.0.2.77"

    const codes: number[] = []
    for (let i = 0; i < 7; i++) {
      const res = await POST(req({ email: `victim${i}@example.com` }, attacker), ctx)
      codes.push(res.status)
    }

    expect(codes.filter((c) => c === 200)).toHaveLength(5)
    expect(codes.filter((c) => c === 429)).toHaveLength(2)
  })

  it("rejects a malformed address before touching anything", async () => {
    const res = await POST(req({ email: "not-an-email" }), ctx)

    expect(res.status).toBe(400)
    expect(mocks.removeSubscriber).not.toHaveBeenCalled()
    expect(mocks.revokeEmailConsentForContact).not.toHaveBeenCalled()
  })
})
