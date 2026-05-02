import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  addSubscriberWithAttribution: vi.fn(),
  ghlCreateContact: vi.fn(),
}))

vi.mock("@/lib/db/newsletter", () => ({
  addSubscriberWithAttribution: mocks.addSubscriberWithAttribution,
  addSubscriber: vi.fn(),
}))
vi.mock("@/lib/ghl", () => ({ ghlCreateContact: mocks.ghlCreateContact }))

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
  })

  it("400 on invalid email", async () => {
    const res = await POST(jsonRequest({ email: "not-an-email" }))
    expect(res.status).toBe(400)
  })

  it("subscribes with no attribution when cookie absent", async () => {
    const res = await POST(jsonRequest({ email: "a@b.com", consent_marketing: true }))
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
    )
    expect(res.status).toBe(200)
    expect(mocks.addSubscriberWithAttribution).toHaveBeenCalledWith(
      expect.objectContaining({ email: "a@b.com", session_id: "abc123" }),
    )
  })

  it("defaults consent_marketing to false when omitted", async () => {
    const res = await POST(jsonRequest({ email: "a@b.com" }))
    expect(res.status).toBe(200)
    expect(mocks.addSubscriberWithAttribution).toHaveBeenCalledWith(
      expect.objectContaining({ consent_marketing: false }),
    )
  })
})
