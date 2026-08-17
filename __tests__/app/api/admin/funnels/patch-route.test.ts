// __tests__/app/api/admin/funnels/patch-route.test.ts
//
// THE DEFECT THIS FILE EXISTS FOR: `funnel-publish-route.test.ts` documents
// that taking a funnel live used to be `PATCH /api/admin/funnels/[id]` with
// `{status:"published"}`, which validated the body and wrote — never looking
// at the funnel's steps. `POST .../publish` replaced that for the UI, but the
// UI switching doorways is not a guard: a direct PATCH to this route skipped
// every gate the UI now runs, same shape as the defect documented in
// `steps/[stepId]/publish/route.ts`'s header. This route must refuse
// `status:"published"` for a funnel itself, while still letting a landing
// page publish through the same body, and still letting unpublish/archive
// through for both kinds.
//
// EVERY TEST NAMES THE MUTANT IT KILLS.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/funnels", () => ({
  getFunnelById: vi.fn(),
  updateFunnel: vi.fn(),
  deleteFunnel: vi.fn(),
  listSteps: vi.fn(),
}))

import { PATCH } from "@/app/api/admin/funnels/[id]/route"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { getFunnelById, updateFunnel } from "@/lib/db/funnels"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const FUNNEL_ID = "ffffffff-1111-4222-8333-444444444444"
const ADMIN_ID = "aaaaaaaa-1111-4222-8333-444444444444"

const FUNNEL_ROW = { id: FUNNEL_ID, slug: "free-trial-week", name: "Free Trial Week", kind: "funnel", status: "draft" }
const PAGE_ROW = { id: FUNNEL_ID, slug: "coaching", name: "Coaching", kind: "page", status: "draft" }

function patch(body: unknown): Request {
  return new Request(`http://localhost/api/admin/funnels/${FUNNEL_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

const ctx = { params: Promise.resolve({ id: FUNNEL_ID }) }

beforeEach(() => {
  vi.clearAllMocks()
  mock(auth).mockResolvedValue({ user: { id: ADMIN_ID, role: "admin" } })
  mock(canAccessAdminPath).mockResolvedValue(true)
  mock(getFunnelById).mockResolvedValue(FUNNEL_ROW)
  mock(updateFunnel).mockImplementation(async (id: string, data: Record<string, unknown>) => ({
    ...FUNNEL_ROW,
    ...data,
  }))
})

describe("PATCH /api/admin/funnels/[id]", () => {
  it("refuses to publish a funnel directly, and writes NOTHING", async () => {
    const response = await PATCH(patch({ status: "published" }) as never, ctx as never)

    // MUTANT: checking `kind` but not returning early, falling through to the
    // write anyway. The status code alone cannot see that — only the absence
    // of the call can.
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toContain("publish")
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })

  it("still publishes a landing page through this route", async () => {
    mock(getFunnelById).mockResolvedValue(PAGE_ROW)

    const response = await PATCH(patch({ status: "published" }) as never, ctx as never)

    // MUTANT: refusing every `status:"published"` regardless of `kind`, which
    // would break the landing-page path this route still legitimately serves.
    expect(response.status).toBe(200)
    expect(mock(updateFunnel)).toHaveBeenCalledWith(FUNNEL_ID, { status: "published" })
  })

  it("still unpublishes (drafts) a funnel through this route", async () => {
    mock(getFunnelById).mockResolvedValue({ ...FUNNEL_ROW, status: "published" })

    const response = await PATCH(patch({ status: "draft" }) as never, ctx as never)

    // MUTANT: refusing every status change on a funnel-kind row, not just
    // `"published"`. Taking something off the air has nothing to gate.
    expect(response.status).toBe(200)
    expect(mock(updateFunnel)).toHaveBeenCalledWith(FUNNEL_ID, { status: "draft" })
  })

  it("still archives a funnel through this route", async () => {
    const response = await PATCH(patch({ status: "archived" }) as never, ctx as never)

    expect(response.status).toBe(200)
    expect(mock(updateFunnel)).toHaveBeenCalledWith(FUNNEL_ID, { status: "archived" })
  })

  it("still renames a funnel with no status field, without reading the row", async () => {
    const response = await PATCH(patch({ name: "New name" }) as never, ctx as never)

    expect(response.status).toBe(200)
    // MUTANT: reading `getFunnelById` unconditionally instead of only when
    // `status === "published"` is present. A rename has no status to gate, so
    // a route that fetches anyway would 404 a funnel someone renamed in the
    // same request a lookup failed for no reason tied to the write it made.
    expect(mock(getFunnelById)).not.toHaveBeenCalled()
    expect(mock(updateFunnel)).toHaveBeenCalledWith(FUNNEL_ID, { name: "New name" })
  })

  it("404s publishing a funnel id that no longer exists, and writes nothing", async () => {
    mock(getFunnelById).mockResolvedValue(null)

    const response = await PATCH(patch({ status: "published" }) as never, ctx as never)

    expect(response.status).toBe(404)
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })

  it("refuses a non-admin", async () => {
    mock(canAccessAdminPath).mockResolvedValue(false)
    const response = await PATCH(patch({ status: "published" }) as never, ctx as never)
    expect(response.status).toBe(403)
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })
})
