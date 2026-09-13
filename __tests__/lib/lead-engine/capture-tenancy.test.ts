// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const recordContactEventMock = vi.fn(async (..._a: unknown[]) => ({ contactId: "c-1", created: true, merged: false }))
vi.mock("@/lib/db/contacts", () => ({
  recordContactEvent: (...a: unknown[]) => recordContactEventMock(...a),
}))

import { captureLead } from "@/lib/lead-engine/capture"

describe("captureLead tenancy", () => {
  beforeEach(() => recordContactEventMock.mockClear())

  it("forwards businessId to the contact spine", async () => {
    await captureLead({ source: "ai_chat", email: "a@b.com", businessId: "00000000-0000-0000-0000-0000000000b2" })
    expect(recordContactEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: "00000000-0000-0000-0000-0000000000b2" }),
    )
  })

  it("never substitutes the platform's own id for the tenant the caller named", async () => {
    // The inverse of the test this replaced. `businessId` is required and the
    // DAL has no default left, so the only value that can reach the contact
    // spine is the caller's — and specifically NOT the platform id a
    // reintroduced fallback would quietly swap in.
    await captureLead({ source: "ai_chat", email: "a@b.com", businessId: "00000000-0000-0000-0000-0000000000c3" })
    const forwarded = recordContactEventMock.mock.calls[0][0] as { businessId?: string }
    expect(forwarded.businessId).toBe("00000000-0000-0000-0000-0000000000c3")
    expect(forwarded.businessId).not.toBe("00000000-0000-0000-0000-000000000001")
  })
})

describe("captureLead attribution session", () => {
  beforeEach(() => recordContactEventMock.mockClear())

  it("forwards attributionSessionId to the contact spine", async () => {
    // MUTANT KILLED: dropping `attributionSessionId` from the object
    // captureLead forwards to recordContactEvent. RecordContactEventInput has
    // always had the field; CaptureLeadInput did not, so every non-funnel
    // entry point (newsletter, contact, inquiry, chat, shop, events) silently
    // dropped the visitor's session on the floor — audit §3.5.
    await captureLead({
      source: "newsletter",
      email: "a@b.com",
      businessId: "00000000-0000-0000-0000-0000000000b2",
      attributionSessionId: "sess-1",
    })
    expect(recordContactEventMock).toHaveBeenCalledWith(expect.objectContaining({ attributionSessionId: "sess-1" }))
  })

  it("forwards undefined when the caller has no session, rather than inventing one", async () => {
    await captureLead({ source: "newsletter", email: "a@b.com", businessId: "biz-1" })
    const forwarded = recordContactEventMock.mock.calls[0][0] as { attributionSessionId?: string | null }
    expect(forwarded.attributionSessionId ?? null).toBeNull()
  })
})
