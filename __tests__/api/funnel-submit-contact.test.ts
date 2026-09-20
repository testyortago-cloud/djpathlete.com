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

  it("carries the submitted timezone through the bridge (G06)", async () => {
    // Without this the bridge's `timezone` parameter and the submit route's
    // schema field are both deletable with the suite green — a plain z.object
    // STRIPS an unknown key rather than erroring, so the value just vanishes.
    const { captureContactFromSubmission } = await import("@/lib/funnels/capture-contact")
    await captureContactFromSubmission({
      name: "Marissa",
      email: "marissa@example.com",
      phone: null,
      attributionSessionId: null,
      payload: {},
      businessId: "platform-biz",
      timezone: "Pacific/Auckland",
    })
    expect(recordContactEvent).toHaveBeenCalledWith(expect.objectContaining({ timezone: "Pacific/Auckland" }))
  })

  // G10. The bridge now carries two kinds of thing: what the VISITOR typed
  // (`payload`) and what the SERVER worked out about the form (`metadata`).
  it("merges the server-derived facts over the visitor's payload", async () => {
    const { captureContactFromSubmission } = await import("@/lib/funnels/capture-contact")
    await captureContactFromSubmission({
      name: "Marissa",
      email: "marissa@example.com",
      phone: null,
      attributionSessionId: null,
      payload: { sport: "lacrosse" },
      businessId: "platform-biz",
      metadata: { role: "parent" },
    })
    expect(recordContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { sport: "lacrosse", role: "parent" } }),
    )
  })

  it("lets the server's answer WIN when an owner has named a form field after one of ours", async () => {
    // A funnel field's name is owner-chosen and validated only as
    // `^[a-z][a-z0-9_]{0,39}$`, so `role` is a legal field name and its
    // value is whatever a stranger typed. What the form DECLARES about
    // itself has to beat that — and `role` is one of the seven keys that
    // reaches `sequence_runs.enrolment_metadata`.
    const { captureContactFromSubmission } = await import("@/lib/funnels/capture-contact")
    await captureContactFromSubmission({
      name: "Marissa",
      email: "marissa@example.com",
      phone: null,
      attributionSessionId: null,
      payload: { role: "whatever the visitor typed" },
      businessId: "platform-biz",
      metadata: { role: "parent" },
    })
    expect(recordContactEvent).toHaveBeenCalledWith(expect.objectContaining({ metadata: { role: "parent" } }))
  })

  it("still passes the payload alone when there are no server-derived facts", async () => {
    const { captureContactFromSubmission } = await import("@/lib/funnels/capture-contact")
    await captureContactFromSubmission({
      name: "Marissa",
      email: "marissa@example.com",
      phone: null,
      attributionSessionId: null,
      payload: { sport: "lacrosse" },
      businessId: "platform-biz",
    })
    expect(recordContactEvent).toHaveBeenCalledWith(expect.objectContaining({ metadata: { sport: "lacrosse" } }))
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
