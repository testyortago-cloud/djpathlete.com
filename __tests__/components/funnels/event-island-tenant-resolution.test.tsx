// @vitest-environment node
//
// EventIsland reads its event under the business the ROUTE resolved and put on
// the render context — never under the Host it could resolve for itself (G35
// review, F4). On `/preview` and `/funnel-preview` the Host is the admin
// screen's, not the funnel's, so an island that read the Host would show a
// coach's preview a different event (or none) than `/go` shows their visitors
// for the same document. Its siblings (quiz, FAQ, testimonials) already read
// the context; this suite pins the event island to the same rule.
//
// It used to pin the opposite: that the island called `resolvePublicTenant()`
// BARE, so the `await headers()` inside could bail a static prerender to
// dynamic rendering. The island no longer resolves anything, so there is no
// signal left in it to swallow. Every route that renders it resolves a tenant
// itself before it gets here — `/go` through the Host, both previews through
// the admin session — and that is what keeps those routes dynamic.
import { describe, expect, it, vi, beforeEach } from "vitest"
import type { ReactElement } from "react"

const getEventById = vi.fn()
const resolvePublicTenant = vi.fn()

vi.mock("@/lib/db/events", () => ({ getEventById: (...a: unknown[]) => getEventById(...a) }))
// Mocked so a regression that reads the Host again is caught by the assertion
// below, rather than by the real module failing for want of request headers.
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: (...a: unknown[]) => resolvePublicTenant(...a) }))

import { EventIsland } from "@/components/funnels/islands/EventIsland"
import { renderIsland, type FunnelRenderContext } from "@/components/funnels/islands"

const ROUTE_BUSINESS = "route-biz"
const HOST_BUSINESS = "host-biz"

function contextFor(businessId: string): FunnelRenderContext {
  return {
    funnelId: "ffffffff-1111-4222-8333-444444444444",
    funnelSlug: "summer-camp",
    stepId: "3f1b7c5e-1111-4222-8333-444444444444",
    stepSlug: "index",
    isPreview: true,
    businessId,
  }
}

const PUBLISHED_EVENT = {
  id: "evt-1",
  slug: "summer-camp",
  type: "camp",
  title: "Summer Camp",
  status: "published",
  capacity: 20,
  signup_count: 5,
  location_name: "Main Field",
  start_date: "2026-11-01T09:00:00Z",
  end_date: "2026-11-01T12:00:00Z",
}

beforeEach(() => {
  vi.resetAllMocks()
  // The Host is a DIFFERENT business from the route's, as it is on both
  // preview routes. An island that resolved the Host would read under it.
  resolvePublicTenant.mockResolvedValue(HOST_BUSINESS)
})

describe("EventIsland reads under the route's business", () => {
  it("reads the event under context.businessId, not the Host", async () => {
    // MUTANT: `getEventById(await resolvePublicTenant(), eventId)` — what the
    // island did before this fix.
    getEventById.mockResolvedValue(PUBLISHED_EVENT)

    const element = await EventIsland({ props: { eventId: "evt-1" }, context: contextFor(ROUTE_BUSINESS) })

    expect(getEventById).toHaveBeenCalledWith(ROUTE_BUSINESS, "evt-1")
    expect(resolvePublicTenant).not.toHaveBeenCalled()
    // Presence: the event it found is the one it renders.
    expect((element as ReactElement<{ "data-djp-event": string }>).props["data-djp-event"]).toBe("summer-camp")
  })

  it("(control) still resolves to null when the event read fails", async () => {
    // Only the read is allowed to degrade: a page must not 500 because one
    // embedded event could not be loaded.
    getEventById.mockRejectedValue(new Error("boom"))

    await expect(
      EventIsland({ props: { eventId: "evt-1" }, context: contextFor(ROUTE_BUSINESS) }),
    ).resolves.toBeNull()
    expect(getEventById).toHaveBeenCalledWith(ROUTE_BUSINESS, "evt-1")
  })

  it("renders nothing for an event another business owns (the read answers null under this one)", async () => {
    getEventById.mockResolvedValue(null)

    await expect(
      EventIsland({ props: { eventId: "evt-1" }, context: contextFor(ROUTE_BUSINESS) }),
    ).resolves.toBeNull()
  })
})

describe("renderIsland hands the event island the page's context", () => {
  it("passes the route's own context object", () => {
    // MUTANT: `<EventIsland props={props} />` with no context (tsc refuses it
    // once the prop is required), or a context rebuilt inside renderIsland,
    // which WOULD type-check. `toBe`, so only the route's own object passes.
    const context = contextFor(ROUTE_BUSINESS)
    const element = renderIsland("event", { eventId: "evt-1" }, context) as ReactElement<{
      context: FunnelRenderContext
    }>

    expect(element.props.context).toBe(context)
  })
})
