// @vitest-environment node
//
// __tests__/app/admin/pipeline-page-tenancy.test.tsx — app/(admin)/admin/pipeline/page.tsx
//
// Final holistic review, Critical 1: `readBoard()` and `getBusinessSettings()`
// were called with NO arguments, so both silently defaulted to
// SINGLETON_BUSINESS_ID (lib/db/pipeline.ts:79, lib/db/businesses.ts:41).
// With the business switcher pointed at a second business, the page would
// render the PLATFORM's cards under the SECOND BUSINESS's name -- not a
// cross-tenant data leak (the operator owns both), but the switcher on
// screen actively asserts something false.
//
// NO RENDER. `PipelinePage` is an async server component; this calls it
// directly and inspects the arguments its mocked dependencies were called
// with -- same "NO RENDER" shape as contacts-page-tenancy.test.tsx.
// `PipelineBoard` is mocked to a no-op so importing it does not pull in its
// own dependency tree.
//
// Fixture hazard note: BUSINESS_ID below is deliberately NOT
// "00000000-0000-0000-0000-000000000001" (SINGLETON_BUSINESS_ID) -- a
// business id equal to the singleton would make the "was the resolved id
// used, not the default" assertion vacuous, since both would produce the
// same expected call.

import { describe, it, expect, vi, beforeEach } from "vitest"

// This page moved from requireAdmin() to requirePermission("contacts") on
// 2026-09-04, when /admin/contacts, /admin/pipeline and /admin/chat became
// reachable by a coach. Mocking the guard the page ACTUALLY calls is what
// keeps these tenancy assertions running; leaving the old mock in place made
// requirePermission reach the real auth() and throw "headers was called
// outside a request scope", which is a broken test, not a boundary.
vi.mock("@/lib/permissions/guard", () => ({ requirePermission: vi.fn() }))
vi.mock("@/lib/tenancy/resolve", () => ({ resolveAdminTenant: vi.fn() }))
vi.mock("@/lib/db/pipeline", () => ({ readBoard: vi.fn(), listGrantablePrograms: vi.fn() }))
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: vi.fn() }))
vi.mock("@/components/admin/pipeline-board", () => ({ PipelineBoard: () => null }))

import { requirePermission } from "@/lib/permissions/guard"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { readBoard, listGrantablePrograms } from "@/lib/db/pipeline"
import { getBusinessSettings } from "@/lib/db/businesses"
import PipelinePage from "@/app/(admin)/admin/pipeline/page"

const BUSINESS_ID = "33333333-3333-3333-3333-333333333333"

beforeEach(() => {
  vi.clearAllMocks()
  ;(requirePermission as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "admin" } })
  ;(resolveAdminTenant as ReturnType<typeof vi.fn>).mockResolvedValue({
    businessId: BUSINESS_ID,
    choices: [{ id: BUSINESS_ID, name: "Trailhead Strength", slug: "trailhead" }],
    isOperator: true,
  })
  ;(readBoard as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(getBusinessSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ display_name: "Trailhead Strength" })
  ;(listGrantablePrograms as ReturnType<typeof vi.fn>).mockResolvedValue([])
})

describe("PipelinePage — tenancy scoping", () => {
  // The gate this page sits behind. `/admin/pipeline` was unmapped in
  // PATH_PERMISSIONS until 2026-09-04, so the proxy default-denied every staff
  // member and requireAdmin() was the only guard that mattered. Now that a
  // coach can hold `contacts`, asserting the KEY matters: guarding on any other
  // permission would still compile, still redirect somebody, and silently gate
  // this screen on an unrelated grant.
  it("guards on the `contacts` permission", async () => {
    await PipelinePage()
    expect(requirePermission).toHaveBeenCalledWith("contacts")
  })

  it("passes the resolved businessId to readBoard, not the SINGLETON default", async () => {
    // MUTANT: `readBoard()` with no second argument. That is exactly the
    // bug this test exists to catch -- the pipeline would silently show the
    // platform's own board under a different business's name.
    await PipelinePage()
    expect(readBoard).toHaveBeenCalledWith(undefined, BUSINESS_ID)
  })

  it("passes the resolved businessId to getBusinessSettings, not the SINGLETON default", async () => {
    // MUTANT: `getBusinessSettings()` with no argument.
    await PipelinePage()
    expect(getBusinessSettings).toHaveBeenCalledWith(BUSINESS_ID)
  })

  it("still resolves the tenant before reading the board (presence control)", async () => {
    await PipelinePage()
    expect(resolveAdminTenant).toHaveBeenCalledTimes(1)
  })
})
