// @vitest-environment node
//
// EventIsland calls `await resolvePublicTenant()` BARE, deliberately outside
// the try/catch that wraps only the getEventById read (see the comment inside
// components/funnels/islands/EventIsland.tsx). That placement is load-bearing:
// resolvePublicTenant() internally calls `await headers()`, which Next throws
// from to signal dynamic rendering during a static prerender (and, under PPR,
// throws a React postpone signal that must not be caught). Moving the resolve
// call back inside the try would swallow that signal and silently prerender
// the island under the wrong tenant -- and today no test would fail if that
// regressed. This suite pins it.
import { describe, expect, it, vi, beforeEach } from "vitest"

const getEventById = vi.fn()
const resolvePublicTenant = vi.fn()

vi.mock("@/lib/db/events", () => ({ getEventById: (...a: unknown[]) => getEventById(...a) }))
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: (...a: unknown[]) => resolvePublicTenant(...a) }))

import { EventIsland } from "@/components/funnels/islands/EventIsland"

beforeEach(() => {
  vi.resetAllMocks()
})

describe("EventIsland tenant resolution", () => {
  it("propagates a rejected resolvePublicTenant() instead of swallowing it into null", async () => {
    resolvePublicTenant.mockRejectedValue(new Error("DYNAMIC_SERVER_USAGE"))
    await expect(EventIsland({ props: { eventId: "evt-1" } })).rejects.toThrow("DYNAMIC_SERVER_USAGE")
    // The tenant must be settled before the event read is even attempted.
    expect(getEventById).not.toHaveBeenCalled()
  })

  // Presence control: without this, the test above could pass for the wrong
  // reason (e.g. EventIsland always rejecting, or never reaching either call).
  // Only getEventById's own catch is supposed to degrade to null -- prove that
  // path is untouched by this change.
  it("(control) still resolves to null when only the event read fails", async () => {
    resolvePublicTenant.mockResolvedValue("biz-1")
    getEventById.mockRejectedValue(new Error("boom"))
    await expect(EventIsland({ props: { eventId: "evt-1" } })).resolves.toBeNull()
    expect(resolvePublicTenant).toHaveBeenCalledTimes(1)
    expect(getEventById).toHaveBeenCalledWith("biz-1", "evt-1")
  })
})
