// @vitest-environment node
//
// POST /api/newsletter — WHICH business the subscribe files under.
//
// A public route with no session, so the tenant comes from the seam in
// lib/tenancy/platform.ts. The seam is mocked to a sentinel so this proves the
// route CALLS it: a hard-coded constant would satisfy an assertion on the real
// id just as well. All three writes — the contact, the settings read behind the
// consent wording, and the consent row — must carry the same value, resolved
// once at the top of the handler.
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  addSubscriberWithAttribution: vi.fn(),
  ghlCreateContact: vi.fn(),
  recordContactEvent: vi.fn(),
  recordConsent: vi.fn(),
  getBusinessSettings: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock("@/lib/db/newsletter", () => ({ addSubscriberWithAttribution: h.addSubscriberWithAttribution }))
vi.mock("@/lib/ghl", () => ({ ghlCreateContact: h.ghlCreateContact }))
vi.mock("@/lib/db/contacts", () => ({ recordContactEvent: h.recordContactEvent }))
vi.mock("@/lib/db/contact-consents", () => ({ recordConsent: h.recordConsent }))
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: h.getBusinessSettings }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: h.recordAudit }))
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz" }))

import { POST } from "@/app/api/newsletter/route"

function req(body: Record<string, unknown>) {
  return new Request("http://localhost/api/newsletter", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  h.addSubscriberWithAttribution.mockResolvedValue({ id: "sub-1" })
  h.ghlCreateContact.mockResolvedValue(null)
  h.recordContactEvent.mockResolvedValue({ contactId: "contact-1", created: true, merged: false })
  h.recordConsent.mockResolvedValue(undefined)
  h.getBusinessSettings.mockResolvedValue({ business_id: "platform-biz", display_name: "Acme Fitness" })
})

describe("POST /api/newsletter — tenant", () => {
  it("resolves the tenant once through the seam and threads it into the contact, the settings read and the consent row", async () => {
    const res = await POST(req({ email: "sub@example.com", consent_marketing: true, consent_context: "checkbox" }), {
      params: Promise.resolve({}),
    })
    expect(res.ok).toBe(true)
    expect(h.recordContactEvent).toHaveBeenCalledTimes(1)
    expect(h.recordContactEvent.mock.calls[0][0]).toMatchObject({ businessId: "platform-biz" })
    expect(h.getBusinessSettings).toHaveBeenCalledWith("platform-biz")
    expect(h.recordConsent).toHaveBeenCalledTimes(1)
    expect(h.recordConsent.mock.calls[0][0]).toMatchObject({ businessId: "platform-biz" })
  })
})
