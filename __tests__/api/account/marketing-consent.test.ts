import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  setMarketingConsent: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/db/marketing-consent", () => ({
  setMarketingConsent: mocks.setMarketingConsent,
  listConsentLog: vi.fn(),
}))

import { POST } from "@/app/api/account/preferences/marketing-consent/route"

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/account/preferences/marketing-consent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/account/preferences/marketing-consent", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.setMarketingConsent.mockResolvedValue({ id: "log-1" })
  })

  it("401 when not logged in", async () => {
    mocks.auth.mockResolvedValueOnce(null)
    const res = await POST(jsonRequest({ granted: true }))
    expect(res.status).toBe(401)
  })

  it("400 on bad body", async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: "u1" } })
    const res = await POST(jsonRequest({ granted: "yes" }))
    expect(res.status).toBe(400)
  })

  it("200 grants consent with source defaulting to account_settings", async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: "u1" } })
    const res = await POST(jsonRequest({ granted: true }))
    expect(res.status).toBe(200)
    expect(mocks.setMarketingConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "u1",
        granted: true,
        source: "account_settings",
      }),
    )
  })

  it("200 revokes consent", async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: "u1" } })
    const res = await POST(jsonRequest({ granted: false }))
    expect(res.status).toBe(200)
    expect(mocks.setMarketingConsent).toHaveBeenCalledWith(
      expect.objectContaining({ granted: false }),
    )
  })
})
