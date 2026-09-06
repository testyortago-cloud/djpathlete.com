// @vitest-environment node
//
// __tests__/app/admin/faqs-page-tenancy.test.tsx — app/(admin)/admin/marketing/faqs/page.tsx
//
// Task 7 (tenancy phase 5a, events per tenant): this admin page calls
// `getPublishedEvents()` — a PUBLISHED reader, normally used by public pages
// — with no arguments at all, so it defaulted to whatever lib/db/events.ts's
// getPublishedEvents() might otherwise fall back to. Not in the brief's
// named "Test:" list; added for the same reason as the other two admin-page
// suites in this task — otherwise zero coverage of this file's threading.
//
// NO RENDER. `FaqsAdminPage` is an async server component; this calls it
// directly and inspects the arguments its mocked dependency was called
// with. `FaqManager`, `getStaticAndTemplatedFaqPages`, and `getFaqCountsByPage`
// are mocked to keep the test isolated to the events-tenancy question this
// task is about.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/tenancy/resolve", () => ({ resolveAdminTenant: vi.fn() }))
vi.mock("@/lib/db/events", () => ({ getPublishedEvents: vi.fn() }))
vi.mock("@/lib/faq/pages", () => ({ getStaticAndTemplatedFaqPages: vi.fn(() => []) }))
vi.mock("@/lib/db/faqs", () => ({ getFaqCountsByPage: vi.fn(async () => ({})) }))
vi.mock("@/app/(admin)/admin/marketing/faqs/FaqManager", () => ({ FaqManager: () => null }))

import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { getPublishedEvents } from "@/lib/db/events"
import FaqsAdminPage from "@/app/(admin)/admin/marketing/faqs/page"

beforeEach(() => {
  vi.clearAllMocks()
  ;(resolveAdminTenant as ReturnType<typeof vi.fn>).mockResolvedValue({
    businessId: "admin-biz",
    choices: [],
    isOperator: true,
  })
  ;(getPublishedEvents as ReturnType<typeof vi.fn>).mockResolvedValue([])
})

describe("FaqsAdminPage — tenancy scoping", () => {
  // MUTANT: `getPublishedEvents()` with no businessId at all — every
  // business's published events would list as FAQ pages on this screen.
  it("passes the resolved businessId to getPublishedEvents, not no argument at all", async () => {
    await FaqsAdminPage()
    expect(getPublishedEvents).toHaveBeenCalledWith("admin-biz")
  })

  it("resolves the tenant before reading events (presence control)", async () => {
    await FaqsAdminPage()
    expect(resolveAdminTenant).toHaveBeenCalledTimes(1)
  })
})
