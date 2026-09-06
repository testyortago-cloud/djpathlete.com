// @vitest-environment node
//
// __tests__/app/admin/events-detail-page-tenancy.test.tsx — app/(admin)/admin/events/[id]/page.tsx
//
// Task 7 (tenancy phase 5a, events per tenant): `EditEventPage` called
// `getEventById(id)` and `getSignupsForEvent(id)` with no leading
// businessId, so both silently defaulted to whatever lib/db/events.ts and
// lib/db/event-signups.ts's readers might otherwise fall back to —
// TypeScript cannot catch either drop, since both remaining calls are still
// single-string-argument shaped after the swap. Not in the brief's named
// "Test:" list, added for the same reason as events-page-tenancy.test.tsx:
// there is otherwise zero coverage of this file's tenant threading.
//
// NO RENDER. `EditEventPage` is an async server component; this calls it
// directly and inspects the arguments its mocked dependencies were called
// with. `EventForm` and `SignupsTable` are mocked to no-ops so importing
// them does not pull in their own dependency trees.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/tenancy/resolve", () => ({ resolveAdminTenant: vi.fn() }))
vi.mock("@/lib/db/events", () => ({ getEventById: vi.fn() }))
vi.mock("@/lib/db/event-signups", () => ({ getSignupsForEvent: vi.fn() }))
vi.mock("@/components/admin/events/EventForm", () => ({ EventForm: () => null }))
vi.mock("@/components/admin/events/SignupsTable", () => ({ SignupsTable: () => null }))

import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { getEventById } from "@/lib/db/events"
import { getSignupsForEvent } from "@/lib/db/event-signups"
import EditEventPage from "@/app/(admin)/admin/events/[id]/page"

const EVENT = { id: "evt-1", status: "draft", slug: "s" }

async function renderPage() {
  return EditEventPage({ params: Promise.resolve({ id: "evt-1" }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(resolveAdminTenant as ReturnType<typeof vi.fn>).mockResolvedValue({
    businessId: "admin-biz",
    choices: [],
    isOperator: true,
  })
  ;(getEventById as ReturnType<typeof vi.fn>).mockResolvedValue(EVENT)
  ;(getSignupsForEvent as ReturnType<typeof vi.fn>).mockResolvedValue([])
})

describe("EditEventPage — tenancy scoping", () => {
  // MUTANT: `getEventById(id)` with no leading businessId — a wrong-tenant
  // event id would resolve to null (404 via notFound()) OR, worse, to
  // another tenant's row if the DAL's own predicate were the only guard.
  it("passes the resolved businessId to getEventById, not the platform id", async () => {
    await renderPage()
    expect(getEventById).toHaveBeenCalledWith("admin-biz", "evt-1")
  })

  // MUTANT: `getSignupsForEvent(id)` with no leading businessId.
  it("passes the resolved businessId to getSignupsForEvent, not the platform id", async () => {
    await renderPage()
    expect(getSignupsForEvent).toHaveBeenCalledWith("admin-biz", "evt-1")
  })

  it("resolves the tenant before reading the event (presence control)", async () => {
    await renderPage()
    expect(resolveAdminTenant).toHaveBeenCalledTimes(1)
  })
})
