import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  upsertAttributionBySession: vi.fn(),
}))

vi.mock("@/lib/db/marketing-attribution", () => ({
  upsertAttributionBySession: mocks.upsertAttributionBySession,
  getUnclaimedAttribution: vi.fn(),
  claimAttribution: vi.fn(),
  findAttributionByEmail: vi.fn(),
}))

import { POST } from "@/app/api/public/attribution/track/route"

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/public/attribution/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/public/attribution/track", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.upsertAttributionBySession.mockResolvedValue({ id: "attr-1" })
  })

  it("400 when session_id missing", async () => {
    const res = await POST(jsonRequest({ gclid: "x" }))
    expect(res.status).toBe(400)
  })

  it("400 when no tracking param is present", async () => {
    const res = await POST(jsonRequest({ session_id: "abc12345" }))
    expect(res.status).toBe(400)
  })

  it("204 when valid body with at least one tracking param", async () => {
    const res = await POST(jsonRequest({ session_id: "abc12345", gclid: "g1" }))
    expect(res.status).toBe(204)
    expect(mocks.upsertAttributionBySession).toHaveBeenCalledWith(
      "abc12345",
      expect.objectContaining({ gclid: "g1" }),
    )
  })

  it("204 when only utm params are present", async () => {
    const res = await POST(jsonRequest({
      session_id: "abc12345",
      utm_source: "google",
      utm_campaign: "launch",
    }))
    expect(res.status).toBe(204)
  })

  it("never throws on DB error — returns 204 to avoid blocking landings", async () => {
    mocks.upsertAttributionBySession.mockRejectedValueOnce(new Error("DB exploded"))
    const res = await POST(jsonRequest({ session_id: "abc12345", gclid: "g1" }))
    expect(res.status).toBe(204)
  })
})
