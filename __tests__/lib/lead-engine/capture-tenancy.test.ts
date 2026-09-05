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
