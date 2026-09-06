// @vitest-environment node
//
// __tests__/app/admin/events-page-tenancy.test.tsx — app/(admin)/admin/events/page.tsx
//
// Task 7 (tenancy phase 5a, events per tenant): `AdminEventsPage` called
// `getEvents()` with NO businessId, so it silently defaulted to whatever
// lib/db/events.ts's getEvents() might otherwise fall back to — every
// business's events on one screen. Not in the brief's named "Test:" list
// (which only lists the two API route suites), but the brief's own Step 5
// mutation-check targets THIS file, and nothing else in the suite covers it —
// added so that check has something to fail against.
//
// NO RENDER. `AdminEventsPage` is an async server component; this calls it
// directly and inspects the arguments its mocked dependencies were called
// with — same "NO RENDER" shape as contacts-page-tenancy.test.tsx and
// pipeline-page-tenancy.test.tsx. `EventList` is mocked to a no-op so
// importing it does not pull in its own dependency tree.
//
// Sentinel is "admin-biz", the dispatcher's chosen value for this task's
// admin-boundary mocks — never the platform id and never "host-biz" (the
// PUBLIC boundary's own sentinel).

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/tenancy/resolve", () => ({ resolveAdminTenant: vi.fn() }))
vi.mock("@/lib/db/events", () => ({ getEvents: vi.fn() }))
vi.mock("@/components/admin/events/EventList", () => ({ EventList: () => null }))

import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { getEvents } from "@/lib/db/events"
import AdminEventsPage from "@/app/(admin)/admin/events/page"

beforeEach(() => {
  vi.clearAllMocks()
  ;(resolveAdminTenant as ReturnType<typeof vi.fn>).mockResolvedValue({
    businessId: "admin-biz",
    choices: [],
    isOperator: true,
  })
  ;(getEvents as ReturnType<typeof vi.fn>).mockResolvedValue([])
})

describe("AdminEventsPage — tenancy scoping", () => {
  // MUTANT: `getEvents()` with no businessId, or `getEvents(SINGLETON_ID)`.
  // Either way every business's events would render on this one screen.
  it("passes the resolved businessId to getEvents, not the platform id", async () => {
    await AdminEventsPage()
    expect(getEvents).toHaveBeenCalledWith("admin-biz")
  })

  it("resolves the tenant before reading events (presence control)", async () => {
    await AdminEventsPage()
    expect(resolveAdminTenant).toHaveBeenCalledTimes(1)
  })
})
