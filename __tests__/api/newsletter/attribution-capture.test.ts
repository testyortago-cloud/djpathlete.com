import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  addSubscriberWithAttribution: vi.fn(),
  ghlCreateContact: vi.fn(),
  captureLead: vi.fn(),
}))

vi.mock("@/lib/db/newsletter", () => ({
  addSubscriberWithAttribution: mocks.addSubscriberWithAttribution,
  addSubscriber: vi.fn(),
}))
vi.mock("@/lib/ghl", () => ({ ghlCreateContact: mocks.ghlCreateContact }))
// Partial mock: the route imports NEWSLETTER_CONSENT_WORDING from the same
// module and the real constant is what the consent test below quotes, so only
// captureLead is replaced.
vi.mock("@/lib/lead-engine/capture", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/lead-engine/capture")>()
  return { ...actual, captureLead: mocks.captureLead }
})
// The route resolves its tenant from the request's Host through the ONE Host
// boundary (lib/tenancy/public.ts). Mocked to a sentinel that is not the
// platform's, so a route that hard-codes platformBusinessId() cannot pass.
// Without this mock the real boundary calls headers() from next/headers,
// which throws outside a request scope.
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: async () => "host-biz" }))

import { POST } from "@/app/api/newsletter/route"

function jsonRequest(body: unknown, cookieHeader?: string): NextRequest {
  return new NextRequest("http://localhost/api/newsletter", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe("POST /api/newsletter — attribution capture", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.addSubscriberWithAttribution.mockResolvedValue({ subscriber_id: "sub-1" })
    mocks.ghlCreateContact.mockResolvedValue(undefined)
    mocks.captureLead.mockResolvedValue("contact-1")
  })

  it("400 on invalid email", async () => {
    const res = await POST(jsonRequest({ email: "not-an-email" }), { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
  })

  it("subscribes with no attribution when cookie absent", async () => {
    const res = await POST(jsonRequest({ email: "a@b.com", consent_marketing: true }), { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    expect(mocks.addSubscriberWithAttribution).toHaveBeenCalledWith({
      email: "a@b.com",
      session_id: undefined,
      consent_marketing: true,
      ip_address: null,
      user_agent: null,
    })
  })

  it("forwards session_id from djp_attr cookie", async () => {
    const res = await POST(
      jsonRequest({ email: "a@b.com", consent_marketing: true }, "djp_attr=abc123; foo=bar"),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(200)
    expect(mocks.addSubscriberWithAttribution).toHaveBeenCalledWith(
      expect.objectContaining({ email: "a@b.com", session_id: "abc123" }),
    )
  })

  it("defaults consent_marketing to false when omitted", async () => {
    const res = await POST(jsonRequest({ email: "a@b.com" }), { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    expect(mocks.addSubscriberWithAttribution).toHaveBeenCalledWith(
      expect.objectContaining({ consent_marketing: false }),
    )
  })

  it("carries the submitted timezone into the contact spine (G06)", async () => {
    // Without this, both the schema field and the route's passthrough can be
    // deleted with the suite green — a plain z.object STRIPS an unknown key
    // rather than erroring, so the value would just vanish.
    await POST(jsonRequest({ email: "a@b.com", consent_marketing: true, timezone: "Pacific/Auckland" }), {
      params: Promise.resolve({}),
    })
    expect(mocks.captureLead).toHaveBeenCalledWith(
      expect.objectContaining({ source: "newsletter", timezone: "Pacific/Auckland" }),
    )
  })

  it("passes a null timezone when the form sent none, rather than omitting the field", async () => {
    await POST(jsonRequest({ email: "a@b.com", consent_marketing: true }), { params: Promise.resolve({}) })
    const arg = mocks.captureLead.mock.calls[0][0] as { timezone?: string | null }
    expect(arg.timezone ?? null).toBeNull()
  })

  it("carries the djp_attr session id into the contact spine", async () => {
    // MUTANT KILLED: dropping `attributionSessionId` from this route's
    // captureLead call. The newsletter row already stored the session
    // (addSubscriberWithAttribution above); the CONTACT did not, which is the
    // caller-side half of audit §3.5.
    await POST(jsonRequest({ email: "a@b.com", consent_marketing: true }, "djp_attr=abc123; foo=bar"), {
      params: Promise.resolve({}),
    })
    expect(mocks.captureLead).toHaveBeenCalledWith(
      expect.objectContaining({ source: "newsletter", attributionSessionId: "abc123" }),
    )
  })

  it("passes a null session when there is no cookie, rather than omitting the field", async () => {
    await POST(jsonRequest({ email: "a@b.com", consent_marketing: true }), { params: Promise.resolve({}) })
    const arg = mocks.captureLead.mock.calls[0][0] as { attributionSessionId?: string | null }
    expect(arg.attributionSessionId ?? null).toBeNull()
  })
})
