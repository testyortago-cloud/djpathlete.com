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

  it("omits businessId when the caller gives none, so the DAL default still applies", async () => {
    await captureLead({ source: "ai_chat", email: "a@b.com" })
    expect(recordContactEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: undefined }),
    )
  })
})
