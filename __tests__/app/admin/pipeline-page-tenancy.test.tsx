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
vi.mock("@/lib/db/pipeline", () => ({ readBoard: vi.fn(), listGrantablePrograms: vi.fn(), listPipelines: vi.fn() }))
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: vi.fn() }))
vi.mock("@/components/admin/pipeline-board", () => ({ PipelineBoard: () => null }))

import { requirePermission } from "@/lib/permissions/guard"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { readBoard, listGrantablePrograms, listPipelines } from "@/lib/db/pipeline"
// NOT from "@/lib/db/pipeline" — that module is mocked above, so its
// re-export of this constant would come back undefined and every assertion
// below would compare undefined to undefined. Taken from the module that
// actually defines it.
import { DEFAULT_PIPELINE_KEY } from "@/lib/lead-engine/pipeline-move"
import { ASSESSMENT_KEY } from "@/lib/lead-engine/pipeline-route"
import { getBusinessSettings } from "@/lib/db/businesses"
import PipelinePage from "@/app/(admin)/admin/pipeline/page"

const BUSINESS_ID = "33333333-3333-3333-3333-333333333333"

/** The two boards migration 00257 seeded on production, as listPipelines reports them. */
const TWO_BOARDS = [
  { id: "pipe-coaching", key: DEFAULT_PIPELINE_KEY, name: "Coaching" },
  { id: "pipe-assessment", key: ASSESSMENT_KEY, name: "Assessment" },
]

/** The page's props. Next 16 hands `searchParams` in as a Promise. */
function props(board?: string) {
  return { searchParams: Promise.resolve(board === undefined ? {} : { board }) }
}

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
  ;(listPipelines as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: "pipe-coaching", key: DEFAULT_PIPELINE_KEY, name: "Coaching" },
  ])
})

describe("PipelinePage — tenancy scoping", () => {
  // The gate this page sits behind. `/admin/pipeline` was unmapped in
  // PATH_PERMISSIONS until 2026-09-04, so the proxy default-denied every staff
  // member and requireAdmin() was the only guard that mattered. Now that a
  // coach can hold `contacts`, asserting the KEY matters: guarding on any other
  // permission would still compile, still redirect somebody, and silently gate
  // this screen on an unrelated grant.
  it("guards on the `contacts` permission", async () => {
    await PipelinePage(props())
    expect(requirePermission).toHaveBeenCalledWith("contacts")
  })

  it("passes the resolved businessId to readBoard, not the SINGLETON default", async () => {
    // MUTANT: `readBoard()` with no second argument. That is exactly the
    // bug this test exists to catch -- the pipeline would silently show the
    // platform's own board under a different business's name.
    //
    // RETARGETED by Task 8: the first argument used to be a literal
    // `undefined` (readBoard's own default), and is now the resolved board
    // key. Same claim about the tenant argument, stated against the call the
    // page actually makes.
    await PipelinePage(props())
    expect(readBoard).toHaveBeenCalledWith(DEFAULT_PIPELINE_KEY, BUSINESS_ID)
  })

  it("passes the resolved businessId to getBusinessSettings, not the SINGLETON default", async () => {
    // MUTANT: `getBusinessSettings()` with no argument.
    await PipelinePage(props())
    expect(getBusinessSettings).toHaveBeenCalledWith(BUSINESS_ID)
  })

  it("still resolves the tenant before reading the board (presence control)", async () => {
    await PipelinePage(props())
    expect(resolveAdminTenant).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Task 8 (audit §4 #7): `?board=<key>` picks which of this tenant's boards is
// shown. Before this, `/admin/pipeline` read the DEFAULT board only, so cards
// `routeToPipeline` filed on `camps_clinics` or `assessment` had no surface.
// ---------------------------------------------------------------------------

describe("PipelinePage — which board it reads", () => {
  it("reads the requested board when the tenant actually has it", async () => {
    // MUTANT: `readBoard(DEFAULT_PIPELINE_KEY, ...)` unconditionally — the
    // switcher renders, the URL changes, and the same board comes back.
    ;(listPipelines as ReturnType<typeof vi.fn>).mockResolvedValue(TWO_BOARDS)

    await PipelinePage(props(ASSESSMENT_KEY))

    expect(readBoard).toHaveBeenCalledWith(ASSESSMENT_KEY, BUSINESS_ID)
  })

  it("falls back to the default board when the key names nothing this tenant has", async () => {
    // MUTANT: pass the raw `?board` value straight to readBoard. `resolvePipeline`
    // then throws PipelineNotConfiguredError for a hand-typed key and the whole
    // page becomes the admin error boundary — reachable by editing the URL.
    ;(listPipelines as ReturnType<typeof vi.fn>).mockResolvedValue(TWO_BOARDS)

    await PipelinePage(props("nope"))

    expect(readBoard).toHaveBeenCalledWith(DEFAULT_PIPELINE_KEY, BUSINESS_ID)
  })

  it("validates the key against THIS tenant's boards, not a hardcoded list of keys", async () => {
    // The mutant the test above cannot kill on its own: a validator checking
    // `["coaching","camps_clinics","assessment"].includes(requested)` passes it
    // too. Here the tenant has NOT been seeded with Assessment (only `coaching`
    // is seeded by create_business, 00249), so a key-list validator would send
    // "assessment" through and 500 the page.
    ;(listPipelines as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "pipe-coaching", key: DEFAULT_PIPELINE_KEY, name: "Coaching" },
    ])

    await PipelinePage(props(ASSESSMENT_KEY))

    expect(readBoard).toHaveBeenCalledWith(DEFAULT_PIPELINE_KEY, BUSINESS_ID)
  })

  it("asks for this tenant's boards, not the platform's", async () => {
    await PipelinePage(props())
    expect(listPipelines).toHaveBeenCalledWith(BUSINESS_ID)
  })
})
