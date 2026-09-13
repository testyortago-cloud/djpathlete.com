// @vitest-environment node
//
// Pinned to node: the default jsdom environment crashes on worker start
// in this repo (ERR_REQUIRE_ESM in html-encoding-sniffer), and reports as
// "Test Files no tests" rather than a failure. Without this line the suite
// silently runs nothing.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  upsertAttributionBySession: vi.fn(),
}))

vi.mock("@/lib/db/marketing-attribution", () => ({
  upsertAttributionBySession: mocks.upsertAttributionBySession,
  getUnclaimedAttribution: vi.fn(),
  claimAttribution: vi.fn(),
  findAttributionForContact: vi.fn(),
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

  it("400 when the body carries neither a tracking param NOR a landing_url", async () => {
    // MUTANT KILLED: dropping the guard entirely. A body with no tracking key
    // and no landing_url says nothing about where the visitor came from, so
    // writing a row for it would be an empty attribution record.
    const res = await POST(jsonRequest({ session_id: "abc12345" }))
    expect(res.status).toBe(400)
    expect(mocks.upsertAttributionBySession).not.toHaveBeenCalled()
  })

  it("204 and writes the row for a landing-only body (the organic /go visitor)", async () => {
    // MUTANT KILLED: restoring `if (!hasAnyTrackingParam(params))` without the
    // `&& !params.landing_url` half. This is the exact body proxy.ts now posts
    // for an untagged /go landing (audit §3.5); under the old guard it 400'd,
    // which is the second half of why 0 of 170 production contacts had a
    // session — the cookie fix alone would still have written no row.
    const res = await POST(
      jsonRequest({ session_id: "abc12345", landing_url: "https://x.example/go/a" }),
    )
    expect(res.status).toBe(204)
    expect(mocks.upsertAttributionBySession).toHaveBeenCalledWith(
      "abc12345",
      expect.objectContaining({ landing_url: "https://x.example/go/a" }),
    )
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
