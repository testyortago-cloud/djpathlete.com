// @vitest-environment node
import { describe, it, expect, vi } from "vitest"

const recordContactEvent = vi.fn(async () => ({ contactId: "c1", created: true, merged: false }))
vi.mock("@/lib/db/contacts", () => ({ recordContactEvent }))

describe("funnel submit → contact spine", () => {
  it("passes the submitted identifiers and the attribution session through", async () => {
    const { captureContactFromSubmission } = await import("@/lib/funnels/capture-contact")
    await captureContactFromSubmission({
      name: "Marissa",
      email: "Marissa@Example.com",
      phone: "617-650-4548",
      attributionSessionId: "sess-123",
      payload: { sport: "lacrosse" },
      businessId: "platform-biz",
    })
    expect(recordContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "Marissa@Example.com",
        phone: "617-650-4548",
        name: "Marissa",
        source: "funnel_form",
        attributionSessionId: "sess-123",
        businessId: "platform-biz",
      }),
    )
  })

  it("never throws when the contact write fails — the submission still stands", async () => {
    recordContactEvent.mockRejectedValueOnce(new Error("PGRST204 column missing"))
    const { captureContactFromSubmission } = await import("@/lib/funnels/capture-contact")
    await expect(
      captureContactFromSubmission({
        name: "X",
        email: "x@y.com",
        phone: null,
        attributionSessionId: null,
        payload: {},
        businessId: "platform-biz",
      }),
    ).resolves.toBeNull()
  })
})
