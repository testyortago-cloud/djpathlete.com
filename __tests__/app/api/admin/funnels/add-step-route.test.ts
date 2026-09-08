// __tests__/app/api/admin/funnels/add-step-route.test.ts
//
// THE DEFECT THIS FILE EXISTS FOR, found by review of the convert branch:
// `/admin/funnels/[id]` has rendered `AddStepDialog` only when
// `kind === "funnel"` since the boards were split, and its comment states that
// a landing page "is single-page by definition". The ROUTE never checked —
// it read the funnel only to 404. So the rule lived entirely on a button.
//
// WHY IT IS WORTH A GUARD RATHER THAN A SHRUG. A `kind === "page"` row has two
// doors to publication that a funnel does not: `PATCH /api/admin/funnels/[id]`
// accepts `{status:"published"}` for a page, and `steps/[stepId]/publish` flips
// a page's row LIVE as a side effect of publishing one step. A page that had
// grown extra pages could therefore go public with those pages unbuilt — the
// "live funnel whose own buttons 404" state that `[id]/publish/route.ts` and
// its three gates exist to prevent, reached without touching a funnel.
//
// It is also what makes the convert route's guard hold over time. That guard
// counts steps at ONE INSTANT; without this line the row grows a second page
// the next request and "a landing page is one page" quietly stops being true.
//
// EVERY TEST NAMES THE MUTANT IT KILLS.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/funnels", () => ({
  getFunnelById: vi.fn(),
  createStep: vi.fn(),
}))

import { POST } from "@/app/api/admin/funnels/steps/route"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { getFunnelById, createStep } from "@/lib/db/funnels"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const FUNNEL_ID = "ffffffff-1111-4222-8333-444444444444"
const ADMIN_ID = "aaaaaaaa-1111-4222-8333-444444444444"

const FUNNEL_ROW = { id: FUNNEL_ID, slug: "free-trial-week", name: "Free Trial Week", kind: "funnel", status: "draft" }
const PAGE_ROW = { id: FUNNEL_ID, slug: "coaching", name: "Coaching", kind: "page", status: "draft" }

function addStep(body: unknown): Request {
  return new Request("http://localhost/api/admin/funnels/steps", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

const VALID = { funnel_id: FUNNEL_ID, slug: "thanks", name: "Thanks" }

beforeEach(() => {
  vi.resetAllMocks()
  mock(auth).mockResolvedValue({ user: { id: ADMIN_ID, role: "admin" } })
  mock(canAccessAdminPath).mockResolvedValue(true)
  mock(getFunnelById).mockResolvedValue(FUNNEL_ROW)
  mock(createStep).mockImplementation(async (data: Record<string, unknown>) => ({ id: "new-step", ...data }))
})

describe("POST /api/admin/funnels/steps", () => {
  it("adds a page to a FUNNEL", async () => {
    const response = await POST(addStep(VALID) as never, {} as never)

    // THE PRESENCE CONTROL for the refusal below. Without it a guard that
    // rejected every request would pass the next test and look correct.
    expect(response.status).toBe(201)
    expect(mock(createStep)).toHaveBeenCalledWith(VALID)
  })

  it("REFUSES to add a page to a landing page, and writes NOTHING", async () => {
    mock(getFunnelById).mockResolvedValue(PAGE_ROW)

    const response = await POST(addStep(VALID) as never, {} as never)

    // MUTANT: dropping the `kind === "page"` check. Nothing else in this route
    // would notice — the insert succeeds, 201 comes back, and the row is a
    // two-page "landing page" whose second page no admin screen can reach and
    // whose publish path skips the funnel gates.
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain("one page")
    expect(mock(createStep)).not.toHaveBeenCalled()
  })

  it("refuses a non-admin before reading any funnel", async () => {
    mock(canAccessAdminPath).mockResolvedValue(false)

    const response = await POST(addStep(VALID) as never, {} as never)

    expect(response.status).toBe(403)
    expect(mock(getFunnelById)).not.toHaveBeenCalled()
    expect(mock(createStep)).not.toHaveBeenCalled()
  })

  it("404s on a funnel that does not exist", async () => {
    mock(getFunnelById).mockResolvedValue(null)

    const response = await POST(addStep(VALID) as never, {} as never)

    // MUTANT: ordering the kind check before the null check — `null.kind`
    // throws, and the route answers 500 for a request that is merely stale.
    expect(response.status).toBe(404)
    expect(mock(createStep)).not.toHaveBeenCalled()
  })
})
