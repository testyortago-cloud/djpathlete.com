// @vitest-environment node
//
// Three outcomes, and the fourth thing that is NOT an outcome: a read failure.
// If a failed lookup returned "unknown" or fell through to the platform ramp,
// a transient database fault would file one coach's booking into another
// coach's tenant -- silently, with a 200, and with no way to tell afterwards.
// So the read throws and the route answers 500, which Calendly retries.
import { describe, it, expect, vi, beforeEach } from "vitest"

const findByEventType = vi.fn()
vi.mock("@/lib/db/coach-calendar-connections", () => ({
  findCoachCalendarConnectionByEventType: (...a: unknown[]) => findByEventType(...a),
}))

import { resolveCalendlyTenant } from "@/lib/bookings/calendly-tenant"

beforeEach(() => {
  findByEventType.mockReset()
  delete process.env.CALENDLY_EVENT_TYPE_URI
})

describe("resolveCalendlyTenant", () => {
  it("returns the CONNECTION's ids when an event type matches", async () => {
    findByEventType.mockResolvedValue({ id: "conn-9", business_id: "biz-9", host_id: "host-9" })
    const t = await resolveCalendlyTenant("https://api.calendly.com/event_types/E9")
    expect(t).toEqual({ kind: "connection", businessId: "biz-9", hostId: "host-9", connectionId: "conn-9" })
  })

  it("takes the platform ramp only when the env event type matches exactly", async () => {
    findByEventType.mockResolvedValue(null)
    process.env.CALENDLY_EVENT_TYPE_URI = "https://api.calendly.com/event_types/ENV"
    const t = await resolveCalendlyTenant("https://api.calendly.com/event_types/ENV", {
      platformBusinessId: () => "biz-platform", platformHostId: async () => "host-platform",
    })
    expect(t).toEqual({ kind: "platform", businessId: "biz-platform", hostId: "host-platform" })
  })

  it("is unknown when neither a row nor the env matches", async () => {
    findByEventType.mockResolvedValue(null)
    process.env.CALENDLY_EVENT_TYPE_URI = "https://api.calendly.com/event_types/ENV"
    expect(await resolveCalendlyTenant("https://api.calendly.com/event_types/OTHER")).toEqual({ kind: "unknown" })
  })

  it("is unknown for a delivery carrying no event type — it cannot be proven to belong to anyone", async () => {
    process.env.CALENDLY_EVENT_TYPE_URI = "https://api.calendly.com/event_types/ENV"
    expect(await resolveCalendlyTenant(null)).toEqual({ kind: "unknown" })
    expect(findByEventType).not.toHaveBeenCalled()
  })

  it("is unknown when nothing matches AND no env is configured", async () => {
    findByEventType.mockResolvedValue(null)
    expect(await resolveCalendlyTenant("https://api.calendly.com/event_types/E1")).toEqual({ kind: "unknown" })
  })

  it("PROPAGATES a read failure — it must never be mistaken for 'no match'", async () => {
    findByEventType.mockRejectedValue(new Error("connection read failed (PGRST301)"))
    process.env.CALENDLY_EVENT_TYPE_URI = "https://api.calendly.com/event_types/E1"
    await expect(resolveCalendlyTenant("https://api.calendly.com/event_types/E1")).rejects.toThrow(/PGRST301/)
  })
})
